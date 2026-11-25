/**
 * Global + per-group policy engine
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { getGroupSettings } from "../utils/groupSettings.js";
import { createTtlCache } from "../utils/cache.js";

const KEY = "policies";

const GLOBAL_DEFAULTS = {
  quietHoursStart: null, // "22:00"
  quietHoursEnd: null, // "07:00"
  maxWarns: 3,
  allowMediaCommands: true,
  allowLinksInGroups: true, // antilink still per-group
  rateLimitPerUser: 20, // commands / minute
  blockBroadcast: false,
};

let cache = null;

async function loadGlobal() {
  if (cache) return cache;
  const stored = await kvGet(KEY);
  cache = { ...GLOBAL_DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  return cache;
}

export async function getPolicies() {
  return { ...(await loadGlobal()) };
}

export async function setPolicy(key, value) {
  const p = await loadGlobal();
  p[key] = value;
  cache = p;
  await kvSet(KEY, p);
  return p;
}

function inQuietHours(policy) {
  const start = policy.quietHoursStart;
  const end = policy.quietHoursEnd;
  if (!start || !end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const parse = (s) => {
    const [h, m] = String(s).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const a = parse(start);
  const b = parse(end);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;
  // wraps midnight
  return cur >= a || cur < b;
}

/** Simple bounded per-user command rate limit */
const buckets = createTtlCache({ ttlMs: 2 * 60_000, max: 500 });

function rateLimited(userKey, limit) {
  if (!limit || limit <= 0) return false;
  const now = Date.now();
  let arr = buckets.get(userKey) || [];
  arr = arr.filter((t) => now - t < 60_000);
  arr.push(now);
  buckets.set(userKey, arr);
  return arr.length > limit;
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function evaluatePolicy(message, command, { privileged = false } = {}) {
  const policy = await loadGlobal();
  const name = (command.patternName || "").toLowerCase();

  if (privileged) {
    // still honor maintenance-like broadcast block for non-owner handled elsewhere
  }

  if (!privileged && inQuietHours(policy)) {
    // Allow menu/ping/status/help during quiet hours
    const allow = new Set(["menu", "help", "ping", "status", "mode", "setup"]);
    if (!allow.has(name)) {
      return { ok: false, reason: "QUIET_HOURS" };
    }
  }

  if (policy.blockBroadcast && name === "broadcast") {
    return { ok: false, reason: "BROADCAST_BLOCKED" };
  }

  if (!policy.allowMediaCommands) {
    const mediaish = [
      "ytmp3",
      "ytmp4",
      "play",
      "sticker",
      "s",
      "ig",
      "tiktok",
      "fb",
      "tomp3",
    ];
    if (mediaish.includes(name) && !privileged) {
      return { ok: false, reason: "MEDIA_DISABLED" };
    }
  }

  if (!privileged) {
    const userKey = `${message.from}:${message.sender}`;
    if (rateLimited(userKey, policy.rateLimitPerUser)) {
      return { ok: false, reason: "RATE_LIMIT" };
    }
  }

  // Sync warn limit into group defaults conceptually
  if (message.isGroup && policy.maxWarns) {
    try {
      const gs = await getGroupSettings(message.from);
      if (gs.warnLimit !== policy.maxWarns) {
        // soft — don't write every message; only used when reading warns
      }
    } catch {
      /* ignore */
    }
  }

  return { ok: true, policy };
}
