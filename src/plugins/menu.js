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

async function buildMenuText(filterCategory = null) {
  const cmds = getMenuCommands();
  const byType = new Map();

  for (const cmd of cmds) {
    const type = cmd.type || "misc";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(cmd);
  }

  let types = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ];

  if (filterCategory) {
    const matched = types.filter(
      (t) => t.toLowerCase() === filterCategory.toLowerCase()
    );
    if (matched.length > 0) {
      types = matched;
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

  let text = `╭───『 *${BOT_INFO.NAME.toUpperCase()}* 』───╮\n`;
  text += `│ • *Version:* v${BOT_INFO.VERSION}\n`;
  text += `│ • *Prefix:* \`${BOT_INFO.PREFIX}\`\n`;
  text += `│ • *Mode:* \`${mode}\`\n`;
  text += `│ • *Commands:* \`${cmds.length}\`\n`;
  text += `│ • *Language:* \`${lang}\`\n`;
  text += `╰──────────────────────╯\n\n`;

  for (const type of types) {
    const list = byType.get(type) || [];
    if (!list.length) continue;

    const meta = CATEGORY_META[type] || {
      title: type.toUpperCase(),
      icon: "📌",
    };

    text += `*${meta.icon} ${meta.title} (${list.length})*\n`;
    for (const cmd of list.sort((a, b) =>
      a.patternName.localeCompare(b.patternName)
    )) {
      const usage = `${BOT_INFO.PREFIX}${cmd.patternName}`;
      text += `  • \`${usage}\``;
      if (cmd.desc) text += ` — ${cmd.desc}`;
      text += `\n`;
    }
    text += `\n`;
  }

  text += `_💡 Filter by category: \`${BOT_INFO.PREFIX}menu <category>\`_\n`;
  text += `_💡 Command details: \`${BOT_INFO.PREFIX}help <command>\`_`;
  return text;
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

    await reply(
      conn,
      message,
      `*${BOT_INFO.PREFIX}${hit.patternName}*\n` +
        `${hit.desc || "_No description_"}\n\n` +
        `• *Category:* ${meta.icon} ${meta.title}\n` +
        `• *Scope:* ${hit.groupOnly ? "Group Only" : "All Chats"}\n` +
        `• *Permission:* ${hit.fromMe ? "Bot Owner" : hit.adminOnly ? "Group Admin" : "Everyone"}`
    );
  }
);
