/**
 * Shared BufferJSON + key helpers for auth state backends
 */

export const BufferJSON = {
  // Regular function preserves `this[key]` (pre-toJSON Buffer) to avoid intermediate integer-array allocs
  replacer: function (key, value) {
    const raw = this?.[key];
    if (Buffer.isBuffer(raw)) {
      return { type: "Buffer", data: raw.toString("base64") };
    }
    if (value instanceof Buffer) {
      return { type: "Buffer", data: value.toString("base64") };
    }
    if (value?.type === "Buffer" && Array.isArray(value?.data)) {
      return {
        type: "Buffer",
        data: Buffer.from(value.data).toString("base64"),
      };
    }
    if (value instanceof Uint8Array) {
      return {
        type: "Buffer",
        data: Buffer.from(value).toString("base64"),
      };
    }
    return value;
  },

  reviver: (_key, value) => {
    if (value?.type === "Buffer" && typeof value?.data === "string") {
      try {
        return Buffer.from(value.data, "base64");
      } catch {
        return value;
      }
    }
    return value;
  },
};

/**
 * Serialize any value (preserving Buffers/Uint8Arrays) into a BufferJSON string.
 */
export function encodeBufferJson(obj) {
  return JSON.stringify(obj, BufferJSON.replacer);
}

/**
 * Revive a BufferJSON string or plain object back into native Buffers.
 */
export function decodeBufferJson(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    return JSON.parse(raw, BufferJSON.reviver);
  }
  return JSON.parse(JSON.stringify(raw), BufferJSON.reviver);
}

/**
 * Losslessly deep-clone an object containing Buffer/Uint8Array fields.
 */
export function cloneBufferJson(obj) {
  return obj == null ? obj : decodeBufferJson(encodeBufferJson(obj));
}

/**
 * Sanitize key names for storage
 */
export function sanitizeKey(key) {
  if (!key) return key;
  return key.replace(/[<>:"|?*]/g, "_").replace(/\//g, "__").replace(/:/g, "-");
}

/**
 * Build storage key for a Baileys signal key entry
 */
export function makeStorageKey(type, id) {
  return sanitizeKey(`${type}-${id}.json`);
}

/**
 * Trim excess closed Signal sub-sessions inside a serialized SessionEntry record
 * while keeping open (-1) ratchets untouched.
 */
export function trimClosedRatchets(rawJsonValue, maxClosedPerJid = 5) {
  if (!rawJsonValue) return { changed: false, prunedCount: 0 };
  try {
    const parsed = JSON.parse(rawJsonValue, BufferJSON.reviver);
    const map = parsed?._sessions;
    if (!map || typeof map !== "object") return { changed: false, prunedCount: 0 };

    const closedKeys = [];
    for (const [baseKey, entry] of Object.entries(map)) {
      const closedAt = entry?.indexInfo?.closed;
      if (typeof closedAt === "number" && closedAt > 0) {
        closedKeys.push({ baseKey, closedAt });
      }
    }

    if (closedKeys.length <= maxClosedPerJid) {
      return { changed: false, prunedCount: 0 };
    }

    closedKeys.sort((a, b) => b.closedAt - a.closedAt);
    const toDrop = closedKeys.slice(maxClosedPerJid);
    for (const item of toDrop) {
      delete map[item.baseKey];
    }

    return {
      changed: true,
      prunedCount: toDrop.length,
      nextValue: JSON.stringify(parsed, BufferJSON.replacer),
    };
  } catch {
    return { changed: false, prunedCount: 0 };
  }
}
