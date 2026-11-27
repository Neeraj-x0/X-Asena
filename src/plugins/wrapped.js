/**
 * Group & Chat Activity Wrapped (#wrapped)
 * Sends a multi-slide interactive Wrapped Story Card in HTML (or clean text fallback).
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping } from "../utils/message.js";
import { isPrivileged } from "../utils/access.js";
import { BOT_INFO } from "../config/constants.js";
import { computeChatWrapped, resetWrappedStats } from "../utils/wrappedStore.js";
import { buildWrappedHtml, formatWrappedText } from "../utils/wrappedHtml.js";
import { validateAndPrepareHtml, sendHtmlRichMessage } from "../utils/htmlRich.js";

command(
  {
    pattern: "wrapped",
    fromMe: false,
    desc: "Generate an interactive Spotify-Wrapped-style activity recap card for this chat",
    usage: "#wrapped [text|reset]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[text|reset]",
      description:
        "Builds an interactive multi-slide HTML Wrapped recap (top yappers, peak hour, emojis, superlatives). Pass 'text' for plain WhatsApp summary or 'reset' to clear stats.",
      examples: ["", "text", "reset"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const sub = (getCommandArgs(message.body, "wrapped") || "").trim().toLowerCase();

    if (sub === "reset" || sub === "clear") {
      if (!(await isPrivileged(message, conn))) {
        await replyFail(conn, message, "Only the owner or sudo can reset chat Wrapped stats.");
        return;
      }
      await resetWrappedStats(message.from);
      await replyOk(conn, message, "Wrapped activity counters cleared for this chat.");
      return;
    }

    await withTyping(conn, message.from, async () => {
      const stats = await computeChatWrapped(message.from, conn);
      if (!stats.totalMessages) {
        await reply(
          conn,
          message,
          `✨ *${BOT_INFO.NAME} Wrapped*\n\nNo activity recorded for this chat yet! Send a few messages (or turn \`${BOT_INFO.PREFIX}monitor on\` for full archived logs) and try \`${BOT_INFO.PREFIX}wrapped\` again.`
        );
        return;
      }

      if (sub === "text" || sub === "txt") {
        await reply(conn, message, formatWrappedText(stats));
        return;
      }

      try {
        const html = validateAndPrepareHtml(buildWrappedHtml(stats), {
          branding: true,
          requireSound: true,
        });
        await sendHtmlRichMessage(conn, message.from, html, {
          fallbackText: formatWrappedText(stats),
          validate: false,
        });
      } catch {
        // Safe fallback to plain text recap if rich relay fails
        await reply(conn, message, formatWrappedText(stats));
      }
    });
  }
);
