/**
 * Anti View-Once Plugin
 * Recovers View-Once (viewOnceMessage) media into permanent photos, videos, and voice notes.
 *
 * Usage:
 * - #vv / #antiviewonce (Reply to a View-Once message to decrypt & reveal it)
 * - #antiviewonce on | pm | off (Toggle auto-sniffing and archiving)
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, withTyping, ackCommand, getCommandArgs } from "../utils/message.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { getGroupSettings, setGroupSettings } from "../utils/groupSettings.js";
import { BOT_INFO } from "../config/constants.js";
import { displayId } from "../utils/group.js";
import { normalizeNumber } from "../utils/access.js";

command(
  {
    pattern: "vv",
    fromMe: false,
    desc: "Recover and reveal a View-Once image, video, or voice note",
    usage: "#vv [on|chat|pm|off] (or reply to view-once media with empty args)",
    params: {
      argsRequired: false,
      requiresQuoted: "optional",
      format: "[on|chat|pm|off]",
      description: "Reply to a view-once message with empty args to reveal it, or pass 'on'/'chat'/'pm'/'off' to configure automatic view-once capture.",
      examples: ["", "on", "pm", "off"],
    },
    type: "security",
  },
  async (message, conn) => {
    const rawArgs = (getCommandArgs(message.body, "vv") || "").trim().toLowerCase();

    // Configuration subcommand
    if (rawArgs === "on" || rawArgs === "chat" || rawArgs === "pm" || rawArgs === "off") {
      const isGroup = message.from.endsWith("@g.us");
      if (isGroup) {
        const val = rawArgs === "off" ? false : rawArgs === "pm" ? "pm" : "chat";
        await setGroupSettings(message.from, { antiviewonce: val });
        return await replyOk(conn, message, `Anti View-Once is now *${val ? val.toUpperCase() : "OFF"}* for this group.`);
      } else {
        const val = rawArgs === "off" ? "off" : rawArgs === "pm" ? "pm" : "chat";
        await kvSet("global_antiviewonce", val);
        return await replyOk(conn, message, `Global Anti View-Once is now *${val.toUpperCase()}*.`);
      }
    }

    if (!message.quoted) {
      return await replyFail(
        conn,
        message,
        `Reply to a View-Once message with \`${BOT_INFO.PREFIX}vv\` to retrieve it.`
      );
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (!media || !media.buffer) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, "Could not download media from the quoted message.");
        }

        const sender = message.quoted?.participant || message.quoted?.sender || message.from;
        const senderNumber = displayId(sender);
        const originalCaption = message.quoted?.caption || message.quoted?.text || "";

        let header = `🔓 *[VIEW-ONCE RECOVERED]*\n`;
        header += `• *From:* @${senderNumber}\n`;
        header += `• *Type:* ${media.type.toUpperCase()}\n`;
        if (originalCaption) {
          header += `• *Caption:* ${originalCaption}\n`;
        }

        const mentions = [sender];
        const payload = {};

        if (media.type === "image") {
          payload.image = media.buffer;
          payload.caption = header;
          payload.mentions = mentions;
        } else if (media.type === "video") {
          payload.video = media.buffer;
          payload.caption = header;
          payload.mentions = mentions;
        } else if (media.type === "audio") {
          payload.audio = media.buffer;
          payload.mimetype = media.mimetype || "audio/ogg; codecs=opus";
          payload.ptt = false;
        } else {
          payload.document = media.buffer;
          payload.mimetype = media.mimetype || "application/octet-stream";
          payload.caption = header;
          payload.mentions = mentions;
        }

        // If audio, send header text first then audio
        if (media.type === "audio") {
          await reply(conn, message, header, { mentions });
          await conn.sendMessage(message.from, payload, { quoted: message });
        } else {
          await conn.sendMessage(message.from, payload, { quoted: message });
        }

        await ackCommand(conn, message, "✅");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        await replyFail(conn, message, `Failed to recover view-once: ${err?.message || err}`);
      }
    }, { timeoutMs: 45_000 });
  }
);

// Alias: antiviewonce
command(
  {
    pattern: "antiviewonce",
    fromMe: false,
    desc: "Alias for #vv (Recover View-Once media)",
    type: "security",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    // Re-dispatch using same flow
    const rawArgs = (getCommandArgs(message.body, "antiviewonce") || "").trim().toLowerCase();
    message.body = `${BOT_INFO.PREFIX}vv ${rawArgs}`.trim();
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}vv`);
    if (cmd?.function) {
      await cmd.function(message, conn);
    }
  }
);

/**
 * Automatically sniff and archive incoming view-once media if enabled
 */
export async function handleAutoViewOnce(message, conn) {
  try {
    const isGroup = message.from.endsWith("@g.us");
    let isEnabled = false;
    let targetDestination = message.from;

    if (isGroup) {
      const gset = await getGroupSettings(message.from);
      if (gset.antiviewonce) {
        isEnabled = true;
        if (gset.antiviewonce === "pm") {
          targetDestination = BOT_INFO.OWNER
            ? `${normalizeNumber(BOT_INFO.OWNER)}@s.whatsapp.net`
            : message.from;
        }
      }
    }

    if (!isEnabled) {
      const globalSetting = await kvGet("global_antiviewonce");
      if (globalSetting && globalSetting !== "off") {
        isEnabled = true;
        if (globalSetting === "pm") {
          targetDestination = BOT_INFO.OWNER
            ? `${normalizeNumber(BOT_INFO.OWNER)}@s.whatsapp.net`
            : message.from;
        }
      }
    }

    if (!isEnabled) return;

    const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: false });
    if (!media || !media.buffer) return;

    const sender = message.sender || message.from;
    const senderNumber = displayId(sender);
    const originalCaption = message.body || "";

    let header = `🔓 *[AUTO ANTI-VIEWONCE]*\n`;
    header += `• *From:* @${senderNumber}\n`;
    header += `• *Type:* ${media.type.toUpperCase()}\n`;
    if (originalCaption) header += `• *Caption:* ${originalCaption}\n`;

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
    }

    await conn.sendMessage(targetDestination, payload);
  } catch (err) {
    console.error("[antiviewonce] auto-sniff error:", err?.message || err);
  }
}
