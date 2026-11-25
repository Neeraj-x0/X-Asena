/**
 * WhatsApp Status (Stories) Plugin
 * Commands for saving contact statuses, posting text/media statuses, and configuring auto-view/react.
 *
 * @module plugins/status
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, withTyping, ackCommand, getCommandArgs } from "../utils/message.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { BOT_INFO } from "../config/constants.js";
import { displayId } from "../utils/group.js";
import { isPrivileged } from "../utils/access.js";

// ==================== SAVE STATUS ====================
command(
  {
    pattern: "save",
    fromMe: false,
    desc: "Save and download a contact's status to your PM",
    usage: "#save (reply to a contact status)",
    params: { argsRequired: false, requiresQuoted: true, format: "", description: "Reply to a status update to save/forward media to your PM." },
    type: "status",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(
        conn,
        message,
        `Reply to a WhatsApp status with \`${BOT_INFO.PREFIX}save\` to download it.`
      );
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        const sender = message.quoted?.participant || message.quoted?.sender || message.from;
        const senderName = displayId(sender);
        const originalCaption = message.quoted?.caption || message.quoted?.text || "";

        let header = `📥 *[STATUS SAVED]*\n`;
        header += `• *From:* @${senderName}\n`;
        if (originalCaption) header += `• *Caption:* ${originalCaption}\n`;

        // Send to requester's private chat
        const targetJid = message.sender || message.from;

        if (media && media.buffer) {
          const payload = {};
          if (media.type === "image") {
            payload.image = media.buffer;
            payload.caption = header;
            payload.mentions = [sender];
          } else if (media.type === "video") {
            payload.video = media.buffer;
            payload.caption = header;
            payload.mentions = [sender];
          } else if (media.type === "audio") {
            payload.audio = media.buffer;
            payload.mimetype = media.mimetype || "audio/ogg; codecs=opus";
          } else {
            payload.document = media.buffer;
            payload.mimetype = media.mimetype || "application/octet-stream";
            payload.caption = header;
            payload.mentions = [sender];
          }

          if (media.type === "audio") {
            await conn.sendMessage(targetJid, { text: header, mentions: [sender] });
            await conn.sendMessage(targetJid, payload);
          } else {
            await conn.sendMessage(targetJid, payload);
          }
        } else if (originalCaption) {
          await conn.sendMessage(targetJid, {
            text: `${header}\n\n${originalCaption}`,
            mentions: [sender],
          });
        } else {
          return await replyFail(conn, message, "Could not extract content from the quoted status.");
        }

        await ackCommand(conn, message, "✅");
        await replyOk(conn, message, "Status sent to your private chat!");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        await replyFail(conn, message, `Failed to save status: ${err?.message || err}`);
      }
    });
  }
);

// Alias: statussaver
command(
  {
    pattern: "statussaver",
    fromMe: false,
    desc: "Alias for #save",
    type: "status",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}save`);
    if (cmd?.function) await cmd.function(message, conn);
  }
);

// ==================== POST STATUS ====================
command(
  {
    pattern: "poststatus",
    fromMe: true,
    desc: "Post text or media to bot's WhatsApp Status",
    usage: "#poststatus <status_text> (or reply to image/video with optional caption)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "[text]", description: "Broadcast text status or quoted media to WhatsApp Status." },
    type: "status",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can post to WhatsApp status.");
    }

    const rawText = (getCommandArgs(message.body, "poststatus") || "").trim();

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");

        // Check if media is quoted or attached
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (media && media.buffer) {
          const caption = rawText || message.quoted?.caption || "";
          const payload = {};
          if (media.type === "image") {
            payload.image = media.buffer;
            payload.caption = caption;
          } else if (media.type === "video") {
            payload.video = media.buffer;
            payload.caption = caption;
          } else if (media.type === "audio") {
            payload.audio = media.buffer;
            payload.mimetype = media.mimetype || "audio/ogg; codecs=opus";
            payload.ptt = true;
          }

          await conn.sendMessage("status@broadcast", payload);
          await ackCommand(conn, message, "✅");
          return await replyOk(conn, message, `Media status posted successfully!`);
        }

        // Text status
        if (!rawText) {
          return await replyFail(
            conn,
            message,
            `Provide text or reply to media to post.\n*Usage:* \`${BOT_INFO.PREFIX}poststatus Your message here\``
          );
        }

        // WhatsApp colors
        const colors = [
          0xff26c4dc, 0xff792138, 0xff8b6990, 0xfff0b330, 0xffae8774,
          0xff5696ff, 0xffff7b6b, 0xff54c265, 0xff6b2572, 0xfff33e58
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        await conn.sendMessage("status@broadcast", {
          text: rawText,
          backgroundColor: randomColor,
          font: 1,
        });

        await ackCommand(conn, message, "✅");
        return await replyOk(conn, message, "Text status posted successfully!");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to post status: ${err?.message || err}`);
      }
    });
  }
);

// ==================== AUTO STATUS CONFIG ====================
command(
  {
    pattern: "autostatus",
    fromMe: true,
    desc: "Configure auto-reading or auto-reacting to contact statuses",
    usage: "#autostatus [view|react|off|status]",
    params: { argsRequired: false, requiresQuoted: false, format: "[view|react|off|status]", description: "Enable auto-viewing or auto-reacting to WhatsApp Status updates." },
    type: "status",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can configure auto-status.");
    }

    const args = (getCommandArgs(message.body, "autostatus") || "").trim();
    const parts = args.split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (!sub) {
      const current = (await kvGet("auto_status")) || "off";
      const react = (await kvGet("auto_status_react")) || "none";
      return await reply(
        conn,
        message,
        `📱 *AUTO STATUS CONFIGURATION*\n\n` +
          `• *Auto View Status:* ${current.toUpperCase()}\n` +
          `• *Auto React Emoji:* ${react}\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}autostatus on\` — Enable auto-view\n` +
          `• \`${BOT_INFO.PREFIX}autostatus off\` — Disable auto-view\n` +
          `• \`${BOT_INFO.PREFIX}autostatus react <emoji|off>\` — Set reaction emoji (e.g. 💚)`
      );
    }

    if (sub === "on") {
      await kvSet("auto_status", "on");
      return await replyOk(conn, message, "Auto-viewing contact statuses enabled.");
    }

    if (sub === "off") {
      await kvSet("auto_status", "off");
      return await replyOk(conn, message, "Auto-viewing contact statuses disabled.");
    }

    if (sub === "react") {
      const emoji = parts[1];
      if (!emoji || emoji === "off" || emoji === "none") {
        await kvSet("auto_status_react", "");
        return await replyOk(conn, message, "Status auto-reaction disabled.");
      }
      await kvSet("auto_status_react", emoji);
      return await replyOk(conn, message, `Status auto-reaction set to: ${emoji}`);
    }

    return await replyFail(conn, message, `Unknown option. Type \`${BOT_INFO.PREFIX}autostatus\` for help.`);
  }
);
