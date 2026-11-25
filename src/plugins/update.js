/**
 * Self-Update & Auto-Deploy Command (#update)
 * - #update / #update check : fetches remote changelog & commit status from GitHub
 * - #update now / deploy    : pulls latest from GitHub and triggers automatic Koyeb redeployment
 * - #update token <key> [id]: saves & validates Koyeb API token in BotKV
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping } from "../utils/message.js";
import { isOwnerMessage } from "../utils/access.js";
import { writeAudit } from "../enterprise/audit.js";
import { BOT_INFO } from "../config/constants.js";
import {
  fetchGitHubUpdateInfo,
  getKoyebConfig,
  saveKoyebConfig,
  resolveKoyebServiceId,
  triggerKoyebRedeploy,
  pullLocalGitUpdate,
} from "../utils/updater.js";

/** Pending chat-level "update now" confirmations (chatJid -> { expiresAt }) */
const pendingUpdateConfirmations = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function recordPendingUpdate(chatJid) {
  const now = Date.now();
  for (const [k, v] of pendingUpdateConfirmations) {
    if (v.expiresAt <= now) pendingUpdateConfirmations.delete(k);
  }
  pendingUpdateConfirmations.set(chatJid, { expiresAt: now + PENDING_TTL_MS });
}

export async function handlePendingUpdateConfirmation({ message, conn }) {
  if (!pendingUpdateConfirmations.size) return false;
  const text = String(message?.body || "").trim().toLowerCase();
  if (text !== "update now" && text !== "update deploy") return false;

  const entry = pendingUpdateConfirmations.get(message.from);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingUpdateConfirmations.delete(message.from);
    return false;
  }
  if (!isOwnerMessage(message, conn)) return false;

  pendingUpdateConfirmations.delete(message.from);
  await handleUpdate(message, conn, "now");
  return true;
}

function formatReport(info, koyebCfg) {
  const lines = [];
  lines.push(`🔄 *${BOT_INFO.NAME} UPDATE CHECK*`);
  lines.push(`📦 Repo: \`${info.repo}\` (\`${info.branch}\`)`);
  lines.push(
    `🏷️ Current: *v${info.localVersion}*${info.localShortSha ? ` (\`${info.localShortSha}\`)` : ""}`
  );
  lines.push(
    `☁️ Latest: *v${info.remoteVersion}*${info.remoteShortSha ? ` (\`${info.remoteShortSha}\`)` : ""}`
  );

  if (info.upToDate) {
    lines.push(`✅ Status: *Up to date*`);
  } else if (typeof info.aheadBy === "number" && info.aheadBy > 0) {
    lines.push(`🚀 Status: *Update available!* (+${info.aheadBy} commit${info.aheadBy > 1 ? "s" : ""})`);
  } else {
    lines.push(`✨ Status: Latest commits fetched from GitHub`);
  }

  if (info.commits?.length) {
    lines.push("");
    lines.push("📝 *Recent GitHub Commits:*");
    for (const c of info.commits.slice(0, 5)) {
      lines.push(`• \`${c.shortSha}\` ${c.message}`);
    }
  }

  if (info.changelogPreview) {
    lines.push("");
    lines.push("📋 *Changelog:*");
    lines.push(info.changelogPreview);
  }

  lines.push("");
  if (koyebCfg.token) {
    lines.push(`⚡ *Deploy target:* Koyeb Auto-Deploy (${koyebCfg.serviceId || "auto-detect"})`);
    lines.push(`👉 Send \`${BOT_INFO.PREFIX}update now\` (or reply *update now*) to deploy the latest version to Koyeb.`);
  } else if (info.hasGit) {
    lines.push(`⚡ *Deploy target:* Local Git repository`);
    lines.push(
      `👉 Send \`${BOT_INFO.PREFIX}update now\` (or reply *update now*) to pull from GitHub (or set \`KOYEB_API_TOKEN\` for Koyeb auto-deploy).`
    );
  } else {
    lines.push(
      `⚠️ *Koyeb API token not set yet.* Set \`KOYEB_API_TOKEN\` env var or run \`${BOT_INFO.PREFIX}update token <YOUR_KOYEB_API_TOKEN>\` so \`${BOT_INFO.PREFIX}update now\` can trigger Koyeb redeploys automatically.`
    );
  }

  return lines.join("\n");
}

