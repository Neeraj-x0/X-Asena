/**
 * Persistent storage and native replay for saved quoted WhatsApp messages (#quoted / #getquoted)
 * Works across both SQLite and Postgres BotKV backends.
 */

import {
  WAProto,
  BufferJSON,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  normalizeMessageContent,
} from "baileys";
import { kvGet, kvSet, kvDel } from "../database/botKv.js";
import { downloadQuotedOrSelf } from "./media.js";

const INDEX_KEY = "saved_quotes_index";
const ITEM_PREFIX = "saved_quote:";
const MAX_SAVED_MEDIA_BYTES = 12 * 1024 * 1024; // 12 MB safe DB cap

function serializeWithBuffers(obj) {
  return JSON.stringify(obj, BufferJSON.replacer);
}

function parseWithBuffers(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    return JSON.parse(raw, BufferJSON.reviver);
  }
  return JSON.parse(JSON.stringify(raw), BufferJSON.reviver);
}

export function normalizeQuoteName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Unwrap ephemeral wrappers while preserving real content wrappers.
 */
function unwrapEphemeral(msg) {
  let current = msg;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    break;
  }
  return current;
}

/**
 * Recursively strip forwarding badges, old reply stanza contextInfo, and foreign secrets
 * so replayed messages appear cleanly as originating from the bot itself.
 */
export function sanitizeProtoForBotSend(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeProtoForBotSend(v));
  if (typeof obj !== "object") return obj;

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (k === "messageContextInfo") continue;
    if (k === "senderKeyDistributionMessage") continue;
    if (k === "contextInfo" && v && typeof v === "object") {
      const cleanCtx = {};
      if (Array.isArray(v.mentionedJid) && v.mentionedJid.length > 0) {
        cleanCtx.mentionedJid = [...v.mentionedJid];
      }
      if (v.externalAdReply && typeof v.externalAdReply === "object") {
        cleanCtx.externalAdReply = sanitizeProtoForBotSend(v.externalAdReply);
      }
      if (Object.keys(cleanCtx).length > 0) {
        out.contextInfo = cleanCtx;
      }
      continue;
    }
    out[k] = sanitizeProtoForBotSend(v);
  }
  return out;
}

