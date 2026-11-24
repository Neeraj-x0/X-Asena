/**
 * Autonomous Event Automation & Watcher Engine
 * Enables the AI agent to watch for real-time events (member leaves/joins/promotes, messages)
 * and trigger automated actions or cancel linked fallback tasks.
 *
 * @module agent/agentEvents
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";
import { groupCache } from "../utils/cache.js";
import { isLidUser, isPnUser } from "../functions.js";

const WATCHERS_KV_KEY = "agent_event_watchers";
let inMemoryWatchers = null;

/**
 * Load all event watchers from storage
 */
export async function loadEventWatchers() {
  if (inMemoryWatchers !== null) {
    return inMemoryWatchers;
  }
  try {
    const saved = await kvGet(WATCHERS_KV_KEY);
    inMemoryWatchers = Array.isArray(saved) ? saved : [];
  } catch {
    inMemoryWatchers = inMemoryWatchers || [];
  }
  return inMemoryWatchers;
}

/**
 * Save event watchers to storage
 */
export async function saveEventWatchers(watchers) {
  inMemoryWatchers = watchers;
  try {
    await kvSet(WATCHERS_KV_KEY, watchers);
  } catch {
    /* fallback to in-memory */
  }
}

/**
 * Normalize target user identifier (phone number digits or bare string)
 */
function normalizeTarget(target) {
  if (!target) return "";
  const s = String(target).trim().replace(/^@/, "");
  return normalizeNumber(s) || s;
}

/**
 * Create and register a real-time event watcher
 *
 * @param {object} opts
 * @param {string} opts.groupJid - Target group JID
 * @param {"member_leave"|"member_join"|"member_promote"|"member_demote"|"message_contains"} opts.eventType
 * @param {string} [opts.targetUser] - Optional target user (e.g. "@user", phone number, or JID)
 * @param {string} [opts.matchPattern] - Optional regex or keyword pattern (for message_contains)
 * @param {string} opts.action - Action or prompt to execute when event fires (e.g. "unlock the group")
 * @param {string} [opts.linkedTaskId] - Optional ID of scheduled iterative task to cancel upon trigger
 * @param {boolean} [opts.once=true] - Auto-cancel watcher after firing once
 * @param {string} [opts.creatorJid] - JID of the user who set the watcher
 * @returns {Promise<object>} The registered watcher
 */
