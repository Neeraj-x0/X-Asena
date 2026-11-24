/**
 * Agent Safety Throttle & Anti-Ban Protection
 * Provides safe WhatsApp direct messaging (DMs), group messaging,
 * zero-tolerance profanity/abuse filtering ("myr"), and aggressive
 * rate-limiting/pacing to prevent WhatsApp number bans.
 *
 * @module agent/agentSafetyThrottle
 */

import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";

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

// ==================== ANTI-SPAM & ANTI-BAN RATE LIMITER ====================

// Cooldown tracking per chat / recipient JID
const chatLastSent = new Map(); // chatJid -> timestamp
const chatMinuteWindows = new Map(); // chatJid -> [timestamps]
const globalMinuteWindow = []; // [timestamps]

const MIN_GROUP_INTERVAL_MS = 2500; // 2.5s minimum between group messages
const MIN_DM_INTERVAL_MS = 3500; // 3.5s minimum between DMs
const MAX_MESSAGES_PER_MINUTE_CHAT = 5; // Max 5 msgs / min / chat
const MAX_DMS_PER_MINUTE_GLOBAL = 10; // Max 10 DMs / min across all users
const MAX_MESSAGES_PER_MINUTE_GLOBAL = 25; // Max 25 total msgs / min across all chats
const MAX_AUTOMATED_MENTIONS = 5; // Prevent ghost-tag spam bans
const MAX_BATCH_DM_RECIPIENTS = 5; // Hard cap on batch DMs to prevent mass spam bans

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
 * Resolve phone number, raw string, mention, or LID to a clean WhatsApp JID.
 * Properly differentiates between Phone Number JIDs (@s.whatsapp.net) and LIDs (@lid).
 * NEVER converts an arbitrary LID into an invalid @s.whatsapp.net address.
 */
export async function resolveTargetJid(recipient, context = {}) {
  if (!recipient || typeof recipient !== "string") return null;
  let raw = recipient.trim();

  // 1. Resolve 'caller' / 'me' / 'sender'
  if (/^(caller|me|sender)$/i.test(raw)) {
    if (context.callerPn) return context.callerPn;
    if (context.senderPn) return context.senderPn;
    if (context.callerJid && !context.callerJid.endsWith("@lid")) return context.callerJid;
    raw = context.callerJid || context.sender || "";
  }

  // 2. If it's a group JID, return as-is
  if (raw.endsWith("@g.us")) {
    return raw;
  }

  // 3. Resolve using resolveUserIdentifiers
  const { resolveUserIdentifiers } = await import("../utils/lid.js");
  const resolved = await resolveUserIdentifiers(raw, {
    conn: context.conn,
    groupMetadata: context.meta || context.groupMetadata,
    alt: context.callerPn || context.senderPn || context.participantAlt,
  });

  // Prefer verified phone number JID (@s.whatsapp.net)
  if (resolved.pnJid) {
    return resolved.pnJid;
  }

  // If it's a LID that could not be mapped to a phone number, keep it as @lid!
  // CRITICAL: NEVER convert an LID to @s.whatsapp.net!
  if (resolved.lidJid) {
    return resolved.lidJid;
  }

  // Raw digits
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) {
    return `${digits}@s.whatsapp.net`;
  }

  return null;
}

/**
 * Dispatch a group message with strict WhatsApp anti-ban, anti-spam,
 * and profanity guardrails.
 */
