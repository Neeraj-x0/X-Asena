/**
 * Chat State & Message Modification Plugin
 * Control chat archiving, conversation pinning, mute duration, starred messages, and bot PushName.
 *
 * @module plugins/chatmodify
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { isPrivileged } from "../utils/access.js";

// ==================== ARCHIVE / UNARCHIVE ====================
command(
  {
    pattern: "archive",
    fromMe: true,
    desc: "Archive the current chat",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.chatModify({ archive: true }, message.from);
      await replyOk(conn, message, "Chat archived successfully.");
    } catch (err) {
      await replyFail(conn, message, `Failed to archive chat: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "unarchive",
    fromMe: true,
    desc: "Unarchive the current chat",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.chatModify({ archive: false }, message.from);
      await replyOk(conn, message, "Chat unarchived successfully.");
    } catch (err) {
      await replyFail(conn, message, `Failed to unarchive chat: ${err?.message || err}`);
    }
  }
);

// ==================== PIN / UNPIN CHAT ====================
command(
  {
    pattern: "pinchat",
    fromMe: true,
    desc: "Pin this chat to the top of WhatsApp chat list",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.chatModify({ pin: true }, message.from);
      await replyOk(conn, message, "Chat pinned to top.");
    } catch (err) {
      await replyFail(conn, message, `Failed to pin chat: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "unpinchat",
    fromMe: true,
    desc: "Unpin this chat from the top of chat list",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.chatModify({ pin: false }, message.from);
      await replyOk(conn, message, "Chat unpinned.");
    } catch (err) {
      await replyFail(conn, message, `Failed to unpin chat: ${err?.message || err}`);
    }
  }
);

// ==================== MUTE / UNMUTE CHAT ====================
command(
  {
    pattern: "mutechat",
    fromMe: true,
    desc: "Mute chat notifications (8h|1w|always|unmute)",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const raw = (getCommandArgs(message.body, "mutechat") || "").trim().toLowerCase();
    const durations = {
      "8h": 8 * 60 * 60 * 1000,
      "1w": 7 * 24 * 60 * 60 * 1000,
      always: 100 * 365 * 24 * 60 * 60 * 1000,
    };

    try {
      if (raw === "unmute" || raw === "off") {
        await conn.chatModify({ mute: null }, message.from);
        return await replyOk(conn, message, "Chat unmuted.");
      }

      const ms = durations[raw] || durations["8h"];
      await conn.chatModify({ mute: ms }, message.from);
      return await replyOk(conn, message, `Chat muted for *${raw || "8H"}*.`);
    } catch (err) {
      return await replyFail(conn, message, `Failed to mute chat: ${err?.message || err}`);
    }
  }
);

// ==================== STAR / UNSTAR MESSAGE ====================
command(
  {
    pattern: "star",
    fromMe: false,
    desc: "Star a quoted message to bookmark it",
    type: "chats",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(conn, message, `Reply to a message with \`${BOT_INFO.PREFIX}star\` to star it.`);
    }

    try {
      await conn.chatModify(
        {
          star: {
            messages: [{ id: message.quoted.id, fromMe: Boolean(message.quoted.fromMe) }],
            star: true,
          },
        },
        message.from
      );
      await ackCommand(conn, message, "⭐");
      await replyOk(conn, message, "Message starred!");
    } catch (err) {
      await replyFail(conn, message, `Failed to star message: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "unstar",
    fromMe: false,
    desc: "Unstar a quoted message",
    type: "chats",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(conn, message, `Reply to a message with \`${BOT_INFO.PREFIX}unstar\``);
    }

    try {
      await conn.chatModify(
        {
          star: {
            messages: [{ id: message.quoted.id, fromMe: Boolean(message.quoted.fromMe) }],
            star: false,
          },
        },
        message.from
      );
      await replyOk(conn, message, "Message unstarred.");
    } catch (err) {
      await replyFail(conn, message, `Failed to unstar message: ${err?.message || err}`);
    }
  }
);

// ==================== CLEAR CHAT ====================
command(
  {
    pattern: "clearchat",
    fromMe: true,
    desc: "Clear chat messages in this conversation",
    type: "chats",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    try {
      await conn.chatModify(
        {
          clear: {
            messages: [
              {
                id: message.id,
                fromMe: message.key?.fromMe,
                timestamp: Math.floor(Date.now() / 1000),
              },
            ],
          },
        },
        message.from
      );
      await replyOk(conn, message, "Chat messages cleared.");
    } catch (err) {
      await replyFail(conn, message, `Failed to clear chat: ${err?.message || err}`);
    }
  }
);

// ==================== SET BOT DISPLAY NAME ====================
command(
  {
    pattern: "setnamebot",
    fromMe: true,
    desc: "Update bot's WhatsApp PushName visible to other users",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const newName = (getCommandArgs(message.body, "setnamebot") || "").trim();
    if (!newName) {
      return await replyFail(conn, message, `Provide a name: \`${BOT_INFO.PREFIX}setnamebot MyBotName\``);
    }

    try {
      await conn.updateProfileName(newName);
      await replyOk(conn, message, `Bot PushName updated to: *${newName}*`);
    } catch (err) {
      await replyFail(conn, message, `Failed to update name: ${err?.message || err}`);
    }
  }
);
