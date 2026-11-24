/**
 * WhatsApp Privacy Settings Plugin
 * Inspect and update account privacy settings (Last Seen, Online, Profile Photo, Read Receipts, Group Add, Calls).
 *
 * @module plugins/privacy
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { isPrivileged } from "../utils/access.js";

command(
  {
    pattern: "privacy",
    fromMe: true,
    desc: "Inspect or configure WhatsApp privacy settings",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can configure privacy settings.");
    }

    const raw = (getCommandArgs(message.body, "privacy") || "").trim().toLowerCase();
    const [setting, val] = raw.split(/\s+/);

    // ==================== GET / INSPECT PRIVACY ====================
    if (!raw || setting === "status" || setting === "get") {
      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const settings = await conn.fetchPrivacySettings(true);
          await ackCommand(conn, message, "🔒");

          let text = `🔒 *ACCOUNT PRIVACY SETTINGS*\n\n`;
          text += `• *Read Receipts (Blue Ticks):* \`${settings.readreceipts || "default"}\`\n`;
          text += `• *Last Seen:* \`${settings.last || "default"}\`\n`;
          text += `• *Online Status:* \`${settings.online || "default"}\`\n`;
          text += `• *Profile Picture:* \`${settings.profile || "default"}\`\n`;
          text += `• *Status Privacy:* \`${settings.status || "default"}\`\n`;
          text += `• *Group Add Permission:* \`${settings.groupadd || "default"}\`\n`;
          text += `• *Call Privacy:* \`${settings.calladd || "default"}\`\n\n`;
          text += `*Update Commands:*\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy lastseen all|contacts|blacklist|none\`\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy online all|match_last_seen\`\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy profile all|contacts|none\`\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy readreceipts all|none\`\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy groupadd all|contacts|blacklist\`\n`;
          text += `• \`${BOT_INFO.PREFIX}privacy calls all|known\``;

          return await reply(conn, message, text);
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to fetch privacy settings: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== UPDATE LAST SEEN ====================
    if (setting === "lastseen" || setting === "last") {
      const allowed = ["all", "contacts", "contact_blacklist", "none"];
      const v = val === "blacklist" ? "contact_blacklist" : val;
      if (!allowed.includes(v)) {
        return await replyFail(conn, message, `Options: \`all\`, \`contacts\`, \`blacklist\`, \`none\``);
      }
      try {
        await conn.updateLastSeenPrivacy(v);
        return await replyOk(conn, message, `Last seen privacy updated to: *${v.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update last seen: ${err?.message || err}`);
      }
    }

    // ==================== UPDATE ONLINE STATUS ====================
    if (setting === "online") {
      const allowed = ["all", "match_last_seen"];
      if (!allowed.includes(val)) {
        return await replyFail(conn, message, `Options: \`all\`, \`match_last_seen\``);
      }
      try {
        await conn.updateOnlinePrivacy(val);
        return await replyOk(conn, message, `Online privacy updated to: *${val.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update online status: ${err?.message || err}`);
      }
    }

    // ==================== UPDATE PROFILE PICTURE ====================
    if (setting === "profile" || setting === "pfp") {
      const allowed = ["all", "contacts", "contact_blacklist", "none"];
      const v = val === "blacklist" ? "contact_blacklist" : val;
      if (!allowed.includes(v)) {
        return await replyFail(conn, message, `Options: \`all\`, \`contacts\`, \`blacklist\`, \`none\``);
      }
      try {
        await conn.updateProfilePicturePrivacy(v);
        return await replyOk(conn, message, `Profile picture privacy updated to: *${v.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update profile picture privacy: ${err?.message || err}`);
      }
    }

    // ==================== UPDATE READ RECEIPTS ====================
    if (setting === "readreceipts" || setting === "receipts") {
      const allowed = ["all", "none"];
      if (!allowed.includes(val)) {
        return await replyFail(conn, message, `Options: \`all\`, \`none\``);
      }
      try {
        await conn.updateReadReceiptsPrivacy(val);
        return await replyOk(conn, message, `Read receipts (blue ticks) updated to: *${val.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update read receipts: ${err?.message || err}`);
      }
    }

    // ==================== UPDATE GROUP ADD PERMISSION ====================
    if (setting === "groupadd") {
      const allowed = ["all", "contacts", "contact_blacklist"];
      const v = val === "blacklist" ? "contact_blacklist" : val;
      if (!allowed.includes(v)) {
        return await replyFail(conn, message, `Options: \`all\`, \`contacts\`, \`blacklist\``);
      }
      try {
        await conn.updateGroupsAddPrivacy(v);
        return await replyOk(conn, message, `Group add privacy updated to: *${v.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update group add privacy: ${err?.message || err}`);
      }
    }

    // ==================== UPDATE CALL PRIVACY ====================
    if (setting === "calls" || setting === "call") {
      const allowed = ["all", "known"];
      if (!allowed.includes(val)) {
        return await replyFail(conn, message, `Options: \`all\`, \`known\``);
      }
      try {
        await conn.updateCallPrivacy(val);
        return await replyOk(conn, message, `Call privacy updated to: *${val.toUpperCase()}*`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to update call privacy: ${err?.message || err}`);
      }
    }

    return await replyFail(conn, message, `Unknown option. Type \`${BOT_INFO.PREFIX}privacy\` for status and options.`);
  }
);

// Alias: getprivacy
command(
  {
    pattern: "getprivacy",
    fromMe: true,
    desc: "Fetch current account privacy settings",
    type: "owner",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const { findCommand } = await import("../plugins.js");
    const cmd = findCommand(`${BOT_INFO.PREFIX}privacy`);
    if (cmd?.function) await cmd.function(message, conn);
  }
);
