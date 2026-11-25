/**
 * Interactive UI Components & Message Utilities Plugin
 * Features:
 * - #pin: Pin or unpin messages in chat (24h, 7d, 30d, unpin)
 * - #edit: Edit an already sent bot message
 * - #vcard: Generate and send WhatsApp contact cards
 * - #loc: Share a custom geographic location
 *
 * @module plugins/ui-tools
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { resolveTargetUser } from "../utils/group.js";
import { normalizeNumber } from "../utils/access.js";
import { proto } from "baileys";

// ==================== PIN & UNPIN MESSAGES ====================
command(
  {
    pattern: "pin",
    fromMe: false,
    desc: "Pin or unpin a quoted message (24h, 7d, 30d, unpin)",
    usage: "#pin [24h|7d|30d|unpin] (reply to message)",
    params: { argsRequired: false, requiresQuoted: true, format: "[24h|7d|30d|unpin]", description: "Pin the quoted message in chat for duration or pass 'unpin'." },
    type: "chats",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(
        conn,
        message,
        `Reply to a message with \`${BOT_INFO.PREFIX}pin [24h|7d|30d|unpin]\``
      );
    }

    const raw = (getCommandArgs(message.body, "pin") || "").trim().toLowerCase();
    const durations = {
      "24h": 86400,
      "1d": 86400,
      "7d": 604800,
      "30d": 2592000,
    };

    const targetKey = {
      remoteJid: message.from,
      id: message.quoted.id,
      fromMe: Boolean(message.quoted.fromMe),
      participant: message.quoted.participant,
    };

    try {
      if (raw === "unpin" || raw === "remove") {
        await conn.sendMessage(message.from, {
          pin: targetKey,
          type: proto.Message.PinInChatMessage.Type.UNPIN_FOR_ALL,
        });
        await ackCommand(conn, message, "📌");
        return await replyOk(conn, message, "Message unpinned successfully!");
      }

      const seconds = durations[raw] || 604800; // default 7 days
      await conn.sendMessage(message.from, {
        pin: targetKey,
        type: proto.Message.PinInChatMessage.Type.PIN_FOR_ALL,
        time: seconds,
      });

      await ackCommand(conn, message, "📌");
      const durationLabel = raw in durations ? raw.toUpperCase() : "7D";
      return await replyOk(conn, message, `Message pinned for *${durationLabel}*!`);
    } catch (err) {
      await replyFail(conn, message, `Failed to pin message: ${err?.message || err}`);
    }
  }
);

// ==================== EDIT SENT BOT MESSAGE ====================
command(
  {
    pattern: "edit",
    fromMe: true,
    desc: "Edit a previously sent message from the bot",
    usage: "#edit <new_text> (reply to bot's message)",
    params: { argsRequired: true, requiresQuoted: true, format: "<new_text>", description: "Edit text of a previously sent bot message." },
    type: "chats",
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(
        conn,
        message,
        `Reply to a message from the bot with \`${BOT_INFO.PREFIX}edit New text here\``
      );
    }

    const newText = (getCommandArgs(message.body, "edit") || "").trim();
    if (!newText) {
      return await replyFail(conn, message, "Please provide the replacement text.");
    }

    try {
      const targetKey = {
        remoteJid: message.from,
        id: message.quoted.id,
        fromMe: true,
      };

      await conn.sendMessage(message.from, {
        text: newText,
        edit: targetKey,
      });

      await ackCommand(conn, message, "✏️");
    } catch (err) {
      await replyFail(conn, message, `Failed to edit message: ${err?.message || err}`);
    }
  }
);

// ==================== VCARD / CONTACT CARD ====================
command(
  {
    pattern: "vcard",
    fromMe: false,
    desc: "Send a WhatsApp contact card (Name | Number or mention)",
    usage: "#vcard <Name> | <Phone_Number>",
    params: { argsRequired: true, requiresQuoted: false, format: "<Name> | <Number>", description: "Create and send a vCard contact card." },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "vcard") || "").trim();
    let name = "Contact";
    let number = "";

    if (raw.includes("|")) {
      const parts = raw.split("|");
      name = parts[0].trim() || "Contact";
      number = normalizeNumber(parts[1].trim());
    } else if (raw) {
      number = normalizeNumber(raw);
      name = raw;
    } else {
      const target = resolveTargetUser(message);
      if (target) {
        number = normalizeNumber(target);
        name = message.quoted?.pushName || `User +${number}`;
      }
    }

    if (!number) {
      return await replyFail(
        conn,
        message,
        `*Usage:*\n• \`${BOT_INFO.PREFIX}vcard John Doe | 1234567890\`\n• Reply to a user with \`${BOT_INFO.PREFIX}vcard\``
      );
    }

    try {
      const vcard =
        `BEGIN:VCARD\n` +
        `VERSION:3.0\n` +
        `FN:${name}\n` +
        `ORG:${BOT_INFO.NAME};\n` +
        `TEL;type=CELL;type=VOICE;waid=${number}:+${number}\n` +
        `END:VCARD`;

      await conn.sendMessage(message.from, {
        contacts: {
          displayName: name,
          contacts: [{ vcard }],
        },
      }, { quoted: message });
    } catch (err) {
      await replyFail(conn, message, `Failed to send contact card: ${err?.message || err}`);
    }
  }
);

// Alias: contact
command(
  {
    pattern: "contact",
    fromMe: false,
    desc: "Alias for #vcard",
    type: "tools",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}vcard`);
    if (cmd?.function) await cmd.function(message, conn);
  }
);

// ==================== LOCATION SHARING ====================
command(
  {
    pattern: "loc",
    fromMe: false,
    desc: "Share a location pin (latitude,longitude [Place Name])",
    usage: "#loc <latitude>,<longitude> [Place Name]",
    params: { argsRequired: true, requiresQuoted: false, format: "<lat>,<lon> [name]", description: "Send an interactive map pin at coordinates (e.g. '40.7128,-74.0060 New York')." },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "loc") || "").trim();
    if (!raw) {
      return await replyFail(
        conn,
        message,
        `*Usage:*\n\`${BOT_INFO.PREFIX}loc latitude,longitude [Place Name]\`\n*Example:* \`${BOT_INFO.PREFIX}loc 27.1751,78.0421 Taj Mahal\``
      );
    }

    const [coords, ...restName] = raw.split(/\s+/);
    const [latStr, lngStr] = coords.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const placeName = restName.join(" ").trim() || "Shared Location";

    if (isNaN(lat) || isNaN(lng)) {
      return await replyFail(conn, message, "Invalid coordinates. Format: `latitude,longitude`");
    }

    try {
      await conn.sendMessage(message.from, {
        location: {
          degreesLatitude: lat,
          degreesLongitude: lng,
          name: placeName,
        },
      }, { quoted: message });
    } catch (err) {
      await replyFail(conn, message, `Failed to send location: ${err?.message || err}`);
    }
  }
);
