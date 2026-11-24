/**
 * Anti-Foreign / Country Code Blocker Plugin
 * Automatically removes participants with phone numbers from prohibited country codes.
 *
 * @module plugins/antiforeign
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getGroupSettings, setGroupSettings } from "../utils/groupSettings.js";

command(
  {
    pattern: "antiforeign",
    fromMe: false,
    desc: "Auto-kick participants from specific country codes (on|off|add|del|list)",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "antiforeign") || "").trim();
    const [sub, ...rest] = raw.split(/\s+/);
    let code = rest.join("").trim().replace(/\D/g, "");
    const settings = await getGroupSettings(message.from);

    if (!raw || sub === "status") {
      const active = Boolean(settings.antiforeign);
      const list = settings.foreignCodes || [];
      return await reply(
        conn,
        message,
        `🌍 *ANTI-FOREIGN NUMBER BLOCKER*\n\n` +
          `• *Status:* ${active ? "✅ ENABLED" : "❌ DISABLED"}\n` +
          `• *Blocked Country Codes:* ${list.length ? list.map((c) => `+${c}`).join(", ") : "None"}\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}antiforeign on\` — Turn on auto-kicking for blacklisted country codes\n` +
          `• \`${BOT_INFO.PREFIX}antiforeign off\` — Turn off\n` +
          `• \`${BOT_INFO.PREFIX}antiforeign add <code>\` — Blacklist a country calling code (e.g. \`1\` or \`212\`)\n` +
          `• \`${BOT_INFO.PREFIX}antiforeign del <code>\` — Remove country code\n` +
          `• \`${BOT_INFO.PREFIX}antiforeign list\` — List all blocked country codes`
      );
    }

    if (sub === "on" || sub === "enable") {
      await setGroupSettings(message.from, { antiforeign: true });
      return await replyOk(conn, message, "Anti-Foreign number blocker *ENABLED*.");
    }

    if (sub === "off" || sub === "disable") {
      await setGroupSettings(message.from, { antiforeign: false });
      return await replyOk(conn, message, "Anti-Foreign number blocker *DISABLED*.");
    }

    if (sub === "add") {
      if (!code) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}antiforeign add <country_code>\` (e.g. \`1\`)`);
      const codes = new Set((settings.foreignCodes || []).map((c) => String(c).replace(/\D/g, "")));
      codes.add(code);
      await setGroupSettings(message.from, {
        antiforeign: true,
        foreignCodes: [...codes],
      });
      return await replyOk(conn, message, `Country code *+${code}* blacklisted (Auto-kick active).`);
    }

    if (sub === "del" || sub === "delete" || sub === "remove") {
      if (!code) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}antiforeign del <country_code>\``);
      const codes = (settings.foreignCodes || []).filter((c) => String(c).replace(/\D/g, "") !== code);
      await setGroupSettings(message.from, { foreignCodes: codes });
      return await replyOk(conn, message, `Removed country code *+${code}* from blacklist.`);
    }

    if (sub === "list") {
      const list = settings.foreignCodes || [];
      if (!list.length) {
        return await reply(conn, message, "📋 No country codes are currently blacklisted.");
      }
      return await reply(
        conn,
        message,
        `🌍 *BLACKLISTED COUNTRY CODES (${list.length}):*\n` +
          list.map((c) => `• +${c}`).join("\n")
      );
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}antiforeign [on|off|add|del|list]\``);
  }
);
