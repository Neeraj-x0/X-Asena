/**
 * Onboarding, log-group, status, groupsetup, help
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs } from "../utils/message.js";
import {
  ensureLogGroup,
  getLogGroupJid,
  setLogGroupJid,
  systemLog,
  isSetupDone,
} from "../utils/logGroup.js";
import { kvDel } from "../database/botKv.js";
import { runSetupCommand, checkFfmpeg } from "../onboarding/setup.js";
import {
  setGroupSettings,
} from "../utils/groupSettings.js";
import { getMode, isOwnerMessage, isPrivileged } from "../utils/access.js";
import { getLang } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";
import os from "os";

command(
  {
    pattern: "createlog",
    fromMe: true,
    desc: "Create/recreate the system log group",
    usage: "#createlog",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Creates a dedicated system log group for bot logs and onboarding." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, "Owner/sudo only.");
      return;
    }
    await kvDel("log_group_jid");
    const res = await ensureLogGroup(conn);
    if (res.needsManual) {
      await replyFail(
        conn,
        message,
        "Set OWNER_NUMBER in .env, or create a group, add the bot, then `#setlog`."
      );
      return;
    }
    if (!res.jid) {
      await replyFail(conn, message, `Failed: ${res.error || "unknown"}`);
      return;
    }
    await replyOk(
      conn,
      message,
      `${res.created ? "Created" : "Using"} system group:\n\`${res.jid}\``
    );
  }
);

command(
  {
    pattern: "setlog",
    fromMe: true,
    desc: "Mark this group as the system log group",
    usage: "#setlog",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Marks current group as the bot system log group." },
    type: "owner",
    groupOnly: true,
  },
  async (message, conn) => {
    if (!isOwnerMessage(message, conn) && !message.key.fromMe) {
      await replyFail(conn, message, "Owner only.");
      return;
    }
    if (!message.isGroup) {
      await replyFail(conn, message, "Run inside a group.");
      return;
    }
    await setLogGroupJid(message.from);
    await replyOk(
      conn,
      message,
      "This group is now the *system log / onboarding* chat.\n" +
        `Run \`${BOT_INFO.PREFIX}setup\` here.\n` +
        "_Errors will only be posted in this group._"
    );
    await systemLog("success", `Log group set to ${message.from}`);
  }
);

command(
  {
    pattern: "setup",
    fromMe: true,
    desc: "Onboarding wizard (system log group only)",
    usage: "#setup [step_args]",
    params: { argsRequired: false, requiresQuoted: false, format: "[args]", description: "Runs interactive onboarding setup wizard inside system log group." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, "Owner/sudo only.");
      return;
    }
    const args = getCommandArgs(message.body, "setup") || "";
    let result = await runSetupCommand(message, conn, args);
    if (result.continue) {
      result = await runSetupCommand(message, conn, "start");
    }
    if (result.ok) await reply(conn, message, result.text);
    else await replyFail(conn, message, result.text);
  }
);

command(
  {
    pattern: "groupsetup",
    fromMe: false,
    desc: "Quick group moderation setup",
    usage: "#groupsetup [recommended|minimal|off]",
    params: { argsRequired: false, requiresQuoted: false, format: "[recommended|minimal|off]", description: "Apply group moderation preset ('recommended' enables welcome, antilink, antispam)." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "groupsetup") || "")
      .trim()
      .toLowerCase();

    if (!args || args === "help") {
      await reply(
        conn,
        message,
        `*Group setup*\n\n` +
          `\`${BOT_INFO.PREFIX}groupsetup recommended\` — welcome + antilink + antispam on\n` +
          `\`${BOT_INFO.PREFIX}groupsetup minimal\` — welcome only\n` +
          `\`${BOT_INFO.PREFIX}groupsetup off\` — disable welcome/goodbye/antilink/antispam\n\n` +
          `Then tweak with \`${BOT_INFO.PREFIX}groupsettings\``
      );
      return;
    }

    if (args === "recommended" || args === "full") {
      await setGroupSettings(message.from, {
        welcome: true,
        goodbye: true,
        antilink: true,
        antispam: true,
      });
      await replyOk(
        conn,
        message,
        "Applied *recommended*: welcome, goodbye, antilink, antispam ON."
      );
      return;
    }

    if (args === "minimal") {
      await setGroupSettings(message.from, {
        welcome: true,
        goodbye: false,
        antilink: false,
        antispam: false,
      });
      await replyOk(conn, message, "Applied *minimal*: welcome ON only.");
      return;
    }

    if (args === "off") {
      await setGroupSettings(message.from, {
        welcome: false,
        goodbye: false,
        antilink: false,
        antispam: false,
      });
      await replyOk(conn, message, "Moderation features turned OFF.");
      return;
    }

    await replyFail(conn, message, "Use recommended | minimal | off");
  }
);

command(
  {
    pattern: "status",
    fromMe: false,
    desc: "Bot health status",
    usage: "#status",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Displays uptime, RAM usage, mode, and platform info." },
    type: "info",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    const ff = await checkFfmpeg();
    const mode = await getMode();
    const lang = await getLang();
    const logJid = await getLogGroupJid();
    const setup = await isSetupDone();
    const uptime = Math.floor(process.uptime());
    const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);

    let text =
      `*${BOT_INFO.NAME}* v${BOT_INFO.VERSION}\n` +
      `• Uptime: ${uptime}s\n` +
      `• Mode: ${mode}\n` +
      `• Lang: ${lang}\n` +
      `• FFmpeg: ${ff.ok ? "✅" : "❌"}\n` +
      `• Setup: ${setup ? "done" : "pending"}\n`;

    if (privileged) {
      text +=
        `• RSS: ${mem} MB\n` +
        `• Platform: ${os.platform()}\n` +
        `• Log group: ${logJid || "_(not set)_"}\n` +
        `• User: ${conn.user?.id || "?"}\n`;
    }

    await reply(conn, message, text);
  }
);
