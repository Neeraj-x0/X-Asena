/**
 * better-sqlite3 Auth State (default local backend)
 * Single DB handle, WAL, prepared statements, serial write queue.
 */

import Database from "better-sqlite3";
import { initAuthCreds, proto } from "baileys";
import { BufferJSON, sanitizeKey, makeStorageKey } from "./bufferJson.js";

/**
 * @param {string} dbPath
 * @returns {Promise<{ state: object, saveCreds: Function, clearAuthState: Function, hasCreds: Function }>}
 */
export async function useBetterSqliteAuthState(dbPath) {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

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
          const upsertMany = db.transaction((entries) => {
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

          const entries = [];
          for (const category in data) {
            for (const id in data[category]) {
              entries.push({
                key: `${category}-${id}.json`,
                value: data[category][id],
              });
            }
          }
          upsertMany(entries);
        });
      },
    },
  };

  const saveCreds = async () => writeData(creds, "creds.json");

  const clearAuthState = async () => {
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
      try {
        const row = stmtKvGet.get(String(key));
        if (!row?.value) return null;
        return JSON.parse(row.value);
      } catch (err) {
        console.error(`[botkv-sqlite] get failed (${key}):`, err?.message || err);
        return null;
      }
    },
    async set(key, value) {
      return enqueueWrite(async () => {
        if (value === null || value === undefined) {
          stmtKvDelete.run(String(key));
          return;
        }
        stmtKvUpsert.run(String(key), JSON.stringify(value));
      });
    },
    async del(key) {
      return enqueueWrite(async () => {
        stmtKvDelete.run(String(key));
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

  return {
    state,
    saveCreds,
    clearAuthState,
    hasCreds,
    purgeSession,
    botKv,
    close: async () => {
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
