/**
 * Lightweight Enterprise Admin HTTP & Full WhatsApp Management Dashboard
 * Serves the interactive web dashboard (GET / & /dashboard) and JSON Ops/Control APIs.
 * Bind localhost by default (ADMIN_HTTP_HOST=127.0.0.1, ADMIN_HTTP_PORT=8787).
 */

import http from "http";
import { createRequire } from "module";
import { getMetricsSnapshot, metricsPrometheus } from "./metrics.js";
import { queryAudit, clearAudit, writeAudit } from "./audit.js";
import { getFlags, setFlag } from "./flags.js";
import { getPolicies, setPolicy } from "./policy.js";
import { queueStats } from "./queue.js";
import { getMode, setMode, normalizeNumber } from "../utils/access.js";
import { getLogGroupJid, isSetupDone } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { checkFfmpeg } from "../onboarding/setup.js";
import logger from "../utils/logger.js";
import { renderDashboardHtml } from "./dashboardHtml.js";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode-terminal/vendor/QRCode/index.js");
const QRErrorCorrectLevel = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js");

let server = null;

/**
 * Render a clean local SVG string for a WhatsApp pairing QR string
 */
function qrToSvg(text) {
  if (!text) return null;
  try {
    const qr = new QRCode(-1, QRErrorCorrectLevel.L);
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = 6;
    const size = count * cell;
    let rects = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#090d12"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="210" height="210" viewBox="0 0 ${size} ${size}">${rects}</svg>`;
  } catch {
    return null;
  }
}

function auth(req, token) {
  if (!token) return false;
  const h = req.headers.authorization || "";
  if (h === `Bearer ${token}`) return true;
  if (req.headers["x-admin-token"] === token) return true;
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams.get("token") === token;
}