async function downloadStreamToBuffer(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_SAVED_MEDIA_BYTES) {
      throw new Error("Media exceeds 12MB DB save limit");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function tryDownloadHeaderMedia(unwrapped) {
  const interactiveHeader = unwrapped?.interactiveMessage?.header;
  const buttonsHeader = unwrapped?.buttonsMessage;
  const headerTargets = [interactiveHeader, buttonsHeader].filter(Boolean);

  for (const container of headerTargets) {
    for (const [key, kind] of [
      ["imageMessage", "image"],
      ["videoMessage", "video"],
      ["documentMessage", "document"],
    ]) {
      const node = container?.[key];
      if (node?.mediaKey && (node?.directPath || node?.url)) {
        try {
          const stream = await downloadContentFromMessage(node, kind);
          const buffer = await downloadStreamToBuffer(stream);
          return {
            kind,
            mimetype: node.mimetype || undefined,
            fileName: node.fileName || undefined,
            buffer,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function detectPreview(quoted, sanitizedProto) {
  const text = String(quoted?.text || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 60);
  const type = quoted?.type || "message";
  if (sanitizedProto?.interactiveMessage?.nativeFlowMessage?.buttons?.length) {
    return `${sanitizedProto.interactiveMessage.nativeFlowMessage.buttons.length} interactive button(s)`;
  }
  return `[${type}]`;
}

export async function listSavedQuotes() {
  const list = await kvGet(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

export async function getSavedQuoteByQuery(query) {
  const index = await listSavedQuotes();
  if (!index.length) return null;

  const qStr = String(query || "").trim();
  if (!qStr) return null;

  let meta = null;
  if (/^\d+$/.test(qStr)) {
    const idx = Number.parseInt(qStr, 10) - 1;
    if (idx >= 0 && idx < index.length) {
      meta = index[idx];
    }
  }
  if (!meta) {
    const norm = normalizeQuoteName(qStr);
    meta = index.find((item) => item.key === norm) || null;
  }
  if (!meta) return null;

  const rawItem = await kvGet(`${ITEM_PREFIX}${meta.key}`);
  const item = parseWithBuffers(rawItem);
  if (!item) return null;
  return { meta, item };
}

export async function deleteSavedQuote(query) {
  const index = await listSavedQuotes();
  const qStr = String(query || "").trim();
  if (!qStr || !index.length) return null;

  let idx = -1;
  if (/^\d+$/.test(qStr)) {
    const n = Number.parseInt(qStr, 10) - 1;
    if (n >= 0 && n < index.length) idx = n;
  }
  if (idx === -1) {
    const norm = normalizeQuoteName(qStr);
    idx = index.findIndex((item) => item.key === norm);
  }
  if (idx === -1) return null;

  const [removed] = index.splice(idx, 1);
  await kvDel(`${ITEM_PREFIX}${removed.key}`);
  await kvSet(INDEX_KEY, index);
  return removed;
}

/**
 * Save a quoted WhatsApp message to BotKV under `name`.
 */
export async function saveQuotedMessage({ message, conn, name }) {
  if (!message?.quoted) {
    throw new Error("Reply to a message first to save it.");
  }
  const displayName = String(name || "").trim();
  const key = normalizeQuoteName(displayName);
  if (!key) {
    throw new Error("Provide a name to save the quoted message (e.g. `#quoted interactive`).");
  }

  const rawSource = message.quoted.rawQuotedMessage || message.quoted.raw;
  if (!rawSource || typeof rawSource !== "object") {
    throw new Error("Could not read the raw quoted message content.");
  }

  const unwrapped = unwrapEphemeral(rawSource);
  const protoCopy = JSON.parse(JSON.stringify(unwrapped, BufferJSON.replacer), BufferJSON.reviver);
  const sanitizedProto = sanitizeProtoForBotSend(protoCopy);
  const normContent = normalizeMessageContent(sanitizedProto) || sanitizedProto;

  const mediaTypes = new Set(["image", "video", "audio", "sticker", "document"]);
  let savedMedia = null;
  let headerMedia = null;

  if (mediaTypes.has(message.quoted.type)) {
    try {
      const downloaded = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
      if (downloaded?.buffer && downloaded.buffer.length <= MAX_SAVED_MEDIA_BYTES) {
        savedMedia = {
          type: downloaded.type,
          mimetype: downloaded.mimetype || message.quoted.mimetype || undefined,
          fileName: message.quoted.fileName || undefined,
          caption: message.quoted.caption || undefined,
          ptt: Boolean(message.quoted.ptt),
          gifPlayback: Boolean(message.quoted.gifPlayback),
          viewOnce: Boolean(message.quoted.isViewOnce),
          mentions: message.quoted.contextInfo?.mentionedJid || undefined,
          buffer: downloaded.buffer,
        };
      }
    } catch {
      /* fallback to raw proto replay */
    }
  } else {
    headerMedia = await tryDownloadHeaderMedia(normContent);
  }

  const record = {
    key,
    name: displayName,
    type: message.quoted.type || "unknown",
    messageTypeKey: message.quoted.messageTypeKey || Object.keys(normContent || {})[0] || "unknown",
    proto: normContent,
    savedMedia,
    headerMedia,
  };

  await kvSet(`${ITEM_PREFIX}${key}`, serializeWithBuffers(record));

  const index = await listSavedQuotes();
  const now = Date.now();
  const existingIdx = index.findIndex((entry) => entry.key === key);
  const meta = {
    key,
    name: displayName,
    type: record.type,
    messageTypeKey: record.messageTypeKey,
    preview: detectPreview(message.quoted, normContent),
    hasMedia: Boolean(savedMedia || headerMedia),
    savedBy: message.sender || null,
    savedAt: existingIdx >= 0 ? index[existingIdx].savedAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    index[existingIdx] = meta;
  } else {
    index.push(meta);
  }
  await kvSet(INDEX_KEY, index);

  return {
    meta,
    replaced: existingIdx >= 0,
  };
}

function buildAdditionalNodes(protoMsg) {
  const nodes = [];
  const inner = normalizeMessageContent(protoMsg) || protoMsg || {};

  if (inner.interactiveMessage) {
    if (inner.interactiveMessage.nativeFlowMessage || inner.interactiveMessage.carouselMessage) {
      nodes.push({
        tag: "biz",
        attrs: {},
        content: [
          {
            tag: "interactive",
            attrs: { type: "native_flow", v: "1" },
            content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
          },
        ],
      });
    } else {
      nodes.push({ tag: "biz", attrs: {} });
    }
  } else if (inner.buttonsMessage || inner.listMessage || inner.templateMessage) {
    nodes.push({ tag: "biz", attrs: {} });
  } else if (inner.eventMessage) {
    nodes.push({
      tag: "meta",
      attrs: { event_type: "creation" },
    });
  }

  return nodes;
}

/**
 * Send a saved quoted message freshly into `targetJid` as if sent from the bot itself.
 */
export async function sendSavedQuote(conn, targetJid, item) {
  if (!conn || !targetJid || !item) {
    throw new Error("Missing connection, target chat, or saved message.");
  }

  // 1. Fresh media upload + send (images, videos, stickers, audio, documents)
  if (item.savedMedia?.buffer) {
    const m = item.savedMedia;
    const buf = Buffer.isBuffer(m.buffer) ? m.buffer : Buffer.from(m.buffer);
    const payload = { [m.type]: buf };
    if (m.caption) payload.caption = m.caption;
    if (m.mimetype) payload.mimetype = m.mimetype;
    if (m.fileName) payload.fileName = m.fileName;
    if (m.type === "audio" && m.ptt) payload.ptt = true;
    if (m.type === "video" && m.gifPlayback) payload.gifPlayback = true;
    if (m.viewOnce) payload.viewOnce = true;
    if (Array.isArray(m.mentions) && m.mentions.length) payload.mentions = m.mentions;
    return await conn.sendMessage(targetJid, payload);
  }

  const rawProto = sanitizeProtoForBotSend(item.proto || {});
  const protoMsg = normalizeMessageContent(rawProto) || rawProto;

  // 2. Plain text conversation
  if (typeof protoMsg.conversation === "string") {
    return await conn.sendMessage(targetJid, { text: protoMsg.conversation });
  }

  // 3. Poll creation (needs fresh messageSecret + poll meta stanza)
  const poll =
    protoMsg.pollCreationMessage ||
    protoMsg.pollCreationMessageV2 ||
    protoMsg.pollCreationMessageV3;
  if (poll?.name && Array.isArray(poll?.options)) {
    return await conn.sendMessage(targetJid, {
      poll: {
        name: poll.name,
        values: poll.options.map((o) => o.optionName).filter(Boolean),
        selectableCount: Number(poll.selectableOptionsCount || 1),
      },
    });
  }

  // 4. Location & Contacts via high-level Baileys API
  if (protoMsg.locationMessage && typeof protoMsg.locationMessage.degreesLatitude === "number") {
    const loc = protoMsg.locationMessage;
    return await conn.sendMessage(targetJid, {
      location: {
        degreesLatitude: loc.degreesLatitude,
        degreesLongitude: loc.degreesLongitude,
        name: loc.name || undefined,
        address: loc.address || undefined,
        url: loc.url || undefined,
      },
    });
  }

  if (protoMsg.contactMessage?.vcard) {
    return await conn.sendMessage(targetJid, {
      contacts: {
        displayName: protoMsg.contactMessage.displayName || "Contact",
        contacts: [{ vcard: protoMsg.contactMessage.vcard }],
      },
    });
  }

  if (protoMsg.contactsArrayMessage?.contacts?.length) {
    return await conn.sendMessage(targetJid, {
      contacts: {
        displayName: protoMsg.contactsArrayMessage.displayName || "Contacts",
        contacts: protoMsg.contactsArrayMessage.contacts.map((c) => ({ vcard: c.vcard })),
      },
    });
  }

  // 5. Re-upload header media if present on interactive / buttons messages
  if (item.headerMedia?.buffer && typeof conn.waUploadToServer === "function") {
    try {
      const hm = item.headerMedia;
      const buf = Buffer.isBuffer(hm.buffer) ? hm.buffer : Buffer.from(hm.buffer);
      const uploaded = await prepareWAMessageMedia(
        {
          [hm.kind]: buf,
          ...(hm.mimetype ? { mimetype: hm.mimetype } : {}),
          ...(hm.fileName ? { fileName: hm.fileName } : {}),
        },
        { upload: conn.waUploadToServer }
      );
      const mediaKeyName = `${hm.kind}Message`;
      if (uploaded?.[mediaKeyName]) {
        if (protoMsg.interactiveMessage?.header?.[mediaKeyName]) {
          protoMsg.interactiveMessage.header[mediaKeyName] = uploaded[mediaKeyName];
        } else if (protoMsg.buttonsMessage?.[mediaKeyName]) {
          protoMsg.buttonsMessage[mediaKeyName] = uploaded[mediaKeyName];
        }
      }
    } catch {
      /* continue with existing header metadata */
    }
  }

  // 6. Native proto replay (interactiveMessage, buttonsMessage, listMessage, extendedTextMessage, etc.)
  const cleanMsgObject = WAProto.Message.create(protoMsg);
  const fullMsg = generateWAMessageFromContent(targetJid, cleanMsgObject, {
    userJid: conn.user?.id,
    timestamp: new Date(),
  });
  const additionalNodes = buildAdditionalNodes(protoMsg);

  await conn.relayMessage(targetJid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalNodes,
  });

  return fullMsg;
}
