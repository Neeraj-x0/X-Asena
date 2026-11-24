/**
 * WhatsApp Intel & Number Verification Plugin
 * Commands:
 * - #checkwa: Check if phone number is registered on WhatsApp (returns JID & LID)
 * - #whois: Fetch high-resolution profile picture, bio, and account metadata
 * - #getbio: Fetch user's About/Status and timestamp
 * - #inspect: Inspect a group invite link without joining
 * - #join: Join a group via invite link
 *
 * @module plugins/intel
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { normalizeNumber, isPrivileged } from "../utils/access.js";

// ==================== CHECK WHATSAPP REGISTRATION ====================
command(
  {
    pattern: "checkwa",
    fromMe: false,
    desc: "Check if a phone number is registered on WhatsApp",
    type: "tools",
  },
  async (message, conn) => {
    let raw = (getCommandArgs(message.body, "checkwa") || "").trim();
    if (!raw && message.quoted) {
      raw = message.quoted.participant || message.quoted.sender || "";
    }
    const target = normalizeNumber(raw);
    if (!target) {
      return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}checkwa +1234567890\``);
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "🔍");
        const results = await conn.onWhatsApp(target);
        if (!results || !results.length || !results[0].exists) {
          await ackCommand(conn, message, "❌");
          return await reply(conn, message, `❌ *Number +${target} is NOT registered on WhatsApp.*`);
        }

        const res = results[0];
        await ackCommand(conn, message, "✅");
        return await reply(
          conn,
          message,
          `✅ *WHATSAPP NUMBER VERIFIED*\n\n` +
            `• *Phone Number:* +${target}\n` +
            `• *JID:* \`${res.jid}\`\n` +
            (res.lid ? `• *LID:* \`${res.lid}\`\n` : "") +
            `• *Status:* Registered & Active`
        );
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Check failed: ${err?.message || err}`);
      }
    });
  }
);

// Alias: wacheck
command(
  {
    pattern: "wacheck",
    fromMe: false,
    desc: "Alias for #checkwa",
    type: "tools",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}checkwa`);
    if (cmd?.function) await cmd.function(message, conn);
  }
);

// ==================== WHOIS / USER PROFILE ====================
command(
  {
    pattern: "whois",
    fromMe: false,
    desc: "Fetch user profile photo, bio, and account details",
    type: "tools",
  },
  async (message, conn) => {
    let target = resolveTargetUser(message);
    if (!target) {
      const raw = (getCommandArgs(message.body, "whois") || "").trim();
      if (raw) target = `${normalizeNumber(raw)}@s.whatsapp.net`;
    }
    if (!target && !message.isGroup) target = message.from;
    if (!target) {
      return await replyFail(conn, message, `Reply or mention a user: \`${BOT_INFO.PREFIX}whois @user\``);
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "🔎");
        const num = displayId(target);

        // Fetch Bio
        let bio = "No bio available";
        let setAt = null;
        try {
          const statusList = await conn.fetchStatus(target);
          if (statusList && statusList.length) {
            bio = statusList[0].status || "No bio available";
            setAt = statusList[0].setAt ? new Date(statusList[0].setAt).toLocaleDateString() : null;
          }
        } catch {
          /* privacy restricted */
        }

        // Fetch Profile Picture
        let ppUrl = null;
        try {
          ppUrl = await conn.profilePictureUrl(target, "image");
        } catch {
          /* no pfp or privacy restricted */
        }

        let caption = `👤 *USER PROFILE DETAILS*\n\n`;
        caption += `• *User:* @${num}\n`;
        caption += `• *JID:* \`${target}\`\n`;
        caption += `• *Bio:* ${bio}\n`;
        if (setAt) caption += `• *Bio Updated:* ${setAt}\n`;

        await ackCommand(conn, message, "✅");

        if (ppUrl) {
          return await conn.sendMessage(
            message.from,
            { image: { url: ppUrl }, caption, mentions: [target] },
            { quoted: message }
          );
        }

        return await reply(conn, message, caption, { mentions: [target] });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to fetch user details: ${err?.message || err}`);
      }
    });
  }
);

// ==================== GET BIO ====================
command(
  {
    pattern: "getbio",
    fromMe: false,
    desc: "Fetch user's WhatsApp About / Status",
    type: "tools",
  },
  async (message, conn) => {
    let target = resolveTargetUser(message);
    if (!target && !message.isGroup) target = message.from;
    if (!target) {
      return await replyFail(conn, message, `Reply or mention a user: \`${BOT_INFO.PREFIX}getbio @user\``);
    }

    try {
      const statusList = await conn.fetchStatus(target);
      if (!statusList || !statusList.length || !statusList[0].status) {
        return await reply(conn, message, `User @${displayId(target)} has no public bio.`, {
          mentions: [target],
        });
      }
      const item = statusList[0];
      const dateStr = item.setAt ? `\n_Updated: ${new Date(item.setAt).toLocaleString()}_` : "";
      return await reply(
        conn,
        message,
        `📝 *Bio of @${displayId(target)}:*\n\n"${item.status}"${dateStr}`,
        { mentions: [target] }
      );
    } catch (err) {
      return await replyFail(conn, message, `Could not fetch bio: ${err?.message || err}`);
    }
  }
);

// ==================== INSPECT GROUP INVITE LINK ====================
command(
  {
    pattern: "inspect",
    fromMe: false,
    desc: "Inspect a group invite link without joining",
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "inspect") || "").trim();
    if (!raw) {
      return await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}inspect https://chat.whatsapp.com/CodeHere\``
      );
    }

    const code = raw.replace(/https?:\/\/chat\.whatsapp\.com\//i, "").trim();

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "🔍");
        const info = await conn.groupGetInviteInfo(code);
        if (!info) return await replyFail(conn, message, "Invalid invite code or group not found.");

        const createdDate = info.creation ? new Date(info.creation * 1000).toLocaleDateString() : "Unknown";
        let text = `📋 *GROUP INVITE DETAILS*\n\n`;
        text += `• *Subject:* ${info.subject}\n`;
        text += `• *ID:* \`${info.id}@g.us\`\n`;
        text += `• *Total Members:* ${info.size ?? "Unknown"}\n`;
        text += `• *Created:* ${createdDate}\n`;
        if (info.owner) text += `• *Creator:* @${displayId(info.owner)}\n`;
        if (info.desc) text += `\n*Description:*\n${info.desc}`;

        await ackCommand(conn, message, "✅");
        return await reply(conn, message, text, { mentions: info.owner ? [info.owner] : [] });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to inspect link: ${err?.message || err}`);
      }
    });
  }
);

// ==================== JOIN GROUP VIA LINK ====================
command(
  {
    pattern: "join",
    fromMe: true,
    desc: "Join a group using an invite link",
    type: "tools",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can instruct the bot to join groups.");
    }

    const raw = (getCommandArgs(message.body, "join") || "").trim();
    if (!raw) {
      return await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}join https://chat.whatsapp.com/CodeHere\``
      );
    }

    const code = raw.replace(/https?:\/\/chat\.whatsapp\.com\//i, "").trim();

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const groupId = await conn.groupAcceptInvite(code);
        await ackCommand(conn, message, "✅");
        return await replyOk(conn, message, `Joined group successfully! JID: \`${groupId}\``);
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to join group: ${err?.message || err}`);
      }
    });
  }
);
