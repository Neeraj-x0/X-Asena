/**
 * Terminal Input Handler for X-Asena
 * Shortcuts: Q logout, R restart, A wipe auth DB
 */

import { clearAuthState, closeAuthState } from "../database/authState.js";
import config from "../../config.js";
import fs from "fs/promises";

let connection = null;
let awaitingWipeConfirm = false;

export function setConnection(conn) {
  connection = conn;
}

async function unlinkWithRetry(filePath, retries = 5, delayMs = 150) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err) {
      if (err.code === "ENOENT") return;
      if ((err.code === "EBUSY" || err.code === "EPERM") && i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

async function logout() {
  console.log("\n🔄 Logging out...");

  try {
    if (connection) {
      try {
        await connection.logout();
        console.log("✅ Connection closed");
      } catch (err) {
        console.log("⚠️ Logout socket error:", err?.message || err);
      }
    }

    await clearAuthState();
    await closeAuthState();
    console.log("✅ Auth state cleared");
    console.log("✅ Logout complete!\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during logout:", error);
    process.exit(1);
  }
}

async function restart() {
  console.log("\n🔄 Restarting bot...");

  try {
    if (connection) {
      try {
        await connection.end();
        console.log("✅ Connection closed gracefully");
      } catch (error) {
        console.log("⚠️ Connection already closed:", error?.message || error);
      }
    }
    console.log("✅ Restart initiated...\n");
    await closeAuthState();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during restart:", error);
    process.exit(1);
  }
}

async function wipeDatabase() {
  console.log("\n⚠️  DATABASE WIPE INITIATED");

  try {
    // Stop live WhatsApp socket first so no concurrent creds.update writes happen
    if (connection) {
      try {
        await connection.end();
      } catch {
        /* ignore socket end errors */
      }
      connection = null;
    }

    await clearAuthState();
    await closeAuthState();

    if (!config.USE_POSTGRES && config.SQLITE_PATH) {
      await unlinkWithRetry(config.SQLITE_PATH);
      await unlinkWithRetry(`${config.SQLITE_PATH}-wal`).catch(() => {});
      await unlinkWithRetry(`${config.SQLITE_PATH}-shm`).catch(() => {});
      console.log(`✅ Removed ${config.SQLITE_PATH}`);
    }

    console.log("✅ Database wiped successfully!\n");
    console.log("⚠️  Please restart the bot manually.\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error wiping database:", error);
    process.exit(1);
  }
}

export function initTerminalHandler() {
  console.log("\n📝 Terminal shortcuts enabled:");
  console.log("   Type 'Q' + Enter - Logout and clear auth state");
  console.log("   Type 'R' + Enter - Restart the bot");
  console.log("   Type 'A' + Enter - Wipe entire database");
  console.log("   Press Ctrl+C - Exit\n");

  process.stdin.setEncoding("utf8");
  if (process.stdin.isTTY) {
    process.stdin.resume();
  }

  process.stdin.on("data", async (data) => {
    const input = data.toString().trim().toUpperCase();
    if (!input) return;

    if (awaitingWipeConfirm) {
      awaitingWipeConfirm = false;
      if (input === "Y" || input === "YES") {
        await wipeDatabase();
      } else {
        console.log("❌ Database wipe cancelled.\n");
      }
      return;
    }

    if (input === "Q") {
      await logout();
    } else if (input === "R") {
      await restart();
    } else if (input === "A") {
      awaitingWipeConfirm = true;
      console.log("\n⚠️  WARNING: This will DELETE ALL AUTH DATABASE DATA!");
      console.log("⚠️  Type 'Y' and press Enter to confirm: ");
    } else {
      console.log(`⚠️  Unknown command: "${input}". Valid: Q, R, A`);
    }
  });

  process.on("SIGINT", async () => {
    console.log("\n👋 Shutting down...");
    if (connection) {
      try {
        await connection.end();
      } catch {
        /* ignore */
      }
    }
    await closeAuthState();
    process.exit(0);
  });
}
