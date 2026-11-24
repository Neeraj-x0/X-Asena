/**
 * Agent Safety Throttle & Anti-Ban Protection
 * Enforces DM restrictions, zero-tolerance profanity/abuse filtering ("myr"),
 * and aggressive rate-limiting/anti-spam protection to prevent WhatsApp number bans.
 *
 * @module agent/agentSafetyThrottle
 */

import { BOT_INFO } from "../config/constants.js";

// ==================== PROFANITY & ABUSE PATTERNS ====================

const PROFANITY_PATTERNS = [
  // 1. Regional / Malayalam profanities (specifically "myr", "myre")
  /\bm[\s._-]*y[\s._-]*r(e)?\b/i,
  /\b(thendi|kunna|patti|oombu|punda|thevidiya|koothi|nayinte|pinnem)\b/i,

  // 2. Hindi / South Asian vulgar slurs
  /\b(chutiya|gandu|madarchod|behenchod|bhosdike|laude|lavda|harami)\b/i,

  // 3. Global / English profanities & slurs (including common leet-speak masks)
  /\bf[\s._*@$!1-]*[u*@$!1][\s._*@$!1-]*c[\s._*@$!1-]*k(ing|er|ed)?\b/i,
  /\bb[\s._*@$!1-]*[i*!1|][\s._*@$!1-]*t[\s._*@$!1-]*c[\s._*@$!1-]*h(es)?\b/i,
  /\b(cunt|asshole|motherfucker|dickhead|bastard|slut|whore|nigger|faggot)\b/i,
];

/**
 * Check if text contains abusive language, profanity, or vulgar slang
 *
 * @param {string} text
 * @returns {{ hasProfanity: boolean, matchedWord: string }}
 */
export function containsProfanityOrAbuse(text) {
  if (!text || typeof text !== "string") return { hasProfanity: false, matchedWord: "" };
  for (const pattern of PROFANITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { hasProfanity: true, matchedWord: match[0] };
    }
  }
  return { hasProfanity: false, matchedWord: "" };
}

// ==================== DM RESTRICTION PATTERNS ====================

const DM_REQUEST_PATTERNS = [
  /(send|blast|forward|deliver)\s+(a\s+)?(dm|private\s+message|personal\s+message|direct\s+message)/i,
  /\b(dm|privately\s+message)\s+(all|everyone|each|them|users?|members?|participants?|\+\d+|\d{8,})/i,
  /\bmessage\s+(everyone|all\s+members?|them)\s+(in\s+private|in\s+dm|privately)\b/i,
  /\b(send|text)\s+(\+\d{8,}|\d{10,})\s+(in\s+private|privately|via\s+dm)/i,
];

/**
 * Check if prompt is asking to send private messages/DMs to users
 *
 * @param {string} prompt
 * @returns {boolean}
 */
export function isDmRequest(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  return DM_REQUEST_PATTERNS.some((p) => p.test(prompt));
}

// ==================== ANTI-SPAM & ANTI-BAN RATE LIMITER ====================

// Cooldown state per chat
const chatLastSent = new Map(); // chatJid -> timestamp
const chatMinuteWindows = new Map(); // chatJid -> [timestamps]
const globalMinuteWindow = []; // [timestamps]

const MIN_INTER_MESSAGE_INTERVAL_MS = 2500; // 2.5 seconds minimum spacing
const MAX_MESSAGES_PER_MINUTE_CHAT = 5; // Max 5 automated msgs / min / chat
const MAX_MESSAGES_PER_MINUTE_GLOBAL = 20; // Max 20 automated msgs / min across all chats
const MAX_AUTOMATED_MENTIONS = 5; // Prevent ghost-tag spam bans

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Prune timestamps older than 60 seconds from an array
 */
function pruneTimestamps(arr, now) {
  const cutoff = now - 60_000;
  while (arr.length > 0 && arr[0] < cutoff) {
    arr.shift();
  }
}

