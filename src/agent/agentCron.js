/**
 * Autonomous Agent Cron & Task Scheduler
 * Enables the AI agent to schedule, manage, and self-initiate autonomous tasks.
 *
 * @module agent/agentCron
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { runAgentPrompt } from "./aiAgent.js";
import { addMessageToHistory } from "./agentMemory.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";
import { groupCache } from "../utils/cache.js";

const TASKS_KV_KEY = "agent_autonomous_tasks";
let schedulerInterval = null;
let activeConn = null;

/**
 * Parse interval string into milliseconds (e.g. "1m", "30s", "2m", "every minute")
 * Minimum enforced delay is 30 seconds to prevent WhatsApp anti-ban triggers.
 */
export function parseIntervalMs(intervalStr) {
  const s = String(intervalStr || "").trim().toLowerCase();
  if (s === "each minute" || s === "every minute" || s === "1 minute" || s === "1m" || s === "1 min") {
    return 60_000;
  }
  const match = s.match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/i);
  if (!match) return 60_000; // default 1 minute

  const qty = parseInt(match[1], 10);
  const unit = match[2][0];
  let ms = 60_000;
  if (unit === "s") ms = qty * 1000;
  else if (unit === "m") ms = qty * 60 * 1000;
  else if (unit === "h") ms = qty * 60 * 60 * 1000;
  else if (unit === "d") ms = qty * 24 * 60 * 60 * 1000;

  // Enforce 30s minimum for safety
  return Math.max(30_000, ms);
}

// ==================== CRON & TIME PARSING ====================

/**
 * Check if a single cron field matches a value
 */
function matchCronField(field, val) {
  if (field === "*") return true;

  // Step notation */15
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && val % step === 0;
  }

  // Comma-separated 1,2,5
  if (field.includes(",")) {
    return field.split(",").some((part) => matchCronField(part.trim(), val));
  }

  // Range 1-5
  if (field.includes("-")) {
    const [start, end] = field.split("-").map((x) => parseInt(x, 10));
    return val >= start && val <= end;
  }

  return parseInt(field, 10) === val;
}

/**
 * Test if a 5-part cron expression matches a given Date
 * Format: minute (0-59), hour (0-23), dayOfMonth (1-31), month (1-12), dayOfWeek (0-6, 0=Sun)
 */
export function isCronMatch(cronStr, date = new Date()) {
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [min, hr, dom, mon, dow] = parts;

  const matchMin = matchCronField(min, date.getMinutes());
  const matchHr = matchCronField(hr, date.getHours());
  const matchDom = matchCronField(dom, date.getDate());
  const matchMon = matchCronField(mon, date.getMonth() + 1);
  const matchDow = matchCronField(dow, date.getDay());

  return matchMin && matchHr && matchDom && matchMon && matchDow;
}

/**
 * Calculate the next run timestamp (ms) for a cron expression
 */
export function getNextCronRun(cronStr, fromDate = new Date()) {
  const check = new Date(fromDate.getTime() + 60_000); // start from next minute
  check.setSeconds(0, 0);

  // Search ahead up to 31 days (44,640 minutes)
  for (let i = 0; i < 44_640; i++) {
    if (isCronMatch(cronStr, check)) {
      return check.getTime();
    }
    check.setMinutes(check.getMinutes() + 1);
  }

  // Fallback: 24h
  return fromDate.getTime() + 24 * 60 * 60 * 1000;
}

/**
 * Parse human schedule expressions (relative, daily time, or cron)
 */
