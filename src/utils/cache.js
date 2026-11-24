/**
 * Tiny in-memory TTL + max-size caches
 */

/**
 * @param {object} options
 * @param {number} [options.ttlMs] - Entry time-to-live in ms
 * @param {number} [options.max] - Max entries (evict oldest)
 */
export function createTtlCache({ ttlMs = 5 * 60 * 1000, max = 50 } = {}) {
  const store = new Map();

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  function evictOverflow() {
    while (store.size > max) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      // Refresh insertion order for LRU-ish eviction
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },

    set(key, value) {
      evictExpired();
      store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      evictOverflow();
    },

    delete(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },

    get size() {
      return store.size;
    },
  };
}

/** Group metadata cache (~3 min, max 50) */
export const groupCache = createTtlCache({
  ttlMs: 3 * 60 * 1000,
  max: 50,
});

/** Message cache for getMessage retries and anti-delete (~1000 entries, 2 hours) */
export const msgCache = createTtlCache({
  ttlMs: 2 * 60 * 60 * 1000,
  max: 1000,
});
