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
import { runAgentPrompt, getAgentConfig } from "./aiAgent.js";
import {
  fetchAvailableModels,
  getCachedDiscoveredModels,
  formatModelSelectionPrompt,
} from "./agentModels.js";
import { handleAdminConfirmation } from "./agentGuardrails.js";
import {
  getActivePersona,
  setPersona,
  PRESET_PERSONAS,
} from "./agentPersona.js";
import {
  addToKnowledgeBase,
  listKnowledgeBase,
  deleteFromKnowledgeBase,
  queryKnowledgeBase,
} from "./agentKnowledge.js";

command(
  {
    pattern: "agent",
    fromMe: false,
    desc: "Autonomous AI agent for group tasks and complex queries",
    usage: "#agent <natural_language_prompt>",
    params: {
      argsRequired: true,
      requiresQuoted: "optional",
      format: "<prompt>",
      description: "Natural language instruction or question for the AI agent.",
      examples: ["summarize last 10 messages", "lock group in 30m"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const prompt = (getCommandArgs(message.body, "agent") || "").trim();
    if (!prompt) {
      return await reply(
        conn,
        message,
        `🤖 *AUTONOMOUS AGENT LAYER*\n\n` +
          `Ask or instruct the bot naturally: \`@bot <request>\`\n\n` +
          `_Commands:_\n` +
          `• \`${BOT_INFO.PREFIX}agent <prompt>\` — Run an instruction\n` +
          `• \`${BOT_INFO.PREFIX}agentconfig\` — Endpoint, key & model\n` +
          `• \`${BOT_INFO.PREFIX}agentguard\` — Injection & safety guardrails\n` +
          `• \`${BOT_INFO.PREFIX}agentpersona\` — Tone & personality\n` +
          `• \`${BOT_INFO.PREFIX}agentkb\` — Knowledge Base (RAG)\n` +
          `• \`${BOT_INFO.PREFIX}agentmemory\` — Long-term memory\n` +
          `• \`${BOT_INFO.PREFIX}agenttasks\` — Scheduled autonomous jobs\n` +
          `• \`${BOT_INFO.PREFIX}agentwatchers\` — Real-time event watchers\n` +
          `• \`${BOT_INFO.PREFIX}confirm\` — Approve high-impact actions`
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
    usage: "#agentconfig <key|url|model|models|status> [value]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[key <api_key>|url <base_url>|model <model_id>|models|status]",
      description: "Configure AI provider settings or trigger model discovery.",
      examples: ["status", "models", "model llama-3.3-70b-versatile"],
    },
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
    usage: "#agentpersona [executive|strict-mod|witty|tutor|default|custom <prompt>]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[preset_name|custom <instructions>]",
      description: "Switch agent operational tone or set a custom personality prompt.",
      examples: ["strict-mod", "witty", "custom Speak like a pirate"],
    },
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
    usage: "#agentkb <list|add Title | Content|del id_or_title|search query>",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[list|add <title> | <content>|del <id_or_title>|search <query>]",
      description: "Add, search, delete, or list persistent Knowledge Base RAG entries.",
      examples: ["list", "add Rules | No spam allowed", "search rules"],
    },
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
    usage: "#confirm [action_id]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[confirm_id]",
      description: "Pass confirmation ID or leave empty to confirm latest pending high-risk action.",
      examples: [""],
    },
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
    usage: "#agentmemory [clear|reset]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[clear|reset]",
      description: "Leave empty to view stored memories, or pass 'clear' to wipe memories for this chat.",
      examples: ["", "clear"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const { getMemories, clearMemories } = await import("./agentMemory.js");
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
        `🧠 *AGENT MEMORY STORE*\n\n_No memories stored for this chat yet._`
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
    usage: "#agenttasks [cancel <task_id>]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[cancel <task_id>]",
      description: "Leave empty to list active scheduled tasks, or pass 'cancel <task_id>' to cancel one.",
      examples: ["", "cancel task_17325"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const { listScheduledTasks, cancelScheduledTask } = await import("./agentCron.js");
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
        `⏰ *AUTONOMOUS AGENT SCHEDULED TASKS*\n\n_No active scheduled tasks for this chat._`
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

// ==================== AGENT REAL-TIME EVENT WATCHERS ====================
command(
  {
    pattern: "agentwatchers",
    fromMe: false,
    desc: "Inspect or cancel active real-time event watchers",
    usage: "#agentwatchers [cancel <watcher_id>]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[cancel <watcher_id>]",
      description: "Leave empty to list active real-time event watchers, or pass 'cancel <watcher_id>' to remove one.",
      examples: ["", "cancel watch_17325"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const { listEventWatchers, cancelEventWatcher } = await import("./agentEvents.js");
    const raw = (getCommandArgs(message.body, "agentwatchers") || "").trim();
    const [sub, targetId] = raw.split(/\s+/);
    const chatJid = message.from;

    if (sub === "cancel" || sub === "del") {
      if (!targetId) {
        return await replyFail(
          conn,
          message,
          `Usage: \`${BOT_INFO.PREFIX}agentwatchers cancel <watcher_id>\``
        );
      }
      const ok = await cancelEventWatcher(targetId, chatJid);
      if (!ok) return await replyFail(conn, message, "Watcher not found or not in this chat.");
      return await replyOk(conn, message, `Event watcher \`${targetId}\` cancelled.`);
    }

    const watchers = await listEventWatchers(chatJid);
    if (!watchers.length) {
      return await reply(
        conn,
        message,
        `🎯 *ACTIVE EVENT WATCHERS*\n\n_No active event watchers registered in this chat._\n\n` +
          `Set watchers via AI prompt, e.g.:\n` +
          `> *"#ask unlock the group when @user leaves"*`
      );
    }

    let text = `🎯 *ACTIVE EVENT WATCHERS (${watchers.length}):*\n\n`;
    watchers.forEach((w, i) => {
      text += `*${i + 1}. [${w.eventType.toUpperCase()}] ${w.id}*\n`;
      if (w.targetUser) text += `   • Target User: \`${w.targetUser}\`\n`;
      if (w.matchPattern) text += `   • Pattern: \`${w.matchPattern}\`\n`;
      text += `   • Action: "${w.action}"\n`;
      if (w.linkedTaskId) text += `   • Linked Task: \`${w.linkedTaskId}\`\n`;
      text += `   • One-time: \`${w.once ? "Yes" : "No"}\`\n\n`;
    });
    text += `_To cancel a watcher: \`${BOT_INFO.PREFIX}agentwatchers cancel <watcher_id>\`_`;

    return await reply(conn, message, text);
  }
);

// ==================== PROMPT INJECTION GUARDRAILS COMMAND ====================
command(
  {
    pattern: "agentguard",
    fromMe: false,
    desc: "Inspect or configure AI prompt injection guardrails",
    usage: "#agentguard [status|on|off|mode strict|standard|logs|clearlogs|test <prompt>]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[status|on|off|mode <strict|standard>|logs|clearlogs|test <sample>]",
      description: "Configure prompt injection guardrails, inspect incident logs, or test a sample prompt.",
      examples: ["status", "mode strict", "logs"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const {
      getGuardrailConfig,
      setGuardrailConfig,
      getBlockedAttemptLogs,
      clearBlockedAttemptLogs,
      scanPromptInjection,
    } = await import("./agentInjectionGuard.js");

    const raw = (getCommandArgs(message.body, "agentguard") || "").trim();
    const [sub, ...rest] = raw.split(/\s+/);
    const subCmd = (sub || "").toLowerCase();
    const arg = rest.join(" ").trim();

    const privileged = await isPrivileged(message, conn);

    if (subCmd === "on" || subCmd === "enable") {
      if (!privileged) return await replyFail(conn, message, "Only bot owner / admins can change guardrail settings.");
      await setGuardrailConfig({ enabled: true });
      return await replyOk(conn, message, "AI Prompt Injection Guardrails are now *ENABLED*.");
    }

    if (subCmd === "off" || subCmd === "disable") {
      if (!privileged) return await replyFail(conn, message, "Only bot owner / admins can change guardrail settings.");
      await setGuardrailConfig({ enabled: false });
      return await replyOk(conn, message, "⚠️ AI Prompt Injection Guardrails are now *DISABLED*.");
    }

    if (subCmd === "mode") {
      if (!privileged) return await replyFail(conn, message, "Only bot owner / admins can change guardrail mode.");
      const mode = arg.toLowerCase();
      if (mode !== "strict" && mode !== "standard") {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentguard mode <strict|standard>\``);
      }
      await setGuardrailConfig({ mode });
      return await replyOk(
        conn,
        message,
        `Guardrail sensitivity mode set to *${mode.toUpperCase()}* (threshold: ${mode === "strict" ? "40" : "60"}/100).`
      );
    }

    if (subCmd === "logs") {
      const logs = await getBlockedAttemptLogs(10);
      if (!logs.length) {
        return await reply(conn, message, "🛡️ *No prompt injection attempts recorded yet.*");
      }
      let text = `🛡️ *RECENT BLOCKED INJECTION INCIDENTS (${logs.length}):*\n\n`;
      logs.forEach((l, i) => {
        text += `*${i + 1}. [${new Date(l.timestamp).toLocaleTimeString()}] Score: ${l.score}/100*\n`;
        text += `   • Sender: \`${l.sender}\`\n`;
        text += `   • Reasons: ${l.matchedRules?.join(", ") || "N/A"}\n`;
        text += `   • Snippet: "${l.promptSnippet}"\n\n`;
      });
      text += `_To clear logs: \`${BOT_INFO.PREFIX}agentguard clearlogs\`_`;
      return await reply(conn, message, text);
    }

    if (subCmd === "clearlogs") {
      if (!privileged) return await replyFail(conn, message, "Only bot owner / admins can clear security logs.");
      await clearBlockedAttemptLogs();
      return await replyOk(conn, message, "Guardrail incident logs cleared.");
    }

    if (subCmd === "test") {
      if (!arg) return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}agentguard test <sample prompt>\``);
      const scan = scanPromptInjection(arg);
      const cfg = await getGuardrailConfig();
      const threshold = cfg.mode === "strict" ? 40 : 60;
      const willBlock = cfg.enabled && scan.score >= threshold;

      let text = `🛡️ *GUARDRAIL SCAN DRY RUN:*\n\n`;
      text += `• *Status:* ${willBlock ? "🚨 *WOULD BE BLOCKED*" : "✅ *SAFE / ALLOWED*"}\n`;
      text += `• *Score:* \`${scan.score}/100\` (Threshold: ${threshold})\n`;
      text += `• *Active Mode:* \`${cfg.mode}\`\n`;
      if (scan.reasons.length) {
        text += `• *Detected Vectors:* ${scan.reasons.join(", ")}\n`;
      }
      if (scan.flaggedSnippets?.length) {
        text += `• *Matched Patterns:* \`${scan.flaggedSnippets.join("`, `")}\`\n`;
      }
      return await reply(conn, message, text);
    }

    // Default: Show guardrail status overview
    const cfg = await getGuardrailConfig();
    const threshold = cfg.mode === "strict" ? 40 : 60;

    let text = `🛡️ *AI PROMPT INJECTION GUARDRAILS*\n\n`;
    text += `• *Guardrails Active:* ${cfg.enabled ? "✅ YES" : "❌ NO"}\n`;
    text += `• *Sensitivity Mode:* \`${cfg.mode.toUpperCase()}\` (Score Threshold: ${threshold}/100)\n`;
    text += `• *Direct Jailbreak Defense:* ${cfg.blockDirectJailbreaks ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *System Leak Prevention:* ${cfg.blockSystemLeaks ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *Roleplay / DAN Filter:* ${cfg.blockRoleplayBypasses ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *Token Injection Filter:* ${cfg.blockTokenInjections ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *Boundary Tag Sandboxing:* ${cfg.sanitizeBoundaries ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *Output Secret Scrubber:* ${cfg.preventOutputLeaks ? "✅ Active" : "❌ Disabled"}\n`;
    text += `• *Audit Logging:* ${cfg.logBlockedAttempts ? "✅ Active" : "❌ Disabled"}\n\n`;

    text += `_Commands:_\n`;
    text += `• \`${BOT_INFO.PREFIX}agentguard on\` / \`off\` — Toggle guardrails\n`;
    text += `• \`${BOT_INFO.PREFIX}agentguard mode strict|standard\` — Set sensitivity\n`;
    text += `• \`${BOT_INFO.PREFIX}agentguard logs\` — View blocked injection attempts\n`;
    text += `• \`${BOT_INFO.PREFIX}agentguard clearlogs\` — Clear audit log\n`;
    text += `• \`${BOT_INFO.PREFIX}agentguard test <prompt>\` — Test prompt against scanner`;

    return await reply(conn, message, text);
  }
);
