/**
 * better-sqlite3 Auth State (default local backend)
 * Single DB handle, WAL, prepared statements, serial write queue.
 */

import Database from "better-sqlite3";
import { initAuthCreds, proto } from "baileys";
import { BufferJSON, sanitizeKey, makeStorageKey, trimClosedRatchets } from "./bufferJson.js";
import { createTtlCache } from "../utils/cache.js";

/**
 * @param {string} dbPath
 * @returns {Promise<{ state: object, saveCreds: Function, clearAuthState: Function, hasCreds: Function }>}
 */
export async function useBetterSqliteAuthState(dbPath) {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -2000"); // Bound SQLite page cache to ~2MB
  db.pragma("mmap_size = 0"); // Prevent OS page cache RSS bloat
  db.pragma("wal_autocheckpoint = 200");

  db.exec(`
    CREATE TABLE IF NOT EXISTS AuthState (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS BotKV (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);

  const stmtGet = db.prepare("SELECT value FROM AuthState WHERE key = ?");
  const stmtGetMany = db.prepare(
    "SELECT key, value FROM AuthState WHERE key IN (SELECT value FROM json_each(?))"
  );
  const stmtUpsert = db.prepare(
    "INSERT INTO AuthState (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const stmtDelete = db.prepare("DELETE FROM AuthState WHERE key = ?");
  const stmtClear = db.prepare("DELETE FROM AuthState");
  const stmtHasCreds = db.prepare(
    "SELECT 1 AS ok FROM AuthState WHERE key = ? LIMIT 1"
  );

  const stmtKvGet = db.prepare("SELECT value FROM BotKV WHERE key = ?");
  const stmtKvUpsert = db.prepare(
    "INSERT INTO BotKV (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const stmtKvDelete = db.prepare("DELETE FROM BotKV WHERE key = ?");

  // Hoist single reusable batch transaction for Signal keys
  const upsertManyTx = db.transaction((entries) => {
    for (const { key, value } of entries) {
      if (value) {
        stmtUpsert.run(
          sanitizeKey(key),
          JSON.stringify(value, BufferJSON.replacer)
        );
      } else {
        stmtDelete.run(sanitizeKey(key));
      }
    }
  });

  // Hot in-memory cache for BotKV reads (reduces synchronous SQLite + JSON.parse overhead)
  const kvCache = createTtlCache({ ttlMs: 5 * 60 * 1000, max: 200 });
  const KV_MISS = Symbol("KV_MISS");

  /** Serial write queue — one async chain (bounded memory vs per-key Map) */
  let writeChain = Promise.resolve();

  function enqueueWrite(fn) {
    writeChain = writeChain.then(fn).catch((err) => {
      console.error("[auth-sqlite] write queue error:", err?.message || err);
    });
    return writeChain;
  }

  function readData(key) {
    try {
      const sanitized = sanitizeKey(key);
      const row = stmtGet.get(sanitized);
      if (!row?.value) return null;
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch (err) {
      console.error(`[auth-sqlite] read failed (${key}):`, err?.message || err);
      return null;
    }
  }

  function writeDataSync(data, key) {
    const sanitized = sanitizeKey(key);
    const jsonData = JSON.stringify(data, BufferJSON.replacer);
    stmtUpsert.run(sanitized, jsonData);
  }

  async function writeData(data, key) {
    return enqueueWrite(async () => writeDataSync(data, key));
  }

  async function removeData(key) {
    return enqueueWrite(async () => {
      try {
        stmtDelete.run(sanitizeKey(key));
      } catch (err) {
        console.error(`[auth-sqlite] delete failed (${key}):`, err?.message || err);
      }
    });
  }

  let creds = readData("creds.json");
  if (!creds) {
    console.log("No existing credentials found, initializing new auth state...");
    creds = initAuthCreds();
    writeDataSync(creds, "creds.json");
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        if (!ids?.length) return data;

        try {
          const keys = ids.map((id) => makeStorageKey(type, id));
          const rows = stmtGetMany.all(JSON.stringify(keys));
          const byKey = new Map(rows.map((r) => [r.key, r.value]));

          for (const id of ids) {
            const storageKey = makeStorageKey(type, id);
            const raw = byKey.get(storageKey);
            if (!raw) {
              data[id] = null;
              continue;
            }
            try {
              let value = JSON.parse(raw, BufferJSON.reviver);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.create(value);
              }
              data[id] = value;
            } catch {
              data[id] = null;
            }
          }
        } catch (err) {
          // Fallback: per-key reads
          console.error("[auth-sqlite] batch get failed, falling back:", err?.message || err);
          for (const id of ids) {
            let value = readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              try {
                value = proto.Message.AppStateSyncKeyData.create(value);
              } catch {
                value = null;
              }
            }
            data[id] = value;
          }
        }

        return data;
      },

      set: async (data) => {
        return enqueueWrite(async () => {
          const entries = [];
          for (const category in data) {
            for (const id in data[category]) {
              entries.push({
                key: `${category}-${id}.json`,
                value: data[category][id],
              });
            }
          }
          if (entries.length) {
            upsertManyTx(entries);
          }
        });
      },
    },
  };

  // Debounced saveCreds coalesces bursts of creds.update while flush()/close() saves immediately
  let credsTimer = null;
  let credsDirty = false;
  const saveCreds = async () => {
    credsDirty = true;
    if (credsTimer) return;
    credsTimer = setTimeout(() => {
      credsTimer = null;
      if (credsDirty && db.open) {
        credsDirty = false;
        writeData(creds, "creds.json").catch(() => {});
      }
    }, 250);
  };

  const clearAuthState = async () => {
    if (credsTimer) {
      clearTimeout(credsTimer);
      credsTimer = null;
    }
    credsDirty = false;
    kvCache.clear();
    return enqueueWrite(async () => {
      stmtClear.run();
    });
  };

  const hasCreds = () => {
    try {
      return !!stmtHasCreds.get(sanitizeKey("creds.json"));
    } catch {
      return false;
    }
  };

  const botKv = {
    get(key) {
      const k = String(key);
      const cached = kvCache.get(k);
      if (cached !== undefined) {
        return cached === KV_MISS ? null : cached;
      }
      try {
        const row = stmtKvGet.get(k);
        if (!row?.value) {
          kvCache.set(k, KV_MISS);
          return null;
        }
        const parsed = JSON.parse(row.value);
        kvCache.set(k, parsed);
        return parsed;
      } catch (err) {
        console.error(`[botkv-sqlite] get failed (${k}):`, err?.message || err);
        return null;
      }
    },
    async set(key, value) {
      const k = String(key);
      if (value === null || value === undefined) {
        kvCache.set(k, KV_MISS);
      } else {
        kvCache.set(k, value);
      }
      return enqueueWrite(async () => {
        if (value === null || value === undefined) {
          stmtKvDelete.run(k);
          return;
        }
        stmtKvUpsert.run(k, JSON.stringify(value));
      });
    },
    async del(key) {
      const k = String(key);
      kvCache.set(k, KV_MISS);
      return enqueueWrite(async () => {
        stmtKvDelete.run(k);
      });
    },
  };

  const purgeSession = (target) => {
    try {
      const cleanTarget = String(target).split("_")[0].split(".")[0];
      const stmtPurge = db.prepare(
        "DELETE FROM AuthState WHERE key LIKE ? OR key LIKE ?"
      );
      const res = stmtPurge.run(`%${cleanTarget}%`, `sender-key-%${cleanTarget}%`);
      return res.changes;
    } catch (err) {
      console.error("[auth-sqlite] purgeSession error:", err?.message || err);
      return 0;
    }
  };

  const flush = async () => {
    if (credsTimer) {
      clearTimeout(credsTimer);
      credsTimer = null;
    }
    if (credsDirty && db.open) {
      credsDirty = false;
      await writeData(creds, "creds.json").catch(() => {});
    }
    await writeChain.catch(() => {});
    if (db.open) {
      try {
        db.pragma("wal_checkpoint(PASSIVE)");
      } catch {
        /* ignore checkpoint errors */
      }
    }
  };

  const getStats = () => {
    try {
      const rows = db.prepare("SELECT key FROM AuthState").all();
      const kvCountRow = db.prepare("SELECT COUNT(*) AS cnt FROM BotKV").get();
      let sessions = 0;
      let preKeys = 0;
      let senderKeys = 0;
      let appStateSyncKeys = 0;
      let other = 0;
      let hasCredsKey = false;

      for (const r of rows) {
        const k = r.key || "";
        if (k === "creds.json") hasCredsKey = true;
        else if (k.startsWith("session-")) sessions++;
        else if (k.startsWith("pre-key-")) preKeys++;
        else if (k.startsWith("sender-key-")) senderKeys++;
        else if (k.startsWith("app-state-sync-")) appStateSyncKeys++;
        else other++;
      }

      return {
        backend: "sqlite",
        registered: Boolean(creds?.registered),
        hasCreds: hasCredsKey,
        sessions,
        preKeys,
        senderKeys,
        appStateSyncKeys,
        other,
        totalAuthKeys: rows.length,
        botKvKeys: kvCountRow?.cnt || 0,
      };
    } catch {
      return null;
    }
  };

  /**
   * Safely trim excess closed Signal sub-sessions inside session-*.json records
   * without touching open (-1) sessions, creds, or pre-keys.
   */
  const pruneStaleSessions = async ({ maxClosedPerJid = 5 } = {}) => {
    return enqueueWrite(async () => {
      let prunedEntries = 0;
      try {
        const rows = db
          .prepare("SELECT key, value FROM AuthState WHERE key LIKE 'session-%'")
          .all();

        const updateMany = db.transaction((updates) => {
          for (const u of updates) {
            stmtUpsert.run(u.key, u.value);
          }
        });

        const updates = [];
        for (const row of rows) {
          const res = trimClosedRatchets(row?.value, maxClosedPerJid);
          if (res.changed) {
            prunedEntries += res.prunedCount;
            updates.push({ key: row.key, value: res.nextValue });
          }
        }

        if (updates.length) {
          updateMany(updates);
        }
      } catch (err) {
        console.error("[auth-sqlite] pruneStaleSessions error:", err?.message || err);
      }
      return prunedEntries;
    });
  };

  return {
    state,
    saveCreds,
    clearAuthState,
    hasCreds,
    purgeSession,
    flush,
    getStats,
    pruneStaleSessions,
    botKv,
    close: async () => {
      if (credsTimer) {
        clearTimeout(credsTimer);
        credsTimer = null;
      }
      if (credsDirty && db.open) {
        credsDirty = false;
        await writeData(creds, "creds.json").catch(() => {});
      }
      await writeChain.catch(() => {});
      if (db.open) {
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          /* ignore checkpoint errors during shutdown */
        }
        db.close();
      }
    },
  };
}
