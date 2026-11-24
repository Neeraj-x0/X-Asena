/**
 * Agentic AI Plugin
 * Autonomous multi-step tool calling agent with OpenAI-compatible API backend,
 * model auto-discovery, persistent memory, subagents, planning, and safety guardrails.
 *
 * @module plugins/agent
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { isPrivileged } from "../utils/access.js";
import { runAgentPrompt, getAgentConfig } from "../agent/aiAgent.js";
import {
  fetchAvailableModels,
  getCachedDiscoveredModels,
  formatModelSelectionPrompt,
} from "../agent/agentModels.js";
import { handleAdminConfirmation } from "../agent/agentGuardrails.js";
import {
  getActivePersona,
  setPersona,
  PRESET_PERSONAS,
} from "../agent/agentPersona.js";
import {
  addToKnowledgeBase,
  listKnowledgeBase,
  deleteFromKnowledgeBase,
  queryKnowledgeBase,
} from "../agent/agentKnowledge.js";

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
          `• *Multi-Agent Swarm:* \`@bot delegate to researcher to find latest Baileys features\`\n` +
          `• *Autonomous Planning:* \`@bot create a plan to audit this group and execute it\`\n` +
          `• *Knowledge Base (RAG):* \`@bot what are the refund guidelines in our knowledge base?\`\n` +
          `• *Generative Visuals:* \`@bot generate an image of a cyberpunk city at night\`\n` +
          `• *Multi-Modal Vision:* Reply to any photo with \`@bot what is written here?\`\n` +
          `• *Long-Term Memory:* \`@bot remember that quiet hours start at 10 PM\`\n\n` +
          `_Commands:_\n` +
          `• \`${BOT_INFO.PREFIX}agent <prompt>\` / \`${BOT_INFO.PREFIX}ask <prompt>\`\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig\` — Set API key, URL, and model\n` +
          `• \`${BOT_INFO.PREFIX}agentpersona\` — Configure agent operational persona\n` +
          `• \`${BOT_INFO.PREFIX}agentkb\` — Manage verified Knowledge Base articles\n` +
          `• \`${BOT_INFO.PREFIX}agentmemory\` — View or reset long-term memories\n` +
          `• \`${BOT_INFO.PREFIX}agenttasks\` — Inspect or cancel scheduled autonomous jobs\n` +
          `• \`${BOT_INFO.PREFIX}confirm\` — Confirm high-risk actions (safety guardrail)`
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

// ==================== AGENT CONFIGURATION & AUTO-MODEL DISCOVERY ====================
command(
  {
    pattern: "agentconfig",
    fromMe: true,
    desc: "Configure OpenAI-compatible API key, Base URL, and discover models",
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

    const config = await getAgentConfig();

    if (!raw || sub === "status") {
      const maskedKey = config.apiKey
        ? config.apiKey.slice(0, 6) + "..." + config.apiKey.slice(-4)
        : "None (Not configured)";

      return await reply(
        conn,
        message,
        `🤖 *AI AGENT CONFIGURATION*\n\n` +
          `• *API Key:* \`${maskedKey}\`\n` +
          `• *Base URL:* \`${config.baseUrl}\`\n` +
          `• *Default Model:* \`${config.model}\`\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig key <api_key>\` — Set API key\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig url <base_url>\` — Set endpoint Base URL\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig model <name|number>\` — Set default model\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig models\` — Query endpoint for available models\n\n` +
          `_Compatible with OpenAI, Groq, OpenRouter, DeepSeek, Together, Ollama, LM Studio, etc._`
      );
    }

    // Setting API Key
    if (sub === "key") {
      if (!value) return await replyFail(conn, message, "Please provide the API key.");
      await kvSet("ai_api_key", value);

      const targetUrl = config.baseUrl;
      let extraText = "AI Agent API key updated successfully!";

      // If URL is also present, immediately query endpoint for available models
      if (targetUrl) {
        try {
          const models = await fetchAvailableModels(targetUrl, value);
          if (models.length) {
            extraText += `\n\n` + formatModelSelectionPrompt(models, config.model);
            return await reply(conn, message, `✅ ${extraText}`);
          }
        } catch (modelErr) {
          extraText += `\n\n⚠️ Could not query models from \`${targetUrl}\`: ${modelErr?.message || modelErr}`;
        }
      }

      return await replyOk(conn, message, extraText);
    }

    // Setting Base URL
    if (sub === "url" || sub === "endpoint") {
      if (!value) return await replyFail(conn, message, "Please provide the Base URL (e.g. `https://api.groq.com/openai/v1`).");
      await kvSet("ai_base_url", value);

      const targetKey = config.apiKey;
      let extraText = `AI Agent Base URL set to: \`${value}\``;

      // If Key is also present, immediately query endpoint for available models
      if (targetKey) {
        try {
          const models = await fetchAvailableModels(value, targetKey);
          if (models.length) {
            extraText += `\n\n` + formatModelSelectionPrompt(models, config.model);
            return await reply(conn, message, `✅ ${extraText}`);
          }
        } catch (modelErr) {
          extraText += `\n\n⚠️ Could not query models from \`${value}\`: ${modelErr?.message || modelErr}`;
        }
      }

      return await replyOk(conn, message, extraText);
    }

    // List/query available models
    if (sub === "models" || sub === "discover") {
      if (!config.apiKey || !config.baseUrl) {
        return await replyFail(conn, message, "Both API Key and Base URL must be set first.");
      }
      try {
        await ackCommand(conn, message, "⏳");
        const models = await fetchAvailableModels(config.baseUrl, config.apiKey);
        await ackCommand(conn, message, "🤖");
        return await reply(conn, message, formatModelSelectionPrompt(models, config.model));
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to query models: ${err?.message || err}`);
      }
    }

    // Choose default model (by name or by number from discovered list)
    if (sub === "model") {
      if (!value) return await replyFail(conn, message, "Please provide model name or number.");

      let chosenModel = value;

      // Check if number was provided e.g. "1" or "3"
      if (/^\d+$/.test(value)) {
        const num = parseInt(value, 10);
        const cached = await getCachedDiscoveredModels();
        if (cached && cached[num - 1]) {
          chosenModel = cached[num - 1];
        } else {
          return await replyFail(
            conn,
            message,
            `Model number ${num} is out of range. Run \`${BOT_INFO.PREFIX}agentconfig models\` to see options.`
          );
        }
      }

      await kvSet("ai_model", chosenModel);
      return await replyOk(conn, message, `AI Agent default model set to: *${chosenModel}*`);
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentconfig [key|url|models|model|status]\``);
  }
);

// ==================== DYNAMIC AGENT PERSONA ====================
command(
  {
    pattern: "agentpersona",
    fromMe: false,
    desc: "Configure agent personality tone (executive|strict-mod|witty|tutor|default)",
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "agentpersona") || "").trim();
    const scope = message.isGroup ? message.from : "global";
    const current = await getActivePersona(scope);

    if (!raw) {
      let text = `🎭 *AGENT PERSONA & TONE PROFILES*\n\n`;
      text += `• *Current Persona:* *${current.name}* (\`${current.id}\`)\n`;
      text += `• *Prompt:* "${current.prompt.slice(0, 150)}..."\n\n`;
      text += `*Available Preset Profiles:*\n`;
      for (const [key, p] of Object.entries(PRESET_PERSONAS)) {
        text += `• \`${BOT_INFO.PREFIX}agentpersona ${key}\` — *${p.name}*\n`;
      }
      text += `• \`${BOT_INFO.PREFIX}agentpersona custom <your prompt>\` — Set custom personality`;
      return await reply(conn, message, text);
    }

    const privileged = await isPrivileged(message, conn);
    if (!privileged && message.isGroup) {
      return await replyFail(conn, message, "Only group admins can change the agent persona for this group.");
    }

    const [preset, ...customWords] = raw.split(/\s+/);
    const customPrompt = customWords.join(" ").trim();

    if (preset.toLowerCase() === "custom") {
      if (!customPrompt) return await replyFail(conn, message, "Please provide the custom persona instructions.");
      const updated = await setPersona(scope, customPrompt);
      return await replyOk(conn, message, `Agent custom persona set: "${customPrompt.slice(0, 80)}..."`);
    }

    if (PRESET_PERSONAS[preset.toLowerCase()]) {
      const updated = await setPersona(scope, preset.toLowerCase());
      return await replyOk(conn, message, `Agent persona updated to: *${updated.name}*`);
    }

    return await replyFail(conn, message, `Unknown preset. Options: ${Object.keys(PRESET_PERSONAS).join(", ")}`);
  }
);

// ==================== KNOWLEDGE BASE (RAG) ====================
command(
  {
    pattern: "agentkb",
    fromMe: false,
    desc: "Manage verified Knowledge Base articles (add|list|del|search)",
    type: "tools",
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "agentkb") || "").trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const scope = message.isGroup ? message.from : "global";
    const privileged = await isPrivileged(message, conn);

    if (!raw || sub === "list") {
      const articles = await listKnowledgeBase(scope);
      if (!articles.length) {
        return await reply(
          conn,
          message,
          `📚 *KNOWLEDGE BASE STORE*\n\n_No articles in knowledge base for this chat yet._\n\n` +
            `Add community rules or FAQs using:\n` +
            `\`${BOT_INFO.PREFIX}agentkb add <Title> | <Content>\``
        );
      }
      let text = `📚 *KNOWLEDGE BASE ARTICLES (${articles.length}):*\n\n`;
      articles.forEach((a, i) => {
        text += `*${i + 1}. [${a.category}] ${a.title}*\n`;
        text += `   • ID: \`${a.id}\`\n`;
        text += `   • Content: ${a.content.slice(0, 100)}...\n\n`;
      });
      return await reply(conn, message, text);
    }

    if (sub === "add") {
      if (!privileged && message.isGroup) {
        return await replyFail(conn, message, "Only group admins can add knowledge base articles.");
      }
      const payload = rest.join(" ").trim();
      if (!payload.includes("|")) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentkb add Title Here | Full content here\``);
      }
      const [title, ...contentParts] = payload.split("|");
      const content = contentParts.join("|").trim();
      const article = await addToKnowledgeBase({
        title: title.trim(),
        content,
        scope,
        author: message.sender,
      });
      return await replyOk(conn, message, `Added article *"${article.title}"* to Knowledge Base!`);
    }

    if (sub === "del" || sub === "delete") {
      if (!privileged && message.isGroup) {
        return await replyFail(conn, message, "Admin only.");
      }
      const target = rest.join(" ").trim();
      if (!target) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentkb del <id_or_title>\``);
      const ok = await deleteFromKnowledgeBase(target, scope);
      if (!ok) return await replyFail(conn, message, "Article not found.");
      return await replyOk(conn, message, `Article removed from Knowledge Base.`);
    }

    if (sub === "search") {
      const q = rest.join(" ").trim();
      if (!q) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentkb search <query>\``);
      const matches = await queryKnowledgeBase({ query: q, scope });
      if (!matches.length) return await reply(conn, message, `No matching articles found for "${q}".`);
      let text = `🔍 *KNOWLEDGE BASE SEARCH RESULTS (${matches.length}):*\n\n`;
      matches.forEach((m) => {
        text += `• *${m.title}:*\n> ${m.content}\n\n`;
      });
      return await reply(conn, message, text);
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentkb [add|list|del|search]\``);
  }
);

// ==================== HUMAN CONFIRMATION GUARDRAIL ====================
command(
  {
    pattern: "confirm",
    fromMe: false,
    desc: "Confirm a high-risk mass action triggered by the AI agent",
    type: "admin",
    groupOnly: true,
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "confirm") || "").trim();
    const handled = await handleAdminConfirmation({ message, conn, confirmId: raw || null });
    if (!handled) {
      await replyFail(conn, message, "No pending high-risk action found for confirmation or it has expired.");
    }
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
