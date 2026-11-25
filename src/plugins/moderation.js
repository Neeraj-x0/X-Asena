/**
 * Group moderation: welcome, goodbye, antilink, antispam, warn, mute, kick
 */

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  withTyping,
} from "../utils/message.js";
import {
  getGroupSettings,
  setGroupSettings,
  toggleGroupFlag,
  addWarn,
  getWarns,
  resetWarns,
} from "../utils/groupSettings.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { normalizeNumber } from "../utils/access.js";
import { t } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";
import { groupCache } from "../utils/cache.js";

function onOff(v) {
  return v ? "ON" : "OFF";
}

command(
  {
    pattern: "welcome",
    fromMe: false,
    desc: "Toggle/set welcome message",
    usage: "#welcome [on|off|<custom_template>]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off|<template with @user, @group, @count>]", description: "Toggle welcome on/off or set custom welcome text template." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "welcome") || "").trim();
    if (!args) {
      const s = await toggleGroupFlag(message.from, "welcome");
      await replyOk(
        conn,
        message,
        s.welcome ? await t("WELCOME_ON") : await t("WELCOME_OFF")
      );
      return;
    }
    if (args === "on" || args === "off") {
      await setGroupSettings(message.from, { welcome: args === "on" });
      await replyOk(
        conn,
        message,
        args === "on" ? await t("WELCOME_ON") : await t("WELCOME_OFF")
      );
      return;
    }
    await setGroupSettings(message.from, {
      welcome: true,
      welcomeText: args,
    });
    await replyOk(conn, message, "Welcome text updated & enabled.");
  }
);

command(
  {
    pattern: "goodbye",
    fromMe: false,
    desc: "Toggle/set goodbye message",
    usage: "#goodbye [on|off|<custom_template>]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off|<template with @user, @group, @count>]", description: "Toggle goodbye message on/off or set custom template." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "goodbye") || "").trim();
    if (!args) {
      const s = await toggleGroupFlag(message.from, "goodbye");
      await replyOk(
        conn,
        message,
        s.goodbye ? await t("GOODBYE_ON") : await t("GOODBYE_OFF")
      );
      return;
    }
    if (args === "on" || args === "off") {
      await setGroupSettings(message.from, { goodbye: args === "on" });
      await replyOk(
        conn,
        message,
        args === "on" ? await t("GOODBYE_ON") : await t("GOODBYE_OFF")
      );
      return;
    }
    await setGroupSettings(message.from, {
      goodbye: true,
      goodbyeText: args,
    });
    await replyOk(conn, message, "Goodbye text updated & enabled.");
  }
);

command(
  {
    pattern: "antilink",
    fromMe: false,
    desc: "Toggle anti-link",
    usage: "#antilink [on|off|kick|delete|warn]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off|kick|delete|warn]", description: "Toggle anti-link protection or specify action on detected links." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antilink") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") {
      s = await setGroupSettings(message.from, { antilink: args === "on" });
    } else {
      s = await toggleGroupFlag(message.from, "antilink");
    }
    await replyOk(conn, message, `Anti-link: *${onOff(s.antilink)}*`);
  }
);

command(
  {
    pattern: "antispam",
    fromMe: false,
    desc: "Toggle anti-spam",
    usage: "#antispam [on|off]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off]", description: "Enable or disable anti-spam rate protection in this group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "antispam") || "").trim().toLowerCase();
    let s;
    if (args === "on" || args === "off") {
      s = await setGroupSettings(message.from, { antispam: args === "on" });
    } else {
      s = await toggleGroupFlag(message.from, "antispam");
    }
    await replyOk(
      conn,
      message,
      `Anti-spam: *${onOff(s.antispam)}* (${s.antispamLimit}/${s.antispamWindowMs}ms)`
    );
  }
);

command(
  {
    pattern: "groupsettings",
    fromMe: false,
    desc: "Show group moderation settings",
    usage: "#groupsettings",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Displays all active moderation flags and timers for the group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const s = await getGroupSettings(message.from);
    await reply(
      conn,
      message,
      `*Group settings*\n` +
        `• Welcome: ${onOff(s.welcome)}\n` +
        `• Goodbye: ${onOff(s.goodbye)}\n` +
        `• Antilink: ${onOff(s.antilink)}\n` +
        `• Antispam: ${onOff(s.antispam)}\n` +
        `• Warn limit: ${s.warnLimit}\n` +
        `• Muted: ${s.muted.length}\n` +
        `• Disabled cmds: ${s.disabledPlugins.join(", ") || "none"}`
    );
  }
);

command(
  {
    pattern: "warn",
    fromMe: false,
    desc: "Warn a user (kick at limit)",
    usage: "#warn <@user|phone_number> (or reply to user)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "<@user|number> [reason]", description: "Issue a warning to a group member; kicks automatically if limit reached." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const target = resolveTargetUser(message);
      if (!target) {
        await replyFail(
          conn,
          message,
          `Reply/mention a user.\nUsage: ${BOT_INFO.PREFIX}warn @user`
        );
        return;
      }
      const settings = await getGroupSettings(message.from);
      const norm = normalizeNumber(target) || target;
      const count = await addWarn(message.from, norm);
      const limit = settings.warnLimit || 3;

      const text = (await t("WARNED", { count, limit })).replace(
        "@user",
        `@${displayId(target)}`
      );
      await conn.sendMessage(message.from, {
        text,
        mentions: [target],
      });

      if (count >= limit) {
        try {
          await conn.groupParticipantsUpdate(message.from, [target], "remove");
          await resetWarns(message.from, norm);
          const kicked = (await t("KICKED_WARNS")).replace(
            "@user",
            `@${displayId(target)}`
          );
          await conn.sendMessage(message.from, {
            text: kicked,
            mentions: [target],
          });
        } catch {
          await replyFail(conn, message, "Could not remove user (need admin).");
        }
      }
    });
  }
);