export function parseScheduleExpression(expr) {
  const s = String(expr || "").trim().toLowerCase();

  // Standard 5-part cron: "0 8 * * *" or "*/30 * * * *"
  const parts = s.split(/\s+/);
  if (parts.length === 5) {
    return {
      type: "cron",
      cronExpression: s,
      nextRunAt: getNextCronRun(s),
    };
  }

  // Relative delays: "in 10 minutes", "in 2 hours", "in 30s", "in 1 day"
  const relMatch = s.match(/^in\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/i);
  if (relMatch) {
    const qty = parseInt(relMatch[1], 10);
    const unit = relMatch[2][0];
    let ms = 0;
    if (unit === "s") ms = qty * 1000;
    else if (unit === "m") ms = qty * 60 * 1000;
    else if (unit === "h") ms = qty * 60 * 60 * 1000;
    else if (unit === "d") ms = qty * 24 * 60 * 60 * 1000;

    return {
      type: "once",
      nextRunAt: Date.now() + ms,
    };
  }

  // Specific time: "23:00" or "at 08:30"
  const timeMatch = s.replace(/^at\s+/i, "").match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hr = parseInt(timeMatch[1], 10);
    const min = parseInt(timeMatch[2], 10);
    const target = new Date();
    target.setHours(hr, min, 0, 0);
    if (target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1);
    }
    // Daily recurring at that hour/min
    const dailyCron = `${min} ${hr} * * *`;
    return {
      type: "cron",
      cronExpression: dailyCron,
      nextRunAt: target.getTime(),
    };
  }

  // Direct ISO date string
  const parsedDate = Date.parse(expr);
  if (!isNaN(parsedDate) && parsedDate > Date.now()) {
    return {
      type: "once",
      nextRunAt: parsedDate,
    };
  }

  throw new Error(
    `Unsupported schedule format: "${expr}". Use standard cron (e.g. '0 9 * * *'), time (e.g. '23:00'), or relative (e.g. 'in 30m').`
  );
}

// ==================== TASK STORAGE & MANAGEMENT ====================

let inMemoryTasks = [];

/**
 * Load all stored scheduled tasks from BotKV
 */
export async function loadScheduledTasks() {
  try {
    const tasks = await kvGet(TASKS_KV_KEY);
    inMemoryTasks = Array.isArray(tasks) ? tasks : [];
  } catch {
    /* fallback to inMemoryTasks */
  }
  return inMemoryTasks;
}

/**
 * Save tasks array to BotKV
 */
export async function saveScheduledTasks(tasks) {
  inMemoryTasks = tasks;
  try {
    await kvSet(TASKS_KV_KEY, tasks);
  } catch {
    /* fallback */
  }
}

/**
 * Create and register an autonomous task
 */
export async function createScheduledTask({
  taskPrompt,
  schedule,
  chatJid,
  creatorJid = "system",
  description = "",
}) {
  const { validateScheduleSafe, containsProfanityOrAbuse } = await import(
    "./agentSafetyThrottle.js"
  );

  // Anti-Spam Schedule Interval Safety
  const scheduleCheck = validateScheduleSafe(schedule);
  if (!scheduleCheck.safe) {
    throw new Error(scheduleCheck.error);
  }

  // Zero-Tolerance Profanity Check
  const profanityCheck = containsProfanityOrAbuse(taskPrompt);
  if (profanityCheck.hasProfanity) {
    throw new Error(
      `Cannot schedule task with abusive language ("${profanityCheck.matchedWord}"). Only polite tasks are permitted.`
    );
  }

  const parsed = parseScheduleExpression(schedule);
  const tasks = await loadScheduledTasks();

  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    taskPrompt: String(taskPrompt).trim(),
    scheduleType: parsed.type,
    cronExpression: parsed.cronExpression || null,
    nextRunAt: parsed.nextRunAt,
    chatJid,
    creatorJid,
    description: description || taskPrompt.slice(0, 40),
    createdAt: Date.now(),
    lastRunAt: null,
    runCount: 0,
  };

  tasks.push(task);
  await saveScheduledTasks(tasks);
  return task;
}

/**
 * Create and register an iterative autonomous task loop
 */
