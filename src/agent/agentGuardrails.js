/**
 * Human-in-the-Loop Safety Guardrails
 * Protects groups from destructive mass actions by requiring explicit admin confirmation.
 *
 * @module agent/agentGuardrails
 */

import { BOT_INFO } from "../config/constants.js";
import { isAdmin, isBotAdmin, displayId } from "../utils/group.js";
import { isPrivileged } from "../utils/access.js";

const pendingConfirmations = new Map();
const CONFIRM_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Register a high-risk action requiring human confirmation
 */
export async function registerPendingAction({ actionName, details, impactedCount, payload, context }) {
  const confirmId = `act_${Date.now().toString(36)}`;
  const expiresAt = Date.now() + CONFIRM_TIMEOUT_MS;

  const record = {
    id: confirmId,
    actionName,
    details,
    impactedCount,
    payload,
    context,
    expiresAt,
  };

  pendingConfirmations.set(confirmId, record);

  // Set expiration cleanup timer
  setTimeout(() => {
    if (pendingConfirmations.has(confirmId)) {
      pendingConfirmations.delete(confirmId);
    }
  }, CONFIRM_TIMEOUT_MS);

  // Construct confirmation notification
  let text = `⚠️ *[HUMAN CONFIRMATION GUARDRAIL TRIGGERED]*\n\n`;
  text += `• *Action:* ${actionName}\n`;
  text += `• *Affected Count:* \`${impactedCount}\` participants\n`;
  text += `• *Details:* ${details}\n\n`;
  text += `🚨 *Safety Threshold Triggered:* Because this action affects multiple participants, admin approval is required.\n\n`;
  text += `👉 *To execute:* Reply \`CONFIRM\` or type \`${BOT_INFO.PREFIX}confirm ${confirmId}\` within 3 minutes.\n`;
  text += `👉 *To cancel:* Type \`${BOT_INFO.PREFIX}cancelaction ${confirmId}\``;

  if (context.conn && context.groupJid) {
    try {
      await context.conn.sendMessage(context.groupJid, { text });
    } catch {
      /* ignore */
    }
  }

  return {
    requiresConfirmation: true,
    confirmId,
    expiresAt: new Date(expiresAt).toLocaleTimeString(),
    message: text,
  };
}

/**
 * Check and execute a pending confirmation if valid
 */
export async function handleAdminConfirmation({ message, conn, confirmId = null }) {
  const isGroup = message.isGroup;
  if (!isGroup) return false;

  const text = (message.body || "").trim().toUpperCase();
  const isDirectConfirm = text === "CONFIRM" || text === "YES EXECUTE" || text.startsWith(`${BOT_INFO.PREFIX}CONFIRM`);

  if (!isDirectConfirm) return false;

  // Find candidate confirmation
  let candidate = null;
  const now = Date.now();

  if (confirmId) {
    candidate = pendingConfirmations.get(confirmId);
  } else {
    // Find latest pending confirmation for this chat
    for (const [id, record] of pendingConfirmations) {
      if (record.context.groupJid === message.from && record.expiresAt > now) {
        candidate = record;
        break;
      }
    }
  }

  if (!candidate || candidate.expiresAt <= now) {
    return false;
  }

  // Verify caller is admin or owner
  const privileged = await isPrivileged(message, conn);
  const meta = candidate.context.groupJid ? await conn.groupMetadata(candidate.context.groupJid).catch(() => null) : null;
  const senderAdmin = privileged || (meta && isAdmin(meta, message.sender));

  if (!senderAdmin) {
    await conn.sendMessage(message.from, {
      text: "❌ *Permission Denied:* Only group administrators can confirm this action.",
    });
    return true;
  }

  // Remove from pending
  pendingConfirmations.delete(candidate.id);

  // Execute the underlying action
  try {
    const { actionName, payload, context } = candidate;

    if (actionName === "kick_members") {
      const targets = payload.members;
      await conn.groupParticipantsUpdate(context.groupJid, targets, "remove");
      await conn.sendMessage(message.from, {
        text: `✅ *[ACTION CONFIRMED & EXECUTED]*\nSuccessfully removed \`${targets.length}\` participants as authorized by @${displayId(message.sender)}.`,
        mentions: [message.sender],
      });
      return true;
    }

    if (actionName === "mute_group") {
      await conn.groupSettingUpdate(context.groupJid, "announcement");
      await conn.sendMessage(message.from, { text: "✅ *[ACTION CONFIRMED]* Group chat muted." });
      return true;
    }
  } catch (err) {
    await conn.sendMessage(message.from, {
      text: `❌ *Execution Failed:* ${err?.message || err}`,
    });
    return true;
  }

  return true;
}
