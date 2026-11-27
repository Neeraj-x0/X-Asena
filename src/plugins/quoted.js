/**
 * Saved Quoted Messages Plugin (#quoted / #getquoted / getquoted / #delquoted)
 * - Reply to any message with `#quoted <name>` to store the raw WhatsApp message (including interactive/buttons/media/polls/etc.) in DB
 * - Type `#getquoted` or `getquoted` to list saved items, then reply with a number to send the exact saved message from the bot itself
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping } from "../utils/message.js";
import { getMode, isPrivileged } from "../utils/access.js";
import { BOT_INFO } from "../config/constants.js";
import {
  saveQuotedMessage,
  listSavedQuotes,
  getSavedQuoteByQuery,
  deleteSavedQuote,
  sendSavedQuote,
} from "../utils/quotedStore.js";

/**
 * Pending numbered selection sessions after `getquoted`
 * Map keyed by chatJid -> { expiresAt, listMsgId, count }
 */
const pendingListSessions = new Map();
const LIST_SESSION_TTL_MS = 10 * 60 * 1000;

function recordListSession(chatJid, listMsgId, count) {
  const now = Date.now();
  for (const [k, v] of pendingListSessions) {
    if (v.expiresAt <= now) pendingListSessions.delete(k);
  }
  pendingListSessions.set(chatJid, {
    expiresAt: now + LIST_SESSION_TTL_MS,
    listMsgId: listMsgId || null,
    count,
  });
}

function formatSavedList(index) {
  const lines = ["📚 *SAVED QUOTED MESSAGES*\n"];
  index.forEach((item, i) => {
    const preview = item.preview ? ` — _${item.preview}_` : "";
    lines.push(`*${i + 1}.* \`${item.name}\` (${item.type})${preview}`);
  });
  lines.push("");
  lines.push("↩️ *Reply with a number* (e.g. `1`) to send that message from the bot.");
  lines.push(`🗑️ Delete with \`${BOT_INFO.PREFIX}delquoted <number|name>\``);
  return lines.join("\n");
}

async function showSavedList(message, conn) {
  const index = await listSavedQuotes();
  if (!index.length) {
    await reply(
      conn,
      message,
      `📭 No saved quoted messages yet.\n\nReply to any message with \`${BOT_INFO.PREFIX}quoted <name>\` to save it.`
    );
    return;
  }
  const sent = await reply(conn, message, formatSavedList(index));
  recordListSession(message.from, sent?.key?.id || null, index.length);
}

async function sendSelectedQuote(message, conn, query) {
  const found = await getSavedQuoteByQuery(query);
  if (!found) {
    await replyFail(
      conn,
      message,
      `Saved quote \`${query}\` not found. Send \`getquoted\` to see the numbered list.`
    );
    return;
  }
  await sendSavedQuote(conn, message.from, found.item);
}

/**
 * Unprefixed handler for:
 *  - `getquoted` / `getquoted <number|name>`
 *  - Numeric reply (e.g. `1`, `2`) after `getquoted` (either quoting the list message or replying in chat)
 */
export async function handleQuotedInteraction({ message, conn }) {
  const text = String(message?.body || "").trim();
  if (!text) return false;

  const lower = text.toLowerCase();

  // 1. Unprefixed `getquoted` trigger
  if (lower === "getquoted" || lower.startsWith("getquoted ")) {
    const mode = await getMode();
    if (mode === "private" && !(await isPrivileged(message, conn))) {
      return true;
    }
    const arg = text.slice("getquoted".length).trim();
    if (arg) {
      await sendSelectedQuote(message, conn, arg);
    } else {
      await showSavedList(message, conn);
    }
    return true;
  }

  // 2. Numeric reply matching an active `getquoted` session
  if (!pendingListSessions.size) return false;
  if (!/^\d{1,3}$/.test(text)) return false;

  const session = pendingListSessions.get(message.from);
  if (!session || session.expiresAt <= Date.now()) {
    pendingListSessions.delete(message.from);
    return false;
  }

  const quotedStanza = message.quoted?.stanzaId || message.message?.contextInfo?.stanzaId;
  // Require either replying to our list message OR if no other message was quoted, match active chat session
  if (quotedStanza && session.listMsgId && quotedStanza !== session.listMsgId) {
    return false;
  }

  const n = Number.parseInt(text, 10);
  if (n < 1 || n > session.count) {
    return false;
  }

  const mode = await getMode();
  if (mode === "private" && !(await isPrivileged(message, conn))) {
    return true;
  }

  await sendSelectedQuote(message, conn, String(n));
  return true;
}

