/**
 * Bot access control — public/private mode, owner + sudo
 */

import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet, seedBotKvFromEnv } from "../database/botKv.js";

const MODE_KEY = "mode";
const SUDO_KEY = "sudo";

/** Commands that always require privileged (even in public mode for management) */
export const PRIVILEGED_COMMANDS = new Set([
  "mode",
  "sudo",
  "exif",
  "broadcast",
  "cmdlist",
  "setup",
  "createlog",
  "setlog",
  "audit",
  "flag",
  "policy",
  "role",
  "backup",
  "metrics",
  "update",
]);

/** Owner-only (not sudo) — plugin may still allow sudo list */
export const OWNER_ONLY_COMMANDS = new Set([
  "sudo",
  "broadcast",
  "setlog",
  "createlog",
  "backup",
  "update",
]);

/**
 * Strip JID / LID / device suffix → digits or lid id
 */
export function normalizeNumber(input) {
  if (!input) return "";
  let s = String(input).trim();
  // bare number or jid
  s = s.replace(/@.*/, "");
  // device suffix 123456:61 → 123456
  if (s.includes(":")) s = s.split(":")[0];
  // keep digits for phone; for LID keep alphanumeric
  const digits = s.replace(/\D/g, "");
  return digits || s;
}

/**
 * Collect candidate normalized ids from a message sender
 */
export function senderCandidates(message, conn) {
  const ids = new Set();
  const add = (v) => {
    const n = normalizeNumber(v);
    if (n) ids.add(n);
  };

  add(message?.sender);
  add(message?.participant);
  add(message?.participantAlt);
  add(message?.key?.participant);
  add(message?.key?.participantAlt);
  add(message?.key?.remoteJid);
  add(message?.key?.remoteJidAlt);

  if (message?.key?.fromMe && conn?.user) {
    add(conn.user.id);
    add(conn.user.lid);
    if (conn.user.id) add(conn.user.id.replace(/:\d+@/, "@"));
  }

  return ids;
}

/**
 * Owner numbers from env OWNER_NUMBER (comma-separated ok)
 */
export function getOwnerNumbers() {
  const raw = BOT_INFO.OWNER || process.env.OWNER_NUMBER || "";
  return raw
    .split(",")
    .map((s) => normalizeNumber(s))
    .filter(Boolean);
}

async function ensureSeeded() {
  try {
    await seedBotKvFromEnv();
  } catch {
    /* BotKV may not be ready in tests */
  }
}

/**
 * Env SUDO list (always merged)
 */
function envSudoList() {
  return (process.env.SUDO || "")
    .split(",")
    .map((s) => normalizeNumber(s.trim()))
    .filter(Boolean);
}

export async function getMode() {
  await ensureSeeded();
  const mode = await kvGet(MODE_KEY);
  return mode === "private" ? "private" : "public";
}

export async function setMode(mode) {
  const next = String(mode).toLowerCase() === "private" ? "private" : "public";
  await kvSet(MODE_KEY, next);
  return next;
}

/**
 * Runtime sudo list from BotKV (env merged at read time)
 */
export async function listSudo() {
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = Array.isArray(stored) ? stored.map(normalizeNumber) : [];
  const merged = new Set([...list.filter(Boolean), ...envSudoList()]);
  return [...merged];
}

export async function addSudo(number) {
  const n = normalizeNumber(number);
  if (!n) throw new Error("Invalid number");
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = Array.isArray(stored) ? stored.map(normalizeNumber) : [];
  if (!list.includes(n)) list.push(n);
  await kvSet(SUDO_KEY, list);
  return list;
}

export async function removeSudo(number) {
  const n = normalizeNumber(number);
  await ensureSeeded();
  const stored = (await kvGet(SUDO_KEY)) || [];
  const list = (Array.isArray(stored) ? stored : [])
    .map(normalizeNumber)
    .filter((x) => x && x !== n);
  await kvSet(SUDO_KEY, list);
  return list;
}

export function isOwnerMessage(message, conn) {
  if (message?.key?.fromMe) return true;
  const owners = getOwnerNumbers();
  if (!owners.length) {
    // No OWNER_NUMBER: treat fromMe / bot user as owner only
    return !!message?.key?.fromMe;
  }
  const candidates = senderCandidates(message, conn);
  return owners.some((o) => candidates.has(o));
}

export async function isSudoMessage(message, conn) {
  const sudos = await listSudo();
  if (!sudos.length) return false;
  const candidates = senderCandidates(message, conn);
  return sudos.some((s) => candidates.has(s));
}

/**
 * Owner or sudo (or fromMe)
 */
export async function isPrivileged(message, conn) {
  if (message?.key?.fromMe) return true;
  if (isOwnerMessage(message, conn)) return true;
  return isSudoMessage(message, conn);
}

/**
 * Can this user run this command given current mode?
 * Returns { allowed: boolean, silent?: boolean, reason?: string }
 */
export async function checkCommandAccess(message, command, conn) {
  const name = (command.patternName || "").toLowerCase();
  const privileged = await isPrivileged(message, conn);
  const owner = isOwnerMessage(message, conn);

  // Strict owner-only (broadcast); sudo mutations enforced in plugin for `#sudo`
  if (name === "broadcast" && !owner && !message?.key?.fromMe) {
    return { allowed: false, silent: false, reason: "OWNER_ONLY" };
  }

  if (OWNER_ONLY_COMMANDS.has(name) && !owner && !message?.key?.fromMe) {
    // Allow privileged to *list* sudo; plugin enforces owner for add/del
    if (!privileged) {
      return { allowed: false, silent: false, reason: "OWNER_ONLY" };
    }
  }

  if (PRIVILEGED_COMMANDS.has(name) || command.fromMe) {
    if (!privileged) {
      return { allowed: false, silent: false, reason: "OWNER_ONLY" };
    }
    return { allowed: true };
  }

  const mode = await getMode();
  if (mode === "private" && !privileged) {
    return { allowed: false, silent: true };
  }

  return { allowed: true };
}

