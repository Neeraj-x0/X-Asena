/**
 * Group Word Filter / Anti-Profanity Plugin
 * Automatically deletes prohibited words and warns offenders.
 *
 * @module plugins/filter
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getGroupSettings, setGroupSettings } from "../utils/groupSettings.js";

command(
  {
    pattern: "filter",
    fromMe: false,
    desc: "Manage prohibited words filter in group (on|off|add|del|list)",
    usage: "#filter [on|off|add <word>|del <word>|list]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "<on|off|add <word>|del <word>|list|status>",
      description: "Toggle auto-delete prohibited word filter or add/remove/list filtered words.",
      examples: ["on", "add spamword", "del spamword", "list"],
    },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "filter") || "").trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const word = rest.join(" ").trim().toLowerCase();
    const settings = await getGroupSettings(message.from);

    if (!raw || sub === "status") {
      const active = Boolean(settings.wordFilter);
      const list = settings.filteredWords || [];
      return await reply(
        conn,
        message,
        `🛡️ *GROUP WORD FILTER STATUS*\n\n` +
          `• *Status:* ${active ? "✅ ENABLED" : "❌ DISABLED"}\n` +
          `• *Total Filtered Words:* \`${list.length}\`\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}filter on\` — Enable automatic deletion of prohibited words\n` +
          `• \`${BOT_INFO.PREFIX}filter off\` — Disable word filter\n` +
          `• \`${BOT_INFO.PREFIX}filter add <word>\` — Add a word to the blacklist\n` +
          `• \`${BOT_INFO.PREFIX}filter del <word>\` — Remove a word from the blacklist\n` +
          `• \`${BOT_INFO.PREFIX}filter list\` — View all blacklisted words`
      );
    }

    if (sub === "on" || sub === "enable") {
      await setGroupSettings(message.from, { wordFilter: true });
      return await replyOk(conn, message, "Word filter *ENABLED* for this group.");
    }

    if (sub === "off" || sub === "disable") {
      await setGroupSettings(message.from, { wordFilter: false });
      return await replyOk(conn, message, "Word filter *DISABLED* for this group.");
    }

    if (sub === "add") {
      if (!word) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}filter add <word>\``);
      const words = new Set((settings.filteredWords || []).map((w) => w.toLowerCase()));
      words.add(word);
      await setGroupSettings(message.from, {
        wordFilter: true,
        filteredWords: [...words],
      });
      return await replyOk(conn, message, `Added *"${word}"* to filtered words list (Filter active).`);
    }

    if (sub === "del" || sub === "delete" || sub === "remove") {
      if (!word) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}filter del <word>\``);
      const words = (settings.filteredWords || []).filter((w) => w.toLowerCase() !== word);
      await setGroupSettings(message.from, { filteredWords: words });
      return await replyOk(conn, message, `Removed *"${word}"* from filtered words list.`);
    }

    if (sub === "list") {
      const list = settings.filteredWords || [];
      if (!list.length) {
        return await reply(conn, message, "📋 No prohibited words in this group's blacklist.");
      }
      return await reply(
        conn,
        message,
        `📋 *PROHIBITED WORDS (${list.length}):*\n` +
          list.map((w, i) => `${i + 1}. \`${w}\``).join("\n")
      );
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}filter [on|off|add|del|list]\``);
  }
);