function json(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function html(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function requireConn(connState) {
  if (!connState?.connected || !connState.conn) {
    throw new Error("WhatsApp socket is not connected right now.");
  }
  return connState.conn;
}

export function startAdminHttp() {
  const hasPlatformPort = Boolean(process.env.PORT);
  const port = Number(process.env.ADMIN_HTTP_PORT || process.env.PORT || 0);
  if (!port) {
    logger.info?.("Admin HTTP disabled (set ADMIN_HTTP_PORT or PORT to enable)");
    return null;
  }

  const host = process.env.ADMIN_HTTP_HOST || (hasPlatformPort ? "0.0.0.0" : "127.0.0.1");
  const token = process.env.ADMIN_HTTP_TOKEN || "";

  if (!token && !hasPlatformPort) {
    console.warn(
      "[admin-http] ADMIN_HTTP_PORT set but ADMIN_HTTP_TOKEN missing — refusing to start"
    );
    return null;
  }

  if (!token && hasPlatformPort) {
    console.warn(
      "[admin-http] PORT set without ADMIN_HTTP_TOKEN — running in health-check-only mode (/health). Set ADMIN_HTTP_TOKEN to enable the dashboard & APIs."
    );
  }

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}`);
      const path = url.pathname;
      const method = (req.method || "GET").toUpperCase();

      // Dashboard HTML shell (handles auth gate via Bearer token in browser JS)
      if (method === "GET" && (path === "/" || path === "/dashboard")) {
        if (!token) {
          if (path === "/dashboard") {
            return json(res, 503, {
              error: "dashboard_disabled",
              message: "Set ADMIN_HTTP_TOKEN to enable the dashboard.",
            });
          }
          return json(res, 200, {
            ok: true,
            service: BOT_INFO.NAME,
            version: BOT_INFO.VERSION,
            healthOnly: true,
          });
        }
        const accept = req.headers.accept || "";
        // If explicit JSON client hits "/" without browser HTML accept, still serve JSON if ?format=json
        if (url.searchParams.get("format") === "json") {
          if (!auth(req, token)) return json(res, 401, { error: "unauthorized" });
          return json(res, 200, {
            service: BOT_INFO.NAME,
            version: BOT_INFO.VERSION,
            dashboard: `http://${host}:${port}/dashboard?token=${token}`,
          });
        }
        if (accept.includes("text/html") || path === "/dashboard" || !accept.includes("application/json")) {
          return html(res, 200, renderDashboardHtml());
        }
      }

      // Open health probe (always resilient during cold boot before DB init)
      if (method === "GET" && path === "/health") {
        const ff = await checkFfmpeg().catch(() => ({ ok: false }));
        const { getConnectionState } = await import("../socket/connection.js");
        const cs = getConnectionState();
        const mode = await getMode().catch(() => "initializing");
        const setup = await isSetupDone().catch(() => false);
        const logGroup = Boolean(await getLogGroupJid().catch(() => null));
        return json(res, 200, {
          ok: true,
          name: BOT_INFO.NAME,
          version: BOT_INFO.VERSION,
          connected: cs.connected,
          status: cs.status,
          mode,
          ffmpeg: ff.ok,
          setup,
          logGroup,
          queue: queueStats(),
        });
      }

      if (!auth(req, token)) {
        return json(res, 401, { error: "unauthorized" });
      }

      // ==================== LEGACY / PROMETHEUS / JSON OPS ====================
      if (method === "GET" && path === "/metrics" && url.searchParams.get("format") === "prom") {
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(metricsPrometheus());
        return;
      }
      if (method === "GET" && path === "/metrics") {
        return json(res, 200, getMetricsSnapshot());
      }
      if (method === "GET" && path === "/flags") {
        return json(res, 200, await getFlags());
      }
      if (method === "GET" && path === "/policies") {
        return json(res, 200, await getPolicies());
      }
      if (method === "GET" && path === "/audit") {
        const limit = Number(url.searchParams.get("limit") || 50);
        const action = url.searchParams.get("action") || undefined;
        return json(res, 200, await queryAudit({ limit, action }));
      }

      // ==================== DASHBOARD OVERVIEW ====================
      if (method === "GET" && path === "/api/overview") {
        const { getConnectionState, getConnection, getRecentMessages } = await import(
          "../socket/connection.js"
        );
        const cs = getConnectionState();
        const conn = getConnection();
        const ff = await checkFfmpeg();
        const mem = process.memoryUsage();

        let groupCount = null;
        if (cs.connected && conn) {
          try {
            const participating = await conn.groupFetchAllParticipating();
            groupCount = Object.keys(participating || {}).length;
          } catch {
            groupCount = null;
          }
        }

        const { getAuthStateStats } = await import("../database/authState.js");
        const authStats = await getAuthStateStats().catch(() => null);

        return json(res, 200, {
          name: BOT_INFO.NAME,
          version: BOT_INFO.VERSION,
          nodeVersion: process.version,
          mode: await getMode(),
          ffmpeg: ff.ok,
          setup: await isSetupDone(),
          logGroup: await getLogGroupJid(),
          connection: cs,
          authStats,
          qrSvg: cs.qr ? qrToSvg(cs.qr) : null,
          groupCount,
          metrics: getMetricsSnapshot(),
          queue: queueStats(),
          memoryMb: {
            rss: Math.round(mem.rss / 1048576),
            heapUsed: Math.round(mem.heapUsed / 1048576),
          },
          recentMessages: getRecentMessages(30),
        });
      }

      if (method === "POST" && path === "/api/auth/prune") {
        const { pruneStaleSessions } = await import("../database/authState.js");
        const pruned = await pruneStaleSessions({ maxClosedPerJid: 5 });
        return json(res, 200, {
          success: true,
          pruned,
          message: `Pruned ${pruned} closed Signal session entries`,
        });
      }

      // ==================== BOT SESSION CONTROLS ====================
      if (method === "POST" && path === "/api/bot/mode") {
        const body = await readJsonBody(req);
        const mode = await setMode(body.mode);
        await writeAudit({ action: "dashboard.mode", actor: "dashboard", meta: { mode } });
        return json(res, 200, { success: true, mode, message: `Bot mode set to ${mode.toUpperCase()}` });
      }

      if (method === "POST" && path === "/api/bot/presence") {
        const body = await readJsonBody(req);
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const status = body.status === "unavailable" ? "unavailable" : "available";
        await conn.sendPresenceUpdate(status);
        return json(res, 200, { success: true, status, message: `Presence set to ${status}` });
      }

      if (method === "POST" && path === "/api/bot/pairing") {
        const body = await readJsonBody(req);
        const { getConnection } = await import("../socket/connection.js");
        const conn = getConnection();
        if (!conn) throw new Error("Socket is not initialized.");
        const cleanNum = String(body.phoneNumber || "").replace(/\D/g, "");
        if (!cleanNum) throw new Error("Valid phone number required.");
        const code = await conn.requestPairingCode(cleanNum);
        return json(res, 200, { success: true, code, message: `Pairing code generated: ${code}` });
      }

      if (method === "POST" && path === "/api/bot/reconnect") {
        const { forceReconnect } = await import("../socket/connection.js");
        forceReconnect().catch((e) => logger.warn?.("forceReconnect:", e?.message));
        return json(res, 200, { success: true, message: "WhatsApp socket reconnect triggered" });
      }

      if (method === "POST" && path === "/api/bot/logout") {
        const { getConnection } = await import("../socket/connection.js");
        const { clearAuthState } = await import("../database/authState.js");
        const conn = getConnection();
        if (conn) {
          try {
            await conn.logout();
          } catch {
            /* ignore */
          }
        }
        await clearAuthState();
        await writeAudit({ action: "dashboard.logout", actor: "dashboard" });
        return json(res, 200, { success: true, message: "Logged out and auth state cleared" });
      }

      // ==================== GROUPS & MODERATION ====================
      if (method === "GET" && path === "/api/groups") {
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const all = await conn.groupFetchAllParticipating();
        const groups = Object.values(all || {})
          .map((g) => ({
            id: g.id,
            subject: g.subject || g.id,
            size: g.size || g.participants?.length || 0,
            announce: Boolean(g.announce),
            restrict: Boolean(g.restrict),
            ephemeralDuration: g.ephemeralDuration || 0,
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject));
        return json(res, 200, { total: groups.length, groups });
      }

      if (method === "GET" && path.startsWith("/api/groups/")) {
        const groupJid = decodeURIComponent(path.slice("/api/groups/".length));
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { getGroupSettings, getWarns } = await import("../utils/groupSettings.js");
        const { groupCache } = await import("../utils/cache.js");

        let meta = groupCache.get(groupJid);
        if (!meta) {
          meta = await conn.groupMetadata(groupJid);
          groupCache.set(groupJid, meta);
        }

        const settings = await getGroupSettings(groupJid);
        let inviteLink = null;
        try {
          const code = await conn.groupInviteCode(groupJid);
          if (code) inviteLink = `https://chat.whatsapp.com/${code}`;
        } catch {
          /* bot not admin or link unavailable */
        }

        const participants = await Promise.all(
          (meta.participants || []).map(async (p) => {
            const pNum = p.phoneNumber
              ? normalizeNumber(p.phoneNumber)
              : normalizeNumber(p.id);
            const warns = pNum ? await getWarns(groupJid, pNum) : 0;
            return {
              id: p.id,
              phoneNumber: p.phoneNumber ? p.phoneNumber.replace(/\D/g, "") : null,
              lid: p.lid || (String(p.id).endsWith("@lid") ? p.id : null),
              admin: p.admin || null,
              warns,
            };
          })
        );

        return json(res, 200, {
          id: meta.id,
          subject: meta.subject || meta.id,
          desc: meta.desc || "",
          announce: Boolean(meta.announce),
          restrict: Boolean(meta.restrict),
          ephemeralDuration: meta.ephemeralDuration || 0,
          inviteLink,
          settings,
          participants,
        });
      }

      if (method === "POST" && path === "/api/groups/settings") {
        const body = await readJsonBody(req);
        const { groupJid, key, value } = body;
        if (!groupJid || !key) throw new Error("groupJid and key are required");
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { setGroupSettings } = await import("../utils/groupSettings.js");
        const { groupCache } = await import("../utils/cache.js");

        if (key === "announce") {
          await conn.groupSettingUpdate(groupJid, value ? "announcement" : "not_announcement");
          groupCache.delete(groupJid);
          return json(res, 200, { success: true, message: value ? "Group locked (admins only)" : "Group unlocked (all members)" });
        }
        if (key === "restrict") {
          await conn.groupSettingUpdate(groupJid, value ? "locked" : "unlocked");
          groupCache.delete(groupJid);
          return json(res, 200, { success: true, message: value ? "Group info restricted to admins" : "Group info editable by all" });
        }
        if (key === "ephemeral") {
          const sec = Number(value) || 0;
          await conn.groupToggleEphemeral(groupJid, sec);
          groupCache.delete(groupJid);
          return json(res, 200, { success: true, message: `Disappearing timer set to ${sec}s` });
        }

        await setGroupSettings(groupJid, { [key]: value });
        if (key === "automute" || key === "autounmute") {
          const { syncAutoMuteIndex } = await import("../plugins/automute.js");
          await syncAutoMuteIndex(groupJid, { [key]: value });
        }
        await writeAudit({ action: "dashboard.group_setting", actor: "dashboard", target: groupJid, meta: { key, value } });
        return json(res, 200, { success: true, message: `Updated ${key} = ${value}` });
      }

      if (method === "POST" && path === "/api/groups/member") {
        const body = await readJsonBody(req);
        const { groupJid, userJid, action } = body;
        if (!groupJid || !userJid || !action) throw new Error("groupJid, userJid, and action required");
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { addWarn, resetWarns } = await import("../utils/groupSettings.js");
        const { groupCache } = await import("../utils/cache.js");

        if (action === "kick" || action === "promote" || action === "demote") {
          const map = { kick: "remove", promote: "promote", demote: "demote" };
          await conn.groupParticipantsUpdate(groupJid, [userJid], map[action]);
          groupCache.delete(groupJid);
          await writeAudit({ action: `dashboard.member_${action}`, actor: "dashboard", target: userJid, chat: groupJid });
          return json(res, 200, { success: true, message: `Member ${action} executed` });
        }

        const norm = normalizeNumber(userJid);
        if (action === "warn") {
          const count = await addWarn(groupJid, norm);
          return json(res, 200, { success: true, warns: count, message: `Warned user (total warns: ${count})` });
        }
        if (action === "unwarn") {
          await resetWarns(groupJid, norm);
          return json(res, 200, { success: true, warns: 0, message: "Warnings reset to 0" });
        }
        throw new Error(`Unsupported member action: ${action}`);
      }

      if (method === "POST" && path === "/api/groups/revoke") {
        const body = await readJsonBody(req);
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const newCode = await conn.groupRevokeInviteCode(body.groupJid);
        const inviteLink = `https://chat.whatsapp.com/${newCode}`;
        return json(res, 200, { success: true, inviteLink, message: "Group invite link revoked & regenerated" });
      }

      // ==================== MESSAGING & POLLS ====================
      if (method === "POST" && path === "/api/messages/send") {
        const body = await readJsonBody(req);
        const { target, text } = body;
        if (!target || !text) throw new Error("target and text are required");
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { safeDispatchGroupMessage, safeDispatchDirectMessage } = await import(
          "../agent/agentSafetyThrottle.js"
        );

        let resMsg;
        if (String(target).endsWith("@g.us")) {
          resMsg = await safeDispatchGroupMessage({ conn, targetJid: target, text });
        } else {
          resMsg = await safeDispatchDirectMessage({
            conn,
            recipient: target,
            text,
            callerJid: conn.user?.id?.replace(/:\d+@/, "@") || undefined,
          });
        }

        if (!resMsg?.success) throw new Error(resMsg?.error || "Failed to send message");
        await writeAudit({ action: "dashboard.send_message", actor: "dashboard", target: resMsg.deliveredTo || target });
        return json(res, 200, { success: true, message: `Message delivered to ${resMsg.deliveredTo || target}` });
      }

      if (method === "POST" && path === "/api/messages/poll") {
        const body = await readJsonBody(req);
        const { groupJid, question, options, selectableCount } = body;
        if (!groupJid || !question || !Array.isArray(options) || options.length < 2) {
          throw new Error("groupJid, question, and at least 2 options required");
        }
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        await conn.sendMessage(groupJid, {
          poll: {
            name: question,
            values: options,
            selectableCount: Number(selectableCount) || 1,
          },
        });
        await writeAudit({ action: "dashboard.send_poll", actor: "dashboard", target: groupJid });
        return json(res, 200, { success: true, message: "Interactive poll sent!" });
      }

      // ==================== AI AGENT CONTROL ====================
      if (method === "GET" && path === "/api/agent") {
        const { getAgentConfig } = await import("../agent/aiAgent.js");
        const { getCachedDiscoveredModels } = await import("../agent/agentModels.js");
        const { getGuardrailConfig, getBlockedAttemptLogs } = await import(
          "../agent/agentInjectionGuard.js"
        );
        const { listScheduledTasks } = await import("../agent/agentCron.js");
        const { listEventWatchers } = await import("../agent/agentEvents.js");

        const cfg = await getAgentConfig();
        const maskedKey = cfg.apiKey
          ? cfg.apiKey.slice(0, 5) + "..." + cfg.apiKey.slice(-4)
          : "";

        return json(res, 200, {
          config: {
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            maskedKey,
            hasKey: Boolean(cfg.apiKey),
          },
          discoveredModels: await getCachedDiscoveredModels(),
          guardrails: await getGuardrailConfig(),
          blockedLogs: await getBlockedAttemptLogs(15),
          tasks: await listScheduledTasks("all"),
          watchers: await listEventWatchers("all"),
        });
      }

      if (method === "POST" && path === "/api/agent/prompt") {
        const body = await readJsonBody(req);
        const { prompt, chatJid } = body;
        if (!prompt) throw new Error("prompt is required");
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { runAgentPrompt } = await import("../agent/aiAgent.js");

        const selfJid = conn.user?.id ? conn.user.id.replace(/:\d+@/, "@") : "";
        const targetJid =
          chatJid && String(chatJid).includes("@") ? String(chatJid).trim() : selfJid;
        if (!targetJid || !targetJid.includes("@")) {
          throw new Error("No valid target WhatsApp JID available for agent execution.");
        }
        const syntheticMsg = {
          from: targetJid,
          sender: selfJid || targetJid,
          participant: selfJid || targetJid,
          isGroup: targetJid.endsWith("@g.us"),
          isBotMessage: false,
          body: prompt,
          message: { conversation: prompt },
          key: { remoteJid: targetJid, id: `dash_${Date.now()}`, fromMe: true },
        };

        const response = await runAgentPrompt({ prompt, message: syntheticMsg, conn });
        return json(res, 200, { success: true, response });
      }

      if (method === "POST" && path === "/api/agent/config") {
        const body = await readJsonBody(req);
        const { kvSet } = await import("../database/botKv.js");
        const { getAgentConfig } = await import("../agent/aiAgent.js");
        const { fetchAvailableModels } = await import("../agent/agentModels.js");

        if (body.baseUrl !== undefined && String(body.baseUrl).trim()) {
          await kvSet("ai_base_url", String(body.baseUrl).trim());
        }
        if (body.apiKey !== undefined && String(body.apiKey).trim()) {
          await kvSet("ai_api_key", String(body.apiKey).trim());
        }
        if (body.model !== undefined && String(body.model).trim()) {
          await kvSet("ai_model", String(body.model).trim());
        }

        let modelsMsg = "AI configuration saved successfully!";
        let discoveredModels = [];
        if (body.discover) {
          const updated = await getAgentConfig();
          if (updated.apiKey && updated.baseUrl) {
            try {
              discoveredModels = await fetchAvailableModels(updated.baseUrl, updated.apiKey);
              modelsMsg = `Saved & discovered ${discoveredModels.length} models`;
            } catch (discErr) {
              modelsMsg = `Config saved (model discovery warning: ${discErr?.message || discErr})`;
            }
          } else {
            modelsMsg = "Config saved (set both Base URL and API Key to discover models)";
          }
        }
        await writeAudit({ action: "dashboard.agent_config", actor: "dashboard", meta: { discover: !!body.discover } });
        return json(res, 200, { success: true, message: modelsMsg, discoveredModels });
      }

      if (method === "POST" && path === "/api/agent/guardrails") {
        const body = await readJsonBody(req);
        const {
          getGuardrailConfig,
          setGuardrailConfig,
          clearBlockedAttemptLogs,
        } = await import("../agent/agentInjectionGuard.js");

        if (body.clearLogs) {
          await clearBlockedAttemptLogs();
          return json(res, 200, { success: true, message: "Guardrail logs cleared" });
        }
        if (body.toggle) {
          const cur = await getGuardrailConfig();
          await setGuardrailConfig({ enabled: !cur.enabled });
          return json(res, 200, { success: true, message: `Guardrails ${!cur.enabled ? "ENABLED" : "DISABLED"}` });
        }
        if (body.mode) {
          await setGuardrailConfig({ mode: body.mode });
          return json(res, 200, { success: true, message: `Guardrail mode set to ${body.mode}` });
        }
        return json(res, 200, { success: true });
      }

      if (method === "POST" && path === "/api/agent/tasks/cancel") {
        const body = await readJsonBody(req);
        const { cancelScheduledTask } = await import("../agent/agentCron.js");
        const ok = await cancelScheduledTask(body.taskId);
        return json(res, 200, { success: ok, message: ok ? "Scheduled task cancelled" : "Task not found" });
      }

      if (method === "POST" && path === "/api/agent/watchers/cancel") {
        const body = await readJsonBody(req);
        const { cancelEventWatcher } = await import("../agent/agentEvents.js");
        const ok = await cancelEventWatcher(body.watcherId);
        return json(res, 200, { success: ok, message: ok ? "Event watcher cancelled" : "Watcher not found" });
      }

      // ==================== COMMANDS & OPS CONTROLS ====================
      if (method === "GET" && path === "/api/commands") {
        const { getMenuCommands } = await import("../plugins.js");
        const list = getMenuCommands().map((c) => ({
          name: c.patternName,
          type: c.type || "misc",
          desc: c.desc || "",
          usage: c.usage || `${BOT_INFO.PREFIX}${c.patternName}`,
          params: c.params || null,
          fromMe: Boolean(c.fromMe),
          adminOnly: Boolean(c.adminOnly),
          groupOnly: Boolean(c.groupOnly),
        }));
        return json(res, 200, { total: list.length, commands: list });
      }

      if (method === "POST" && path === "/api/commands/run") {
        const body = await readJsonBody(req);
        const { commandName, args, chatJid } = body;
        if (!commandName) throw new Error("commandName required");
        const { getConnection, getConnectionState } = await import("../socket/connection.js");
        const conn = requireConn({ ...getConnectionState(), conn: getConnection() });
        const { commandIndex, commands, findCommand } = await import("../plugins.js");

        const clean = commandName.trim().replace(/^#+/, "").toLowerCase();
        let cmd = commandIndex.get(clean) || commands.find((c) => c.patternName?.toLowerCase() === clean);
        const fullBody = `${BOT_INFO.PREFIX}${clean} ${args || ""}`.trim();
        if (!cmd) cmd = findCommand(fullBody);
        if (!cmd) throw new Error(`Command "${clean}" not found`);

        const selfJid = conn.user?.id ? conn.user.id.replace(/:\d+@/, "@") : "";
        const targetJid =
          chatJid && String(chatJid).includes("@") ? String(chatJid).trim() : selfJid;
        if (!targetJid || !targetJid.includes("@")) {
          throw new Error("No valid target WhatsApp JID available to run command.");
        }
        const syntheticMsg = {
          from: targetJid,
          sender: selfJid || targetJid,
          participant: selfJid || targetJid,
          isGroup: Boolean(targetJid.endsWith("@g.us")),
          isBotMessage: false,
          body: fullBody,
          message: { conversation: fullBody },
          key: { remoteJid: targetJid, id: `dashcmd_${Date.now()}`, fromMe: true },
        };

        await cmd.function(syntheticMsg, conn);
        await writeAudit({ action: "dashboard.run_command", actor: "dashboard", target: targetJid, meta: { command: clean, args } });
        return json(res, 200, { success: true, message: `Executed #${clean}` });
      }

      if (method === "POST" && path === "/api/flags") {
        const body = await readJsonBody(req);
        const flags = await setFlag(body.name, body.value);
        await writeAudit({ action: "dashboard.flag_set", actor: "dashboard", meta: { name: body.name, value: flags[body.name] } });
        return json(res, 200, { success: true, flags, message: `Flag ${body.name} → ${flags[body.name] ? "ON" : "OFF"}` });
      }

      if (method === "POST" && path === "/api/policies") {
        const body = await readJsonBody(req);
        const p = await setPolicy(body.key, body.value);
        await writeAudit({ action: "dashboard.policy_set", actor: "dashboard", meta: { key: body.key, value: body.value } });
        return json(res, 200, { success: true, policies: p, message: `Policy ${body.key} updated` });
      }

      if (method === "POST" && path === "/api/audit/clear") {
        await clearAudit();
        return json(res, 200, { success: true, message: "Audit log cleared" });
      }

      return json(res, 404, { error: "not_found" });
    } catch (err) {
      return json(res, 500, { error: err?.message || "error" });
    }
  });

  server.listen(port, host, () => {
    if (token) {
      console.log(`🛡 WhatsApp Operations Dashboard: http://${host}:${port}/?token=${token}`);
    } else {
      console.log(`🩺 Health endpoint listening: http://${host}:${port}/health`);
    }
  });

  return server;
}

export function stopAdminHttp() {
  if (server) {
    server.close();
    server = null;
  }
}
