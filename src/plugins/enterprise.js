/**
 * Enterprise commands: audit, flags, policy, role, backup, metrics
 */

import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
  withTyping,
} from "../utils/message.js";
import { writeAudit, queryAudit, clearAudit } from "../enterprise/audit.js";
import { getFlags, setFlag, COMMAND_FLAGS } from "../enterprise/flags.js";
import { getPolicies, setPolicy } from "../enterprise/policy.js";
import {
  setUserRole,
  listRoles,
  resolveRole,
  can,
  ROLES,
} from "../enterprise/rbac.js";
import { createBackup } from "../enterprise/backup.js";
import { getMetricsSnapshot } from "../enterprise/metrics.js";
import { queueStats } from "../enterprise/queue.js";
import { isLogGroupAsync } from "../utils/logGroup.js";
import {
  isOwnerMessage,
  isPrivileged,
  normalizeNumber,
} from "../utils/access.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";
import fs from "fs/promises";

async function requireLogGroup(message) {
  return isLogGroupAsync(message.from);
}

command(
  {
    pattern: "audit",
    fromMe: true,
    desc: "Show audit log (system group)",
    usage: "#audit [limit|action_filter|clear]",
    params: { argsRequired: false, requiresQuoted: false, format: "[limit|filter|clear]", description: "Read recent audit entries, filter by action/limit, or pass 'clear'." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "audit.read"))) {
      await replyFail(conn, message, "No permission.");
      return;
    }
    if (!(await requireLogGroup(message))) {
      await replyFail(conn, message, "Use `#audit` only in the *system log group*.");
      return;
    }

    const raw = (getCommandArgs(message.body, "audit") || "").trim();
    if (raw === "clear" && isOwnerMessage(message, conn)) {
      await clearAudit();
      await writeAudit({
        action: "audit.clear",
        actor: message.sender,
        chat: message.from,
      });
      await replyOk(conn, message, "Audit log cleared.");
      return;
    }

    const [filter, lim] = raw.split(/\s+/);
    const limit = parseInt(lim || filter, 10);
    const rows = await queryAudit({
      limit: Number.isFinite(limit) ? limit : 15,
      action: Number.isFinite(limit) ? undefined : filter || undefined,
    });

    if (!rows.length) {
      await reply(conn, message, "*Audit:* _(empty)_");
      return;
    }

    const lines = rows.map((r) => {
      const t = new Date(r.ts).toISOString().slice(5, 19).replace("T", " ");
      return `• \`${t}\` *${r.action}* by ${r.actor}` +
        (r.target ? ` → ${r.target}` : "") +
        (r.chat ? `\n  chat:${r.chat}` : "");
    });
    await reply(conn, message, `*Audit (latest)*\n${lines.join("\n")}`);
  }
);

command(
  {
    pattern: "flag",
    fromMe: true,
    desc: "Feature flags: #flag list | #flag media off",
    usage: "#flag [list|<flag_name> <on|off>]",
    params: { argsRequired: false, requiresQuoted: false, format: "[list|<name> <on|off>]", description: "View feature flags or toggle a feature flag." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "flag")) && !(await isPrivileged(message, conn))) {
      await replyFail(conn, message, "No permission.");
      return;
    }

    const raw = (getCommandArgs(message.body, "flag") || "").trim();
    if (!raw || raw === "list") {
      const flags = await getFlags();
      const lines = Object.entries(flags)
        .map(([k, v]) => `• ${k}: *${v ? "ON" : "OFF"}*`)
        .join("\n");
      await reply(
        conn,
        message,
        `*Feature flags*\n${lines}\n\n` +
          `Mapped cmds: ${Object.keys(COMMAND_FLAGS).slice(0, 12).join(", ")}…\n` +
          `Usage: \`${BOT_INFO.PREFIX}flag <name> on|off\``
      );
      return;
    }

    const [name, state] = raw.split(/\s+/);
    if (!name || !["on", "off", "true", "false", "1", "0"].includes((state || "").toLowerCase())) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}flag media off\``
      );
      return;
    }
    const on = ["on", "true", "1"].includes(state.toLowerCase());
    const flags = await setFlag(name, on);
    await writeAudit({
      action: "flag.set",
      actor: message.sender,
      meta: { name, on },
      chat: message.from,
    });
    await replyOk(conn, message, `Flag *${name}* → *${flags[name] ? "ON" : "OFF"}*`);
  }
);

command(
  {
    pattern: "policy",
    fromMe: true,
    desc: "View/set global policies",
    usage: "#policy [list|<key> <value>]",
    params: { argsRequired: false, requiresQuoted: false, format: "[list|<key> <value>]", description: "View active policies or set a policy key value (e.g. 'rateLimitPerUser 30')." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "policy"))) {
      await replyFail(conn, message, "No permission.");
      return;
    }
    const raw = (getCommandArgs(message.body, "policy") || "").trim();
    if (!raw || raw === "list") {
      const p = await getPolicies();
      await reply(
        conn,
        message,
        `*Policies*\n${Object.entries(p)
          .map(([k, v]) => `• ${k}: \`${v}\``)
          .join("\n")}\n\n` +
          `Set: \`${BOT_INFO.PREFIX}policy rateLimitPerUser 30\``
      );
      return;
    }

    const [key, ...rest] = raw.split(/\s+/);
    let value = rest.join(" ").trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null" || value === "none") value = null;
    else if (/^\d+$/.test(value)) value = Number(value);

    const p = await setPolicy(key, value);
    await writeAudit({
      action: "policy.set",
      actor: message.sender,
      meta: { key, value },
      chat: message.from,
    });
    await replyOk(conn, message, `Policy *${key}* = \`${p[key]}\``);
  }
);

