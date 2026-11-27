/**
 * Menu / Help Command
 * Categorized command browser and help explorer
 */

import { command, getMenuCommands } from "../plugins.js";
import { reply, getCommandArgs } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getMode } from "../utils/access.js";

const CATEGORY_META = {
  group: { title: "GROUP & MEMBERS", icon: "👥" },
  admin: { title: "ADMIN & MODERATION", icon: "🛡️" },
  security: { title: "SECURITY & PRIVACY", icon: "🔒" },
  chats: { title: "CHAT CONTROLS", icon: "💬" },
  presence: { title: "PRESENCE & GHOST", icon: "👁️" },
  status: { title: "STATUS & STORIES", icon: "📱" },
  downloader: { title: "DOWNLOADER", icon: "📥" },
  media: { title: "MEDIA & CONVERTERS", icon: "🎨" },
  tools: { title: "TOOLS & UTILITIES", icon: "🛠️" },
  business: { title: "WHATSAPP BUSINESS", icon: "💼" },
  social: { title: "CHANNELS & COMMUNITIES", icon: "🌐" },
  owner: { title: "BOT OWNER & SYSTEM", icon: "⚡" },
  info: { title: "INFO & HELP", icon: "ℹ️" },
  misc: { title: "MISCELLANEOUS", icon: "✨" },
};

const TYPE_ORDER = [
  "group",
  "admin",
  "security",
  "chats",
  "presence",
  "status",
  "downloader",
  "media",
  "tools",
  "business",
  "social",
  "owner",
  "info",
  "misc",
];

function resolveCategoryFilter(types, filterCategory) {
  const q = filterCategory.toLowerCase();
  const exact = types.filter((t) => t.toLowerCase() === q);
  if (exact.length) return exact;

  const byNameOrTitle = types.filter((t) => {
    const title = CATEGORY_META[t]?.title?.toLowerCase() || "";
    return t.toLowerCase().includes(q) || title.includes(q);
  });
  return byNameOrTitle;
}

async function buildMenuText(filterCategory = null) {
  const cmds = getMenuCommands();
  const byType = new Map();

  for (const cmd of cmds) {
    const type = cmd.type || "misc";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(cmd);
  }

  const allTypes = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ];

  let types = allTypes;
  const isFiltered = Boolean(filterCategory);
  if (filterCategory) {
    types = resolveCategoryFilter(allTypes, filterCategory);
    if (!types.length) {
      const valid = allTypes.map((t) => `\`${t}\``).join(", ");
      return `Unknown category \`${filterCategory}\`.\n\nAvailable: ${valid}`;
    }
  }

  let lang = "en";
  try {
    const { getLang } = await import("../utils/i18n.js");
    lang = await getLang();
  } catch {
    /* ignore */
  }

  let mode = "public";
  try {
    mode = await getMode();
  } catch {
    /* BotKV may not be ready */
  }

  const p = BOT_INFO.PREFIX;
  const lines = [
    `*${BOT_INFO.NAME}* · v${BOT_INFO.VERSION}`,
    `Prefix \`${p}\` · ${mode} · ${cmds.length} cmds · ${lang}`,
    "",
  ];

  for (const type of types) {
    const list = (byType.get(type) || [])
      .slice()
      .sort((a, b) => a.patternName.localeCompare(b.patternName));
    if (!list.length) continue;

    const meta = CATEGORY_META[type] || {
      title: type.toUpperCase(),
      icon: "📌",
    };

    if (isFiltered) {
      lines.push(`${meta.icon} *${meta.title}* (${list.length})`);
      for (const cmd of list) {
        lines.push(`• \`${p}${cmd.patternName}\`${cmd.desc ? ` — ${cmd.desc}` : ""}`);
      }
      lines.push("");
    } else {
      lines.push(`${meta.icon} *${meta.title}*`);
      lines.push(list.map((c) => `${p}${c.patternName}`).join(", "));
      lines.push("");
    }
  }

  if (isFiltered) {
    lines.push(`_${p}help <cmd> for usage & examples_`);
  } else {
    lines.push(`_${p}menu <category> for descriptions · ${p}help <cmd> for usage_`);
  }

  return lines.join("\n").trim();
}

async function sendMenu(message, conn) {
  const arg = (getCommandArgs(message.body, "menu") || "").trim().toLowerCase();
  await reply(conn, message, await buildMenuText(arg || null));
}

command(
  {
    pattern: "menu",
    fromMe: false,
    desc: "Show all commands or filter by category",
    usage: "#menu [category]",
    params: { argsRequired: false, requiresQuoted: false, format: "[category]", description: "Show interactive menu or filter by category name (e.g. 'admin', 'tools', 'media')." },
    type: "info",
  },
  sendMenu
);

command(
  {
    pattern: "help",
    fromMe: false,
    desc: "Show menu or help for one command",
    type: "info",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const args = (message.body || "")
      .replace(new RegExp(`^\\${BOT_INFO.PREFIX}\\s*help\\s*`, "i"), "")
      .trim()
      .toLowerCase();

    if (!args) {
      await sendMenu(message, conn);
      return;
    }

    const cmds = getMenuCommands();
    const hit =
      cmds.find((c) => c.patternName === args) ||
      cmds.find((c) => c.patternName.startsWith(args));

    if (!hit) {
      const suggestions = cmds
        .filter((c) => c.patternName.includes(args))
        .slice(0, 5)
        .map((c) => `\`${c.patternName}\``);
      await reply(
        conn,
        message,
        suggestions.length
          ? `Unknown. Did you mean: ${suggestions.join(", ")}?`
          : `Unknown command. Try \`${BOT_INFO.PREFIX}menu\`.`
      );
      return;
    }

    const meta = CATEGORY_META[hit.type] || { title: hit.type?.toUpperCase() || "MISC", icon: "📌" };

    let details =
      `*${BOT_INFO.PREFIX}${hit.patternName}*\n` +
      `${hit.desc || "_No description_"}\n\n` +
      `• *Category:* ${meta.icon} ${meta.title}\n` +
      `• *Scope:* ${hit.groupOnly ? "Group Only" : "All Chats"}\n` +
      `• *Permission:* ${hit.fromMe ? "Bot Owner" : hit.adminOnly ? "Group Admin" : "Everyone"}`;

    if (hit.usage) {
      details += `\n• *Usage:* \`${hit.usage}\``;
    }
    if (hit.params?.format) {
      details += `\n• *Input Format:* \`${hit.params.format}\``;
    }
    if (hit.params?.requiresQuoted) {
      details += `\n• *Reply Required:* ${hit.params.requiresQuoted === true ? "Yes" : "Optional"}`;
    }
    if (hit.params?.examples?.length) {
      details += `\n• *Examples:* \`${hit.params.examples.join("`, `")}\``;
    }

    await reply(conn, message, details);
  }
);
