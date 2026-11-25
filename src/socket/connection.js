/**
 * WhatsApp socket connection — Baileys 7.0.0-rc13 lean runtime
 * Supports QR or pairing-code login (PAIRING_NUMBER env)
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  proto,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { useMultiDbAuthState, flushAuthState, pruneStaleSessions } from "../database/authState.js";
import { serialize } from "../messages/serialize.js";
import { messageHandler } from "../messages/handler.js";
import { setConnection } from "../terminal/handler.js";
import { groupCache, msgCache, createTtlCache } from "../utils/cache.js";
import { attachGroupParticipantEvents } from "../events/groupParticipants.js";
import { attachCallEvents } from "../events/callHandler.js";
import {
  startReminderScheduler,
  stopReminderScheduler,
} from "../utils/reminders.js";
import { processGroupGuards } from "../messages/groupGuards.js";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

let sessionRotations = 0;

// Install Signal noise suppressor & Bad MAC automatic self-healing listener
if (!globalThis.__badMacHealerInstalled) {
  globalThis.__badMacHealerInstalled = true;
  const originalConsoleError = console.error;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;

  const isSignalSessionNoise = (args) => {
    if (process.env.SIGNAL_DEBUG === "1") return false;
    const first = String(args?.[0] || "");
    if (
      first.includes("Closing open session in favor of incoming prekey bundle") ||
      first.startsWith("Closing session:") ||
      first.startsWith("Removing old closed session:") ||
      first.includes("Decrypted message with closed session") ||
      first.includes("Session already closed") ||
      first.includes("Session already open")
    ) {
      if (first.includes("Closing open session")) {
        sessionRotations += 1;
      }
      return true;
    }
    return false;
  };

  console.info = function (...args) {
    if (isSignalSessionNoise(args)) return;
    return originalConsoleInfo.apply(console, args);
  };

  console.warn = function (...args) {
    if (isSignalSessionNoise(args)) return;
    return originalConsoleWarn.apply(console, args);
  };

  console.error = function (...args) {
    const text = args.map((a) => String(a?.stack || a || "")).join(" ");
    if (text.includes("Bad MAC")) {
      const match =
        text.match(/async\s+([a-zA-Z0-9_.-]+)\s+\[as\s+awaitable\]/i) ||
        text.match(/session-([a-zA-Z0-9_.-]+)/i);
      if (match && match[1]) {
        const targetId = match[1];
        import("../database/authState.js")
          .then(({ purgeCorruptedSession }) => purgeCorruptedSession(targetId))
          .then((count) => {
            if (count > 0) {
              console.warn(
                `[signal-healer] 🔄 Automatically purged ${count} corrupted session key(s) for ${targetId} to heal Bad MAC.`
              );
            }
          })
          .catch(() => {});
      }
    }
    return originalConsoleError.apply(console, args);
  };
}

let globalConnection = null;
let reconnectAttempt = 0;
let isConnecting = false;
let cachedVersion = null;
let pairingRequested = false;
let connectionStatus = "connecting";
let latestQr = null;
let latestPairingCode = null;
let lastDisconnectReason = null;
let startupPruned = false;
let maintenanceInterval = null;
const signalKeyCache = createTtlCache({ ttlMs: 3 * 60 * 1000, max: 300 });
const recentMessages = [];
const MAX_RECENT_MESSAGES = 100;

function recordRecentMessage(message) {
  if (!message) return;
  recentMessages.unshift({
    id: message.id || `msg_${Date.now()}`,
    ts: Date.now(),
    from: message.from || "",
    sender: message.senderPn || message.sender || "",
    senderLid: message.senderLid || null,
    senderName: message.pushName || message.senderName || "",
    isGroup: Boolean(message.isGroup),
    type: message.type || "text",
    body: String(message.body || "").slice(0, 300),
  });
  if (recentMessages.length > MAX_RECENT_MESSAGES) {
    recentMessages.length = MAX_RECENT_MESSAGES;
  }
}

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

function backoffDelay(attempt) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return exp + jitter;
}

async function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch {
    cachedVersion = undefined;
  }
  return cachedVersion;
}

function cleanupSocket(conn) {
  if (!conn) return;
  try {
    conn.ev?.removeAllListeners?.();
  } catch {
    /* ignore */
  }
  try {
    conn.ws?.close?.();
  } catch {
    /* ignore */
  }
  try {
    conn.end?.(undefined);
  } catch {
    /* ignore */
  }
}

