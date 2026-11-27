import fs from "fs/promises";
import path from "path";
import connect, { shutdownConnection } from "./src/socket/connection.js";
import { commands } from "./src/plugins.js";
import { initTerminalHandler } from "./src/terminal/handler.js";
import { useMultiDbAuthState, checkAuthCreds, closeAuthState } from "./src/database/authState.js";
import config from "./config.js";

global.__basedir = path.resolve();

const readAndRequireFiles = async (directory) => {
  try {
    const files = await fs.readdir(directory);
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    await Promise.all(
      jsFiles.map((file) =>
        import(`file://${path.join(directory, file).replace(/\\/g, "/")}`)
      )
    );
  } catch (error) {
    console.error("Error loading files:", error);
    throw error;
  }
};

const initialize = async () => {
  console.log("\n╔══════════════════════════════╗");
  console.log("║        X-Asena v4.3.0       ║");
  console.log("║   Baileys 7.0.0-rc13        ║");
  console.log("╚══════════════════════════════╝\n");

  try {
    // Init auth backend early (creates table / opens DB)
    console.log(
      config.USE_POSTGRES
        ? "⏳ Initializing Postgres auth..."
        : `⏳ Initializing SQLite auth (${config.SQLITE_PATH})...`
    );
    await useMultiDbAuthState();

    const credsCheck = await checkAuthCreds();
    if (credsCheck.hasCreds) {
      console.log("✅ Credentials found");
    } else if (process.env.PAIRING_NUMBER) {
      console.log(
        `ℹ️  No credentials — pairing code login (${process.env.PAIRING_NUMBER.replace(/\D/g, "")})`
      );
    } else {
      console.log(
        "ℹ️  No credentials — QR login (or set PAIRING_NUMBER for code login)"
      );
    }

    // Load plugins (skip database folder auto-import — auth is factory-based)
    await readAndRequireFiles(path.join(global.__basedir, "src/plugins"));
    console.log(`✅ ${commands.length} Plugins Loaded!`);

    initTerminalHandler();

    // Optional enterprise admin HTTP (localhost + token)
    try {
      const { startAdminHttp } = await import("./src/enterprise/adminHttp.js");
      startAdminHttp();
    } catch (err) {
      console.warn("Admin HTTP not started:", err?.message || err);
    }

    console.log("⏳ Connecting to WhatsApp...\n");
    await connect();
  } catch (error) {
    console.error("❌ Initialization error:", error);
    process.exit(1);
  }
};

// Global resilience guards so stray async promise rejections never crash long-running processes
if (!globalThis.__xasenaErrorGuards) {
  globalThis.__xasenaErrorGuards = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[runtime] Unhandled Promise Rejection:", reason?.stack || reason?.message || reason);
  });
  process.on("uncaughtExceptionMonitor", (err, origin) => {
    console.error(`[runtime] Uncaught Exception (${origin}):`, err?.stack || err?.message || err);
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    const forceExit = setTimeout(() => process.exit(0), 5000);
    forceExit.unref?.();
    try {
      await shutdownConnection();
      const { stopAdminHttp } = await import("./src/enterprise/adminHttp.js");
      stopAdminHttp();
      await closeAuthState();
    } catch {
      /* ignore shutdown errors */
    }
    process.exit(0);
  };
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
}

initialize();
