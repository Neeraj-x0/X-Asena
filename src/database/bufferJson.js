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