/**
 * Dispatch a group message with strict WhatsApp anti-ban, anti-spam,
 * DM restriction, and profanity guardrails.
 *
 * @param {object} params
 * @param {any} params.conn - Baileys socket connection
 * @param {string} params.targetJid - Destination chat JID
 * @param {string} params.expectedGroupJid - The active group chat JID
 * @param {boolean} params.isGroup - Whether the current context is a group
 * @param {string} params.text - Message text
 * @param {Array<string>} [params.mentions] - Mention JIDs
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function safeDispatchGroupMessage({
  conn,
  targetJid,
  expectedGroupJid,
  isGroup,
  text,
  mentions = [],
}) {
  const now = Date.now();

  // 1. Enforce DM Restriction
  if (isGroup) {
    if (!targetJid || targetJid !== expectedGroupJid || targetJid.endsWith("@s.whatsapp.net")) {
      return {
        success: false,
        error:
          "POLICY RESTRICTION: I cannot send direct messages (DMs) to individual users. My messaging capabilities are restricted to the current group chat (send_group_message).",
      };
    }
  }

  // 2. Enforce Profanity & Abuse Guardrail
  const profanityCheck = containsProfanityOrAbuse(text);
  if (profanityCheck.hasProfanity) {
    return {
      success: false,
      error: `CONTENT REFUSAL: I cannot send messages containing profanity or abusive language ("${profanityCheck.matchedWord}"). If you would like me to schedule a polite message or reminder inside this group chat after 2 minutes, let me know!`,
    };
  }

  // 3. Anti-Spam Rate Limit Checks (WhatsApp Ban Prevention)
  const chatJid = targetJid;

  // Prune global window
  pruneTimestamps(globalMinuteWindow, now);
  if (globalMinuteWindow.length >= MAX_MESSAGES_PER_MINUTE_GLOBAL) {
    return {
      success: false,
      error:
        "ANTI-SPAM THROTTLE: Global message velocity threshold reached. Pausing automated dispatch to protect number from WhatsApp spam bans.",
    };
  }

  // Prune chat window
  if (!chatMinuteWindows.has(chatJid)) {
    chatMinuteWindows.set(chatJid, []);
  }
  const chatWindow = chatMinuteWindows.get(chatJid);
  pruneTimestamps(chatWindow, now);

  if (chatWindow.length >= MAX_MESSAGES_PER_MINUTE_CHAT) {
    return {
      success: false,
      error: `ANTI-SPAM THROTTLE: Chat rate limit exceeded (maximum ${MAX_MESSAGES_PER_MINUTE_CHAT} messages per minute). Delayed to prevent WhatsApp bans.`,
    };
  }

  // 4. Inter-message interval pacing (minimum 2.5s cooldown)
  const lastSent = chatLastSent.get(chatJid) || 0;
  const elapsed = now - lastSent;
  if (elapsed < MIN_INTER_MESSAGE_INTERVAL_MS) {
    const waitTime = MIN_INTER_MESSAGE_INTERVAL_MS - elapsed;
    await sleep(waitTime);
  }

  // 5. Cap mentions to prevent mass-tag abuse
  let safeMentions = Array.isArray(mentions) ? [...mentions] : [];
  if (safeMentions.length > MAX_AUTOMATED_MENTIONS) {
    safeMentions = safeMentions.slice(0, MAX_AUTOMATED_MENTIONS);
  }

  // 6. Simulate natural human typing before dispatch
  try {
    if (conn?.sendPresenceUpdate) {
      await conn.sendPresenceUpdate("composing", chatJid);
      await sleep(1200); // 1.2s typing pause
    }
  } catch {
    /* ignore presence error */
  }

  // 7. Dispatch message safely
  try {
    await conn.sendMessage(chatJid, {
      text,
      mentions: safeMentions,
    });

    const sendTime = Date.now();
    chatLastSent.set(chatJid, sendTime);
    chatWindow.push(sendTime);
    globalMinuteWindow.push(sendTime);

    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Validate schedule expression to ensure no high-frequency spam loops
 *
 * @param {string} schedule - Raw schedule expression (cron, relative, time)
 * @returns {{ safe: boolean, error?: string }}
 */
export function validateScheduleSafe(schedule) {
  const s = String(schedule || "").trim().toLowerCase();

  // Sub-minute relative: "in 10s", "in 30 seconds"
  const secMatch = s.match(/^in\s+(\d+)\s*(s|sec|seconds?)$/i);
  if (secMatch) {
    const secs = parseInt(secMatch[1], 10);
    if (secs < 60) {
      return {
        safe: false,
        error:
          "SCHEDULE SAFETY: Sub-minute intervals are disabled to prevent spam loops and WhatsApp bans. Minimum delay is 1 minute (e.g. 'in 2 minutes').",
      };
    }
  }

  // High-frequency cron: */1, */2, */3, */4
  const cronMatch = s.match(/^\*\/([1-4])\s+/);
  if (cronMatch) {
    return {
      safe: false,
      error:
        "SCHEDULE SAFETY: High-frequency cron intervals under 5 minutes are disabled to prevent WhatsApp bans. Minimum recurring interval is 5 minutes (e.g. '*/5 * * * *').",
    };
  }

  return { safe: true };
}
