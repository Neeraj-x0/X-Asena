/**
 * Chat Activity Wrapped Aggregator (#wrapped)
 * Tracks lightweight bounded chat engagement stats in memory (flushed lazily to BotKV)
 * and merges persisted #monitor logs cleanly without double-counting.
 */

import { normalizeMessageContent } from "baileys";
import { kvGet, kvSet, kvDel } from "../database/botKv.js";
import { isBotSentId, groupCache } from "./cache.js";
import { extractMessagePreviewText } from "../messages/serialize.js";
import { normalizeNumber } from "./access.js";
import { getMonitoredMessages } from "./monitorStore.js";

const STATS_PREFIX = "wrapped_stats:";
const MAX_CHATS_IN_RAM = 40;
const MAX_SENDERS = 80;
const MAX_EMOJIS = 40;
const MAX_WORDS = 80;
const MAX_RECENT_IDS = 120;
const FLUSH_INTERVAL_MS = 30_000;

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "you", "are", "with", "was", "not", "but",
  "have", "from", "what", "your", "just", "like", "yeah", "okay", "bro", "hey",
  "can", "will", "all", "out", "get", "got", "how", "why", "who", "when", "where",
  "its", "it's", "dont", "don't", "did", "does", "has", "had", "been", "being",
  "here", "there", "then", "than", "now", "one", "two", "yes", "nah", "lol",
]);

const memChats = new Map();
const dirtyChats = new Set();
let flushTimer = null;

