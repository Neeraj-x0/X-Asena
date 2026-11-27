/**
 * Chat Message Monitor Store (#monitor on / off)
 * Captures and persists all raw WhatsApp WAMessage objects of monitored chats in BotKV
 * using chunked storage and per-chat write serialization (SQLite & Postgres safe).
 */

import { normalizeMessageContent } from "baileys";
import { kvGet, kvSet, kvDel } from "../database/botKv.js";
import { encodeBufferJson, decodeBufferJson, cloneBufferJson } from "../database/bufferJson.js";
import { extractMessagePreviewText } from "../messages/serialize.js";

const INDEX_KEY = "monitor_chats";
const CHUNK_PREFIX = "monitor_log:";
const CHUNK_SIZE = 100;
const MAX_CHUNKS_PER_CHAT = Number(process.env.MONITOR_MAX_CHUNKS || 50); // up to 5,000 raw msgs/chat

let indexCache = null;
let loadPromise = null;
const activeChats = new Set();
const writeQueues = new Map();

function chunkKey(chatJid, idx) {
  return `${CHUNK_PREFIX}${chatJid}:${idx}`;
}

function rebuildActiveSet() {
  activeChats.clear();
  if (!indexCache) return;
  for (const [jid, meta] of Object.entries(indexCache)) {
    if (meta?.enabled) activeChats.add(jid);
  }
}

async function ensureIndex() {
  if (indexCache) return indexCache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const stored = await kvGet(INDEX_KEY);
        indexCache = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      } catch {
        indexCache = {};
      }
      rebuildActiveSet();
      return indexCache;
    })().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

function enqueueChatWrite(chatJid, fn) {
  const prev = writeQueues.get(chatJid) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (writeQueues.get(chatJid) === next) {
      writeQueues.delete(chatJid);
    }
  });
  writeQueues.set(chatJid, next);
  return next;
}

