/**
 * Agentic AI Plugin
 * Autonomous multi-step tool calling agent with OpenAI-compatible API backend.
 *
 * @module plugins/agent
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { isPrivileged } from "../utils/access.js";
import { runAgentPrompt, getAgentConfig } from "../agent/aiAgent.js";

command(
  {
    pattern: "agent",
    fromMe: false,
    desc: "Autonomous AI agent for group tasks and complex queries",
    type: "tools",
  },
  async (message, conn) => {
    const prompt = (getCommandArgs(message.body, "agent") || "").trim();
    if (!prompt) {
      return await reply(
        conn,
        message,
        `🤖 *AGENTIC AI LAYER*\n\n` +
          `Prompt the autonomous agent to inspect, manage, or perform complex tasks in this chat.\n\n` +
          `*Examples:*\n` +
          `• \`${BOT_INFO.PREFIX}agent can you kick everyone whose number starts with 63 and their sum of digits adds up to 67?\`\n` +
          `• \`${BOT_INFO.PREFIX}agent mute the group and announce that quiet hours have started\`\n` +
          `• \`${BOT_INFO.PREFIX}agent how many admins are in this group and who created it?\`\n` +
          `• \`${BOT_INFO.PREFIX}agent find all members from USA (+1) in this group\`\n\n` +
          `_You can also trigger it without prefix simply by tagging the bot:_\n` +
          `\`@bot can you kick everyone whose number starts with 63 and their sum of digits adds up to 67\``
      );
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "🤖");
        const response = await runAgentPrompt({ prompt, message, conn });
        await reply(conn, message, response);
      } catch (err) {
        await ackCommand(conn, message, "❌");
        await replyFail(conn, message, `Agent error: ${err?.message || err}`);
      }
    }, { timeoutMs: 120_000 });
  }
);

// Alias: ask
command(
  {
    pattern: "ask",
    fromMe: false,
    desc: "Alias for #agent",
    type: "tools",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "ask") || "").trim();
    message.body = `${BOT_INFO.PREFIX}agent ${raw}`.trim();
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}agent`);
    if (cmd?.function) await cmd.function(message, conn);
  }
);

// ==================== AGENT CONFIGURATION ====================
command(
  {
    pattern: "agentconfig",
    fromMe: true,
    desc: "Configure OpenAI-compatible API key, Base URL, and Model for Agent",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can configure the AI Agent.");
    }

    const raw = (getCommandArgs(message.body, "agentconfig") || "").trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const value = rest.join(" ").trim();

    if (!raw || sub === "status") {
      const config = await getAgentConfig();
      const maskedKey = config.apiKey
        ? config.apiKey.slice(0, 6) + "..." + config.apiKey.slice(-4)
        : "None (Not configured)";

      return await reply(
        conn,
        message,
        `🤖 *AI AGENT CONFIGURATION*\n\n` +
          `• *API Key:* \`${maskedKey}\`\n` +
          `• *Base URL:* \`${config.baseUrl}\`\n` +
          `• *Model:* \`${config.model}\`\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig key <api_key>\`\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig url <base_url>\`\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig model <model_name>\`\n\n` +
          `_Compatible with OpenAI, Groq, OpenRouter, DeepSeek, Together, Ollama, LM Studio, etc._`
      );
    }

    if (sub === "key") {
      if (!value) return await replyFail(conn, message, "Please provide the API key.");
      await kvSet("ai_api_key", value);
      return await replyOk(conn, message, "AI Agent API key updated successfully!");
    }

    if (sub === "url" || sub === "endpoint") {
      if (!value) return await replyFail(conn, message, "Please provide the Base URL (e.g. `https://api.groq.com/openai/v1`).");
      await kvSet("ai_base_url", value);
      return await replyOk(conn, message, `AI Agent Base URL set to: \`${value}\``);
    }

    if (sub === "model") {
      if (!value) return await replyFail(conn, message, "Please provide model name (e.g. `llama-3.3-70b-versatile` or `gpt-4o-mini`).");
      await kvSet("ai_model", value);
      return await replyOk(conn, message, `AI Agent model set to: \`${value}\``);
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentconfig [key|url|model|status]\``);
  }
);