command(
  {
    pattern: "unwarn",
    fromMe: false,
    desc: "Reset warns for a user",
    usage: "#unwarn <@user|phone_number> (or reply)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "<@user|number>", description: "Clear all accumulated warnings for a group member." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) {
      await replyFail(conn, message, "Reply/mention a user.");
      return;
    }
    const norm = normalizeNumber(target) || target;
    await resetWarns(message.from, norm);
    await replyOk(conn, message, `Warns reset for @${displayId(target)}`);
  }
);

command(
  {
    pattern: "warns",
    fromMe: false,
    desc: "Show warn count",
    usage: "#warns [@user|phone_number]",
    params: { argsRequired: false, requiresQuoted: "optional", format: "[@user|number]", description: "Check warning count for mentioned/replied user or yourself." },
    type: "admin",
    groupOnly: true,
  },
  async (message, conn) => {
    const target = resolveTargetUser(message) || message.sender;
    const norm = normalizeNumber(target) || target;
    const count = await getWarns(message.from, norm);
    const settings = await getGroupSettings(message.from);
    await reply(
      conn,
      message,
      `Warns for @${displayId(target)}: *${count}/${settings.warnLimit}*`
    );
  }
);

command(
  {
    pattern: "mute",
    fromMe: false,
    desc: "Mute a user in this group",
    usage: "#mute <@user|phone_number> (or reply)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "<@user|number>", description: "Silently auto-deletes messages from the muted user in this group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) {
      await replyFail(conn, message, "Reply/mention a user.");
      return;
    }
    const s = await getGroupSettings(message.from);
    const n = normalizeNumber(target) || target;
    if (!s.muted.includes(n)) s.muted.push(n);
    await setGroupSettings(message.from, { muted: s.muted });
    await replyOk(conn, message, `Muted @${displayId(target)}`);
  }
);

command(
  {
    pattern: "unmute",
    fromMe: false,
    desc: "Unmute a user",
    usage: "#unmute <@user|phone_number> (or reply)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "<@user|number>", description: "Unmute a previously muted member in this group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) {
      await replyFail(conn, message, "Reply/mention a user.");
      return;
    }
    const s = await getGroupSettings(message.from);
    const n = normalizeNumber(target) || target;
    await setGroupSettings(message.from, {
      muted: (s.muted || []).filter((x) => x !== n),
    });
    await replyOk(conn, message, `Unmuted @${displayId(target)}`);
  }
);

command(
  {
    pattern: "kick",
    fromMe: false,
    desc: "Remove a member",
    usage: "#kick <@user|phone_number> (or reply)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "<@user|number>", description: "Remove a participant from the group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const target = resolveTargetUser(message);
    if (!target) {
      await replyFail(conn, message, "Reply/mention a user.");
      return;
    }
    try {
      await conn.groupParticipantsUpdate(message.from, [target], "remove");
      groupCache.delete(message.from);
      await replyOk(conn, message, `Removed @${displayId(target)}`);
    } catch {
      await replyFail(conn, message, "Failed to kick (bot must be admin).");
    }
  }
);

command(
  {
    pattern: "antidelete",
    fromMe: false,
    desc: "Toggle/set Anti-Delete message recovery (on/off/pm)",
    usage: "#antidelete [on|off|pm|chat]",
    params: { argsRequired: false, requiresQuoted: false, format: "[on|off|pm|chat]", description: "Recover deleted messages directly in chat or forward to owner PM." },
    type: "security",
  },
  async (message, conn) => {
    const rawArgs = (getCommandArgs(message.body, "antidelete") || "").trim().toLowerCase();
    const isGroup = message.from.endsWith("@g.us");

    // Global toggle (owner only)
    if (rawArgs.startsWith("global")) {
      const parts = rawArgs.split(/\s+/);
      const val = parts[1];
      const { kvSet } = await import("../database/botKv.js");
      if (val === "on" || val === "chat") {
        await kvSet("global_antidelete", "chat");
        return await replyOk(conn, message, "Global Anti-Delete enabled (Chat mode).");
      } else if (val === "pm") {
        await kvSet("global_antidelete", "pm");
        return await replyOk(conn, message, "Global Anti-Delete enabled (PM mode).");
      } else if (val === "off") {
        await kvSet("global_antidelete", "off");
        return await replyOk(conn, message, "Global Anti-Delete disabled.");
      }
      return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}antidelete global on|pm|off\``);
    }

    if (!isGroup) {
      return await replyFail(conn, message, `In direct chats, use \`${BOT_INFO.PREFIX}antidelete global on|pm|off\``);
    }

    const cur = await getGroupSettings(message.from);

    if (!rawArgs) {
      const nextState = cur.antidelete ? false : "chat";
      await setGroupSettings(message.from, { antidelete: nextState });
      return await replyOk(
        conn,
        message,
        `Anti-Delete is now *${nextState ? (nextState === "pm" ? "ON (PM mode)" : "ON (Chat mode)") : "OFF"}*`
      );
    }

    if (rawArgs === "on" || rawArgs === "chat") {
      await setGroupSettings(message.from, { antidelete: "chat" });
      return await replyOk(conn, message, "Anti-Delete enabled for this group (Restores in chat).");
    }

    if (rawArgs === "pm") {
      await setGroupSettings(message.from, { antidelete: "pm" });
      return await replyOk(conn, message, "Anti-Delete enabled for this group (Restores sent to PM).");
    }

    if (rawArgs === "off") {
      await setGroupSettings(message.from, { antidelete: false });
      return await replyOk(conn, message, "Anti-Delete disabled for this group.");
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}antidelete [on|pm|off]\``);
  }
);
