/**
 * Multi-Step Autonomous Planning & Live Progress Tracker
 * Allows the AI agent to structure complex goals into milestone checklists
 * and stream live step progress into the chat.
 *
 * @module agent/agentPlanning
 */

const activePlans = new Map();

/**
 * Format plan checklist
 */
export function formatPlanChecklist(plan) {
  let text = `📋 *AUTONOMOUS EXECUTION PLAN*\n`;
  text += `🎯 *Goal:* ${plan.goal}\n\n`;

  plan.steps.forEach((s) => {
    const icon =
      s.status === "completed" ? "✅" : s.status === "in_progress" ? "🔄" : s.status === "failed" ? "❌" : "⏳";
    const label =
      s.status === "completed"
        ? "Done"
        : s.status === "in_progress"
        ? "In Progress"
        : s.status === "failed"
        ? "Failed"
        : "Pending";

    text += `• [${icon} ${label}] *Step ${s.step}:* ${s.title}\n`;
    if (s.note) text += `   > _${s.note}_\n`;
  });

  return text.trim();
}

/**
 * Create a new execution plan and broadcast it to chat
 */
export async function createPlan({ goal, steps, chatJid, conn }) {
  const planId = `plan_${Date.now()}`;
  const stepItems = steps.map((title, idx) => ({
    step: idx + 1,
    title: String(title).trim(),
    status: idx === 0 ? "in_progress" : "pending",
    note: null,
  }));

  const plan = {
    id: planId,
    goal: String(goal).trim(),
    chatJid,
    steps: stepItems,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  activePlans.set(planId, plan);

  if (conn && chatJid) {
    try {
      await conn.sendMessage(chatJid, { text: formatPlanChecklist(plan) });
    } catch {
      /* ignore */
    }
  }

  return { planId, plan };
}

/**
 * Update step status in an active plan and stream update to chat
 */
export async function updatePlanStep({ planId, stepNumber, status, note = null, chatJid, conn }) {
  const plan = activePlans.get(planId);
  if (!plan) return { error: `Plan ${planId} not found.` };

  const target = plan.steps.find((s) => s.step === parseInt(stepNumber, 10));
  if (!target) return { error: `Step ${stepNumber} not found in plan ${planId}.` };

  target.status = status;
  if (note) target.note = note;
  plan.updatedAt = Date.now();

  // If this step completed and there is a next pending step, set next to in_progress
  if (status === "completed") {
    const nextStep = plan.steps.find((s) => s.step === target.step + 1 && s.status === "pending");
    if (nextStep) nextStep.status = "in_progress";
  }

  const allDone = plan.steps.every((s) => s.status === "completed");

  if (conn && chatJid) {
    try {
      let updateText = formatPlanChecklist(plan);
      if (allDone) {
        updateText += `\n\n🎉 *All plan milestones completed successfully!*`;
      }
      await conn.sendMessage(chatJid, { text: updateText });
    } catch {
      /* ignore */
    }
  }

  return { success: true, allDone, plan };
}
