/**
 * Per-group settings stored in BotKV (JSON blob per group)
 */

import { kvGet, kvSet } from "../database/botKv.js";

const PREFIX = "gset:";

const DEFAULTS = {
  welcome: false,
  welcomeText:
    "👋 Welcome @user to *@group*!\nMembers: @count",
  goodbye: false,
  goodbyeText: "👋 @user left *@group*.",
  antilink: false,
  antispam: false,
  antispamLimit: 5,
  antispamWindowMs: 8000,
  warnLimit: 3,
  antidelete: false,
  muted: [],
  disabledPlugins: [],
};

function key(jid) {
  return `${PREFIX}${jid}`;
}

export async function getGroupSettings(jid) {
  const raw = await kvGet(key(jid));
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  return { ...DEFAULTS, ...raw, muted: raw.muted || [], disabledPlugins: raw.disabledPlugins || [] };
}

export async function setGroupSettings(jid, patch) {
  const cur = await getGroupSettings(jid);
  const next = { ...cur, ...patch };
  await kvSet(key(jid), next);
  return next;
}

export async function toggleGroupFlag(jid, flag, value) {
  const cur = await getGroupSettings(jid);
  if (typeof value === "boolean") {
    cur[flag] = value;
  } else {
    cur[flag] = !cur[flag];
  }
  await kvSet(key(jid), cur);
  return cur;
}

/** Warn counts: warns:{group}:{userNorm} */
export async function getWarns(groupJid, userNorm) {
  const n = await kvGet(`warns:${groupJid}:${userNorm}`);
  return typeof n === "number" ? n : parseInt(n, 10) || 0;
}

export async function setWarns(groupJid, userNorm, count) {
  await kvSet(`warns:${groupJid}:${userNorm}`, Math.max(0, count));
  return count;
}

export async function addWarn(groupJid, userNorm) {
  const c = (await getWarns(groupJid, userNorm)) + 1;
  await setWarns(groupJid, userNorm, c);
  return c;
}

export async function resetWarns(groupJid, userNorm) {
  await setWarns(groupJid, userNorm, 0);
  return 0;
}
