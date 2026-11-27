/**
 * Plug-and-play bridge for the optional src/agent/ module.
 * Every call safely no-ops or falls back when src/agent/ is deleted.
 */

import fs from "fs";
import { toWhatsAppJid } from "./access.js";

const AGENT_ENTRY_URL = new URL("../agent/aiAgent.js", import.meta.url);

/**
 * Check whether the optional AI agent folder is present.
 */
export function isAgentInstalled() {
  return fs.existsSync(AGENT_ENTRY_URL);
}

/**
 * Dynamically load a module inside src/agent/, returning null if the agent folder is absent.
 */
export async function loadAgentModule(fileName) {
  if (!isAgentInstalled()) return null;
  try {
    return await import(`../agent/${fileName}`);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw err;
  }
}

export async function tryTriggerMessageWatchers({ message, conn }) {
  const mod = await loadAgentModule("agentEvents.js");
  if (!mod?.triggerMessageEventWatchers) return;
  await mod.triggerMessageEventWatchers({ message, conn }).catch(() => {});
}

export async function tryTriggerGroupWatchers({ groupJid, action, participants, conn }) {
  const mod = await loadAgentModule("agentEvents.js");
  if (!mod?.triggerGroupEventWatchers) return;
  await mod.triggerGroupEventWatchers({ groupJid, action, participants, conn }).catch(() => {});
}

export async function tryHandleAdminConfirmation({ message, conn }) {
  const mod = await loadAgentModule("agentGuardrails.js");
  if (!mod?.handleAdminConfirmation) return false;
  return Boolean(await mod.handleAdminConfirmation({ message, conn }));
}

export async function tryHandleAgentTrigger({ message, conn }) {
  const mod = await loadAgentModule("aiAgent.js");
  if (!mod?.checkAndHandleAgentTrigger) return false;
  return Boolean(await mod.checkAndHandleAgentTrigger({ message, conn }));
}

export async function tryStartAgentScheduler(conn) {
  const mod = await loadAgentModule("agentCron.js");
  if (!mod?.startAutonomousAgentScheduler) return;
  mod.startAutonomousAgentScheduler(conn);
}

/**
 * Dispatch a dashboard message through agentSafetyThrottle if installed,
 * falling back cleanly to conn.sendMessage when src/agent/ is absent.
 */
export async function dispatchSafeMessage({ conn, target, text }) {
  const mod = await loadAgentModule("agentSafetyThrottle.js");
  const isGroupTarget = String(target).endsWith("@g.us");

  if (mod) {
    if (isGroupTarget && mod.safeDispatchGroupMessage) {
      return await mod.safeDispatchGroupMessage({ conn, targetJid: target, text });
    }
    if (!isGroupTarget && mod.safeDispatchDirectMessage) {
      return await mod.safeDispatchDirectMessage({
        conn,
        recipient: target,
        text,
        callerJid: conn.user?.id?.replace(/:\d+@/, "@") || undefined,
      });
    }
  }

  const targetJid = isGroupTarget ? target : toWhatsAppJid(target);
  if (!targetJid) {
    return { success: false, error: "Invalid recipient JID or phone number." };
  }
  await conn.sendMessage(targetJid, { text });
  return { success: true, deliveredTo: targetJid };
}
