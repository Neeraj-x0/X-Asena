/**
 * Chat Monitor Plugin (#monitor)
 * - #monitor on     : Start saving all raw message objects of this chat to DB
 * - #monitor off    : Stop saving messages for this chat
 * - #monitor        : Show monitor status & count
 * - #monitor list   : Preview recent saved messages in this chat
 * - #monitor export : Download all saved raw message objects as a JSON file
 * - #monitor clear  : Delete saved messages for this chat
 * - #monitor chats  : List all monitored chats
 */

import { BufferJSON } from "baileys";
import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping } from "../utils/message.js";
import { displayId } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";
import {
  setChatMonitor,
  getChatMonitorStatus,
  listMonitoredChats,
  getMonitoredMessages,
  clearMonitoredMessages,
} from "../utils/monitorStore.js";

command(
  {
    pattern: "monitor",
    fromMe: true,
    desc: "Save all raw messages of the current chat to DB (#monitor on|off|list|export|clear)",
    usage: "#monitor <on|off|status|list [n]|export|clear|chats>",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "<on|off|status|list [limit]|export|clear|chats>",
      description:
        "Toggle chat message monitoring on/off to save all raw WAMessage objects to the database, or view/export/clear saved messages.",
      examples: ["on", "off", "list 10", "export", "clear"],
    },
    type: "owner",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "monitor") || "").trim();
    const [subRaw, arg2] = raw.split(/\s+/).filter(Boolean);
    const sub = (subRaw || "status").toLowerCase();
    const chatJid = message.from;

    if (sub === "on" || sub === "enable" || sub === "start") {
      const status = await setChatMonitor(chatJid, true, message.sender);
      await replyOk(
        conn,
        message,
        `Chat monitor turned *ON* for this chat.\nAll incoming/outgoing messages here will be saved as raw objects to DB (${status.count} currently stored).`
      );
      return;
    }

    if (sub === "off" || sub === "disable" || sub === "stop") {
      const status = await setChatMonitor(chatJid, false, message.sender);
      await replyOk(
        conn,
        message,
        `Chat monitor turned *OFF* for this chat (${status.count} saved message(s) kept in DB).\nUse \`${BOT_INFO.PREFIX}monitor clear\` to delete them.`
      );
      return;
    }

    if (sub === "chats") {
      const chats = await listMonitoredChats();
      if (!chats.length) {
        await reply(conn, message, "📭 No monitored chats or stored logs.");
        return;
      }
      const lines = ["📡 *MONITORED CHATS*\n"];
      chats.forEach((c, i) => {
        lines.push(
          `${i + 1}. \`${c.chatJid}\` — *${c.enabled ? "ON" : "OFF"}* (${c.count} msgs)`
        );
      });
      await reply(conn, message, lines.join("\n"));
      return;
    }

    if (sub === "list" || sub === "view" || sub === "logs") {
      const parsedLimit = Number.parseInt(arg2 || "15", 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(50, parsedLimit) : 15;
      const items = await getMonitoredMessages(chatJid, { limit });
      if (!items.length) {
        await reply(conn, message, "📭 No monitored messages saved for this chat yet.");
        return;
      }
      const lines = [`🗂️ *MONITORED MESSAGES* (last ${items.length})\n`];
      items.forEach((item, i) => {
        const who = item.pushName || (item.sender ? displayId(item.sender) : "unknown");
        const ts = new Date(item.savedAt).toISOString().slice(11, 19);
        const prev = item.preview ? `: ${item.preview}` : "";
        lines.push(`${i + 1}. [${ts}] *${who}* (${item.messageTypeKey})${prev}`);
      });
      lines.push(`\n_Use \`${BOT_INFO.PREFIX}monitor export\` to download the raw JSON._`);
      await reply(conn, message, lines.join("\n"));
      return;
    }

    if (sub === "export" || sub === "dump") {
      await withTyping(conn, chatJid, async () => {
        const items = await getMonitoredMessages(chatJid, { all: true });
        if (!items.length) {
          await replyFail(conn, message, "No monitored messages saved for this chat.");
          return;
        }
        const jsonBuf = Buffer.from(JSON.stringify(items, BufferJSON.replacer, 2), "utf8");
        const safeId = chatJid.replace(/[^a-zA-Z0-9._-]/g, "_");
        await conn.sendMessage(
          chatJid,
          {
            document: jsonBuf,
            mimetype: "application/json",
            fileName: `monitor-${safeId}.json`,
            caption: `📦 Exported *${items.length}* raw message object(s) from this chat.`,
          },
          { quoted: message }
        );
      });
      return;
    }

    if (sub === "clear" || sub === "purge") {
      const removed = await clearMonitoredMessages(chatJid);
      await replyOk(conn, message, `Cleared *${removed}* saved message(s) for this chat.`);
      return;
    }

    if (sub === "status") {
      const st = await getChatMonitorStatus(chatJid);
      await reply(
        conn,
        message,
        `📡 *CHAT MONITOR STATUS*\n\n` +
          `• *Status:* ${st.enabled ? "🟢 ON" : "⚪ OFF"}\n` +
          `• *Saved messages:* ${st.count}\n\n` +
          `• \`${BOT_INFO.PREFIX}monitor on\` / \`off\`\n` +
          `• \`${BOT_INFO.PREFIX}monitor list\` | \`export\` | \`clear\``
      );
      return;
    }

    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}monitor <on|off|status|list|export|clear|chats>\``
    );
  }
);
