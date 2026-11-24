/**
 * Subagent Swarm Delegation Engine
 * Spawns specialized subagents (researcher, coder, moderator, analyst, summarizer)
 * to tackle delegated sub-tasks in parallel or sequence.
 *
 * @module agent/agentSubagents
 */

import { getAgentConfig } from "./aiAgent.js";
import { searchWeb, fetchWebpage } from "./agentWeb.js";
import { executeSandboxCode } from "./agentCode.js";

const SUBAGENT_ROLES = {
  researcher: {
    title: "Deep Web Researcher",
    instructions:
      "You are a specialized Web Researcher subagent. Your job is to search the web, read pages, and extract comprehensive, verified facts. Be objective, thorough, and cite URLs.",
    tools: ["web_search", "fetch_webpage"],
  },
  coder: {
    title: "Algorithm & Data Engineer",
    instructions:
      "You are a specialized Coding & Math subagent. Your job is to design algorithms, write clean JavaScript code, execute it in the sandbox, and verify calculations deterministically.",
    tools: ["run_code"],
  },
  moderator: {
    title: "Security & Moderation Specialist",
    instructions:
      "You are a strict Community Moderation subagent. Your job is to assess compliance, identify bad actors, review member lists, and recommend firm actions based on rules.",
    tools: ["get_group_members", "filter_group_members"],
  },
  summarizer: {
    title: "Information Synthesizer",
    instructions:
      "You are an expert Summarization subagent. Your job is to condense long texts, transcripts, or debates into clear, bullet-pointed executive summaries without losing key details.",
    tools: [],
  },
  analyst: {
    title: "Critical Strategic Analyst",
    instructions:
      "You are a Strategic Analyst subagent. Your job is to evaluate multi-perspective dilemmas, weigh pros and cons, detect logical fallacies, and provide optimal recommendations.",
    tools: ["run_code", "web_search"],
  },
};

/**
 * Execute a delegated sub-task using a specialized subagent persona
 */
export async function executeSubagentTask({ role = "analyst", taskPrompt, parentContext }) {
  const config = await getAgentConfig();
  if (!config.apiKey) {
    return { error: "AI Agent API key not configured." };
  }

  const roleMeta = SUBAGENT_ROLES[role.toLowerCase()] || SUBAGENT_ROLES.analyst;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const systemMessage =
    `[SPECIALIZED SUBAGENT: ${roleMeta.title.toUpperCase()}]\n` +
    `${roleMeta.instructions}\n\n` +
    `You are working as part of an autonomous multi-agent swarm coordinated by X-Asena.\n` +
    `Complete the delegated sub-task thoroughly and return your focused findings to the coordinator.`;

  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: taskPrompt },
  ];

  try {
    const payload = {
      model: config.model,
      messages,
      temperature: 0.3,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { error: `Subagent (${role}) failed with status ${res.status}: ${err.slice(0, 100)}` };
    }

    const data = await res.json();
    const result = data.choices?.[0]?.message?.content || "Subagent finished without text.";

    return {
      role: roleMeta.title,
      taskPrompt,
      findings: result,
    };
  } catch (err) {
    return { error: `Subagent (${role}) error: ${err?.message || err}` };
  }
}