async function handleUpdate(message, conn, forcedAction = "") {
  if (!isOwnerMessage(message, conn)) {
    await replyFail(conn, message, "Only the *owner* can check or deploy updates.");
    return;
  }

  const rawArgs = forcedAction || (getCommandArgs(message.body, "update") || "").trim();
  const [subRaw, ...rest] = rawArgs.split(/\s+/).filter(Boolean);
  const sub = (subRaw || "check").toLowerCase();

  if (sub === "token" || sub === "config" || sub === "setup") {
    const token = (rest[0] || "").trim();
    const explicitServiceId = (rest[1] || "").trim();
    if (!token) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}update token <KOYEB_API_TOKEN> [KOYEB_SERVICE_ID]\``
      );
      return;
    }

    await withTyping(conn, message.from, async () => {
      try {
        const resolvedId = await resolveKoyebServiceId(
          token,
          explicitServiceId || process.env.KOYEB_SERVICE_ID || ""
        );
        await saveKoyebConfig({ token, serviceId: resolvedId });
        await writeAudit({
          action: "bot.koyeb_token_configured",
          actor: message.sender,
          chat: message.from,
          meta: { serviceId: resolvedId },
        }).catch(() => {});

        // Best-effort delete secret message from chat
        if (message.key) {
          await conn.sendMessage(message.from, { delete: message.key }).catch(() => {});
        }

        await replyOk(
          conn,
          message,
          `Koyeb API configured for service \`${resolvedId}\`.\nRun \`${BOT_INFO.PREFIX}update now\` anytime to deploy updates automatically.`
        );
      } catch (err) {
        await replyFail(conn, message, `Koyeb validation failed: ${err?.message || err}`);
      }
    });
    return;
  }

  if (sub === "now" || sub === "deploy" || sub === "apply") {
    await withTyping(conn, message.from, async () => {
      try {
        const info = await fetchGitHubUpdateInfo();
        const koyebCfg = await getKoyebConfig();

        if (koyebCfg.token) {
          const deployed = await triggerKoyebRedeploy({
            token: koyebCfg.token,
            serviceId: koyebCfg.serviceId,
          });
          await writeAudit({
            action: "bot.update_koyeb_redeploy",
            actor: message.sender,
            chat: message.from,
            meta: {
              repo: info.repo,
              branch: info.branch,
              targetSha: info.remoteShortSha,
              remoteVersion: info.remoteVersion,
              serviceId: deployed.serviceId,
              deploymentId: deployed.deploymentId,
            },
          }).catch(() => {});

          await reply(
            conn,
            message,
            `🚀 *Koyeb Redeploy Triggered!*\n\n` +
              `• *Repo:* \`${info.repo}\` (\`${info.branch}\`)\n` +
              `• *Target:* *v${info.remoteVersion}*${info.remoteShortSha ? ` (\`${info.remoteShortSha}\`)` : ""}\n` +
              `• *Service ID:* \`${deployed.serviceId}\`\n` +
              (deployed.deploymentId ? `• *Deployment ID:* \`${deployed.deploymentId}\`\n` : "") +
              `• *Status:* ${deployed.status}\n\n` +
              `_Koyeb is pulling the latest code from GitHub, rebuilding the container, and will replace this instance automatically once healthy._`
          );
          return;
        }

        if (info.hasGit) {
          const pulled = await pullLocalGitUpdate(info.branch);
          await writeAudit({
            action: "bot.update_git_pull",
            actor: message.sender,
            chat: message.from,
            meta: { repo: info.repo, branch: info.branch, targetSha: info.remoteShortSha },
          }).catch(() => {});

          await replyOk(
            conn,
            message,
            pulled.alreadyUpToDate
              ? `Local git repo is already up to date (\`${info.remoteShortSha || info.branch}\`).\n\n_To also deploy on Koyeb automatically, set \`KOYEB_API_TOKEN\` or run \`${BOT_INFO.PREFIX}update token <key>\`._`
              : `Pulled latest commits from \`${info.repo}@${info.branch}\`:\n\`\`\`\n${pulled.output}\n\`\`\`\nRestart the bot process so new changes take effect.`
          );
          return;
        }

        await replyFail(
          conn,
          message,
          `Cannot trigger Koyeb deploy yet because *KOYEB_API_TOKEN* is not configured.\n\n` +
            `• Option 1: Add \`KOYEB_API_TOKEN\` to Koyeb Environment Variables and redeploy.\n` +
            `• Option 2: Send \`${BOT_INFO.PREFIX}update token <YOUR_KOYEB_API_TOKEN>\` here in chat.`
        );
      } catch (err) {
        await replyFail(conn, message, `Update failed: ${err?.message || err}`);
      }
    });
    return;
  }

  // Default: fetch changelog & update status
  await withTyping(conn, message.from, async () => {
    try {
      const [info, koyebCfg] = await Promise.all([fetchGitHubUpdateInfo(), getKoyebConfig()]);
      recordPendingUpdate(message.from);
      await reply(conn, message, formatReport(info, koyebCfg));
    } catch (err) {
      await replyFail(conn, message, `Update check failed: ${err?.message || err}`);
    }
  });
}

command(
  {
    pattern: "update",
    fromMe: true,
    desc: "Fetch changelog & commits from GitHub, or deploy latest update on Koyeb",
    usage: "#update [now|token <KOYEB_API_TOKEN> [service_id]]",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "[now|check|token <api_token> [service_id]]",
      description:
        "Fetches latest changelog and commits from GitHub. Pass 'now' to pull and trigger automatic Koyeb redeployment, or 'token <key>' to configure Koyeb API access.",
    },
    type: "owner",
  },
  async (message, conn) => handleUpdate(message, conn)
);

command(
  {
    pattern: "updatenow",
    fromMe: true,
    desc: "Fetch latest GitHub release and deploy to Koyeb immediately",
    usage: "#updatenow",
    params: {
      argsRequired: false,
      requiresQuoted: false,
      format: "",
      description: "Shortcut for '#update now' to trigger GitHub pull and Koyeb deployment.",
    },
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => handleUpdate(message, conn, "now")
);
