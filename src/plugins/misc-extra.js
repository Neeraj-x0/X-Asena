/**
 * Language, per-group plugin toggle, broadcast
 */

import { command, getMenuCommands } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  withTyping,
} from "../utils/message.js";
import {
  getLang,
  setLang,
  AVAILABLE_LANGS,
  t,
} from "../utils/i18n.js";
import {
  getGroupSettings,
  setGroupSettings,
} from "../utils/groupSettings.js";
import { BOT_INFO } from "../config/constants.js";
import { isOwnerMessage } from "../utils/access.js";

command(
  {
    pattern: "lang",
    fromMe: false,
    desc: "Show/set bot language (en|id|hi)",
    usage: "#lang [en|id|hi]",
    params: { argsRequired: false, requiresQuoted: false, format: "[en|id|hi]", description: "View current language or switch to 'en', 'id', or 'hi'." },
    type: "info",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "lang") || "").trim().toLowerCase();
    if (!args) {
      const lang = await getLang();
      await reply(
        conn,
        message,
        await t("LANG_LIST", {
          list: AVAILABLE_LANGS.join(", "),
          lang,
        })
      );
      return;
    }
    try {
      const next = await setLang(args);
      await replyOk(conn, message, await t("LANG_SET", { lang: next }));
    } catch {
      await replyFail(
        conn,
        message,
        `Supported: ${AVAILABLE_LANGS.join(", ")}`
      );
    }
  }
);

command(
  {
    pattern: "disable",
    fromMe: false,
    desc: "Disable a command in this group",
    usage: "#disable <command_name>",
    params: { argsRequired: true, requiresQuoted: false, format: "<command_name>", description: "Name of command to disable in this group." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const name = (getCommandArgs(message.body, "disable") || "")
      .trim()
      .toLowerCase();
    if (!name) {
      await replyFail(
        conn,
        message,
        `Usage: ${BOT_INFO.PREFIX}disable <command>`
      );
      return;
    }
    // Protect critical commands
    const protectedCmds = new Set([
      "enable",
      "disable",
      "mode",
      "sudo",
      "menu",
      "help",
      "plugins",
    ]);
    if (protectedCmds.has(name)) {
      await replyFail(conn, message, "That command cannot be disabled.");
      return;
    }
    const s = await getGroupSettings(message.from);
    const list = new Set((s.disabledPlugins || []).map((x) => x.toLowerCase()));
    list.add(name);
    await setGroupSettings(message.from, {
      disabledPlugins: [...list],
    });
    await replyOk(conn, message, `Disabled \`${BOT_INFO.PREFIX}${name}\` in this group.`);
  }
);

command(
  {
    pattern: "enable",
    fromMe: false,
    desc: "Re-enable a command in this group",
    usage: "#enable <command_name>",
    params: { argsRequired: true, requiresQuoted: false, format: "<command_name>", description: "Name of previously disabled command to re-enable." },
    type: "admin",
    groupOnly: true,
    adminOnly: true,
  },
  async (message, conn) => {
    const name = (getCommandArgs(message.body, "enable") || "")
      .trim()
      .toLowerCase();
    if (!name) {
      await replyFail(
        conn,
        message,
        `Usage: ${BOT_INFO.PREFIX}enable <command>`
      );
      return;
    }
    const s = await getGroupSettings(message.from);
    await setGroupSettings(message.from, {
      disabledPlugins: (s.disabledPlugins || []).filter(
        (x) => x.toLowerCase() !== name
      ),
    });
    await replyOk(conn, message, `Enabled \`${BOT_INFO.PREFIX}${name}\`.`);
  }
);

command(
  {
    pattern: "plugins",
    fromMe: false,
    desc: "List disabled commands in this group",
    usage: "#plugins",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "No parameters required." },
    type: "admin",
    groupOnly: true,
  },
  async (message, conn) => {
    const s = await getGroupSettings(message.from);
    const disabled = s.disabledPlugins || [];
    if (!disabled.length) {
      await reply(conn, message, "*Disabled commands:* _(none)_");
      return;
    }
    await reply(
      conn,
      message,
      `*Disabled in this group:*\n${disabled.map((c) => `• ${BOT_INFO.PREFIX}${c}`).join("\n")}`
    );
  }
);

command(
  {
    pattern: "broadcast",
    fromMe: true,
    desc: "Broadcast message to all groups (owner)",
    usage: "#broadcast <message_text>",
    params: { argsRequired: true, requiresQuoted: false, format: "<text>", description: "Announcement message to broadcast to all active groups." },
    type: "owner",
  },
  async (message, conn) => {
    if (!isOwnerMessage(message, conn) && !message.key.fromMe) {
      await replyFail(conn, message, await t("OWNER_ONLY"));
      return;
    }

    const text = (getCommandArgs(message.body, "broadcast") || "").trim();
    if (!text) {
      await replyFail(
        conn,
        message,
        `Usage: ${BOT_INFO.PREFIX}broadcast <message>`
      );
      return;
    }

    await withTyping(conn, message.from, async () => {
      let groups = {};
      try {
        groups = await conn.groupFetchAllParticipating();
      } catch (err) {
        await replyFail(
          conn,
          message,
          `Could not fetch groups: ${err?.message || err}`
        );
        return;
      }

      const jids = Object.keys(groups || {});
      let ok = 0;
      for (const jid of jids) {
        try {
          await conn.sendMessage(jid, {
            text: `📢 *Broadcast*\n\n${text}`,
          });
          ok += 1;
          // gentle rate limit
          await new Promise((r) => setTimeout(r, 400));
        } catch {
          /* skip */
        }
      }

      await replyOk(
        conn,
        message,
        await t("BROADCAST_DONE", { ok, total: jids.length })
      );
    }, { timeoutMs: 120_000 });
  }
);

// Optional: list all command names (owner debug)
command(
  {
    pattern: "cmdlist",
    fromMe: true,
    desc: "List all command names",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const cmds = getMenuCommands()
      .map((c) => c.patternName)
      .sort();
    await reply(conn, message, `*Commands (${cmds.length}):*\n${cmds.join(", ")}`);
  }
);
