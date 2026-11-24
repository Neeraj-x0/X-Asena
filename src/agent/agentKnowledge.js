/**
 * Custom Knowledge Base (RAG / FAQ Store)
 * Enables the autonomous agent to store and retrieve community rules, FAQs,
 * product specs, and documentation with factual accuracy.
 *
 * @module agent/agentKnowledge
 */

import { kvGet, kvSet } from "../database/botKv.js";

const KB_KV_KEY = "agent_knowledge_base";

/**
 * Load all knowledge base articles from BotKV
 */
export async function loadKnowledgeBase() {
  const data = await kvGet(KB_KV_KEY);
  return Array.isArray(data) ? data : [];
}

/**
 * Save knowledge base articles
 */
export async function saveKnowledgeBase(articles) {
  await kvSet(KB_KV_KEY, articles);
}

/**
 * Add an article or document to the knowledge base
 */
export async function addToKnowledgeBase({ title, content, category = "general", scope = "global", author = "admin" }) {
  const cleanTitle = String(title || "").trim();
  const cleanContent = String(content || "").trim();

  if (!cleanTitle || !cleanContent) {
    throw new Error("Title and content are required.");
  }

  let articles = await loadKnowledgeBase();

  // Remove existing with same title & scope
  articles = articles.filter(
    (a) => !(a.title.toLowerCase() === cleanTitle.toLowerCase() && a.scope === scope)
  );

  const article = {
    id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    content: cleanContent,
    category: category || "general",
    scope: scope || "global",
    author: author || "admin",
    updatedAt: Date.now(),
  };

  articles.push(article);
  await saveKnowledgeBase(articles);
  return article;
}

/**
 * Query knowledge base for articles relevant to a query
 */
export async function queryKnowledgeBase({ query, scope = "global", limit = 3 }) {
  const articles = await loadKnowledgeBase();
  const q = String(query || "").toLowerCase();
  const terms = q.split(/\s+/).filter((w) => w.length > 2);

  const matched = articles.filter((a) => {
    if (a.scope !== "global" && a.scope !== scope) return false;
    const fullText = `${a.title} ${a.content} ${a.category}`.toLowerCase();
    return fullText.includes(q) || terms.some((t) => fullText.includes(t));
  });

  return matched.slice(0, limit);
}

/**
 * List all articles for a scope
 */
export async function listKnowledgeBase(scope = "global") {
  const articles = await loadKnowledgeBase();
  return articles.filter((a) => a.scope === "global" || a.scope === scope);
}

/**
 * Delete article from knowledge base
 */
export async function deleteFromKnowledgeBase(idOrTitle, scope = "global") {
  let articles = await loadKnowledgeBase();
  const before = articles.length;
  const target = String(idOrTitle).toLowerCase();

  articles = articles.filter((a) => {
    if (a.id === idOrTitle) return false;
    if (a.title.toLowerCase() === target && (a.scope === scope || scope === "all")) return false;
    return true;
  });

  await saveKnowledgeBase(articles);
  return before !== articles.length;
}

/**
 * Format matching knowledge base articles for prompt injection
 */
export async function formatKnowledgeForPrompt(query, scope = "global") {
  const matches = await queryKnowledgeBase({ query, scope, limit: 3 });
  if (!matches.length) return "";

  let text = "📚 Relevant Verified Knowledge Base Articles:\n";
  matches.forEach((a) => {
    text += `• [${a.title}]: ${a.content.slice(0, 400)}\n`;
  });
  return text.trim();
}
