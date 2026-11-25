/**
 * Presence & Ghost Mode Plugin
 * Control WhatsApp presence updates: online/offline state, typing/recording simulation.
 *
 * @module plugins/presence
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { isPrivileged } from "../utils/access.js";

// ==================== ONLINE STATUS ====================
command(
  {
    pattern: "online",
    fromMe: true,
    desc: "Set bot presence to Online (Available)",
    usage: "#online",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Sets WhatsApp presence status to Available." },
    type: "presence",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.sendPresenceUpdate("available");
      await ackCommand(conn, message, "🟢");
      await replyOk(conn, message, "Bot presence set to *ONLINE*.");
    } catch (err) {
      await replyFail(conn, message, `Failed to update presence: ${err?.message || err}`);
    }
  }
);

// ==================== OFFLINE STATUS ====================
command(
  {
    pattern: "offline",
    fromMe: true,
    desc: "Set bot presence to Offline (Unavailable)",
    usage: "#offline",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Sets WhatsApp presence status to Unavailable." },
    type: "presence",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.sendPresenceUpdate("unavailable");
      await ackCommand(conn, message, "⚪");
      await replyOk(conn, message, "Bot presence set to *OFFLINE*.");
    } catch (err) {
      await replyFail(conn, message, `Failed to update presence: ${err?.message || err}`);
    }
  }
);

// ==================== SIMULATE TYPING ====================
command(
  {
    pattern: "typing",
    fromMe: false,
    desc: "Simulate typing indicator in current chat for 5 seconds",
    usage: "#typing",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Triggers composing presence in chat for 5 seconds." },
    type: "presence",
  },
  async (message, conn) => {
    try {
      await conn.sendPresenceUpdate("composing", message.from);
      setTimeout(async () => {
        await conn.sendPresenceUpdate("paused", message.from).catch(() => {});
      }, 5000);
      await ackCommand(conn, message, "⌨️");
    } catch (err) {
      await replyFail(conn, message, `Failed: ${err?.message || err}`);
    }
  }
);

// ==================== SIMULATE RECORDING ====================
command(
  {
    pattern: "recording",
    fromMe: false,
    desc: "Simulate audio recording indicator in current chat for 5 seconds",
    usage: "#recording",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Triggers recording presence indicator in chat for 5 seconds." },
    type: "presence",
  },
  async (message, conn) => {
    try {
      await conn.sendPresenceUpdate("recording", message.from);
      setTimeout(async () => {
        await conn.sendPresenceUpdate("paused", message.from).catch(() => {});
      }, 5000);
      await ackCommand(conn, message, "🎙️");
    } catch (err) {
      await replyFail(conn, message, `Failed: ${err?.message || err}`);
    }
  }
);

// ==================== AUTO-TYPING CONFIG ====================
command(
  {
    pattern: "autotyping",
    fromMe: true,
    desc: "Toggle automatic typing presence before command responses (on|off)",
    usage: "#autotyping [on|off]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off]", description: "Toggle or check auto-typing presence indicator before replies." },
    type: "presence",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const raw = (getCommandArgs(message.body, "autotyping") || "").trim().toLowerCase();
    if (!raw) {
      const current = (await kvGet("auto_typing")) || "off";
      return await reply(
        conn,
        message,
        `⌨️ *AUTO-TYPING:* ${current.toUpperCase()}\n*Usage:* \`${BOT_INFO.PREFIX}autotyping on|off\``
      );
    }

    if (raw === "on") {
      await kvSet("auto_typing", "on");
      return await replyOk(conn, message, "Auto-typing enabled.");
    }
    if (raw === "off") {
      await kvSet("auto_typing", "off");
      return await replyOk(conn, message, "Auto-typing disabled.");
    }
    return await replyFail(conn, message, "Use `on` or `off`.");
  }
);
