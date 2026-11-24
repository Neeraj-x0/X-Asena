/**
 * Prompt Injection Guardrails & Security Layer
 * Multi-layer defense against direct jailbreaks, system prompt extraction,
 * roleplay bypasses, authority spoofing, delimiter attacks, and indirect injection.
 *
 * @module agent/agentInjectionGuard
 */

import { kvGet, kvSet } from "../database/botKv.js";

const GUARD_CONFIG_KEY = "agent_guardrail_config";
const GUARD_LOGS_KEY = "agent_guardrail_logs";
const MAX_LOGS = 50;

/**
 * In-memory fallback caches (used if BotKV is not yet attached)
 */
let inMemoryConfig = {
  enabled: true,
  mode: "strict", // "strict" (threshold: 40) or "standard" (threshold: 60)
  blockDirectJailbreaks: true,
  blockSystemLeaks: true,
  blockRoleplayBypasses: true,
  blockTokenInjections: true,
  sanitizeBoundaries: true,
  preventOutputLeaks: true,
  logBlockedAttempts: true,
};

let inMemoryLogs = [];

/**
 * Injection Heuristic Patterns with Weights and Reason Codes
 */
const INJECTION_RULES = [
  // 1. Direct Directive Overrides & Ignorals
  {
    code: "DIRECT_INSTRUCTION_OVERRIDE",
    name: "Instruction Override Attempt",
    weight: 60,
    patterns: [
      /ignore\s+(all\s+|any\s+|prior\s+|previous\s+|above\s+|the\s+|your\s+)*(instructions|directives|rules|guidelines|commands|prompts|constraints)/i,
      /disregard\s+(all\s+|any\s+|prior\s+|previous\s+|above\s+|the\s+|your\s+)*(instructions|directives|rules|guidelines|commands|prompts|constraints)/i,
      /forget\s+(all\s+|any\s+|prior\s+|previous\s+|above\s+|everything\s+)*(instructions|directives|rules|guidelines|you\s+were\s+told|so\s+far)/i,
      /(system|prompt)\s+(override|bypass)/i,
      /override\s+(all\s+|system\s+|safety\s+|security\s+)*(instructions|rules|filters|protocols)/i,
      /new\s+(system\s+)?instruction[s]?\s*:\s*(ignore|forget|disregard|you\s+are\s+now|bypass)/i,
      /from\s+now\s+on[,\s]+(you\s+(must|will)\s+)?(ignore|disregard|forget|bypass)\s+(all|your|the)\s+(rules|instructions)/i,
    ],
  },

  // 2. Persona Bypasses, DAN, & Uncensored Mode
  {
    code: "JAILBREAK_PERSONA",
    name: "Jailbreak Persona / Uncensored Mode",
    weight: 60,
    patterns: [
      /\b(DAN|AIM)\s*(mode)?\b/i,
      /(in\s+)?developer\s+mode(\s+(is\s+now\s+)?(enabled|active|on))?/i,
      /jailbreak(\s+mode)?/i,
      /uncensored\s+mode/i,
      /evil\s+bot\s+mode/i,
      /you\s+have\s+no\s+(rules|limits|filters|restrictions)/i,
      /you\s+can\s+do\s+anything\s+now/i,
      /act\s+as\s+an\s+(unrestricted|unfiltered|jailbroken|uncensored)\s+(AI|assistant|model|bot)/i,
      /bypass\s+(all\s+)?(rules|safety|content|ethical|security)(\s+(filters|guidelines|restrictions|rules))?/i,
    ],
  },

  // 3. System Prompt & Developer Directive Leaks
  {
    code: "SYSTEM_PROMPT_EXTRACTION",
    name: "System Prompt Extraction Attempt",
    weight: 55,
    patterns: [
      /(repeat|reveal|print|output|display|show(\s+me)?|dump|echo|leak)\s+(your\s+|the\s+)?(system\s+prompt|initial\s+instructions|system\s+instructions|hidden\s+prompt|core\s+prompt|developer\s+instructions)/i,
      /(what\s+is|what\s+are|give\s+me|show\s+me)\s+(your\s+|the\s+)?(system\s+prompt|initial\s+prompt|hidden\s+rules|system\s+instructions)/i,
      /output\s+everything\s+(above|from\s+line\s+1|from\s+the\s+beginning|prior\s+to\s+this)/i,
      /repeat\s+the\s+words\s+above/i,
    ],
  },

  // 4. Secret & Credential Extraction
  {
    code: "SECRET_EXTRACTION",
    name: "Credential & Secret Probe",
    weight: 70,
    patterns: [
      /(reveal|show(\s+me)?|print|what\s+is|what\s+are|leak|dump|give\s+me|share)\s+(your\s+|the\s+|bot('s)?\s*)?(secret\s+|hidden\s+|private\s+|active\s+|openai\s+|groq\s+)?(api[_\s-]?key|bearer\s+token|auth\s+token|database\s+password|database\s+url|secret\s+key|private\s+key|credentials)/i,
      /\b(api[_\s-]?key|bearer\s+token|secret\s+key)\b.*(reveal|leak|print|show(\s+me)?|give\s+me)/i,
    ],
  },

  // 5. Special Delimiter / Token Injection
  {
    code: "SPECIAL_TOKEN_INJECTION",
    name: "Raw Special Token Injection",
    weight: 50,
    patterns: [
      /<\|im_start\|>/i,
      /<\|im_end\|>/i,
      /\[INST\]/i,
      /\[\/INST\]/i,
      /<<SYS>>/i,
      /<<\/SYS>>/i,
      /\[SYSTEM\]/i,
      /\[\/SYSTEM\]/i,
      /\{\s*"role"\s*:\s*"system"/i,
    ],
  },

  // 6. Authority & Admin Spoofing
  {
    code: "AUTHORITY_SPOOFING",
    name: "Admin / Authority Spoofing",
    weight: 35,
    patterns: [
      /i\s+am\s+(the\s+)?(bot\s+owner|developer|creator|system\s+admin|superadmin).*(bypass|override|disable|grant|promote\s+me|kick)/i,
      /emergency\s+override\s+protocol/i,
    ],
  },

  // 7. Sandbox Boundary Tag Breakout
  {
    code: "BOUNDARY_TAG_BREAKOUT",
    name: "Boundary Tag Escape Attempt",
    weight: 45,
    patterns: [
      /<\/?untrusted_(user_input|web_content|chat_history|knowledge)[^>]*>/i,
    ],
  },
];

/**
 * Get Guardrail Configuration
 */
export async function getGuardrailConfig() {
  try {
    const data = await kvGet(GUARD_CONFIG_KEY);
    if (data && typeof data === "object") {
      inMemoryConfig = { ...inMemoryConfig, ...data };
    }
  } catch {
    /* fallback to inMemoryConfig */
  }
  return { ...inMemoryConfig };
}

/**
 * Update Guardrail Configuration
 */
export async function setGuardrailConfig(updates) {
  inMemoryConfig = { ...inMemoryConfig, ...updates };
  try {
    await kvSet(GUARD_CONFIG_KEY, inMemoryConfig);
  } catch {
    /* ignore fallback */
  }
  return { ...inMemoryConfig };
}

/**
 * Record a blocked prompt injection attempt
 */
export async function recordBlockedAttempt({ sender, chat, prompt, matchedRules, score }) {
  const entry = {
    id: `inj_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    sender: sender || "unknown",
    chat: chat || "unknown",
    promptSnippet: String(prompt || "").slice(0, 150),
    matchedRules: matchedRules || [],
    score: score || 0,
  };

  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_LOGS) inMemoryLogs.pop();

  try {
    let logs = [];
    try {
      const data = await kvGet(GUARD_LOGS_KEY);
      if (Array.isArray(data)) logs = data;
    } catch {
      logs = inMemoryLogs;
    }
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.pop();
    await kvSet(GUARD_LOGS_KEY, logs);
  } catch {
    /* ignore */
  }

  return entry;
}

/**
 * Get list of recent blocked injection attempts
 */
export async function getBlockedAttemptLogs(limit = 10) {
  try {
    const data = await kvGet(GUARD_LOGS_KEY);
    if (Array.isArray(data)) {
      return data.slice(0, limit);
    }
  } catch {
    /* fallback */
  }
  return inMemoryLogs.slice(0, limit);
}

/**
 * Clear blocked injection logs
 */
export async function clearBlockedAttemptLogs() {
  inMemoryLogs = [];
  try {
    await kvSet(GUARD_LOGS_KEY, []);
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Scan a text for prompt injection heuristics
 *
 * @param {string} text - Input prompt to scan
 * @param {object} [options]
 * @returns {object} Scan result with score, matched rules, and flagged status
 */
export function scanPromptInjection(text, options = {}) {
  const clean = String(text || "").trim();
  if (!clean) {
    return {
      score: 0,
      isInjection: false,
      reasons: [],
      matchedRules: [],
      flaggedSnippets: [],
    };
  }

  let totalScore = 0;
  const matchedRules = [];
  const reasons = [];
  const flaggedSnippets = [];

  for (const rule of INJECTION_RULES) {
    for (const pattern of rule.patterns) {
      const match = clean.match(pattern);
      if (match) {
        totalScore += rule.weight;
        if (!matchedRules.includes(rule.code)) {
          matchedRules.push(rule.code);
          reasons.push(rule.name);
        }
        flaggedSnippets.push(match[0]);
        break; // Match rule once
      }
    }
  }

  // Cap score at 100
  const score = Math.min(100, totalScore);

  return {
    score,
    matchedRules,
    reasons,
    flaggedSnippets,
  };
}

/**
 * Check if a prompt should be blocked based on active guardrail policy
 *
 * @param {string} prompt - Raw user prompt
 * @param {object} context - { callerJid, chatJid, callerAdmin }
 * @returns {Promise<{ blocked: boolean, score: number, threshold: number, reasons: string[] }>}
 */
export async function checkPromptSafety(prompt, context = {}) {
  const config = await getGuardrailConfig();

  if (!config.enabled) {
    return { blocked: false, score: 0, threshold: 0, reasons: [] };
  }

  const scan = scanPromptInjection(prompt);
  const threshold = config.mode === "strict" ? 40 : 60;
  const isBlocked = scan.score >= threshold;

  if (isBlocked && config.logBlockedAttempts) {
    await recordBlockedAttempt({
      sender: context.callerJid,
      chat: context.chatJid,
      prompt,
      matchedRules: scan.reasons,
      score: scan.score,
    });
  }

  return {
    blocked: isBlocked,
    score: scan.score,
    threshold,
    reasons: scan.reasons,
    matchedRules: scan.matchedRules,
    flaggedSnippets: scan.flaggedSnippets,
  };
}

/**
 * Wrap and sanitize untrusted external content (user input, web search, scraped pages)
 * within explicit XML-like defensive isolation boundary tags.
 *
 * @param {string} content - Untrusted text
 * @param {string} label - Tag identifier (e.g. 'user_input', 'web_content', 'chat_history')
 * @param {object} [metadata] - Optional attributes
 * @returns {string} Boundary-sandboxed string
 */
export function sanitizeUntrustedContent(content, label = "user_input", metadata = {}) {
  if (content == null) return "";
  let text = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  // Neutralize breakout attempts
  text = text
    .replace(/<\/untrusted_[^>]+>/gi, "[ESCAPED_TAG_CLOSE]")
    .replace(/<untrusted_[^>]+>/gi, "[ESCAPED_TAG_OPEN]");

  const metaParts = Object.entries(metadata)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`);

  const attrStr = metaParts.length ? ` ${metaParts.join(" ")}` : "";

  return `<untrusted_${label}${attrStr}>\n${text}\n</untrusted_${label}>`;
}

/**
 * Scrub agent output before delivering to WhatsApp
 * Prevents accidental leaking of API keys, tokens, or system prompt fragments.
 *
 * @param {string} output - Raw response generated by the LLM
 * @param {Array<string>} [knownSecrets] - Optional explicit keys to redact
 * @returns {string} Sanitized output safe for public delivery
 */
export function scrubAgentOutput(output, knownSecrets = []) {
  if (!output || typeof output !== "string") return output;
  let clean = output;

  // Redact known secrets (e.g. API keys, URLs with embedded auth)
  for (const secret of knownSecrets) {
    if (secret && typeof secret === "string" && secret.trim().length >= 6) {
      const escaped = secret.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      clean = clean.replace(new RegExp(escaped, "g"), "[REDACTED_SECRET]");
    }
  }

  // Redact common API key patterns (OpenAI, Anthropic, HuggingFace, GitHub, generic Bearer)
  clean = clean
    .replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}/g, "[REDACTED_GIT_TOKEN]")
    .replace(/AIzaSy[a-zA-Z0-9_-]{33}/g, "[REDACTED_GOOGLE_API_KEY]");

  // Redact raw internal system tokens if model hallucinated them
  clean = clean
    .replace(/<\|im_start\|>|<\|im_end\|>|<<SYS>>|<<\/SYS>>/g, "")
    .replace(/\[INST\]|\[\/INST\]|\[SYSTEM\]|\[\/SYSTEM\]/g, "");

  // Prevent verbatim regurgitation of system prompt intro
  clean = clean.replace(
    /You are the fully autonomous AI agent for [^\n]+/gi,
    "[System operational prompt redacted]"
  );

  return clean;
}
