/**
 * Scheduled Group Mute & Unmute Plugin
 * Automatically closes and opens groups at configured daily times.
 *
 * @module plugins/automute
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getGroupSettings, setGroupSettings } from "../utils/groupSettings.js";
import { isBotAdmin } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";

command(
  {
    pattern: "automute",
    fromMe: false,
    desc: "Set daily automatic group mute time (e.g. 23:00)",
    usage: "#automute <HH:MM>",
    params: {
      argsRequired: true,
      requiresQuoted: false,
      format: "<HH:MM>",
      description: "24-hour time (e.g. '23:00') to automatically lock the group daily.",
      examples: ["23:00", "22:30"],
    },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const time = (getCommandArgs(message.body, "automute") || "").trim();
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
      return await replyFail(
        conn,
        message,
        `*Usage:* \`${BOT_INFO.PREFIX}automute HH:MM\` (24-hour format)\n*Example:* \`${BOT_INFO.PREFIX}automute 23:00\` (Mute group at 11:00 PM)`
      );
    }

    const [h, m] = time.split(":").map((x) => String(parseInt(x, 10)).padStart(2, "0"));
    const formatted = `${h}:${m}`;

    await setGroupSettings(message.from, { automute: formatted });
    return await replyOk(conn, message, `Group will automatically *MUTE* every day at *${formatted}*.`);
  }
);

command(
  {
    pattern: "autounmute",
    fromMe: false,
    desc: "Set daily automatic group unmute time (e.g. 07:00)",
    usage: "#autounmute <HH:MM>",
    params: {
      argsRequired: true,
      requiresQuoted: false,
      format: "<HH:MM>",
      description: "24-hour time (e.g. '07:00') to automatically unlock the group daily.",
      examples: ["07:00", "08:30"],
    },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const time = (getCommandArgs(message.body, "autounmute") || "").trim();
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
      return await replyFail(
        conn,
        message,
        `*Usage:* \`${BOT_INFO.PREFIX}autounmute HH:MM\` (24-hour format)\n*Example:* \`${BOT_INFO.PREFIX}autounmute 07:00\` (Unmute group at 7:00 AM)`
      );
    }

    const [h, m] = time.split(":").map((x) => String(parseInt(x, 10)).padStart(2, "0"));
    const formatted = `${h}:${m}`;

    await setGroupSettings(message.from, { autounmute: formatted });
    return await replyOk(conn, message, `Group will automatically *UNMUTE* every day at *${formatted}*.`);
  }
);

command(
  {
    pattern: "autotime",
    fromMe: false,
    desc: "Inspect or disable automatic group timers (off|status)",
    usage: "#autotime [off|status]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[off|status]",
      description: "Pass 'off' to disable automute/autounmute timers, or leave empty/'status' to inspect.",
      examples: ["status", "off"],
    },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const sub = (getCommandArgs(message.body, "autotime") || "").trim().toLowerCase();
    const settings = await getGroupSettings(message.from);

    if (sub === "off" || sub === "disable") {
      await setGroupSettings(message.from, { automute: null, autounmute: null });
      return await replyOk(conn, message, "Automatic mute and unmute timers have been *DISABLED* for this group.");
    }

    return await reply(
      conn,
      message,
      `⏰ *GROUP AUTOMATED TIMERS*\n\n` +
        `• *Auto-Mute Time:* ${settings.automute ? `\`${settings.automute}\`` : "_Not set_"}\n` +
        `• *Auto-Unmute Time:* ${settings.autounmute ? `\`${settings.autounmute}\`` : "_Not set_"}\n\n` +
        `*Commands:*\n` +
        `• \`${BOT_INFO.PREFIX}automute 23:00\`\n` +
        `• \`${BOT_INFO.PREFIX}autounmute 07:00\`\n` +
        `• \`${BOT_INFO.PREFIX}autotime off\``
    );
  }
);

/**
 * Background scheduler checking automated group mutes/unmutes every minute
 */
let schedulerInterval = null;

export function startAutoMuteScheduler(conn) {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    try {
      if (!conn?.user?.id) return;
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const participating = await conn.groupFetchAllParticipating().catch(() => ({}));
      const groupJids = Object.keys(participating || {});

      for (const jid of groupJids) {
        try {
          const settings = await getGroupSettings(jid);
          let meta = groupCache.get(jid) || participating[jid];

          if (settings.automute === currentHHMM) {
            if (meta && isBotAdmin(meta, conn)) {
              await conn.groupSettingUpdate(jid, "announcement");
              await conn.sendMessage(jid, {
                text: "🌙 *[AUTO-MUTE]*\nThis group has been automatically muted as scheduled. Only admins can send messages.",
              });
            }
          }

          if (settings.autounmute === currentHHMM) {
            if (meta && isBotAdmin(meta, conn)) {
              await conn.groupSettingUpdate(jid, "not_announcement");
              await conn.sendMessage(jid, {
                text: "☀️ *[AUTO-UNMUTE]*\nThis group has been automatically unmuted as scheduled. Everyone can send messages now!",
              });
            }
          }
        } catch {
          /* skip individual group errors */
        }
      }
    } catch {
      /* skip overall cycle */
    }
  }, 60_000);
}
