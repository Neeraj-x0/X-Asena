/**
 * Agentic AI Layer for X-Asena
 * Provides autonomous tool-calling AI agent powered by any OpenAI-compatible API.
 * Supports natural language group management, complex conditional filtering, and task execution.
 *
 * @module agent/aiAgent
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { groupCache } from "../utils/cache.js";
import { isAdmin, isBotAdmin, displayId } from "../utils/group.js";
import { isPrivileged, normalizeNumber } from "../utils/access.js";
import { BOT_INFO } from "../config/constants.js";

/**
 * Get active AI Agent configuration from KV or environment
 */
export async function getAgentConfig() {
  const apiKey =
    (await kvGet("ai_api_key")) ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const baseUrl =
    (await kvGet("ai_base_url")) ||
    process.env.AI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1";
  const model =
    (await kvGet("ai_model")) ||
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  return { apiKey, baseUrl, model };
}

/**
 * Calculate digit sum of a phone number string
 */
export function getDigitSum(numStr) {
  return String(numStr || "")
    .replace(/\D/g, "")
    .split("")
    .reduce((sum, d) => sum + parseInt(d, 10), 0);
}

/**
 * Available tool definitions for OpenAI-compatible function calling
 */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_group_members",
      description:
        "Retrieve the list of all participants in the current group, including their JID, phone number, push name, and admin status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "filter_group_members",
      description:
        "Deterministically filter group members using precise criteria (e.g. startsWith country code, digitSum of phone number, admin status, or custom JavaScript condition).",
      parameters: {
        type: "object",
        properties: {
          startsWith: {
            type: "string",
            description: "Phone number prefix or country code (e.g. '63' for Philippines, '1' for USA)",
          },
          endsWith: {
            type: "string",
            description: "Phone number suffix to match",
          },
          digitSumEquals: {
            type: "number",
            description: "Exact sum of all digits in the phone number (e.g. 67)",
          },
          digitSumGreaterThan: {
            type: "number",
            description: "Phone number digit sum must be strictly greater than this value",
          },
          digitSumLessThan: {
            type: "number",
            description: "Phone number digit sum must be strictly less than this value",
          },
          isAdmin: {
            type: "boolean",
            description: "Filter by admin status (true = only admins, false = only non-admins)",
          },
          customCondition: {
            type: "string",
            description:
              "Optional JS condition evaluated against participant object 'p' (e.g. `p.phoneNumber.startsWith('63') && p.digitSum === 67`)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kick_members",
      description:
        "Remove / kick participants from the group. STRICT SECURITY: Caller must be a Group Admin or Bot Owner, and Bot must be an Admin.",
      parameters: {
        type: "object",
        properties: {
          members: {
            type: "array",
            items: { type: "string" },
            description: "Array of participant JIDs to remove (e.g. ['639123456789@s.whatsapp.net'])",
          },
          reason: {
            type: "string",
            description: "Brief reason for removal",
          },
        },
        required: ["members"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "promote_members",
      description: "Promote participants to group admins. STRICT SECURITY: Caller and Bot must be admins.",
      parameters: {
        type: "object",
        properties: {
          members: {
            type: "array",
            items: { type: "string" },
            description: "Array of participant JIDs to promote",
          },
        },
        required: ["members"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demote_members",
      description: "Demote group admins to regular members. STRICT SECURITY: Caller and Bot must be admins.",
      parameters: {
        type: "object",
        properties: {
          members: {
            type: "array",
            items: { type: "string" },
            description: "Array of admin JIDs to demote",
          },
        },
        required: ["members"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mute_group",
      description: "Close group chat so only admins can send messages. STRICT SECURITY: Caller must be admin.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unmute_group",
      description: "Open group chat so all participants can send messages. STRICT SECURITY: Caller must be admin.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_group_subject",
      description: "Change the group title / name. STRICT SECURITY: Caller must be admin.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "New title for the group" },
        },
        required: ["subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_group_description",
      description: "Change the group description. STRICT SECURITY: Caller must be admin.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "New group description text" },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_group_info",
      description: "Get group metadata: subject, creation date, creator, description, and participant count.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_group_message",
      description: "Send an announcement, notification, or alert message to the current chat.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text message to deliver" },
          mentions: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of user JIDs to mention",
          },
        },
        required: ["text"],
      },
    },
  },
];

/**
 * Execute a tool requested by the AI agent
 */
export async function executeAgentTool(name, args, context) {
  const { message, conn, groupJid, callerJid, isGroup, callerAdmin, botAdmin } = context;

  if (name === "get_group_members") {
    if (!isGroup) return { error: "This tool can only be used in a WhatsApp group." };
    let meta = groupCache.get(groupJid);
    if (!meta) {
      meta = await conn.groupMetadata(groupJid);
      groupCache.set(groupJid, meta);
    }
    const members = (meta.participants || []).map((p) => {
      const jid = p.id;
      const phoneNumber = normalizeNumber(jid);
      return {
        jid,
        phoneNumber,
        isAdmin: p.admin === "admin" || p.admin === "superadmin",
        digitSum: getDigitSum(phoneNumber),
      };
    });
    return {
      total: members.length,
      members,
    };
  }

  if (name === "filter_group_members") {
    if (!isGroup) return { error: "This tool can only be used in a WhatsApp group." };
    let meta = groupCache.get(groupJid);
    if (!meta) {
      meta = await conn.groupMetadata(groupJid);
      groupCache.set(groupJid, meta);
    }

    const {
      startsWith,
      endsWith,
      digitSumEquals,
      digitSumGreaterThan,
      digitSumLessThan,
      isAdmin: adminFilter,
      customCondition,
    } = args;

    const all = (meta.participants || []).map((p) => {
      const jid = p.id;
      const phoneNumber = normalizeNumber(jid);
      const isAdm = p.admin === "admin" || p.admin === "superadmin";
      const digitSum = getDigitSum(phoneNumber);
      return { jid, phoneNumber, isAdmin: isAdm, digitSum };
    });

    const filtered = all.filter((p) => {
      if (startsWith && !p.phoneNumber.startsWith(startsWith)) return false;
      if (endsWith && !p.phoneNumber.endsWith(endsWith)) return false;
      if (typeof digitSumEquals === "number" && p.digitSum !== digitSumEquals) return false;
      if (typeof digitSumGreaterThan === "number" && p.digitSum <= digitSumGreaterThan) return false;
      if (typeof digitSumLessThan === "number" && p.digitSum >= digitSumLessThan) return false;
      if (typeof adminFilter === "boolean" && p.isAdmin !== adminFilter) return false;

      if (customCondition && typeof customCondition === "string") {
        try {
          // Safe evaluation with bounded scope
          const fn = new Function("p", `return Boolean(${customCondition});`);
          if (!fn(p)) return false;
        } catch {
          /* ignore filter error */
        }
      }
      return true;
    });

    return {
      matchedCount: filtered.length,
      matchedMembers: filtered,
    };
  }

  if (name === "kick_members") {
    if (!isGroup) return { error: "Can only kick members in a group." };
    if (!callerAdmin) {
      return {
        error: "PERMISSION DENIED: The user commanding this action is not a group admin or bot owner.",
      };
    }
    if (!botAdmin) {
      return {
        error: "PERMISSION DENIED: The bot is not an administrator in this group and cannot remove members.",
      };
    }

    const targets = Array.isArray(args.members) ? args.members : [args.members];
    const botJid = conn.user?.id ? normalizeNumber(conn.user.id.replace(/:\d+@/, "@")) : "";

    // Protect bot and caller
    const validTargets = targets.filter((j) => {
      const num = normalizeNumber(j);
      return num && num !== botJid && j !== callerJid;
    });

    if (!validTargets.length) {
      return { error: "No valid participants to remove." };
    }

    try {
      await conn.groupParticipantsUpdate(groupJid, validTargets, "remove");
      groupCache.delete(groupJid);
      return {
        success: true,
        removedCount: validTargets.length,
        removedJids: validTargets,
        reason: args.reason || "Kicked by admin agent command",
      };
    } catch (err) {
      return { error: `Failed to remove members: ${err?.message || err}` };
    }
  }

  if (name === "promote_members") {
    if (!isGroup) return { error: "Can only promote members in a group." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not a group admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    const targets = Array.isArray(args.members) ? args.members : [args.members];
    try {
      await conn.groupParticipantsUpdate(groupJid, targets, "promote");
      groupCache.delete(groupJid);
      return { success: true, promoted: targets };
    } catch (err) {
      return { error: `Promote failed: ${err?.message || err}` };
    }
  }

  if (name === "demote_members") {
    if (!isGroup) return { error: "Can only demote members in a group." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not a group admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    const targets = Array.isArray(args.members) ? args.members : [args.members];
    try {
      await conn.groupParticipantsUpdate(groupJid, targets, "demote");
      groupCache.delete(groupJid);
      return { success: true, demoted: targets };
    } catch (err) {
      return { error: `Demote failed: ${err?.message || err}` };
    }
  }

  if (name === "mute_group") {
    if (!isGroup) return { error: "Group only." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not an admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    try {
      await conn.groupSettingUpdate(groupJid, "announcement");
      return { success: true, status: "muted (announcement only)" };
    } catch (err) {
      return { error: err?.message || err };
    }
  }

  if (name === "unmute_group") {
    if (!isGroup) return { error: "Group only." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not an admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    try {
      await conn.groupSettingUpdate(groupJid, "not_announcement");
      return { success: true, status: "unmuted (all participants can chat)" };
    } catch (err) {
      return { error: err?.message || err };
    }
  }

  if (name === "set_group_subject") {
    if (!isGroup) return { error: "Group only." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not an admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    try {
      await conn.groupUpdateSubject(groupJid, args.subject);
      groupCache.delete(groupJid);
      return { success: true, newSubject: args.subject };
    } catch (err) {
      return { error: err?.message || err };
    }
  }

  if (name === "set_group_description") {
    if (!isGroup) return { error: "Group only." };
    if (!callerAdmin) return { error: "PERMISSION DENIED: Caller is not an admin." };
    if (!botAdmin) return { error: "PERMISSION DENIED: Bot is not an admin." };

    try {
      await conn.groupUpdateDescription(groupJid, args.description);
      groupCache.delete(groupJid);
      return { success: true, newDescription: args.description };
    } catch (err) {
      return { error: err?.message || err };
    }
  }

  if (name === "get_group_info") {
    if (!isGroup) return { error: "Group only." };
    let meta = groupCache.get(groupJid);
    if (!meta) {
      meta = await conn.groupMetadata(groupJid);
      groupCache.set(groupJid, meta);
    }
    return {
      subject: meta.subject,
      description: meta.desc,
      owner: meta.owner,
      participantCount: meta.participants?.length || 0,
      creation: meta.creation ? new Date(meta.creation * 1000).toISOString() : null,
    };
  }

  if (name === "send_group_message") {
    try {
      await conn.sendMessage(groupJid, {
        text: args.text,
        mentions: args.mentions || [],
      });
      return { success: true, sent: true };
    } catch (err) {
      return { error: err?.message || err };
    }
  }

  return { error: `Unknown tool: ${name}` };
}

/**
 * Execute agent prompt with OpenAI-compatible endpoint
 */
export async function runAgentPrompt({ prompt, message, conn }) {
  const config = await getAgentConfig();
  if (!config.apiKey) {
    return (
      `⚠️ *AI Agent is not configured yet.*\n\n` +
      `Set your OpenAI-compatible API key using:\n` +
      `\`${BOT_INFO.PREFIX}agentconfig key <your_api_key>\`\n\n` +
      `_Optionally set custom endpoint & model:_\n` +
      `\`${BOT_INFO.PREFIX}agentconfig url https://api.groq.com/openai/v1\`\n` +
      `\`${BOT_INFO.PREFIX}agentconfig model llama-3.3-70b-versatile\``
    );
  }

  const isGroup = Boolean(message.isGroup);
  const groupJid = isGroup ? message.from : null;
  const callerJid = message.sender || message.participant;

  let meta = null;
  let callerAdmin = false;
  let botAdmin = false;

  if (isGroup) {
    meta = groupCache.get(groupJid);
    if (!meta) {
      try {
        meta = await conn.groupMetadata(groupJid);
        groupCache.set(groupJid, meta);
      } catch {
        meta = null;
      }
    }
    const privileged = await isPrivileged(message, conn);
    callerAdmin = privileged || (meta && isAdmin(meta, callerJid));
    botAdmin = meta && isBotAdmin(meta, conn);
  }

  const context = {
    message,
    conn,
    groupJid,
    callerJid,
    isGroup,
    callerAdmin,
    botAdmin,
  };

  const systemPrompt =
    `You are the intelligent administrative AI agent for ${BOT_INFO.NAME}, a powerful WhatsApp bot.\n` +
    `You have direct access to tools to query and manage this WhatsApp chat.\n` +
    `Current Context:\n` +
    `- Chat Type: ${isGroup ? `Group (${meta?.subject || groupJid})` : "Direct Message"}\n` +
    `- Caller: ${callerJid} (${callerAdmin ? "ADMIN/OWNER" : "REGULAR PARTICIPANT"})\n` +
    `- Bot Admin Privileges: ${botAdmin ? "YES (Has full admin rights)" : "NO (Regular member)"}\n\n` +
    `Guidelines:\n` +
    `1. If the user asks you to filter or select members based on mathematical criteria (e.g. phone number starting with '63' and digit sum adding to 67), use the 'filter_group_members' tool which performs exact, bug-free calculations!\n` +
    `2. STRICT SECURITY: If a non-admin requests destructive actions like kicking members, demoting, or muting, refuse politely and explain that only group administrators can authorize this.\n` +
    `3. Always confirm the actions you have executed clearly, reporting the number of affected participants and their details.\n` +
    `4. Keep responses concise, formatting user mentions cleanly like @phoneNumber.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Multi-step tool execution loop (max 5 turns)
  for (let turn = 0; turn < 5; turn++) {
    const payload = {
      model: config.model,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "auto",
    };

    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      return `❌ AI API connection error: ${netErr?.message || netErr}`;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return `❌ AI API Error (${res.status}): ${errText.slice(0, 200) || res.statusText}`;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      return "⚠️ No response received from AI model.";
    }

    const aiMsg = choice.message;
    messages.push(aiMsg);

    // If model made tool calls, execute them and continue loop
    if (aiMsg.tool_calls && aiMsg.tool_calls.length) {
      for (const call of aiMsg.tool_calls) {
        const fnName = call.function?.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(call.function?.arguments || "{}");
        } catch {
          fnArgs = {};
        }

        const toolResult = await executeAgentTool(fnName, fnArgs, context);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
      continue;
    }

    // Model finished and gave content
    return aiMsg.content || "Done!";
  }

  return "⚠️ Reached maximum agent tool iterations.";
}

/**
 * Check if an incoming message is addressing the bot directly (e.g. @bot or quote reply)
 */
export async function checkAndHandleAgentTrigger({ message, conn }) {
  if (message.isBotMessage) return false;
  if (!message.body && !message.quoted) return false;

  const botJid = conn.user?.id
    ? normalizeNumber(conn.user.id.replace(/:\d+@/, "@")) + "@s.whatsapp.net"
    : "";
  const botNumber = conn.user?.id ? normalizeNumber(conn.user.id) : "";

  const text = (message.body || "").trim();
  const mentions = message.message?.contextInfo?.mentionedJid || [];

  const isMentioned =
    mentions.some((m) => normalizeNumber(m) === botNumber) ||
    new RegExp(`@${botNumber}\\b`, "i").test(text) ||
    /^@bot\b/i.test(text);

  const isQuotedBot =
    message.quoted &&
    message.quoted.sender &&
    normalizeNumber(message.quoted.sender) === botNumber;

  if (!isMentioned && !isQuotedBot) return false;

  // Clean prompt: remove @bot or @phoneNumber
  let prompt = text
    .replace(new RegExp(`@${botNumber}\\b`, "ig"), "")
    .replace(/^@bot\b/i, "")
    .trim();

  if (!prompt && message.quoted?.text) {
    prompt = message.quoted.text;
  }

  if (!prompt) return false;

  try {
    await conn.sendPresenceUpdate("composing", message.from);
    const replyText = await runAgentPrompt({ prompt, message, conn });
    await conn.sendMessage(message.from, { text: replyText }, { quoted: message });
    return true;
  } catch (err) {
    console.error("[aiAgent] Trigger error:", err?.message || err);
    return false;
  }
}