function createEmptyStats() {
  return {
    totalMessages: 0,
    totalWords: 0,
    totalEmojis: 0,
    hourly: new Array(24).fill(0),
    types: { text: 0, sticker: 0, media: 0, other: 0 },
    senders: {},
    emojis: {},
    words: {},
    recentIds: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function scheduleFlush() {
  if (flushTimer || !dirtyChats.size) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushWrappedStats().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

async function getOrLoadStats(chatJid) {
  if (memChats.has(chatJid)) {
    const val = memChats.get(chatJid);
    memChats.delete(chatJid);
    memChats.set(chatJid, val);
    return val;
  }

  let loaded = null;
  try {
    loaded = await kvGet(`${STATS_PREFIX}${chatJid}`);
  } catch {
    /* BotKV may not be ready in unit tests */
  }
  const stats =
    loaded && typeof loaded === "object" && Array.isArray(loaded.hourly)
      ? { ...createEmptyStats(), ...loaded }
      : createEmptyStats();

  memChats.set(chatJid, stats);
  while (memChats.size > MAX_CHATS_IN_RAM) {
    const oldest = memChats.keys().next().value;
    memChats.delete(oldest);
  }
  return stats;
}

function classifyTypeKey(key) {
  if (!key) return "other";
  const k = key.toLowerCase();
  if (k === "conversation" || k === "extendedtextmessage") return "text";
  if (k === "stickermessage") return "sticker";
  if (
    k === "imagemessage" ||
    k === "videomessage" ||
    k === "ptvmessage" ||
    k === "audiomessage" ||
    k === "documentmessage" ||
    k === "documentwithcaptionmessage"
  ) {
    return "media";
  }
  return "other";
}

function incrementTopMap(mapObj, key, delta, maxKeys) {
  mapObj[key] = (mapObj[key] || 0) + delta;
  const keys = Object.keys(mapObj);
  if (keys.length > maxKeys + 15) {
    keys
      .sort((a, b) => mapObj[b] - mapObj[a])
      .slice(maxKeys)
      .forEach((drop) => delete mapObj[drop]);
  }
}

function ingestIntoStats(stats, { id, sender, pushName, timestampMs, contentKey, text }) {
  if (id) {
    if (stats.recentIds.includes(id)) return false;
    stats.recentIds.push(id);
    if (stats.recentIds.length > MAX_RECENT_IDS) {
      stats.recentIds.splice(0, stats.recentIds.length - MAX_RECENT_IDS);
    }
  }

  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const hour = new Date(ts).getHours();
  if (hour >= 0 && hour < 24) stats.hourly[hour] += 1;

  const bucket = classifyTypeKey(contentKey);
  stats.types[bucket] = (stats.types[bucket] || 0) + 1;
  stats.totalMessages += 1;
  stats.updatedAt = Date.now();

  // Words & emojis
  const cleanText = String(text || "");
  const emojiMatches = cleanText.match(/\p{Extended_Pictographic}/gu) || [];
  stats.totalEmojis += emojiMatches.length;
  for (const em of emojiMatches) {
    incrementTopMap(stats.emojis, em, 1, MAX_EMOJIS);
  }

  let msgWords = 0;
  if (cleanText && !cleanText.startsWith("#")) {
    const tokens = cleanText
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/@\S+/g, " ")
      .toLowerCase()
      .match(/[a-z0-9']{3,20}/g);
    if (tokens) {
      msgWords = tokens.length;
      stats.totalWords += msgWords;
      for (const w of tokens) {
        if (!STOPWORDS.has(w) && !/^\d+$/.test(w)) {
          incrementTopMap(stats.words, w, 1, MAX_WORDS);
        }
      }
    }
  }

  // Sender leaderboard tracking
  const senderKey = normalizeNumber(sender) || String(sender || "unknown");
  if (!stats.senders[senderKey] && Object.keys(stats.senders).length >= MAX_SENDERS) {
    // Evict lowest count sender if cap reached
    const lowest = Object.entries(stats.senders).sort((a, b) => a[1].count - b[1].count)[0]?.[0];
    if (lowest) delete stats.senders[lowest];
  }

  const prev = stats.senders[senderKey] || {
    name: pushName || senderKey,
    count: 0,
    words: 0,
    media: 0,
    stickers: 0,
    lateNight: 0,
  };
  if (pushName && pushName.trim()) prev.name = pushName.trim().slice(0, 28);
  prev.count += 1;
  prev.words += msgWords;
  if (bucket === "media") prev.media += 1;
  if (bucket === "sticker") prev.stickers += 1;
  if (hour >= 0 && hour < 5) prev.lateNight += 1;
  stats.senders[senderKey] = prev;

  return true;
}

/**
 * Record lightweight stats for every incoming WAMessage in real time.
 */
export async function recordWrappedActivity(rawMsg) {
  const chatJid = rawMsg?.key?.remoteJid;
  if (!chatJid || !rawMsg?.message || chatJid === "status@broadcast") return false;
  if (rawMsg.key?.fromMe && isBotSentId(rawMsg.key.id)) return false;

  const content = normalizeMessageContent(rawMsg.message) || rawMsg.message || {};
  const contentKey =
    Object.keys(content).find(
      (k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage" && content[k] != null
    ) || "unknown";
  if (contentKey === "protocolMessage" || contentKey === "reactionMessage") return false;

  const mime = contentKey.replace(/Message.*$/i, "").toLowerCase();
  const text = extractMessagePreviewText(content[contentKey], mime);
  const rawTs = Number(rawMsg.messageTimestamp || 0);
  const timestampMs = rawTs > 0 ? (rawTs > 1e12 ? rawTs : rawTs * 1000) : Date.now();

  const stats = await getOrLoadStats(chatJid);
  const changed = ingestIntoStats(stats, {
    id: rawMsg.key?.id || null,
    sender: rawMsg.key?.participant || rawMsg.key?.remoteJid,
    pushName: rawMsg.pushName || "",
    timestampMs,
    contentKey,
    text,
  });

  if (changed) {
    dirtyChats.add(chatJid);
    scheduleFlush();
  }
  return changed;
}

export async function flushWrappedStats() {
  if (!dirtyChats.size) return;
  const targets = [...dirtyChats];
  dirtyChats.clear();
  await Promise.all(
    targets.map(async (jid) => {
      const stats = memChats.get(jid);
      if (!stats) return;
      try {
        await kvSet(`${STATS_PREFIX}${jid}`, stats);
      } catch {
        /* ignore if DB closed */
      }
    })
  );
}

export async function resetWrappedStats(chatJid) {
  memChats.delete(chatJid);
  dirtyChats.delete(chatJid);
  try {
    await kvDel(`${STATS_PREFIX}${chatJid}`);
  } catch {
    /* ignore */
  }
}

function formatHourRange(hour) {
  const fmt = (h) => {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? "AM" : "PM"}`;
  };
  return `${fmt(hour)} – ${fmt((hour + 1) % 24)}`;
}

function computeVibeTag(hourly) {
  const sum = (a, b) => hourly.slice(a, b).reduce((s, n) => s + n, 0);
  const night = sum(0, 5) + sum(22, 24);
  const morning = sum(6, 12);
  const afternoon = sum(12, 18);
  const evening = sum(18, 22);
  const buckets = [
    { label: "Night Owls 🦉", v: night },
    { label: "Morning Hustlers ☀️", v: morning },
    { label: "Afternoon Crew ⚡", v: afternoon },
    { label: "Evening Legends 🌆", v: evening },
  ];
  buckets.sort((a, b) => b.v - a.v);
  return buckets[0].label;
}

/**
 * Compute complete Wrapped summary for a chat, merging live stats + #monitor persisted history.
 */
export async function computeChatWrapped(chatJid, conn) {
  const base = await getOrLoadStats(chatJid);
  const merged = {
    ...createEmptyStats(),
    ...base,
    hourly: [...(base.hourly || new Array(24).fill(0))],
    types: { ...base.types },
    senders: JSON.parse(JSON.stringify(base.senders || {})),
    emojis: { ...base.emojis },
    words: { ...base.words },
    recentIds: [...(base.recentIds || [])],
  };

  // Merge persisted #monitor messages (deduped by message ID)
  try {
    const monitored = await getMonitoredMessages(chatJid, { all: true });
    for (const item of monitored) {
      const raw = item?.rawMessage;
      const content = normalizeMessageContent(raw?.message) || raw?.message || {};
      const key = item.messageTypeKey || Object.keys(content)[0] || "unknown";
      const mime = key.replace(/Message.*$/i, "").toLowerCase();
      const text = item.preview || extractMessagePreviewText(content[key], mime);
      ingestIntoStats(merged, {
        id: item.id || raw?.key?.id || null,
        sender: item.sender || raw?.key?.participant || raw?.key?.remoteJid,
        pushName: item.pushName || raw?.pushName || "",
        timestampMs: item.savedAt || Date.now(),
        contentKey: key,
        text,
      });
    }
  } catch {
    /* monitor optional */
  }

  let chatTitle = chatJid.endsWith("@g.us") ? "Group Chat" : "Private Chat";
  if (chatJid.endsWith("@g.us") && conn) {
    try {
      let meta = groupCache.get(chatJid);
      if (!meta && typeof conn.groupMetadata === "function") {
        meta = await conn.groupMetadata(chatJid);
        groupCache.set(chatJid, meta);
      }
      if (meta?.subject) chatTitle = meta.subject;
    } catch {
      /* fallback title */
    }
  }

  const total = merged.totalMessages || 0;
  const senderEntries = Object.entries(merged.senders).map(([id, s]) => ({
    id,
    name: s.name || id,
    count: s.count || 0,
    words: s.words || 0,
    media: s.media || 0,
    stickers: s.stickers || 0,
    lateNight: s.lateNight || 0,
    pct: total ? Math.round(((s.count || 0) / total) * 100) : 0,
    avgWords: s.count ? Math.round(((s.words || 0) / s.count) * 10) / 10 : 0,
  }));

  senderEntries.sort((a, b) => b.count - a.count);
  const topTalkers = senderEntries.slice(0, 5);

  const mvp = topTalkers[0] || null;
  const yapper =
    senderEntries.filter((s) => s.count >= 2).sort((a, b) => b.avgWords - a.avgWords)[0] || mvp;
  const mediaKing =
    senderEntries
      .slice()
      .sort((a, b) => b.media + b.stickers - (a.media + a.stickers))[0] || mvp;
  const nightOwl = senderEntries.slice().sort((a, b) => b.lateNight - a.lateNight)[0] || null;

  let peakHour = 0;
  for (let h = 1; h < 24; h++) {
    if (merged.hourly[h] > merged.hourly[peakHour]) peakHour = h;
  }

  const topEmojis = Object.entries(merged.emojis)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([emoji, count]) => ({ emoji, count }));

  const topWords = Object.entries(merged.words)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));

  return {
    chatJid,
    chatTitle,
    totalMessages: total,
    uniqueTalkers: senderEntries.length,
    totalWords: merged.totalWords || 0,
    totalEmojis: merged.totalEmojis || 0,
    hourly: merged.hourly,
    peakHour,
    peakHourLabel: formatHourRange(peakHour),
    vibeTag: computeVibeTag(merged.hourly),
    types: merged.types,
    topTalkers,
    topEmojis,
    topWords,
    awards: {
      mvp,
      yapper,
      mediaKing: mediaKing && mediaKing.media + mediaKing.stickers > 0 ? mediaKing : null,
      nightOwl: nightOwl && nightOwl.lateNight > 0 ? nightOwl : null,
    },
  };
}