function pairingNumber() {
  const raw = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
  return raw || null;
}

async function connect() {
  if (isConnecting) return globalConnection;
  isConnecting = true;

  let conn = null;

  try {
    const { state, saveCreds } = await useMultiDbAuthState();
    const version = await getVersion();
    // Prefer pairing when no session identity yet and PAIRING_NUMBER is set
    const hasSession = !!(state.creds?.me || state.creds?.registered);
    const usePairing = !hasSession && !!pairingNumber();

    const socketOptions = {
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger, signalKeyCache),
      },
      syncFullHistory: false,
      shouldSyncHistoryMessage: ({ syncType }) =>
        syncType !== proto.HistorySync.HistorySyncType.FULL,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,
      shouldIgnoreJid: (jid) =>
        !jid ||
        (jid.endsWith("@broadcast") && jid !== "status@broadcast"),
      getMessage: async (key) => {
        const id = key?.id;
        if (!id) return undefined;
        const entry = msgCache.get(id);
        return entry?.message || entry || undefined;
      },
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
    };

    if (version) {
      socketOptions.version = version;
    }

    conn = makeWASocket(socketOptions);

    globalConnection = conn;
    setConnection(conn);
    pairingRequested = false;

    // Request pairing code ASAP when PAIRING_NUMBER is set and not registered
    if (usePairing) {
      pairingRequested = true;
      setTimeout(async () => {
        try {
          const code = await conn.requestPairingCode(pairingNumber());
          latestPairingCode = code;
          connectionStatus = "pairing";
          console.log("\n🔗 Pairing code (enter on phone):\n");
          console.log(`   ${code}\n`);
          console.log("Phone → Linked devices → Link with phone number\n");
        } catch (err) {
          console.error("Pairing code failed:", err?.message || err);
          console.log("Scan QR instead if it appears...\n");
        }
      }, 2000);
    }

    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
        connectionStatus = "qr";
      }

      if (qr && !usePairing) {
        qrcode.generate(qr, { small: true });
        console.log("\n📱 Scan the QR code above to log in.\n");
        console.log(
          "(Or set PAIRING_NUMBER=yourNumberWithCountryCode and restart)\n"
        );
      }

      if (connection === "open") {
        reconnectAttempt = 0;
        connectionStatus = "open";
        latestQr = null;
        latestPairingCode = null;
        lastDisconnectReason = null;
        console.log("✅ Connected successfully!");
        startReminderScheduler(conn);
        import("../plugins/automute.js")
          .then(({ startAutoMuteScheduler }) => startAutoMuteScheduler?.(conn))
          .catch(() => {});
        import("../agent/agentCron.js")
          .then(({ startAutonomousAgentScheduler }) => startAutonomousAgentScheduler?.(conn))
          .catch(() => {});

        // Non-blocking closed ratchet cleanup after boot + every 24h for 365-day uptime
        if (!startupPruned) {
          startupPruned = true;
          const bootTimer = setTimeout(() => {
            pruneStaleSessions({ maxClosedPerJid: 3 }).catch(() => {});
          }, 15_000);
          bootTimer.unref?.();

          maintenanceInterval = setInterval(async () => {
            try {
              await pruneStaleSessions({ maxClosedPerJid: 3 });
              await flushAuthState();
            } catch {
              /* ignore maintenance errors */
            }
          }, 24 * 60 * 60 * 1000);
          maintenanceInterval.unref?.();
        }

        // System log group + onboarding (never DM the bot itself)
        setTimeout(async () => {
          try {
            const { ensureLogGroup, attachLogGroupConn, systemLog } =
              await import("../utils/logGroup.js");
            const { startOnboardingIfNeeded } = await import(
              "../onboarding/setup.js"
            );
            const loggerMod = (await import("../utils/logger.js")).default;

            attachLogGroupConn(conn);
            loggerMod.setRemoteSink((level, msg, detail) =>
              systemLog(level, msg, detail)
            );

            const res = await ensureLogGroup(conn);
            if (res.needsManual) {
              console.warn(
                "[onboarding] Set OWNER_NUMBER or run #setlog in a group you create."
              );
            }
            if (res.jid) {
              await startOnboardingIfNeeded(conn);
            }
          } catch (err) {
            console.error("Onboarding/log-group init failed:", err?.message || err);
          }
        }, 2500);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        connectionStatus = "close";
        lastDisconnectReason = statusCode ?? "closed";

        stopReminderScheduler();
        import("../plugins/automute.js")
          .then(({ stopAutoMuteScheduler }) => stopAutoMuteScheduler?.())
          .catch(() => {});
        await flushAuthState();
        cleanupSocket(conn);
        if (globalConnection === conn) {
          globalConnection = null;
          setConnection(null);
        }

        if (shouldReconnect) {
          const delay = backoffDelay(reconnectAttempt);
          reconnectAttempt += 1;
          console.log(
            `❌ Connection closed (code ${statusCode ?? "?"}). Reconnecting in ${Math.round(delay / 1000)}s...`
          );
          isConnecting = false;
          setTimeout(() => {
            connect().catch((err) => {
              console.error("Reconnect failed:", err?.message || err);
              isConnecting = false;
            });
          }, delay);
        } else {
          console.log("🔓 Logged out. Restart the bot to login again.");
          isConnecting = false;
        }
      }
    });

    conn.ev.on("creds.update", saveCreds);
    attachGroupParticipantEvents(conn);
    attachCallEvents(conn);

    conn.ev.on("groups.update", async (updates) => {
      for (const update of updates) {
        if (update.id) groupCache.delete(update.id);
      }
    });

    conn.ev.on("messages.upsert", async (m) => {
      try {
        if (m.type && m.type !== "notify") return;
        if (m.requestId) return;

        const msg = m.messages?.[0];
        if (!msg?.message) return;

        // WhatsApp Status handling (auto-view & auto-react)
        if (msg.key?.remoteJid === "status@broadcast") {
          const { handleIncomingStatus } = await import("../events/statusHandler.js");
          await handleIncomingStatus(conn, msg);
          return;
        }

        // Anti-Delete: check for revoked messages
        const { handleAntiDelete } = await import("../events/antiDelete.js");
        const wasRevoked = await handleAntiDelete(conn, msg);
        if (wasRevoked) return;

        if (msg.key?.id) {
          msgCache.set(msg.key.id, {
            message: msg.message,
            sender: msg.key?.participant || msg.key?.remoteJid,
            pushName: msg.pushName || "",
          });
        }

        const message = await serialize(msg, conn);
        if (!message) return;

        recordRecentMessage(message);

        // Group guards (mute / antilink / antispam) before command routing
        const blocked = await processGroupGuards({ message, conn });
        if (blocked) return;

        await messageHandler({ message, conn });
      } catch (error) {
        console.error("❌ Error processing message:", error?.message || error);
        try {
          const { systemLog } = await import("../utils/logGroup.js");
          await systemLog("error", "messages.upsert failed", error);
        } catch {
          /* ignore */
        }
      }
    });

    isConnecting = false;
    return conn;
  } catch (error) {
    isConnecting = false;
    cleanupSocket(conn);
    throw error;
  }
}

export function getConnection() {
  return globalConnection;
}

export function getConnectionState() {
  const conn = globalConnection;
  const connected = connectionStatus === "open" && Boolean(conn?.user?.id);
  return {
    connected,
    status: connected ? "open" : connectionStatus,
    user: conn?.user || null,
    qr: connected ? null : latestQr,
    pairingCode: connected ? null : latestPairingCode,
    reconnectAttempt,
    lastDisconnectReason,
    sessionRotations,
  };
}

export function getRecentMessages(limit = 50) {
  return recentMessages.slice(0, Math.min(limit, MAX_RECENT_MESSAGES));
}

export async function forceReconnect() {
  if (globalConnection) {
    cleanupSocket(globalConnection);
    globalConnection = null;
    setConnection(null);
  }
  isConnecting = false;
  connectionStatus = "connecting";
  return await connect();
}

export default connect;