export async function createIterativeTask({
  groupJid,
  interval = "1m",
  actionType = "kick_next_member",
  terminationCondition = "until_no_non_admins",
  maxIterations = 50,
  targetRole = "non_admin",
  excludeUsers = [],
  reminderText = "",
  customPrompt = "",
  linkedWatcherId = null,
  creatorJid = "system",
}) {
  const intervalMs = parseIntervalMs(interval);
  const tasks = await loadScheduledTasks();

  const task = {
    id: `itask_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    isIterative: true,
    taskPrompt: `Iterative Loop: ${actionType} every ${interval} (${terminationCondition})`,
    chatJid: groupJid,
    creatorJid,
    intervalStr: interval,
    intervalMs,
    actionType,
    terminationCondition,
    maxIterations: Math.min(Math.max(1, parseInt(maxIterations, 10) || 50), 100),
    iterationCount: 0,
    targetRole: targetRole || "non_admin",
    excludeUsers: Array.isArray(excludeUsers) ? excludeUsers : [],
    reminderText: reminderText || "",
    customPrompt: customPrompt || "",
    linkedWatcherId: linkedWatcherId ? String(linkedWatcherId).trim() : null,
    nextRunAt: Date.now() + intervalMs,
    createdAt: Date.now(),
    lastRunAt: null,
    runCount: 0,
  };

  tasks.push(task);
  await saveScheduledTasks(tasks);
  return task;
}

/**
 * List active scheduled tasks for a given chat or all chats
 */
export async function listScheduledTasks(chatJid = null) {
  const tasks = await loadScheduledTasks();
  if (!chatJid || chatJid === "all") return tasks;
  return tasks.filter((t) => t.chatJid === chatJid);
}

/**
 * Cancel a scheduled task by ID
 */
export async function cancelScheduledTask(taskId, chatJid = null) {
  let tasks = await loadScheduledTasks();
  const before = tasks.length;

  tasks = tasks.filter((t) => {
    if (t.id === taskId) {
      if (chatJid && t.chatJid !== chatJid) return true; // not in this chat
      return false; // remove
    }
    return true;
  });

  await saveScheduledTasks(tasks);
  return before !== tasks.length;
}

// ==================== AUTONOMOUS EXECUTION ENGINE ====================

/**
 * Execute an iterative task step when due
 */
async function executeIterativeTask(task, conn) {
  try {
    const isGroup = task.chatJid.endsWith("@g.us");
    if (!isGroup) {
      task.nextRunAt = null;
      let allTasks = await loadScheduledTasks();
      allTasks = allTasks.filter((t) => t.id !== task.id);
      await saveScheduledTasks(allTasks);
      return;
    }

    if (task.actionType === "kick_next_member") {
      let meta;
      try {
        meta = await conn.groupMetadata(task.chatJid);
      } catch (err) {
        console.error("[agentCron] Iterative task failed to fetch group metadata:", err?.message);
        return;
      }

      const botJid = conn.user?.id ? normalizeNumber(conn.user.id.replace(/:\d+@/, "@")) : "";
      const botLid = conn.user?.lid ? normalizeNumber(conn.user.lid) : "";
      const creatorNum = normalizeNumber(task.creatorJid) || "";
      const excluded = new Set((task.excludeUsers || []).map((u) => normalizeNumber(u)).filter(Boolean));

      // Non-admin participants only
      const eligible = (meta.participants || []).filter((p) => {
        if (p.admin === "admin" || p.admin === "superadmin") return false;
        const pNum = p.phoneNumber ? normalizeNumber(p.phoneNumber) : normalizeNumber(p.id);
        if (!pNum) return false;
        if (pNum === botJid || (botLid && pNum === botLid)) return false;
        if (creatorNum && pNum === creatorNum) return false;
        if (excluded.has(pNum)) return false;
        return true;
      });

      if (eligible.length === 0) {
        await conn.sendMessage(task.chatJid, {
          text: "🏁 *[ITERATIVE LOOP COMPLETE]*\n_No eligible non-admin members remain in the group. The loop has concluded._",
        });

        if (task.linkedWatcherId) {
          try {
            const { cancelEventWatcher } = await import("./agentEvents.js");
            await cancelEventWatcher(task.linkedWatcherId, task.chatJid);
          } catch {
            /* ignore */
          }
        }

        let allTasks = await loadScheduledTasks();
        allTasks = allTasks.filter((t) => t.id !== task.id);
        await saveScheduledTasks(allTasks);
        return;
      }

      const target = eligible[0];
      const targetDisplay = target.phoneNumber || target.id.split("@")[0];

      try {
        await conn.groupParticipantsUpdate(task.chatJid, [target.id], "remove");
        groupCache.delete(task.chatJid);
      } catch (kickErr) {
        await conn.sendMessage(task.chatJid, {
          text: `⚠️ *[ITERATIVE KICK FAILED]* for @${targetDisplay}: ${kickErr?.message || kickErr}`,
          mentions: [target.id],
        });
      }

      task.iterationCount = (task.iterationCount || 0) + 1;
      const remainingCount = eligible.length - 1;

      await conn.sendMessage(task.chatJid, {
        text: `⏳ *[AUTONOMOUS LOOP]* Removed @${targetDisplay}.\nRemaining non-admins: ${remainingCount}.\nNext removal in ${task.intervalStr || "1m"}.`,
        mentions: [target.id],
      });

      let allTasks = await loadScheduledTasks();
      const stored = allTasks.find((t) => t.id === task.id);

      if (task.iterationCount >= task.maxIterations) {
        await conn.sendMessage(task.chatJid, {
          text: `🏁 *[ITERATIVE LOOP COMPLETE]*\nReached maximum iteration limit (${task.maxIterations}). Loop concluded.`,
        });
        allTasks = allTasks.filter((t) => t.id !== task.id);
        await saveScheduledTasks(allTasks);
        return;
      }

      if (
        remainingCount === 0 &&
        (task.terminationCondition === "until_no_non_admins" ||
          task.terminationCondition === "until_empty")
      ) {
        await conn.sendMessage(task.chatJid, {
          text: "🏁 *[ITERATIVE LOOP COMPLETE]*\nAll non-admin participants have been removed.",
        });
        if (task.linkedWatcherId) {
          try {
            const { cancelEventWatcher } = await import("./agentEvents.js");
            await cancelEventWatcher(task.linkedWatcherId, task.chatJid);
          } catch {
            /* ignore */
          }
        }
        allTasks = allTasks.filter((t) => t.id !== task.id);
        await saveScheduledTasks(allTasks);
        return;
      }

      if (stored) {
        stored.nextRunAt = Date.now() + task.intervalMs;
        stored.iterationCount = task.iterationCount;
        await saveScheduledTasks(allTasks);
      }
    } else if (task.actionType === "send_reminder") {
      if (task.reminderText) {
        await conn.sendMessage(task.chatJid, { text: task.reminderText });
      }
      task.iterationCount = (task.iterationCount || 0) + 1;
      let allTasks = await loadScheduledTasks();
      const stored = allTasks.find((t) => t.id === task.id);
      if (task.iterationCount >= task.maxIterations) {
        allTasks = allTasks.filter((t) => t.id !== task.id);
        await saveScheduledTasks(allTasks);
      } else if (stored) {
        stored.nextRunAt = Date.now() + task.intervalMs;
        stored.iterationCount = task.iterationCount;
        await saveScheduledTasks(allTasks);
      }
    } else if (task.actionType === "custom_prompt") {
      const { runAgentPrompt } = await import("./aiAgent.js");
      const syntheticMessage = {
        from: task.chatJid,
        sender:
          task.creatorJid ||
          (conn.user?.id ? normalizeNumber(conn.user.id) + "@s.whatsapp.net" : task.chatJid),
        participant: task.creatorJid,
        isGroup: true,
        isBotMessage: false,
        body: task.customPrompt,
        message: { conversation: task.customPrompt },
        key: { remoteJid: task.chatJid, id: `itask_${Date.now()}`, fromMe: false },
      };
      await runAgentPrompt({ prompt: task.customPrompt, message: syntheticMessage, conn });
      task.iterationCount = (task.iterationCount || 0) + 1;
      let allTasks = await loadScheduledTasks();
      const stored = allTasks.find((t) => t.id === task.id);
      if (task.iterationCount >= task.maxIterations) {
        allTasks = allTasks.filter((t) => t.id !== task.id);
        await saveScheduledTasks(allTasks);
      } else if (stored) {
        stored.nextRunAt = Date.now() + task.intervalMs;
        stored.iterationCount = task.iterationCount;
        await saveScheduledTasks(allTasks);
      }
    }
  } catch (err) {
    console.error(`[agentCron] Error executing iterative task ${task.id}:`, err?.message || err);
  }
}

/**
 * Execute an autonomous task when due
 */
async function executeAutonomousTask(task, conn) {
  try {
    const isGroup = task.chatJid.endsWith("@g.us");

    // Construct synthetic message representation for the agent
    const syntheticMessage = {
      from: task.chatJid,
      sender: task.creatorJid || (conn.user?.id ? normalizeNumber(conn.user.id) + "@s.whatsapp.net" : task.chatJid),
      participant: task.creatorJid,
      isGroup,
      isBotMessage: false,
      body: task.taskPrompt,
      message: { conversation: task.taskPrompt },
      key: {
        remoteJid: task.chatJid,
        id: `auto_${Date.now()}`,
        fromMe: false,
      },
    };

    // Notify chat that autonomous agent is starting its scheduled run
    const header = `🤖 *[AUTONOMOUS AGENT ACTIVE]*\n_Executing scheduled task:_\n> "${task.taskPrompt}"`;
    await conn.sendMessage(task.chatJid, { text: header });

    // Run the agent with all tools, context, and memory
    const result = await runAgentPrompt({
      prompt: task.taskPrompt,
      message: syntheticMessage,
      conn,
    });

    // Pacing to prevent WhatsApp burst spam
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Deliver completion report
    const completionMsg = `✅ *[AUTONOMOUS TASK COMPLETED]*\n\n${result}`;
    await conn.sendMessage(task.chatJid, { text: completionMsg });

    // Record into rolling chat history
    addMessageToHistory(task.chatJid, {
      sender: "system",
      senderName: "AutonomousAgent",
      text: `[Scheduled Task]: ${task.taskPrompt} -> ${result}`,
      isBot: true,
    });
  } catch (err) {
    console.error(`[agentCron] Error executing task ${task.id}:`, err?.message || err);
    try {
      await conn.sendMessage(task.chatJid, {
        text: `⚠️ *[AUTONOMOUS TASK FAILED]*: ${err?.message || err}`,
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single tick of the autonomous scheduler
 */
async function tickScheduler(conn) {
  try {
    if (!conn?.user?.id) return;
    const now = Date.now();
    let tasks = await loadScheduledTasks();
    const dueTasks = tasks.filter((t) => t.nextRunAt && t.nextRunAt <= now);

    if (!dueTasks.length) return;

    for (const task of dueTasks) {
      task.lastRunAt = now;
      task.runCount = (task.runCount || 0) + 1;

      if (task.isIterative) {
        // Execute iterative task step asynchronously
        executeIterativeTask(task, conn);
      } else {
        // Execute standard autonomous task asynchronously
        executeAutonomousTask(task, conn);

        // Handle next run
        if (task.scheduleType === "cron" && task.cronExpression) {
          task.nextRunAt = getNextCronRun(task.cronExpression, new Date(now));
        } else {
          // One-time task finished, mark null nextRunAt
          task.nextRunAt = null;
        }
      }
    }

    // Keep active cron tasks, purge completed one-shot tasks
    tasks = tasks.filter((t) => t.nextRunAt != null);
    await saveScheduledTasks(tasks);
  } catch (err) {
    console.error("[agentCron] Scheduler tick error:", err?.message || err);
  }
}

/**
 * Start the autonomous agent background scheduler loop
 */
export function startAutonomousAgentScheduler(conn) {
  activeConn = conn;
  if (schedulerInterval) return;

  // Tick every 30 seconds
  schedulerInterval = setInterval(() => {
    tickScheduler(activeConn);
  }, 30_000);

  // Initial check after 5s
  setTimeout(() => tickScheduler(activeConn), 5000);
}

/**
 * Stop scheduler
 */
export function stopAutonomousAgentScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
