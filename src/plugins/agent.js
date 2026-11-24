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
        `🤖 *AUTONOMOUS AGENT LAYER*\n\n` +
          `Prompt the autonomous agent to inspect, manage, browse, calculate, or schedule tasks in this chat.\n\n` +
          `*Capabilities & Examples:*\n` +
          `• *Smart Moderation:* \`@bot can you kick everyone whose number starts with 63 and their digits sum to 67?\`\n` +
          `• *Autonomous Cron:* \`@bot every day at 8 AM search AI news and post a summary\`\n` +
          `• *Live Web Search:* \`@bot search who won today's football match and summarize\`\n` +
          `• *Code Execution:* \`@bot calculate the first 30 prime numbers\`\n` +
          `• *Generative Visuals:* \`@bot generate an image of a cyberpunk city at night\`\n` +
          `• *Multi-Modal Vision:* Reply to any photo with \`@bot what is written here?\`\n` +
          `• *Long-Term Memory:* \`@bot remember that quiet hours start at 10 PM\`\n\n` +
          `_Commands:_\n` +
          `• \`${BOT_INFO.PREFIX}agent <prompt>\` / \`${BOT_INFO.PREFIX}ask <prompt>\`\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig\` — Set API key, URL, and model\n` +
          `• \`${BOT_INFO.PREFIX}agentmemory\` — View or reset long-term memories\n` +
          `• \`${BOT_INFO.PREFIX}agenttasks\` — Inspect or cancel scheduled autonomous jobs`
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

// ==================== AGENT MEMORY BROWSER ====================
command(
  {
    pattern: "agentmemory",
    fromMe: false,
    desc: "Inspect or clear persistent memories stored by the agent",
    type: "tools",
  },
  async (message, conn) => {
    const { getMemories, clearMemories } = await import("../agent/agentMemory.js");
    const raw = (getCommandArgs(message.body, "agentmemory") || "").trim().toLowerCase();
    const scope = message.isGroup ? message.from : "global";

    if (raw === "clear" || raw === "reset") {
      const privileged = await isPrivileged(message, conn);
      if (!privileged && message.isGroup) {
        return await replyFail(conn, message, "Only group admins can clear memory.");
      }
      await clearMemories(scope);
      return await replyOk(conn, message, "Agent memories cleared for this chat.");
    }

    const memories = await getMemories(scope);
    if (!memories.length) {
      return await reply(
        conn,
        message,
        `🧠 *AGENT MEMORY STORE*\n\n_No memories stored for this chat yet._\n\nPrompt the agent to remember facts or rules, e.g.:\n\`@bot remember that quiet hours begin at 10 PM\``
      );
    }

    let text = `🧠 *STORED AGENT MEMORIES (${memories.length}):*\n\n`;
    memories.forEach((m, idx) => {
      text += `*${idx + 1}. [${m.category}] ${m.key}*\n   > ${m.value}\n`;
    });
    text += `\n_To reset memories: \`${BOT_INFO.PREFIX}agentmemory clear\`_`;

    return await reply(conn, message, text);
  }
);

// ==================== AGENT AUTONOMOUS TASKS BROWSER ====================
command(
  {
    pattern: "agenttasks",
    fromMe: false,
    desc: "Inspect or cancel scheduled autonomous agent cron jobs",
    type: "tools",
  },
  async (message, conn) => {
    const { listScheduledTasks, cancelScheduledTask } = await import("../agent/agentCron.js");
    const raw = (getCommandArgs(message.body, "agenttasks") || "").trim();
    const [sub, targetId] = raw.split(/\s+/);
    const chatJid = message.from;

    if (sub === "cancel" || sub === "del") {
      if (!targetId) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agenttasks cancel <task_id>\``);
      const ok = await cancelScheduledTask(targetId, chatJid);
      if (!ok) return await replyFail(conn, message, "Task not found or not in this chat.");
      return await replyOk(conn, message, `Autonomous task \`${targetId}\` cancelled.`);
    }

    const tasks = await listScheduledTasks(chatJid);
    if (!tasks.length) {
      return await reply(
        conn,
        message,
        `⏰ *AUTONOMOUS AGENT SCHEDULED TASKS*\n\n_No active scheduled tasks for this chat._\n\n` +
          `You can schedule autonomous tasks directly with natural language, e.g.:\n` +
          `• \`@bot every day at 8 AM check for foreign numbers and kick them\`\n` +
          `• \`@bot in 30 minutes unmute the group and announce morning greetings\``
      );
    }

    let text = `⏰ *ACTIVE AUTONOMOUS TASKS (${tasks.length}):*\n\n`;
    tasks.forEach((t, i) => {
      text += `*${i + 1}. [${t.scheduleType.toUpperCase()}] ${t.id}*\n`;
      text += `   • Next Run: \`${new Date(t.nextRunAt).toLocaleString()}\`\n`;
      if (t.cronExpression) text += `   • Cron: \`${t.cronExpression}\`\n`;
      text += `   • Prompt: "${t.taskPrompt}"\n\n`;
    });
    text += `_To cancel a task: \`${BOT_INFO.PREFIX}agenttasks cancel <task_id>\`_`;

    return await reply(conn, message, text);
  }
);
