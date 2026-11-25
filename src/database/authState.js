/**
 * Auth State Factory
 * Dual backend: better-sqlite3 (default) | Sequelize Postgres (when DATABASE_URL is postgres)
 * Shared interface: { state, saveCreds }
 */

import config from "../../config.js";
import { attachBotKv, seedBotKvFromEnv } from "./botKv.js";

let initPromise = null;
let activeBackend = null;

async function initBackend() {
  if (config.USE_POSTGRES) {
    const { createPostgresSequelize, usePostgresAuthState } = await import(
      "./authPostgres.js"
    );
    const sequelize = await createPostgresSequelize(config.DATABASE_URL);
    await sequelize.authenticate();
    activeBackend = await usePostgresAuthState(sequelize);
    console.log("✅ Auth backend: Postgres (Sequelize)");
  } else {
    const { useBetterSqliteAuthState } = await import("./authSqlite.js");
    activeBackend = await useBetterSqliteAuthState(config.SQLITE_PATH);
    console.log(`✅ Auth backend: better-sqlite3 (${config.SQLITE_PATH})`);
  }

  if (activeBackend?.botKv) {
    attachBotKv(activeBackend.botKv);
    await seedBotKvFromEnv();
  }

  return activeBackend;
}

/**
 * Initialize once and return Baileys-compatible auth state.
 * @returns {Promise<{ state: object, saveCreds: Function }>}
 */
export async function useMultiDbAuthState() {
  if (!initPromise) {
    initPromise = initBackend();
  }
  const backend = await initPromise;
  return {
    state: backend.state,
    saveCreds: backend.saveCreds,
  };
}

/**
 * Clear all auth state (logout / reset)
 */
export async function clearAuthState() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }
  await initPromise;
  if (activeBackend?.clearAuthState) {
    await activeBackend.clearAuthState();
    console.log("Cleared auth state");
  }
}

/**
 * Flush pending writes and close the active auth database handle
 */
export async function closeAuthState() {
  try {
    if (initPromise) {
      await initPromise.catch(() => {});
    }
    if (typeof activeBackend?.close === "function") {
      await activeBackend.close();
    }
  } finally {
    activeBackend = null;
    initPromise = null;
  }
}

/**
 * Cheap creds existence check (no full table scan)
 */
export async function checkAuthCreds() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }
  await initPromise;
  const has =
    typeof activeBackend.hasCreds === "function"
      ? await activeBackend.hasCreds()
      : false;

  return {
    valid: !!has,
    hasCreds: !!has,
  };
}

/**
 * @deprecated Prefer checkAuthCreds
 */
export async function validateAuthState() {
  const result = await checkAuthCreds();
  return {
    valid: result.hasCreds,
    issues: result.hasCreds ? [] : ["No credentials found"],
    stats: null,
  };
}

export async function getAuthStateStats() {
  return null;
}

/**
 * Purge corrupted session/sender keys for an address to heal Bad MAC errors.
 * @param {string} target - Session address or identifier
 * @returns {Promise<number>} Number of purged records
 */
export async function purgeCorruptedSession(target) {
  if (!initPromise) {
    await useMultiDbAuthState();
  }
  const backend = await initPromise;
  if (typeof backend?.purgeSession === "function") {
    return await backend.purgeSession(target);
  }
  return 0;
}
