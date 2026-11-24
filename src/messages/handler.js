/**
 * Message Handler — ACL, flags, policy, audit, metrics
 * User chats: friendly errors only. Stacks → system log group.
 */

import { findCommand } from "../plugins.js";
import { validateCommand } from "../utils/validation.js";
import { checkCommandAccess, isPrivileged } from "../utils/access.js";
import { sendError, ackCommand } from "../utils/message.js";
import { validateGroupPermissions } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";
import { getGroupSettings } from "../utils/groupSettings.js";
import { BOT_INFO } from "../config/constants.js";
import { t } from "../utils/i18n.js";
import logger from "../utils/logger.js";
import { systemLog, isLogGroupAsync } from "../utils/logGroup.js";
import { checkCommandFlag } from "../enterprise/flags.js";
import { evaluatePolicy } from "../enterprise/policy.js";
import { writeAudit } from "../enterprise/audit.js";
import { recordCommand, recordError } from "../enterprise/metrics.js";

const AUDIT_ACTIONS = new Set([
  "kick",
  "warn",
  "mute",
  "unmute",
  "promote",
  "demote",
  "mode",
  "sudo",
  "broadcast",
  "disable",
  "enable",
  "flag",
  "policy",
  "role",
  "backup",
  "setlog",
  "createlog",
]);

export async function messageHandler(params) {
  const { message, conn } = params;
  try {
    if (message.isBotMessage) return;
    if (!message.body) return;

    if (!message.body.startsWith(BOT_INFO.PREFIX)) {
      try {
        const { handleAdminConfirmation } = await import("../agent/agentGuardrails.js");
        const confirmed = await handleAdminConfirmation({ message, conn });
        if (confirmed) return;

        const { checkAndHandleAgentTrigger } = await import("../agent/aiAgent.js");
        const handled = await checkAndHandleAgentTrigger({ message, conn });
        if (handled) return;
      } catch {
        /* non-agent message */
      }
      return;
    }

    const command = findCommand(message.body);
    if (!command) return;

    const name = (command.patternName || "").toLowerCase();
    const privileged = await isPrivileged(message, conn);

    const access = await checkCommandAccess(message, command, conn);
    if (!access.allowed) {
      if (access.silent) return;
      await sendError(conn, message.from, access.reason || "OWNER_ONLY");
      return;
    }

    // Maintenance / feature flags (owner/sudo bypass maintenance for control cmds)
    const flagCheck = await checkCommandFlag(name);
    if (!flagCheck.ok) {
      if (flagCheck.flag === "maintenance" && privileged) {
        // allow privileged through during maintenance
      } else if (flagCheck.flag === "maintenance") {
        await sendError(
          conn,
          message.from,
          "🛠 Bot is in *maintenance mode*. Try again later."
        );
        return;
      } else {
        await sendError(
          conn,
          message.from,
          `⚠️ Feature *${flagCheck.flag}* is disabled.`
        );
        return;
      }
    }

    // Global policies (quiet hours, rate limit, …)
    const policy = await evaluatePolicy(message, command, { privileged });
    if (!policy.ok) {
      const msgs = {
        QUIET_HOURS: "🌙 Quiet hours — try again later.",
        RATE_LIMIT: "⏳ Slow down — rate limit hit.",
        MEDIA_DISABLED: "⚠️ Media commands are disabled by policy.",
        BROADCAST_BLOCKED: "⚠️ Broadcast is blocked by policy.",
      };
      await sendError(conn, message.from, msgs[policy.reason] || policy.reason);
      return;
    }

    if (message.isGroup && command.patternName) {
      const settings = await getGroupSettings(message.from);
      const disabled = settings.disabledPlugins || [];
      if (disabled.includes(name)) {
        if (!privileged) {
          await sendError(conn, message.from, await t("PLUGIN_DISABLED"));
          return;
        }
      }
    }

    logger.command(name || "unknown", message.sender, message.isGroup ? message.from : null);

    const validation = await validateCommand(message, command, conn);
    if (!validation.valid) {
      await sendError(conn, message.from, validation.error);
      return;
    }

    if (message.isGroup && (command.adminOnly || command.botAdminRequired)) {
      let groupMetadata = groupCache.get(message.from);
      if (!groupMetadata) {
        groupMetadata = await conn.groupMetadata(message.from);
        groupCache.set(message.from, groupMetadata);
      }

      const groupValidation = validateGroupPermissions(
        message,
        groupMetadata,
        {
          adminOnly: command.adminOnly,
          botAdminRequired: command.botAdminRequired,
        },
        conn
      );

      if (!groupValidation.valid) {
        await sendError(conn, message.from, groupValidation.error);
        return;
      }
    }

    await ackCommand(conn, message);
    recordCommand(name || "unknown");

    await command.function(message, conn);

    if (AUDIT_ACTIONS.has(name)) {
      writeAudit({
        action: `cmd.${name}`,
        actor: message.sender,
        chat: message.from,
        meta: { body: String(message.body || "").slice(0, 120) },
      }).catch(() => {});
    }
  } catch (error) {
    recordError();
    const where = `${commandNameSafe(message)} @ ${message?.from || "?"}`;
    await systemLog("error", `Handler crash: ${where}`, error);

    const inLog = await isLogGroupAsync(message?.from);
    try {
      if (inLog) {
        await sendError(
          conn,
          message.from,
          `Handler error: ${error?.message || "unknown"} (see log above)`
        );
      } else {
        await sendError(conn, message.from, await t("FAILED"));
      }
    } catch (sendErr) {
      recordError();
      await systemLog("error", "Failed to send user-safe error", sendErr);
    }
  }
}

function commandNameSafe(message) {
  try {
    const body = message?.body || "";
    return body.split(/\s+/)[0] || "unknown";
  } catch {
    return "unknown";
  }
}