command(
  {
    pattern: "role",
    fromMe: true,
    desc: "RBAC: #role set @user admin | list",
    usage: "#role <list|me|set @user role>",
    params: { argsRequired: false, requiresQuoted: false, format: "[list|me|set <@user|number> <role>]", description: "Inspect RBAC roles or assign a role to a user." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "role.manage")) && !isOwnerMessage(message, conn)) {
      await replyFail(conn, message, "Owner/admin only.");
      return;
    }

    const raw = (getCommandArgs(message.body, "role") || "").trim();
    if (!raw || raw === "list") {
      const map = await listRoles();
      const entries = Object.entries(map);
      if (!entries.length) {
        await reply(conn, message, "*Roles:* _(none — sudo defaults to admin)_");
        return;
      }
      await reply(
        conn,
        message,
        `*Roles*\n${entries.map(([n, r]) => `• ${n}: *${r}*`).join("\n")}`
      );
      return;
    }

    const [action, a2, a3] = raw.split(/\s+/);
    if (action === "me") {
      const r = await resolveRole(message, conn);
      await reply(conn, message, `Your role: *${r}*`);
      return;
    }

    if (action === "set") {
      let target = a2;
      let role = a3;
      if (!role) {
        role = a2;
        target = resolveTargetUser(message);
      }
      const n = normalizeNumber(target);
      if (!n || !role) {
        await replyFail(
          conn,
          message,
          `Usage: \`${BOT_INFO.PREFIX}role set @user admin\`\nRoles: ${ROLES.filter((r) => r !== "owner").join(", ")}`
        );
        return;
      }
      try {
        const r = await setUserRole(n, role);
        await writeAudit({
          action: "role.set",
          actor: message.sender,
          target: n,
          meta: { role: r },
        });
        await replyOk(conn, message, `Set *${n}* → *${r}*`);
      } catch (err) {
        await replyFail(conn, message, err.message);
      }
      return;
    }

    await replyFail(conn, message, "Use `list`, `me`, or `set`.");
  }
);

command(
  {
    pattern: "backup",
    fromMe: true,
    desc: "Export BotKV backup (optional auth db)",
    usage: "#backup [full|auth]",
    params: { argsRequired: false, requiresQuoted: false, format: "[full|auth]", description: "Export BotKV backup JSON; pass 'full' or 'auth' to also include auth DB." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await can(message, conn, "backup")) && !isOwnerMessage(message, conn)) {
      await replyFail(conn, message, "No permission.");
      return;
    }

    const raw = (getCommandArgs(message.body, "backup") || "").trim().toLowerCase();
    const includeAuth = raw === "full" || raw === "auth";

    await withTyping(conn, message.from, async () => {
      try {
        const { jsonPath, dbCopy, checksum } = await createBackup({
          includeAuth,
        });
        await writeAudit({
          action: "backup.create",
          actor: message.sender,
          meta: { includeAuth, checksum },
          chat: message.from,
        });

        const buf = await fs.readFile(jsonPath);
        await conn.sendMessage(message.from, {
          document: buf,
          mimetype: "application/json",
          fileName: `xasena-backup-${checksum}.json`,
          caption: `✅ Backup ready\nSHA256∶ \`${checksum}\`` +
            (dbCopy ? `\nDB copy: \`${dbCopy}\`` : ""),
        });
      } catch (err) {
        await replyFail(conn, message, err?.message || "Backup failed");
      }
    });
  }
);

command(
  {
    pattern: "metrics",
    fromMe: true,
    desc: "Show runtime metrics",
    usage: "#metrics",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "No parameters required." },
    type: "owner",
  },
  async (message, conn) => {
    if (!(await isPrivileged(message, conn))) {
      await replyFail(conn, message, "Owner/sudo only.");
      return;
    }
    const m = getMetricsSnapshot();
    const q = queueStats();
    await reply(
      conn,
      message,
      `*Metrics*\n` +
        `• Uptime: ${m.uptime_s}s\n` +
        `• Commands: ${m.counters.commands || 0}\n` +
        `• Errors: ${m.counters.errors || 0} (last min: ${m.errors_last_min})\n` +
        `• Jobs ok/fail: ${m.counters.jobs_ok || 0}/${m.counters.jobs_fail || 0}\n` +
        `• Avg job ms: ${m.avg_job_ms}\n` +
        `• Queue: ${q.active} active / ${q.pending} pending\n` +
        `• Tenant: \`${process.env.TENANT_ID || "default"}\``
    );
  }
);
