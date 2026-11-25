/**
 * Notes, reminders, polls
 */

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
} from "../utils/message.js";
import { saveNote, getNote, deleteNote, listNotes } from "../utils/notes.js";
import {
  addReminder,
  listReminders,
  cancelReminder,
  parseWhen,
} from "../utils/reminders.js";
import { t } from "../utils/i18n.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";

command(
  {
    pattern: "note",
    fromMe: false,
    desc: "Save/get/delete personal notes",
    usage: "#note <set <id> <text>|get <id>|del <id>|list>",
    params: { argsRequired: true, requiresQuoted: false, format: "<set <id> <text>|get <id>|del <id>|list>", description: "Manage saved personal text notes by key ID.", examples: ["set todo Buy groceries", "get todo", "list"] },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "note") || "").trim();
    const owner = message.sender;
    if (!raw) {
      await replyFail(
        conn,
        message,
        `Usage:\n${BOT_INFO.PREFIX}note set <id> <text>\n${BOT_INFO.PREFIX}note get <id>\n${BOT_INFO.PREFIX}note del <id>\n${BOT_INFO.PREFIX}note list`
      );
      return;
    }

    const [action, id, ...rest] = raw.split(/\s+/);
    const act = action.toLowerCase();

    if (act === "list") {
      const notes = await listNotes(owner);
      if (!notes.length) {
        await reply(conn, message, "*Notes:* _(empty)_");
        return;
      }
      await reply(
        conn,
        message,
        `*Notes:*\n${notes.map((n) => `• *${n.id}* — ${n.text.slice(0, 60)}`).join("\n")}`
      );
      return;
    }

    if (act === "get") {
      if (!id) {
        await replyFail(conn, message, "Provide note id.");
        return;
      }
      const n = await getNote(owner, id);
      if (!n) {
        await replyFail(conn, message, await t("NOTE_NOT_FOUND"));
        return;
      }
      await reply(conn, message, `*Note \`${id}\`*\n${n.text}`);
      return;
    }

    if (act === "del" || act === "delete" || act === "rm") {
      if (!id) {
        await replyFail(conn, message, "Provide note id.");
        return;
      }
      const ok = await deleteNote(owner, id);
      if (!ok) {
        await replyFail(conn, message, await t("NOTE_NOT_FOUND"));
        return;
      }
      await replyOk(conn, message, await t("NOTE_DELETED", { id }));
      return;
    }

    if (act === "set" || act === "add" || act === "save") {
      const text = rest.join(" ").trim();
      if (!id || !text) {
        await replyFail(
          conn,
          message,
          `Usage: ${BOT_INFO.PREFIX}note set <id> <text>`
        );
        return;
      }
      await saveNote(owner, id, text);
      await replyOk(conn, message, await t("NOTE_SAVED", { id }));
      return;
    }

    // Shorthand: #note <id> <text> → set
    const text = [id, ...rest].join(" ").trim();
    if (action && text) {
      await saveNote(owner, action, text);
      await replyOk(conn, message, await t("NOTE_SAVED", { id: action }));
      return;
    }

    await replyFail(conn, message, "Unknown note action.");
  }
);

command(
  {
    pattern: "remind",
    fromMe: false,
    desc: "Set a reminder (e.g. 10m buy milk)",
    usage: "#remind <delay> <reminder_text>",
    params: { argsRequired: true, requiresQuoted: false, format: "<duration> <message>", description: "Set a timed reminder (e.g. '10m check server', '2h call team').", examples: ["10m buy milk", "1h standup meeting"] },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "remind") || "").trim();
    if (!raw) {
      await replyFail(
        conn,
        message,
        `Usage: ${BOT_INFO.PREFIX}remind <time> <text>\nTime: 30s, 10m, 2h, 1d`
      );
      return;
    }

    const [whenToken, ...rest] = raw.split(/\s+/);
    const at = parseWhen(whenToken);
    const text = rest.join(" ").trim();
    if (!at || !text) {
      await replyFail(
        conn,
        message,
        `Invalid time or empty text.\nExample: ${BOT_INFO.PREFIX}remind 10m Check oven`
      );
      return;
    }

    const id = `r_${Date.now().toString(36)}`;
    await addReminder({
      id,
      jid: message.from,
      text,
      at,
      createdBy: normalizeNumber(message.sender) || message.sender,
    });

    const when = new Date(at).toLocaleString();
    await replyOk(conn, message, await t("REMINDER_SET", { when }));
  }
);

command(
  {
    pattern: "reminders",
    fromMe: false,
    desc: "List pending reminders in this chat",
    usage: "#reminders",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Lists all active reminders scheduled in this chat." },
    type: "tools",
  },
  async (message, conn) => {
    const list = await listReminders(message.from);
    if (!list.length) {
      await reply(conn, message, "*Reminders:* _(none)_");
      return;
    }
    await reply(
      conn,
      message,
      `*Reminders:*\n${list
        .map(
          (r) =>
            `• \`${r.id}\` ${new Date(r.at).toLocaleString()} — ${r.text}`
        )
        .join("\n")}`
    );
  }
);

command(
  {
    pattern: "cancelremind",
    fromMe: false,
    desc: "Cancel reminder by id",
    usage: "#cancelremind <reminder_id>",
    params: { argsRequired: true, requiresQuoted: false, format: "<id>", description: "ID of the pending reminder to cancel." },
    type: "tools",
  },
  async (message, conn) => {
    const id = (getCommandArgs(message.body, "cancelremind") || "").trim();
    if (!id) {
      await replyFail(conn, message, `Usage: ${BOT_INFO.PREFIX}cancelremind <id>`);
      return;
    }
    const ok = await cancelReminder(id);
    if (!ok) {
      await replyFail(conn, message, "Reminder not found.");
      return;
    }
    await replyOk(conn, message, `Cancelled \`${id}\``);
  }
);

command(
  {
    pattern: "poll",
    fromMe: false,
    desc: "Create a poll: question | opt1 | opt2",
    usage: "#poll <question> | <option1> | <option2> ...",
    params: { argsRequired: true, requiresQuoted: false, format: "<question> | <opt1> | <opt2> [| <opt3>...]", description: "Pipe-separated question and 2-12 options to send a WhatsApp poll.", examples: ["Favorite language? | JS | Python | Go"] },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "poll") || "").trim();
    if (!raw.includes("|")) {
      await replyFail(
        conn,
        message,
        `Usage: ${BOT_INFO.PREFIX}poll Question? | Option A | Option B | Option C`
      );
      return;
    }
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    const values = parts.slice(1);
    if (!name || values.length < 2) {
      await replyFail(conn, message, "Need a question and at least 2 options.");
      return;
    }
    if (values.length > 12) {
      await replyFail(conn, message, "Max 12 options.");
      return;
    }

    try {
      await conn.sendMessage(message.from, {
        poll: {
          name,
          values,
          selectableCount: 1,
        },
      });
    } catch (err) {
      await replyFail(
        conn,
        message,
        `Poll failed: ${err?.message || "unsupported"}`
      );
    }
  }
);