export async function createEventWatcher({
  groupJid,
  eventType,
  targetUser = null,
  matchPattern = null,
  action,
  linkedTaskId = null,
  once = true,
  creatorJid = "system",
}) {
  const validEvents = [
    "member_leave",
    "member_join",
    "member_promote",
    "member_demote",
    "message_contains",
    "link_detected",
    "profanity_detected",
    "media_received",
  ];

  if (!validEvents.includes(eventType)) {
    throw new Error(
      `Invalid eventType: "${eventType}". Must be one of: ${validEvents.join(", ")}`
    );
  }

  if (!action || typeof action !== "string") {
    throw new Error("Watcher must define an 'action' to execute when the event triggers.");
  }

  const watchers = await loadEventWatchers();
  const watcher = {
    id: `watch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    groupJid,
    eventType,
    targetUser: normalizeTarget(targetUser),
    matchPattern: matchPattern ? String(matchPattern).trim() : null,
    action: action.trim(),
    linkedTaskId: linkedTaskId ? String(linkedTaskId).trim() : null,
    once: Boolean(once),
    creatorJid,
    createdAt: Date.now(),
    triggerCount: 0,
    lastTriggeredAt: null,
  };

  watchers.push(watcher);
  await saveEventWatchers(watchers);
  return watcher;
}

/**
 * List active event watchers
 *
 * @param {string} [groupJid]
 * @returns {Promise<Array>}
 */
export async function listEventWatchers(groupJid = null) {
  const watchers = await loadEventWatchers();
  if (!groupJid || groupJid === "all") return watchers;
  return watchers.filter((w) => w.groupJid === groupJid);
}

/**
 * Cancel an event watcher by ID
 *
 * @param {string} watcherId
 * @param {string} [groupJid]
 * @returns {Promise<boolean>}
 */
export async function cancelEventWatcher(watcherId, groupJid = null) {
  let watchers = await loadEventWatchers();
  const before = watchers.length;

  watchers = watchers.filter((w) => {
    if (w.id === watcherId) {
      if (groupJid && w.groupJid !== groupJid) return true;
      return false;
    }
    return true;
  });

  await saveEventWatchers(watchers);
  return before !== watchers.length;
}

/**
 * Trigger group participant event watchers
 * Called from groupParticipants.update event listener
 *
 * @param {object} params
 * @param {string} params.groupJid - Group ID
 * @param {"add"|"remove"|"leave"|"promote"|"demote"} params.action - Baileys action
 * @param {Array<string|object>} params.participants - Updated participants
 * @param {object} params.conn - Baileys connection socket
 */
export async function triggerGroupEventWatchers({ groupJid, action, participants, conn }) {
  try {
    if (!groupJid || !participants?.length) return;

    let eventType = null;
    if (action === "remove" || action === "leave") eventType = "member_leave";
    else if (action === "add") eventType = "member_join";
    else if (action === "promote") eventType = "member_promote";
    else if (action === "demote") eventType = "member_demote";

    if (!eventType) return;

    const watchers = await loadEventWatchers();
    const candidates = watchers.filter(
      (w) => w.groupJid === groupJid && w.eventType === eventType
    );

    if (!candidates.length) return;

    const participantNums = participants.map((p) => {
      const s = typeof p === "string" ? p : p?.id || "";
      return normalizeNumber(s) || s;
    });

    const toRemoveIds = new Set();

    for (const watcher of candidates) {
      // Check targetUser match
      if (watcher.targetUser) {
        const matched = participantNums.some((num) => {
          return num === watcher.targetUser || num.includes(watcher.targetUser);
        });
        if (!matched) continue;
      }

      // Watcher matched!
      watcher.triggerCount = (watcher.triggerCount || 0) + 1;
      watcher.lastTriggeredAt = Date.now();

      if (watcher.once) {
        toRemoveIds.add(watcher.id);
      }

      // Announce watcher triggered
      await conn.sendMessage(groupJid, {
        text: `🎯 *[EVENT WATCHER TRIGGERED]*\n_Event: ${eventType}_\n> Action: "${watcher.action}"${
          watcher.linkedTaskId ? `\n> Cancelling linked task: ${watcher.linkedTaskId}` : ""
        }`,
      });

      // 1. If linked task exists, cancel it immediately
      if (watcher.linkedTaskId) {
        try {
          const { cancelScheduledTask } = await import("./agentCron.js");
          await cancelScheduledTask(watcher.linkedTaskId, groupJid);
        } catch (err) {
          console.error("[agentEvents] Error cancelling linked task:", err?.message || err);
        }
      }

      // 2. Execute the action
      await executeWatcherAction({
        action: watcher.action,
        groupJid,
        creatorJid: watcher.creatorJid,
        conn,
      });
    }

    if (toRemoveIds.size > 0) {
      const remaining = watchers.filter((w) => !toRemoveIds.has(w.id));
      await saveEventWatchers(remaining);
    }
  } catch (err) {
    console.error("[agentEvents] triggerGroupEventWatchers error:", err?.message || err);
  }
}

/**
 * Trigger message event watchers
 * Called on incoming messages
 *
 * @param {object} params
 * @param {object} params.message
 * @param {object} params.conn
 */
export async function triggerMessageEventWatchers({ message, conn }) {
  try {
    if (!message?.from || !message?.body) return;
    const groupJid = message.from;
    const isGroup = groupJid.endsWith("@g.us");
    if (!isGroup) return;

    const watchers = await loadEventWatchers();
    const relevantTypes = new Set([
      "message_contains",
      "link_detected",
      "profanity_detected",
      "media_received",
    ]);
    const candidates = watchers.filter(
      (w) => w.groupJid === groupJid && relevantTypes.has(w.eventType)
    );

    if (!candidates.length) return;

    const senderNum = normalizeNumber(message.sender) || message.sender;
    const body = String(message.body || "");
    const toRemoveIds = new Set();

    for (const watcher of candidates) {
      // Check sender match if specified
      if (watcher.targetUser && senderNum !== watcher.targetUser) {
        continue;
      }

      // Check event conditions
      if (watcher.eventType === "message_contains") {
        if (watcher.matchPattern) {
          const regex = new RegExp(watcher.matchPattern, "i");
          if (!regex.test(body)) continue;
        }
      } else if (watcher.eventType === "link_detected") {
        const hasLink = /(https?:\/\/[^\s]+|chat\.whatsapp\.com\/[^\s]+)/i.test(body);
        if (!hasLink) continue;
      } else if (watcher.eventType === "profanity_detected") {
        const { containsProfanityOrAbuse } = await import("./agentSafetyThrottle.js");
        const prof = containsProfanityOrAbuse(body);
        if (!prof.hasProfanity) continue;
      } else if (watcher.eventType === "media_received") {
        const isMedia = Boolean(
          message.isImage ||
            message.isVideo ||
            message.isSticker ||
            message.isAudio ||
            message.isDocument
        );
        if (!isMedia) continue;
      }

      // Match found!
      watcher.triggerCount = (watcher.triggerCount || 0) + 1;
      watcher.lastTriggeredAt = Date.now();

      if (watcher.once) {
        toRemoveIds.add(watcher.id);
      }

      await conn.sendMessage(groupJid, {
        text: `🎯 *[EVENT WATCHER TRIGGERED]*\n_Matched condition: ${watcher.eventType}_\n> Action: "${watcher.action}"${
          watcher.linkedTaskId ? `\n> Cancelling linked task: ${watcher.linkedTaskId}` : ""
        }`,
      });

      if (watcher.linkedTaskId) {
        try {
          const { cancelScheduledTask } = await import("./agentCron.js");
          await cancelScheduledTask(watcher.linkedTaskId, groupJid);
        } catch (err) {
          console.error("[agentEvents] Error cancelling linked task:", err?.message || err);
        }
      }

      await executeWatcherAction({
        action: watcher.action,
        groupJid,
        creatorJid: watcher.creatorJid,
        conn,
        triggerMessage: message,
      });
    }

    if (toRemoveIds.size > 0) {
      const remaining = watchers.filter((w) => !toRemoveIds.has(w.id));
      await saveEventWatchers(remaining);
    }
  } catch (err) {
    console.error("[agentEvents] triggerMessageEventWatchers error:", err?.message || err);
  }
}

/**
 * Helper to execute the action specified by a watcher
 */
async function executeWatcherAction({ action, groupJid, creatorJid, conn, triggerMessage = null }) {
  const normAction = action.trim().toLowerCase();

  // Fast-path: Delete trigger message
  if (
    normAction === "delete" ||
    normAction === "delete_message" ||
    normAction === "delete message"
  ) {
    if (triggerMessage?.key) {
      try {
        await conn.sendMessage(groupJid, { delete: triggerMessage.key });
      } catch (delErr) {
        console.error("[agentEvents] Failed to delete message:", delErr?.message);
      }
    }
    return;
  }

  // Fast-path: Direct group unlock / unmute
  if (
    normAction === "unlock group" ||
    normAction === "unlock the group" ||
    normAction === "unmute group" ||
    normAction === "unmute the group" ||
    normAction === "unlock_group" ||
    normAction === "unmute_group"
  ) {
    try {
      await conn.groupSettingUpdate(groupJid, "not_announcement");
      await conn.sendMessage(groupJid, {
        text: "🔓 *[GROUP UNLOCKED]*\n_The group has been unlocked. All participants can now send messages._",
      });
      return;
    } catch (err) {
      await conn.sendMessage(groupJid, {
        text: `⚠️ *[UNLOCK FAILED]*: ${err?.message || err}`,
      });
      return;
    }
  }

  // Fast-path: Direct group lock / mute
  if (
    normAction === "lock group" ||
    normAction === "lock the group" ||
    normAction === "mute group" ||
    normAction === "mute the group" ||
    normAction === "lock_group" ||
    normAction === "mute_group"
  ) {
    try {
      await conn.groupSettingUpdate(groupJid, "announcement");
      await conn.sendMessage(groupJid, {
        text: "🔒 *[GROUP LOCKED]*\n_The group has been locked. Only admins can send messages._",
      });
      return;
    } catch (err) {
      await conn.sendMessage(groupJid, {
        text: `⚠️ *[LOCK FAILED]*: ${err?.message || err}`,
      });
      return;
    }
  }

  // General autonomous agent execution for other prompt actions
  try {
    const { runAgentPrompt } = await import("./aiAgent.js");
    const syntheticMessage = {
      from: groupJid,
      sender: creatorJid || (conn.user?.id ? normalizeNumber(conn.user.id) + "@s.whatsapp.net" : groupJid),
      participant: creatorJid,
      isGroup: true,
      isBotMessage: false,
      body: action,
      message: { conversation: action },
      key: { remoteJid: groupJid, id: `event_${Date.now()}`, fromMe: false },
    };

    const result = await runAgentPrompt({
      prompt: action,
      message: syntheticMessage,
      conn,
    });

    if (result) {
      await conn.sendMessage(groupJid, {
        text: `🤖 *[EVENT ACTION RESULT]*\n${result}`,
      });
    }
  } catch (err) {
    console.error("[agentEvents] Failed to execute action:", err?.message || err);
  }
}
