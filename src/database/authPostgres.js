/**
 * Sequelize Postgres Auth State
 * Lazy-loaded only when DATABASE_URL is a Postgres URL.
 */

import { Mutex } from "async-mutex";
import { DataTypes, Op } from "sequelize";
import { initAuthCreds, proto } from "baileys";
import { BufferJSON, sanitizeKey, trimClosedRatchets } from "./bufferJson.js";

const RETRY_CONFIG = {
  maxRetries: 5,
  retryDelay: 50,
  backoffMultiplier: 1.5,
};

/** Single serial write mutex (bounded vs unbounded per-key Map) */
const writeMutex = new Mutex();

async function retryOperation(operation, context = "") {
  let lastError;
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (
        error.name === "SequelizeValidationError" ||
        error.name === "SequelizeUniqueConstraintError"
      ) {
        throw error;
      }
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delay =
          RETRY_CONFIG.retryDelay *
          Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  console.error(`[auth-pg] ${context} failed:`, lastError?.message || lastError);
  throw lastError;
}

/**
 * Create Sequelize instance for Postgres
 */
export async function createPostgresSequelize(databaseUrl) {
  const { Sequelize } = await import("sequelize");
  const disableSsl = /[?&](sslmode=disable|ssl=false)\b/i.test(String(databaseUrl || ""));
  return new Sequelize(databaseUrl, {
    dialect: "postgres",
    protocol: "postgres",
    logging: false,
    pool: { max: 5, min: 0, idle: 10000, acquire: 30000 },
    dialectOptions: disableSsl
      ? {}
      : {
          ssl: { require: true, rejectUnauthorized: false },
        },
  });
}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
export async function usePostgresAuthState(sequelize) {
  const AuthStateDB = sequelize.define(
    "AuthState",
    {
      key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      indexes: [{ fields: ["key"], unique: true }],
    }
  );

  await AuthStateDB.sync();

  const BotKVDB = sequelize.define(
    "BotKV",
    {
      key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      indexes: [{ fields: ["key"], unique: true }],
    }
  );

  await BotKVDB.sync();

  const writeData = async (data, key) => {
    const sanitizedKey = sanitizeKey(key);
    return writeMutex.runExclusive(async () => {
      await retryOperation(async () => {
        const jsonData = JSON.stringify(data, BufferJSON.replacer);
        await AuthStateDB.upsert(
          { key: sanitizedKey, value: jsonData },
          { logging: false }
        );
      }, `write(${key})`);
    });
  };

  const readData = async (key) => {
    const sanitizedKey = sanitizeKey(key);
    try {
      return await retryOperation(async () => {
        const record = await AuthStateDB.findOne({
          where: { key: sanitizedKey },
          attributes: ["value"],
          raw: true,
        });
        if (!record?.value) return null;
        return JSON.parse(record.value, BufferJSON.reviver);
      }, `read(${key})`);
    } catch (error) {
      console.error(`[auth-pg] read failed (${key}):`, error?.message || error);
      return null;
    }
  };

  const removeData = async (key) => {
    const sanitizedKey = sanitizeKey(key);
    return writeMutex.runExclusive(async () => {
      try {
        await AuthStateDB.destroy({ where: { key: sanitizedKey } });
      } catch (error) {
        console.error(`[auth-pg] delete failed (${key}):`, error?.message || error);
      }
    });
  };

  let creds = await readData("creds.json");
  if (!creds) {
    console.log("No existing credentials found, initializing new auth state...");
    creds = initAuthCreds();
    await writeData(creds, "creds.json");
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          if (!ids?.length) return data;

          const keys = ids.map((id) => sanitizeKey(`${type}-${id}.json`));
          try {
            const records = await AuthStateDB.findAll({
              where: { key: { [Op.in]: keys } },
              attributes: ["key", "value"],
              raw: true,
            });
            const byKey = new Map(records.map((r) => [r.key, r.value]));

            for (const id of ids) {
              const storageKey = sanitizeKey(`${type}-${id}.json`);
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
          } catch (error) {
            console.error("[auth-pg] batch get failed:", error?.message || error);
            await Promise.all(
              ids.map(async (id) => {
                let value = await readData(`${type}-${id}.json`);
                if (type === "app-state-sync-key" && value) {
                  try {
                    value = proto.Message.AppStateSyncKeyData.create(value);
                  } catch {
                    value = null;
                  }
                }
                data[id] = value;
              })
            );
          }
          return data;
        },

        set: async (data) => {
          return writeMutex.runExclusive(async () => {
            const tasks = [];
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const key = `${category}-${id}.json`;
                tasks.push(
                  value
                    ? AuthStateDB.upsert({
                        key: sanitizeKey(key),
                        value: JSON.stringify(value, BufferJSON.replacer),
                      })
                    : AuthStateDB.destroy({ where: { key: sanitizeKey(key) } })
                );
              }
            }
            await Promise.allSettled(tasks);
          });
        },
      },
    },

    saveCreds: async () => writeData(creds, "creds.json"),

    clearAuthState: async () => {
      await AuthStateDB.destroy({ where: {}, truncate: true });
    },

    hasCreds: async () => {
      const record = await AuthStateDB.findOne({
        where: { key: sanitizeKey("creds.json") },
        attributes: ["key"],
        raw: true,
      });
      return !!record;
    },

    purgeSession: async (target) => {
      try {
        const { Op } = await import("sequelize");
        const cleanTarget = String(target).split("_")[0].split(".")[0];
        const count = await AuthStateDB.destroy({
          where: {
            key: {
              [Op.or]: [
                { [Op.like]: `%${cleanTarget}%` },
                { [Op.like]: `sender-key-%${cleanTarget}%` },
              ],
            },
          },
        });
        return count;
      } catch (err) {
        console.error("[auth-pg] purgeSession error:", err?.message || err);
        return 0;
      }
    },

    AuthStateDB,

    flush: async () => writeMutex.runExclusive(async () => {}),

    pruneStaleSessions: async ({ maxClosedPerJid = 5 } = {}) => {
      return writeMutex.runExclusive(async () => {
        let prunedEntries = 0;
        try {
          const { Op } = await import("sequelize");
          const rows = await AuthStateDB.findAll({
            where: { key: { [Op.like]: "session-%" } },
            attributes: ["key", "value"],
            raw: true,
          });
          for (const row of rows) {
            const res = trimClosedRatchets(row?.value, maxClosedPerJid);
            if (res.changed) {
              prunedEntries += res.prunedCount;
              await AuthStateDB.upsert({ key: row.key, value: res.nextValue });
            }
          }
        } catch (err) {
          console.error("[auth-pg] pruneStaleSessions error:", err?.message || err);
        }
        return prunedEntries;
      });
    },

    getStats: async () => {
      try {
        const rows = await AuthStateDB.findAll({ attributes: ["key"], raw: true });
        const kvCount = await BotKVDB.count();
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
          backend: "postgres",
          registered: Boolean(creds?.registered),
          hasCreds: hasCredsKey,
          sessions,
          preKeys,
          senderKeys,
          appStateSyncKeys,
          other,
          totalAuthKeys: rows.length,
          botKvKeys: kvCount,
        };
      } catch {
        return null;
      }
    },

    close: async () => {
      await writeMutex.runExclusive(async () => {});
      await sequelize.close();
    },

    botKv: {
      async get(key) {
        try {
          const record = await BotKVDB.findOne({
            where: { key: String(key) },
            attributes: ["value"],
            raw: true,
          });
          if (!record?.value) return null;
          return JSON.parse(record.value);
        } catch (error) {
          console.error(`[botkv-pg] get failed (${key}):`, error?.message || error);
          return null;
        }
      },
      async set(key, value) {
        return writeMutex.runExclusive(async () => {
          if (value === null || value === undefined) {
            await BotKVDB.destroy({ where: { key: String(key) } });
            return;
          }
          await BotKVDB.upsert({
            key: String(key),
            value: JSON.stringify(value),
          });
        });
      },
      async del(key) {
        return writeMutex.runExclusive(async () => {
          await BotKVDB.destroy({ where: { key: String(key) } });
        });
      },
    },
  };
}
