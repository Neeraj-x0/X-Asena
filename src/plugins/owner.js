/**
 * Owner / sudo / mode commands
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import {
  getMode,
  setMode,
  listSudo,
  addSudo,
  removeSudo,
  isOwnerMessage,
  normalizeNumber,
  isPrivileged,
} from "../utils/access.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { BOT_INFO } from "../config/constants.js";
import { WA_DEFAULT_EPHEMERAL } from "baileys";

command(
  {
    pattern: "mode",
    fromMe: true,
    desc: "Show or set bot mode (public|private)",
    type: "owner",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "mode") || "").trim().toLowerCase();

    if (!args) {
      const mode = await getMode();
      await reply(
        conn,
        message,
        `*Bot mode:* ${mode}\n\n` +
          `• \`${BOT_INFO.PREFIX}mode public\` — anyone can use commands\n` +
          `• \`${BOT_INFO.PREFIX}mode private\` — owner + sudo only`
      );
      return;
    }

    if (args !== "public" && args !== "private") {
      await replyFail(
        conn,
        message,
        `Use \`${BOT_INFO.PREFIX}mode public\` or \`${BOT_INFO.PREFIX}mode private\``
      );
      return;
    }

    const next = await setMode(args);
    await replyOk(conn, message, `Mode set to *${next}*`);
  }
);

command(
  {
    pattern: "sudo",
    fromMe: true,
    desc: "Manage sudo users (add|del|list)",
    type: "owner",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "sudo") || "").trim();
    const [action, ...rest] = raw.split(/\s+/);
    const act = (action || "list").toLowerCase();

    if (act === "list" || !action) {
      const list = await listSudo();
      if (!list.length) {
        await reply(conn, message, "*Sudo list:* _(empty)_");
        return;
      }
      await reply(
        conn,
        message,
        `*Sudo list:*\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
      );
      return;
    }

    if (!isOwnerMessage(message, conn)) {
      await replyFail(conn, message, "Only the bot owner can add/remove sudo.");
      return;
    }

    let target = rest.join(" ").trim() || resolveTargetUser(message) || "";
    const mentions = message.message?.contextInfo?.mentionedJid || [];
    if (!target && mentions.length) target = mentions[0];

    const number = normalizeNumber(target);
    if (!number && (act === "add" || act === "del" || act === "remove" || act === "rm")) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}sudo add <number|@user>\` / \`${BOT_INFO.PREFIX}sudo del <number|@user>\``
      );
      return;
    }

    if (act === "add") {
      await addSudo(number);
      await replyOk(conn, message, `Added sudo: *${number}*`);
      return;
    }

    if (act === "del" || act === "remove" || act === "rm") {
      await removeSudo(number);
      await replyOk(conn, message, `Removed sudo: *${number}*`);
      return;
    }

    await replyFail(conn, message, "Unknown action. Use `list`, `add`, or `del`.");
  }
);

// ==================== SET BOT PROFILE PICTURE ====================
command(
  {
    pattern: "setpp",
    fromMe: true,
    desc: "Set bot's profile picture from quoted image",
    type: "owner",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(conn, message, `Reply to an image with \`${BOT_INFO.PREFIX}setpp\``);
    }
    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (!media || media.type !== "image" || !media.buffer) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, "Please reply to a valid image.");
        }
        const botJid = conn.user?.id ? conn.user.id.replace(/:\d+@/, "@") : conn.user?.id;
        await conn.updateProfilePicture(botJid, media.buffer);
        await ackCommand(conn, message, "✅");
        await replyOk(conn, message, "Bot profile picture updated successfully!");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        await replyFail(conn, message, `Failed to update profile picture: ${err?.message || err}`);
      }
    });
  }
);

// ==================== REMOVE BOT PROFILE PICTURE ====================
command(
  {
    pattern: "delpp",
    fromMe: true,
    desc: "Remove bot's profile picture",
    type: "owner",
  },
  async (message, conn) => {
    try {
      const botJid = conn.user?.id ? conn.user.id.replace(/:\d+@/, "@") : conn.user?.id;
      await conn.removeProfilePicture(botJid);
      await replyOk(conn, message, "Bot profile picture removed!");
    } catch (err) {
      await replyFail(conn, message, `Failed to remove profile picture: ${err?.message || err}`);
    }
  }
);

// ==================== SET BOT BIO / ABOUT ====================
command(
  {
    pattern: "setbio",
    fromMe: true,
    desc: "Update bot's WhatsApp About / Status text",
    type: "owner",
  },
  async (message, conn) => {
    const newBio = (getCommandArgs(message.body, "setbio") || "").trim();
    if (!newBio) {
      return await replyFail(conn, message, `Provide bio text: \`${BOT_INFO.PREFIX}setbio Your new bio\``);
    }
    try {
      await conn.updateProfileStatus(newBio);
      await replyOk(conn, message, `Bot About status updated to:\n_"${newBio}"_`);
    } catch (err) {
      await replyFail(conn, message, `Failed to update About: ${err?.message || err}`);
    }
  }
);

// ==================== BLOCK USER ====================
command(
  {
    pattern: "block",
    fromMe: true,
    desc: "Block a user from contacting the bot",
    type: "security",
  },
  async (message, conn) => {
    let target = resolveTargetUser(message);
    if (!target && !message.isGroup) target = message.from;
    if (!target) {
      return await replyFail(conn, message, `Reply or mention a user to block: \`${BOT_INFO.PREFIX}block @user\``);
    }
    try {
      await conn.updateBlockStatus(target, "block");
      await replyOk(conn, message, `Blocked @${displayId(target)}`, { mentions: [target] });
    } catch (err) {
      await replyFail(conn, message, `Failed to block user: ${err?.message || err}`);
    }
  }
);

// ==================== UNBLOCK USER ====================
command(
  {
    pattern: "unblock",
    fromMe: true,
    desc: "Unblock a user",
    type: "security",
  },
  async (message, conn) => {
    let target = resolveTargetUser(message);
    if (!target && !message.isGroup) target = message.from;
    if (!target) {
      return await replyFail(conn, message, `Reply or mention a user to unblock: \`${BOT_INFO.PREFIX}unblock @user\``);
    }
    try {
      await conn.updateBlockStatus(target, "unblock");
      await replyOk(conn, message, `Unblocked @${displayId(target)}`, { mentions: [target] });
    } catch (err) {
      await replyFail(conn, message, `Failed to unblock user: ${err?.message || err}`);
    }
  }
);

// ==================== BLOCKLIST ====================
command(
  {
    pattern: "blocklist",
    fromMe: true,
    desc: "View the list of blocked WhatsApp users",
    type: "security",
  },
  async (message, conn) => {
    try {
      const list = await conn.fetchBlocklist();
      if (!list || !list.length) {
        return await reply(conn, message, "📋 Blocklist is empty.");
      }
      let text = `🚫 *BLOCKED USERS (${list.length})*\n\n`;
      list.forEach((jid, i) => {
        text += `${i + 1}. @${displayId(jid)}\n`;
      });
      await reply(conn, message, text, { mentions: list });
    } catch (err) {
      await replyFail(conn, message, `Failed to fetch blocklist: ${err?.message || err}`);
    }
  }
);

// ==================== DISAPPEARING MESSAGES ====================
command(
  {
    pattern: "disappearing",
    fromMe: false,
    desc: "Set disappearing messages timer in chat (24h|7d|90d|off)",
    type: "admin",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "disappearing") || "").trim().toLowerCase();
    const timers = {
      "24h": 24 * 60 * 60,
      "1d": 24 * 60 * 60,
      "7d": 7 * 24 * 60 * 60,
      "90d": 90 * 24 * 60 * 60,
      off: 0,
    };

    if (!raw || !(raw in timers)) {
      return await reply(
        conn,
        message,
        `⏳ *DISAPPEARING MESSAGES*\n\n` +
          `*Options:*\n` +
          `• \`${BOT_INFO.PREFIX}disappearing 24h\` — Messages disappear after 24 hours\n` +
          `• \`${BOT_INFO.PREFIX}disappearing 7d\` — Messages disappear after 7 days\n` +
          `• \`${BOT_INFO.PREFIX}disappearing 90d\` — Messages disappear after 90 days\n` +
          `• \`${BOT_INFO.PREFIX}disappearing off\` — Turn off disappearing messages`
      );
    }

    try {
      const seconds = timers[raw];
      await conn.sendMessage(message.from, { disappearingMessagesInChat: seconds });
      return await replyOk(
        conn,
        message,
        seconds === 0
          ? "Disappearing messages turned *OFF*."
          : `Disappearing messages timer set to *${raw.toUpperCase()}*.`
      );
    } catch (err) {
      return await replyFail(conn, message, `Failed to set disappearing timer: ${err?.message || err}`);
    }
  }
);

