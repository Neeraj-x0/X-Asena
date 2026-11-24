/**
 * AI Model Discovery & Selection for OpenAI-Compatible Endpoints
 * Queries the endpoint for available models and provides numbered selection.
 *
 * @module agent/agentModels
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { BOT_INFO } from "../config/constants.js";

const LAST_MODELS_KEY = "agent_discovered_models";

/**
 * Fetch available models from an OpenAI-compatible endpoint
 */
export async function fetchAvailableModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) {
    throw new Error("Both Base URL and API Key are required to discover models.");
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "X-Asena-Bot/4.0",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Endpoint returned status ${res.status}: ${errText.slice(0, 150) || res.statusText}`);
  }

  const data = await res.json();
  const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

  let models = rawList.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean);

  // Filter out non-chat models like audio/embedding/dall-e if chat models exist
  const chatCandidates = models.filter((m) =>
    !/embed|whisper|tts|moderation|davinci|curie|babbage/i.test(m)
  );

  if (chatCandidates.length) {
    models = chatCandidates;
  }

  // Sort: prefer gpt-4o, llama-3.3, deepseek, qwen, etc.
  models.sort((a, b) => {
    const aChat = /gpt-4o|llama-3\.3|deepseek|claude/i.test(a) ? 1 : 0;
    const bChat = /gpt-4o|llama-3\.3|deepseek|claude/i.test(b) ? 1 : 0;
    if (aChat !== bChat) return bChat - aChat;
    return a.localeCompare(b);
  });

  // Cache discovered models
  await kvSet(LAST_MODELS_KEY, models);
  return models;
}

/**
 * Get the cached list of discovered models
 */
export async function getCachedDiscoveredModels() {
  const list = await kvGet(LAST_MODELS_KEY);
  return Array.isArray(list) ? list : [];
}

/**
 * Format available models into a user prompt for selection
 */
export function formatModelSelectionPrompt(models, currentModel = "") {
  if (!models.length) {
    return "⚠️ No models were returned by the endpoint.";
  }

  const displayList = models.slice(0, 15);
  let text = `🤖 *AVAILABLE AI MODELS DISCOVERED (${models.length}):*\n\n`;
  text += `_Your endpoint was queried successfully. Choose your default model below:_\n\n`;

  displayList.forEach((m, idx) => {
    const isCurrent = m === currentModel;
    text += `*${idx + 1}.* \`${m}\`${isCurrent ? " *(Current)*" : ""}\n`;
  });

  if (models.length > 15) {
    text += `_...and ${models.length - 15} more models_\n`;
  }

  text += `\n*To set your default model, reply with:*\n`;
  text += `• \`${BOT_INFO.PREFIX}agentconfig model 1\` (by number)\n`;
  text += `• \`${BOT_INFO.PREFIX}agentconfig model <model_name>\` (by name)`;

  return text;
}