export async function safeDispatchGroupMessage({
  conn,
  targetJid,
  text,
  mentions = [],
}) {
  const now = Date.now();

  // 1. Enforce Profanity & Abuse Guardrail
  const profanityCheck = containsProfanityOrAbuse(text);
  if (profanityCheck.hasProfanity) {
    return {
      success: false,
      error: `CONTENT REFUSAL: Message contains profanity or abusive language ("${profanityCheck.matchedWord}"). Please keep messages respectful.`,
    };
  }

  const chatJid = targetJid;

  // 2. Anti-Spam Rate Limit Checks (WhatsApp Ban Prevention)
  pruneTimestamps(globalMinuteWindow, now);
  if (globalMinuteWindow.length >= MAX_MESSAGES_PER_MINUTE_GLOBAL) {
    return {
      success: false,
      error:
        "ANTI-SPAM THROTTLE: Global message velocity threshold reached. Pausing automated dispatch to protect number from WhatsApp bans.",
    };
  }

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

  // 3. Inter-message interval pacing
  const lastSent = chatLastSent.get(chatJid) || 0;
  const elapsed = now - lastSent;
  if (elapsed < MIN_GROUP_INTERVAL_MS) {
    await sleep(MIN_GROUP_INTERVAL_MS - elapsed);
  }

  // 4. Cap mentions to prevent mass-tag abuse
  let safeMentions = Array.isArray(mentions) ? [...mentions] : [];
  if (safeMentions.length > MAX_AUTOMATED_MENTIONS) {
    safeMentions = safeMentions.slice(0, MAX_AUTOMATED_MENTIONS);
  }

  // 5. Simulate natural human typing before dispatch
  try {
    if (conn?.sendPresenceUpdate) {
      await conn.sendPresenceUpdate("composing", chatJid);
      await sleep(1200);
    }
  } catch {
    /* ignore presence error */
  }

  // 6. Dispatch message safely
  try {
    await conn.sendMessage(chatJid, {
      text,
      mentions: safeMentions,
    });

    const sendTime = Date.now();
    chatLastSent.set(chatJid, sendTime);
    chatWindow.push(sendTime);
    globalMinuteWindow.push(sendTime);

    return { success: true, deliveredTo: chatJid };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Dispatch a Direct Message (DM) to an individual WhatsApp user
 * with anti-ban human typing simulation and aggressive rate-limiting.
 *
 * @param {object} params
 * @param {any} params.conn - Baileys socket connection
 * @param {string} params.recipient - Phone number, JID, or 'caller'
 * @param {string} params.text - Private message text
 * @param {string} [params.callerJid] - Context caller JID
 * @returns {Promise<{ success: boolean, deliveredTo?: string, error?: string }>}
 */
export async function safeDispatchDirectMessage({
  conn,
  recipient,
  text,
  callerJid = null,
  context = {},
}) {
  const targetJid = await resolveTargetJid(recipient, {
    conn,
    callerJid,
    callerPn: context.callerPn || context.senderPn,
    meta: context.meta || context.groupMetadata,
  });

  if (!targetJid || (!targetJid.endsWith("@s.whatsapp.net") && !targetJid.endsWith("@lid"))) {
    return {
      success: false,
      error: `INVALID RECIPIENT: Could not resolve "${recipient}" to a valid WhatsApp user JID or LID. Provide a valid phone number with country code.`,
    };
  }

  // 1. Enforce Profanity & Abuse Guardrail
  const profanityCheck = containsProfanityOrAbuse(text);
  if (profanityCheck.hasProfanity) {
    return {
      success: false,
      error: `CONTENT REFUSAL: Cannot send direct message containing abusive language ("${profanityCheck.matchedWord}"). Only polite DMs are permitted.`,
    };
  }

  const now = Date.now();

  // 2. Global DM velocity limit (prevents WhatsApp account bans from rapid PM broadcasts)
  pruneTimestamps(globalMinuteWindow, now);
  if (globalMinuteWindow.length >= MAX_DMS_PER_MINUTE_GLOBAL) {
    return {
      success: false,
      error:
        "ANTI-BAN PROTECTION: Global DM rate limit reached (max 10 DMs/min). Throttling to prevent WhatsApp from flagging this account as a spam bot.",
    };
  }

  // 3. Recipient-specific rate limiting (prevents harassment, max 3 DMs / min / user)
  if (!chatMinuteWindows.has(targetJid)) {
    chatMinuteWindows.set(targetJid, []);
  }
  const userWindow = chatMinuteWindows.get(targetJid);
  pruneTimestamps(userWindow, now);

  if (userWindow.length >= 3) {
    return {
      success: false,
      error: `ANTI-SPAM: Too many messages sent to ${targetJid} recently. Please wait 1 minute before sending another DM to this user.`,
    };
  }

  // 4. Pacing interval between DMs (minimum 3.5s cooldown)
  const lastSent = chatLastSent.get(targetJid) || 0;
  const elapsed = now - lastSent;
  if (elapsed < MIN_DM_INTERVAL_MS) {
    await sleep(MIN_DM_INTERVAL_MS - elapsed);
  }

  // 5. Simulate natural human typing in the recipient's DM
  try {
    if (conn?.sendPresenceUpdate) {
      await conn.sendPresenceUpdate("composing", targetJid);
      await sleep(1500 + Math.floor(Math.random() * 1000)); // 1.5s - 2.5s randomized typing pause
    }
  } catch {
    /* ignore presence error */
  }

  // 6. Deliver the Direct Message
  try {
    await conn.sendMessage(targetJid, { text });

    const sendTime = Date.now();
    chatLastSent.set(targetJid, sendTime);
    userWindow.push(sendTime);
    globalMinuteWindow.push(sendTime);

    return {
      success: true,
      deliveredTo: targetJid,
      note: "Delivered via paced anti-ban dispatcher.",
    };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Dispatch Batch Direct Messages sequentially with randomized jitter
 * to safely message a small group of users without tripping WhatsApp ban filters.
 *
 * @param {object} params
 * @param {any} params.conn - Baileys socket connection
 * @param {Array<string>} params.recipients - List of user numbers or JIDs (max 5)
 * @param {string} params.text - Message content
 * @param {string} [params.callerJid] - Context caller JID
 * @returns {Promise<{ success: boolean, deliveredCount: number, failedCount: number, results: Array<object> }>}
 */
export async function safeDispatchBatchDms({
  conn,
  recipients,
  text,
  callerJid = null,
  context = {},
}) {
  if (!Array.isArray(recipients) || !recipients.length) {
    return { success: false, error: "No recipients provided for batch DM." };
  }

  // Hard cap to prevent WhatsApp mass-broadcast bans
  if (recipients.length > MAX_BATCH_DM_RECIPIENTS) {
    return {
      success: false,
      error: `MASS DM SAFETY: Batch DMs are strictly capped at ${MAX_BATCH_DM_RECIPIENTS} recipients per batch to protect the phone number from being banned by WhatsApp. Received: ${recipients.length}.`,
    };
  }

  const results = [];
  let deliveredCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const target = recipients[i];

    // Randomized human-like pause between each recipient (4s - 7s)
    if (i > 0) {
      const jitter = 4000 + Math.floor(Math.random() * 3000);
      await sleep(jitter);
    }

    const res = await safeDispatchDirectMessage({
      conn,
      recipient: target,
      text,
      callerJid,
      context,
    });

    results.push({ recipient: target, ...res });
    if (res.success) {
      deliveredCount++;
    } else {
      failedCount++;
    }
  }

  return {
    success: deliveredCount > 0,
    deliveredCount,
    failedCount,
    totalAttempted: recipients.length,
    results,
  };
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
