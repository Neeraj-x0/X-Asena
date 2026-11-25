/**
 * Anti-Call Configuration Plugin
 * Automatically reject WhatsApp voice/video calls or auto-block callers.
 *
 * @module plugins/anticall
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs } from "../utils/message.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { BOT_INFO } from "../config/constants.js";
import { isPrivileged } from "../utils/access.js";

command(
  {
    pattern: "anticall",
    fromMe: true,
    desc: "Configure auto-rejection or blocking for incoming WhatsApp calls",
    usage: "#anticall [on|block|off]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[on|block|off]",
      description: "Pass 'on' to reject calls, 'block' to reject & block callers, 'off' to disable, or empty to view current status.",
      examples: ["on", "block", "off", ""],
    },
    type: "security",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can configure Anti-Call.");
    }

    const args = (getCommandArgs(message.body, "anticall") || "").trim().toLowerCase();

    if (!args) {
      const current = (await kvGet("anti_call")) || "off";
      return await reply(
        conn,
        message,
        `📞 *ANTI-CALL CONFIGURATION*\n\n` +
          `• *Current Status:* ${current.toUpperCase()}\n\n` +
          `*Options:*\n` +
          `• \`${BOT_INFO.PREFIX}anticall on\` — Automatically reject incoming calls with polite warning\n` +
          `• \`${BOT_INFO.PREFIX}anticall block\` — Reject incoming calls and automatically block callers\n` +
          `• \`${BOT_INFO.PREFIX}anticall off\` — Disable call rejection`
      );
    }

    if (args === "on" || args === "reject") {
      await kvSet("anti_call", "on");
      return await replyOk(conn, message, "Anti-Call enabled (Calls will be automatically rejected).");
    }

    if (args === "block") {
      await kvSet("anti_call", "block");
      return await replyOk(conn, message, "Anti-Call set to BLOCK mode (Callers will be rejected and blocked).");
    }

    if (args === "off") {
      await kvSet("anti_call", "off");
      return await replyOk(conn, message, "Anti-Call disabled.");
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}anticall [on|block|off]\``);
  }
);
