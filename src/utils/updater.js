/**
 * GitHub update checker, changelog parser, and Koyeb/local deployer
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";

const execFileAsync = promisify(execFile);

const KOYEB_API_BASE = "https://app.koyeb.com/v1";
const KOYEB_TOKEN_KV_KEY = "koyeb_api_token";
const KOYEB_SERVICE_KV_KEY = "koyeb_service_id";
const DEFAULT_REPO = "Neeraj-x0/X-Asena";

function baseDir() {
  return global.__basedir || process.cwd();
}

function normalizeRepoSlug(raw) {
  if (!raw) return DEFAULT_REPO;
  const s = String(raw).trim();
  const match = s.match(/(?:github\.com[:/])?([^/\s]+\/[^/\s#?]+?)(?:\.git)?$/i);
  if (match?.[1]) return match[1];
  return DEFAULT_REPO;
}

async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: baseDir(),
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout || "").trim();
}

export function hasLocalGitRepo() {
  return fs.existsSync(path.join(baseDir(), ".git"));
}

export async function resolveRepoContext() {
  let pkgRepo = "";
  let pkgVersion = BOT_INFO.VERSION;
  try {
    const raw = fs.readFileSync(path.join(baseDir(), "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    pkgVersion = pkg.version || BOT_INFO.VERSION;
    pkgRepo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";
  } catch {
    /* ignore */
  }

  const hasGit = hasLocalGitRepo();
  let localSha = (process.env.KOYEB_GIT_SHA || process.env.SOURCE_COMMIT || "").trim() || null;
  let branch = (process.env.KOYEB_GIT_BRANCH || process.env.GITHUB_BRANCH || "").trim() || "";

  if (hasGit) {
    if (!localSha) {
      localSha = await runGit(["rev-parse", "HEAD"]).catch(() => null);
    }
    if (!branch) {
      const detected = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
      if (detected && detected !== "HEAD") branch = detected;
    }
  }

  const repo = normalizeRepoSlug(
    process.env.KOYEB_GIT_REPOSITORY || process.env.GITHUB_REPO || pkgRepo || DEFAULT_REPO
  );

  return {
    repo,
    branch: branch || "main",
    localSha,
    localVersion: pkgVersion,
    hasGit,
    isKoyeb: Boolean(process.env.KOYEB_SERVICE_ID || process.env.KOYEB_APP_NAME),
  };
}

function githubHeaders(raw = false) {
  const headers = {
    "User-Agent": "X-Asena-Updater",
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || (typeof data === "string" ? data : `HTTP ${res.status}`);
    const err = new Error(`GitHub/API ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchRepoFile(repo, branch, filePath) {
  try {
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(apiUrl, {
      headers: githubHeaders(true),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) return await res.text();
  } catch {
    /* fallback to raw */
  }

  const rawUrl = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${filePath}?t=${Date.now()}`;
  const res = await fetch(rawUrl, {
    headers: { "User-Agent": "X-Asena-Updater" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  return await res.text();
}

/**
 * Extract readable changelog summary from CHANGELOG.md for WhatsApp display.
 */
export function formatChangelogPreview(markdown, maxChars = 1100) {
  if (!markdown || !String(markdown).trim()) return "";
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), body: [] };
      if (sections.length >= 2) break;
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current && sections.length < 2) sections.push(current);

  const out = [];
  for (const sec of sections) {
    const cleaned = sec.body
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        if (l.startsWith("### ")) return `_${l.slice(4).trim()}_`;
        return l.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/`([^`]+)`/g, "$1");
      });
    if (!cleaned.length) continue;
    // Skip pure placeholder [Unreleased] if it only says Planned
    const isUnreleased = /^\[unreleased\]/i.test(sec.heading);
    if (isUnreleased && cleaned.length <= 2) continue;
    out.push(`*${sec.heading}*`);
    out.push(...cleaned);
    out.push("");
    if (out.join("\n").length >= maxChars) break;
  }

  const text = out.join("\n").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

/**
 * Fetch latest commits, remote package.json version, and CHANGELOG.md from GitHub.
 */
export async function fetchGitHubUpdateInfo() {
  const ctx = await resolveRepoContext();
  const { repo, branch, localSha, localVersion } = ctx;

  const [commitsRes, pkgText, changelogText] = await Promise.allSettled([
    fetchJson(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=10`, {
      headers: githubHeaders(false),
    }),
    fetchRepoFile(repo, branch, "package.json"),
    fetchRepoFile(repo, branch, "CHANGELOG.md"),
  ]);

  if (commitsRes.status === "rejected") {
    throw new Error(`Failed to fetch commits from GitHub (${repo}@${branch}): ${commitsRes.reason?.message}`);
  }

  const recentCommits = Array.isArray(commitsRes.value) ? commitsRes.value : [];
  const latest = recentCommits[0] || null;
  const remoteSha = latest?.sha || null;

  let remoteVersion = localVersion;
  if (pkgText.status === "fulfilled" && pkgText.value) {
    try {
      const parsedPkg = JSON.parse(pkgText.value);
      if (parsedPkg?.version) remoteVersion = parsedPkg.version;
    } catch {
      /* ignore invalid package.json */
    }
  }

  let aheadBy = null;
  let newCommits = [];
  if (localSha && remoteSha && localSha === remoteSha) {
    aheadBy = 0;
  } else if (localSha && remoteSha) {
    try {
      const cmp = await fetchJson(
        `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(localSha)}...${encodeURIComponent(branch)}`,
        { headers: githubHeaders(false) }
      );
      if (typeof cmp?.ahead_by === "number") aheadBy = cmp.ahead_by;
      if (Array.isArray(cmp?.commits)) {
        newCommits = cmp.commits.slice().reverse();
      }
    } catch {
      /* fallback below */
    }
  }

  const commitList = (newCommits.length ? newCommits : recentCommits).slice(0, 6).map((c) => ({
    sha: c.sha,
    shortSha: (c.sha || "").slice(0, 7),
    message: String(c.commit?.message || "").split("\n")[0].trim(),
    author: c.commit?.author?.name || c.author?.login || "unknown",
    date: c.commit?.author?.date || null,
  }));

  const upToDate = Boolean(
    (localSha && remoteSha && localSha === remoteSha) ||
      (aheadBy === 0 && remoteVersion === localVersion)
  );

  const changelogPreview =
    changelogText.status === "fulfilled" && changelogText.value
      ? formatChangelogPreview(changelogText.value, 950)
      : "";

  return {
    ...ctx,
    remoteSha,
    remoteShortSha: remoteSha ? remoteSha.slice(0, 7) : null,
    localShortSha: localSha ? localSha.slice(0, 7) : null,
    remoteVersion,
    aheadBy,
    upToDate,
    commits: commitList,
    changelogPreview,
    htmlUrl: `https://github.com/${repo}`,
  };
}