command(
  {
    pattern: "quoted",
    fromMe: false,
    desc: "Save a quoted message (interactive, media, poll, text, etc.) to DB by name",
    usage: "#quoted <name> (reply to a message) | #quoted del <name|number>",
    params: {
      argsRequired: true,
      requiresQuoted: "optional",
      format: "<name|list|del <name|number>>",
      description:
        "Reply to any WhatsApp message with `#quoted <name>` to store its exact payload in DB so it can be re-sent cleanly via `getquoted`.",
      examples: ["interactive", "welcome", "list", "del interactive"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "quoted") || "").trim();
    const [first, ...rest] = raw.split(/\s+/).filter(Boolean);
    const sub = (first || "").toLowerCase();

    if (!raw) {
      await reply(
        conn,
        message,
        `💾 *SAVED QUOTES*\n\n` +
          `• Reply to any message with \`${BOT_INFO.PREFIX}quoted <name>\` to save it\n` +
          `• Send \`${BOT_INFO.PREFIX}getquoted\` or \`getquoted\` to list & replay by number\n` +
          `• Send \`${BOT_INFO.PREFIX}delquoted <number|name>\` to remove one`
      );
      return;
    }

    if (!message.quoted) {
      if (sub === "list") {
        await showSavedList(message, conn);
        return;
      }
      if ((sub === "del" || sub === "delete" || sub === "rm") && rest.length) {
        const deleted = await deleteSavedQuote(rest.join(" "));
        if (!deleted) {
          await replyFail(conn, message, `Saved quote \`${rest.join(" ")}\` not found.`);
          return;
        }
        await replyOk(conn, message, `Deleted saved quote \`${deleted.name}\`.`);
        return;
      }
      await replyFail(
        conn,
        message,
        `Reply to the message you want to save, e.g. \`${BOT_INFO.PREFIX}quoted ${raw}\``
      );
      return;
    }

    await withTyping(conn, message.from, async () => {
      try {
        const { meta, replaced } = await saveQuotedMessage({
          message,
          conn,
          name: raw,
        });
        await replyOk(
          conn,
          message,
          `${replaced ? "Updated" : "Saved"} quoted message *${meta.name}* (\`${meta.type}\`${meta.hasMedia ? ", media cached" : ""}).\nSend \`getquoted\` anytime to list and send it.`
        );
      } catch (err) {
        await replyFail(conn, message, `Failed to save quoted message: ${err?.message || err}`);
      }
    });
  }
);

command(
  {
    pattern: "getquoted",
    fromMe: false,
    desc: "List saved quoted messages and reply with a number to send from the bot",
    usage: "#getquoted [number|name]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[number|name]",
      description:
        "Lists all saved quoted messages with numbers so you can reply a number to send it directly as the bot, or pass a number/name directly.",
      examples: ["", "1", "interactive"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "getquoted") || "").trim();
    if (arg) {
      await sendSelectedQuote(message, conn, arg);
      return;
    }
    await showSavedList(message, conn);
  }
);

command(
  {
    pattern: "delquoted",
    fromMe: false,
    desc: "Delete a saved quoted message by number or name",
    usage: "#delquoted <number|name>",
    params: {
      argsRequired: true,
      requiresQuoted: false,
      format: "<number|name>",
      description: "Deletes a saved quoted message from the database.",
      examples: ["1", "interactive"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const arg = (getCommandArgs(message.body, "delquoted") || "").trim();
    if (!arg) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}delquoted <number|name>\``);
      return;
    }
    const deleted = await deleteSavedQuote(arg);
    if (!deleted) {
      await replyFail(conn, message, `Saved quote \`${arg}\` not found.`);
      return;
    }
    await replyOk(conn, message, `Deleted saved quote \`${deleted.name}\`.`);
  }
);
