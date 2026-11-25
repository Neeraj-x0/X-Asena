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
import { groupCache, createTtlCache } from "../utils/cache.js";
import { kvGet, kvSet } from "../database/botKv.js";

const INDEX_KEY = "automute_schedules";

export async function syncAutoMuteIndex(groupJid, patch) {
  const index = (await kvGet(INDEX_KEY)) || {};
  const cur = index[groupJid] || {};
  const next = { ...cur, ...patch };
  if (!next.automute && !next.autounmute) {
    delete index[groupJid];
  } else {
    index[groupJid] = next;
  }
  await kvSet(INDEX_KEY, index);
}

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
    await syncAutoMuteIndex(message.from, { automute: formatted });
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
    await syncAutoMuteIndex(message.from, { autounmute: formatted });
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
      await syncAutoMuteIndex(message.from, { automute: null, autounmute: null });
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
 * Background scheduler checking automated group mutes/unmutes every 30s (indexed; zero idle network polling)
 */
let schedulerInterval = null;
let activeAutoMuteConn = null;
const triggeredInMinute = createTtlCache({ ttlMs: 90_000, max: 200 });

export function stopAutoMuteScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  activeAutoMuteConn = null;
}

export function startAutoMuteScheduler(conn) {
  // Always update conn reference so reconnects never leave a stale closed socket
  activeAutoMuteConn = conn;
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    try {
      const sock = activeAutoMuteConn;
      if (!sock?.user?.id) return;

      const index = (await kvGet(INDEX_KEY)) || {};
      const entries = Object.entries(index);
      if (!entries.length) return; // Fast-path exit with 0 network calls when unconfigured

      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      for (const [jid, sched] of entries) {
        if (!sched) continue;
        try {
          if (sched.automute === currentHHMM && !triggeredInMinute.get(`${jid}:mute:${currentHHMM}`)) {
            triggeredInMinute.set(`${jid}:mute:${currentHHMM}`, true);
            let meta = groupCache.get(jid);
            if (!meta) {
              meta = await sock.groupMetadata(jid).catch(() => null);
              if (meta) groupCache.set(jid, meta);
            }
            if (meta && isBotAdmin(meta, sock)) {
              await sock.groupSettingUpdate(jid, "announcement");
              await sock.sendMessage(jid, {
                text: "🌙 *[AUTO-MUTE]*\nThis group has been automatically muted as scheduled. Only admins can send messages.",
              });
            }
          }

          if (sched.autounmute === currentHHMM && !triggeredInMinute.get(`${jid}:unmute:${currentHHMM}`)) {
            triggeredInMinute.set(`${jid}:unmute:${currentHHMM}`, true);
            let meta = groupCache.get(jid);
            if (!meta) {
              meta = await sock.groupMetadata(jid).catch(() => null);
              if (meta) groupCache.set(jid, meta);
            }
            if (meta && isBotAdmin(meta, sock)) {
              await sock.groupSettingUpdate(jid, "not_announcement");
              await sock.sendMessage(jid, {
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
  }, 30_000);

  schedulerInterval.unref?.();
}
