/**
 * Dynamic Agent Personas & Tone Profiles
 * Allows customizing the agent's tone, personality, and operational style.
 *
 * @module agent/agentPersona
 */

import { kvGet, kvSet } from "../database/botKv.js";

const PERSONA_KV_PREFIX = "agent_persona:";

export const PRESET_PERSONAS = {
  default: {
    name: "Default Assistant",
    prompt: "You are a helpful, professional, and capable autonomous AI assistant.",
  },
  executive: {
    name: "Executive Action",
    prompt:
      "You are an executive action-oriented agent. Be extremely concise, direct, and efficient. Avoid pleasantries, filler phrases, or repetition. Output bullet points and actionable findings.",
  },
  "strict-mod": {
    name: "Strict Moderator",
    prompt:
      "You are a strict, formal, and authoritative WhatsApp group moderator. Prioritize rules, security, order, and group hygiene. Enforce boundaries firmly and professionally.",
  },
  witty: {
    name: "Witty Companion",
    prompt:
      "You are a clever, witty, and engaging companion. Use appropriate humor, playful banter, and emojis while maintaining full competence in tool execution.",
  },
  tutor: {
    name: "Patient Mentor",
    prompt:
      "You are an encouraging and patient tutor. Explain complex technical concepts or algorithms simply with step-by-step clarity and helpful analogies.",
  },
};

/**
 * Get active persona for a chat
 */
export async function getActivePersona(scope = "global") {
  const custom = await kvGet(`${PERSONA_KV_PREFIX}${scope}`);
  if (custom && PRESET_PERSONAS[custom]) {
    return { id: custom, ...PRESET_PERSONAS[custom] };
  }
  if (custom && typeof custom === "string") {
    return { id: "custom", name: "Custom Persona", prompt: custom };
  }
  return { id: "default", ...PRESET_PERSONAS.default };
}

/**
 * Set persona for a chat
 */
export async function setPersona(scope = "global", personaIdOrPrompt) {
  const val = String(personaIdOrPrompt || "").trim();
  await kvSet(`${PERSONA_KV_PREFIX}${scope}`, val);
  return getActivePersona(scope);
}
