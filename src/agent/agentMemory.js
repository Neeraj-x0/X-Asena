/**
 * Agent Memory Layer
 * Provides short-term conversational context buffers and persistent long-term memory.
 *
 * @module agent/agentMemory
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";

const MEMORY_KV_KEY = "agent_persistent_memories";
const MAX_CHAT_BUFFER = 20;

/**
 * In-memory rolling buffer for recent messages per chat (JID -> Message[])
 */
const chatBuffers = new Map();

/**
 * Add a message to the rolling chat buffer
 */
export function addMessageToHistory(chatJid, { sender, senderName, text, isBot = false }) {
  if (!chatJid || !text) return;

  if (!chatBuffers.has(chatJid)) {
    chatBuffers.set(chatJid, []);
  }

  const buffer = chatBuffers.get(chatJid);
  const cleanSender = normalizeNumber(sender) || "unknown";
  const displayName = senderName || cleanSender;

  buffer.push({
    sender: cleanSender,
    name: displayName,
    text: String(text).trim().slice(0, 500),
    isBot: Boolean(isBot),
    timestamp: Date.now(),
  });

  if (buffer.length > MAX_CHAT_BUFFER) {
    buffer.shift();
  }
}

/**
 * Get formatted recent chat history
 */
export function getChatHistory(chatJid, limit = 10) {
  const buffer = chatBuffers.get(chatJid) || [];
  const slice = buffer.slice(-limit);

  if (!slice.length) return "";

  return slice
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const role = m.isBot ? "Bot" : m.name;
      return `[${time}] ${role}: ${m.text}`;
    })
    .join("\n");
}

/**
 * Load persistent long-term memories from BotKV
 */
export async function loadAllMemories() {
  const data = await kvGet(MEMORY_KV_KEY);
  return Array.isArray(data) ? data : [];
}

/**
 * Save persistent memories to BotKV
 */
export async function saveAllMemories(memories) {
  await kvSet(MEMORY_KV_KEY, memories);
}

/**
 * Store a piece of knowledge/fact to long-term memory
 */
export async function storeMemory({ key, value, scope = "global", category = "general", author = "" }) {
  const memories = await loadAllMemories();
  const cleanKey = String(key || "").trim().toLowerCase();
  const cleanValue = String(value || "").trim();

  if (!cleanKey || !cleanValue) {
    throw new Error("Key and value are required to store a memory.");
  }

  // Remove existing memory with same key and scope if exists
  const filtered = memories.filter(
    (m) => !(m.key.toLowerCase() === cleanKey && m.scope === scope)
  );

  const entry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    key: cleanKey,
    value: cleanValue,
    scope: scope || "global",
    category: category || "general",
    author: author || "system",
    updatedAt: Date.now(),
  };

  filtered.push(entry);
  await saveAllMemories(filtered);
  return entry;
}

/**
 * Retrieve memories for a specific scope (and global)
 */
export async function getMemories(scope = "global", category = null) {
  const memories = await loadAllMemories();
  return memories.filter((m) => {
    const scopeMatch = m.scope === "global" || m.scope === scope;
    const catMatch = category ? m.category === category : true;
    return scopeMatch && catMatch;
  });
}

/**
 * Search long-term memory by keyword query
 */
export async function searchMemories(query, scope = "global") {
  const memories = await getMemories(scope);
  const q = String(query || "").toLowerCase();
  return memories.filter(
    (m) =>
      m.key.toLowerCase().includes(q) ||
      m.value.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
  );
}

/**
 * Delete a specific memory by key or ID
 */
export async function deleteMemory({ key, id, scope = "global" }) {
  let memories = await loadAllMemories();
  const before = memories.length;

  memories = memories.filter((m) => {
    if (id && m.id === id) return false;
    if (key && m.key.toLowerCase() === key.toLowerCase() && (m.scope === scope || scope === "all")) {
      return false;
    }
    return true;
  });

  await saveAllMemories(memories);
  return before !== memories.length;
}

/**
 * Clear all memories for a specific scope
 */
export async function clearMemories(scope) {
  let memories = await loadAllMemories();
  if (!scope || scope === "all") {
    await saveAllMemories([]);
    return true;
  }
  const filtered = memories.filter((m) => m.scope !== scope);
  await saveAllMemories(filtered);
  return true;
}

/**
 * Format active memories into a text block for prompt injection
 */
export async function formatMemoriesForPrompt(scope = "global") {
  const list = await getMemories(scope);
  if (!list.length) return "";

  let text = "🧠 Stored Long-Term Knowledge & Memories:\n";
  for (const m of list) {
    text += `• [${m.category}] ${m.key}: ${m.value}\n`;
  }
  return text.trim();
}