function extractMessageSummary(rawMsg) {
  const content = normalizeMessageContent(rawMsg?.message) || rawMsg?.message || {};
  const key =
    Object.keys(content).find(
      (k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage" && content[k] != null
    ) || "unknown";
  const mime = key.replace(/Message.*$/i, "").toLowerCase();
  const preview = extractMessagePreviewText(content[key], mime);
  return {
    messageTypeKey: key,
    preview: String(preview || "").replace(/\s+/g, " ").trim().slice(0, 80),
  };
}

/**
 * Fast check whether monitoring is enabled for `chatJid`.
 */
export async function isChatMonitored(chatJid) {
  if (!chatJid) return false;
  await ensureIndex();
  return activeChats.has(chatJid);
}

/**
 * Turn monitoring ON or OFF for a chat.
 */
export async function setChatMonitor(chatJid, enabled, actor = null) {
  if (!chatJid) throw new Error("Missing chat JID");
  return enqueueChatWrite(chatJid, async () => {
    const idx = await ensureIndex();
    const prev = idx[chatJid] || {};
    const now = Date.now();
    idx[chatJid] = {
      enabled: Boolean(enabled),
      enabledBy: enabled ? actor || prev.enabledBy || null : prev.enabledBy || null,
      enabledAt: enabled ? now : prev.enabledAt || null,
      disabledAt: enabled ? null : now,
      count: Number(prev.count || 0),
      minChunk: Number(prev.minChunk || 0),
      maxChunk: Number(prev.maxChunk || 0),
      lastAt: prev.lastAt || null,
    };
    rebuildActiveSet();
    await kvSet(INDEX_KEY, idx);
    return { chatJid, ...idx[chatJid] };
  });
}

export async function getChatMonitorStatus(chatJid) {
  const idx = await ensureIndex();
  const entry = idx[chatJid] || {};
  return {
    chatJid,
    enabled: Boolean(entry.enabled),
    enabledBy: entry.enabledBy || null,
    enabledAt: entry.enabledAt || null,
    count: Number(entry.count || 0),
    minChunk: Number(entry.minChunk || 0),
    maxChunk: Number(entry.maxChunk || 0),
    lastAt: entry.lastAt || null,
  };
}

export async function listMonitoredChats() {
  const idx = await ensureIndex();
  return Object.entries(idx)
    .map(([chatJid, meta]) => ({
      chatJid,
      enabled: Boolean(meta?.enabled),
      count: Number(meta?.count || 0),
      lastAt: meta?.lastAt || null,
    }))
    .filter((entry) => entry.enabled || entry.count > 0);
}

/**
 * Persist a raw Baileys WAMessage object if monitoring is enabled for its chat.
 */
export async function recordMonitoredMessage(rawMsg) {
  const chatJid = rawMsg?.key?.remoteJid;
  if (!chatJid || !rawMsg?.message) return false;

  const monitored = await isChatMonitored(chatJid);
  if (!monitored) return false;

  // Deep-clone raw WAMessage losslessly before enqueueing
  const clonedRaw = cloneBufferJson(rawMsg);

  return enqueueChatWrite(chatJid, async () => {
    const idx = await ensureIndex();
    const meta = idx[chatJid];
    if (!meta?.enabled) return false;

    let minChunk = Number(meta.minChunk || 0);
    let maxChunk = Number(meta.maxChunk || 0);
    let totalCount = Number(meta.count || 0);

    let currentChunk = decodeBufferJson(await kvGet(chunkKey(chatJid, maxChunk)));
    if (!Array.isArray(currentChunk)) currentChunk = [];

    if (currentChunk.length >= CHUNK_SIZE) {
      maxChunk += 1;
      currentChunk = [];
      // Evict oldest chunk if exceeding retention cap
      while (maxChunk - minChunk + 1 > MAX_CHUNKS_PER_CHAT) {
        const oldChunk = decodeBufferJson(await kvGet(chunkKey(chatJid, minChunk)));
        const oldLen = Array.isArray(oldChunk) ? oldChunk.length : 0;
        await kvDel(chunkKey(chatJid, minChunk));
        totalCount = Math.max(0, totalCount - oldLen);
        minChunk += 1;
      }
    }

    const { messageTypeKey, preview } = extractMessageSummary(clonedRaw);
    const entry = {
      id: clonedRaw.key?.id || null,
      savedAt: Date.now(),
      sender: clonedRaw.key?.participant || clonedRaw.key?.remoteJid || null,
      pushName: clonedRaw.pushName || "",
      messageTypeKey,
      preview,
      rawMessage: clonedRaw,
    };

    currentChunk.push(entry);
    await kvSet(chunkKey(chatJid, maxChunk), encodeBufferJson(currentChunk));

    idx[chatJid] = {
      ...meta,
      count: totalCount + 1,
      minChunk,
      maxChunk,
      lastAt: entry.savedAt,
    };
    await kvSet(INDEX_KEY, idx);
    return true;
  });
}

/**
 * Retrieve saved monitored messages (oldest-to-newest for the requested tail or all).
 */
export async function getMonitoredMessages(chatJid, { limit = 20, all = false } = {}) {
  const status = await getChatMonitorStatus(chatJid);
  if (status.count === 0 && status.maxChunk === 0) {
    const check = decodeBufferJson(await kvGet(chunkKey(chatJid, 0)));
    if (!Array.isArray(check) || !check.length) return [];
  }

  const collected = [];
  for (let c = status.maxChunk; c >= status.minChunk; c--) {
    const chunk = decodeBufferJson(await kvGet(chunkKey(chatJid, c)));
    if (!Array.isArray(chunk) || !chunk.length) continue;
    for (let i = chunk.length - 1; i >= 0; i--) {
      collected.push(chunk[i]);
      if (!all && collected.length >= limit) break;
    }
    if (!all && collected.length >= limit) break;
  }

  return collected.reverse();
}

/**
 * Delete all saved messages for a chat from DB.
 */
export async function clearMonitoredMessages(chatJid) {
  return enqueueChatWrite(chatJid, async () => {
    const idx = await ensureIndex();
    const prev = idx[chatJid];
    if (!prev) return 0;

    const removedCount = Number(prev.count || 0);
    for (let c = Number(prev.minChunk || 0); c <= Number(prev.maxChunk || 0); c++) {
      await kvDel(chunkKey(chatJid, c));
    }

    if (prev.enabled) {
      idx[chatJid] = {
        ...prev,
        count: 0,
        minChunk: 0,
        maxChunk: 0,
        lastAt: null,
      };
    } else {
      delete idx[chatJid];
    }
    rebuildActiveSet();
    await kvSet(INDEX_KEY, idx);
    return removedCount;
  });
}

/** Reset in-memory cache (for tests or DB close) */
export function resetMonitorCache() {
  indexCache = null;
  loadPromise = null;
  activeChats.clear();
}