/**
 * Retrieve stored or env-based Koyeb credentials.
 */
export async function getKoyebConfig() {
  const envToken = (process.env.KOYEB_API_TOKEN || "").trim();
  const envService = (process.env.KOYEB_SERVICE_ID || "").trim();
  const kvToken = envToken ? "" : String((await kvGet(KOYEB_TOKEN_KV_KEY).catch(() => "")) || "").trim();
  const kvService = envService ? "" : String((await kvGet(KOYEB_SERVICE_KV_KEY).catch(() => "")) || "").trim();
  return {
    token: envToken || kvToken || "",
    serviceId: envService || kvService || "",
    source: envToken ? "env" : kvToken ? "db" : "none",
  };
}

export async function saveKoyebConfig({ token, serviceId } = {}) {
  if (token) await kvSet(KOYEB_TOKEN_KV_KEY, String(token).trim());
  if (serviceId) await kvSet(KOYEB_SERVICE_KV_KEY, String(serviceId).trim());
}

/**
 * List Koyeb services using token (for verification or auto-detecting service ID).
 */
export async function listKoyebServices(token) {
  const res = await fetch(`${KOYEB_API_BASE}/services?limit=50`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Koyeb API ${res.status}: ${msg}`);
  }
  return Array.isArray(data?.services) ? data.services : [];
}

/**
 * Resolve Koyeb service ID from config/env or auto-discover via API.
 */
export async function resolveKoyebServiceId(token, explicitServiceId = "") {
  if (explicitServiceId) return explicitServiceId;
  const services = await listKoyebServices(token);
  if (!services.length) {
    throw new Error("No Koyeb services found for this API token.");
  }
  const preferredNames = [
    process.env.KOYEB_SERVICE_NAME,
    process.env.KOYEB_APP_NAME,
    "x-asena",
    BOT_INFO.NAME.toLowerCase(),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  const matched = services.find((s) => preferredNames.includes(String(s.name || "").toLowerCase()));
  if (matched?.id) return matched.id;
  if (services.length === 1 && services[0]?.id) return services[0].id;

  const listText = services.map((s) => `${s.name} (${s.id})`).join(", ");
  throw new Error(`Multiple Koyeb services found (${listText}). Pass service_id explicitly or set KOYEB_SERVICE_ID.`);
}

/**
 * Trigger a fresh deployment on Koyeb (pulls latest commit from GitHub).
 */
export async function triggerKoyebRedeploy({ token, serviceId } = {}) {
  const cfg = token ? { token, serviceId: serviceId || "" } : await getKoyebConfig();
  if (!cfg.token) {
    throw new Error(
      "KOYEB_API_TOKEN is missing. Set KOYEB_API_TOKEN in Koyeb env vars or run #update token <KOYEB_API_TOKEN>."
    );
  }
  const targetServiceId = await resolveKoyebServiceId(cfg.token, serviceId || cfg.serviceId);

  const res = await fetch(`${KOYEB_API_BASE}/services/${encodeURIComponent(targetServiceId)}/redeploy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(`Koyeb redeploy failed (${res.status}): ${msg}`);
  }

  return {
    ok: true,
    serviceId: targetServiceId,
    deploymentId: data?.deployment?.id || null,
    status: data?.deployment?.status || "STARTING",
  };
}

/**
 * Local fallback: fast-forward git pull when running directly from a git checkout.
 */
export async function pullLocalGitUpdate(branch = "main") {
  if (!hasLocalGitRepo()) {
    return { pulled: false, reason: "no_git_repo" };
  }
  await runGit(["fetch", "origin", branch]);
  const output = await runGit(["pull", "--ff-only", "origin", branch]);
  return {
    pulled: true,
    alreadyUpToDate: /already up to date/i.test(output),
    output,
  };
}
