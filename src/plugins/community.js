/**
 * WhatsApp Communities Plugin
 * Commands to create and manage WhatsApp Communities and link/unlink subgroups.
 *
 * @module plugins/community
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { isPrivileged } from "../utils/access.js";

command(
  {
    pattern: "community",
    fromMe: true,
    desc: "WhatsApp Community management (create|info|link|unlink|groups|leave)",
    type: "social",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can manage communities.");
    }

    const raw = (getCommandArgs(message.body, "community") || "").trim();
    if (!raw) {
      return await reply(
        conn,
        message,
        `🌐 *WHATSAPP COMMUNITIES*\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}community create <Name> | [Description]\` — Create a new community\n` +
          `• \`${BOT_INFO.PREFIX}community info <CommunityJID>\` — Fetch community metadata\n` +
          `• \`${BOT_INFO.PREFIX}community link <GroupJID> <CommunityJID>\` — Link group to community\n` +
          `• \`${BOT_INFO.PREFIX}community unlink <GroupJID> <CommunityJID>\` — Unlink group from community\n` +
          `• \`${BOT_INFO.PREFIX}community groups <CommunityJID>\` — List all subgroups in community\n` +
          `• \`${BOT_INFO.PREFIX}community leave <CommunityJID>\` — Leave a community`
      );
    }

    const [subcmd, ...rest] = raw.split(/\s+/);
    const sub = subcmd.toLowerCase();
    const argText = rest.join(" ").trim();

    // ==================== CREATE COMMUNITY ====================
    if (sub === "create") {
      if (!argText) {
        return await replyFail(
          conn,
          message,
          `Usage: \`${BOT_INFO.PREFIX}community create Community Name | Description\``
        );
      }

      let name = argText;
      let desc = "";
      if (argText.includes("|")) {
        const parts = argText.split("|");
        name = parts[0].trim();
        desc = parts.slice(1).join("|").trim();
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const res = await conn.communityCreate(name, desc);
          const meta = res?.value || res;
          await ackCommand(conn, message, "✅");
          return await reply(
            conn,
            message,
            `🌐 *COMMUNITY CREATED SUCCESSFULLY!*\n\n` +
              `• *Name:* ${meta.subject || name}\n` +
              `• *JID:* \`${meta.id || "created"}\`\n` +
              (desc ? `• *Description:* ${desc}\n` : "") +
              `\n_You can now link subgroups using \`${BOT_INFO.PREFIX}community link <groupJid> <communityJid>\`_`
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to create community: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== COMMUNITY INFO ====================
    if (sub === "info") {
      const communityJid = argText || (message.isGroup ? message.from : "");
      if (!communityJid) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}community info <communityJid>\``);
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const meta = await conn.communityMetadata(communityJid);
          if (!meta) return await replyFail(conn, message, "Community metadata not found.");

          await ackCommand(conn, message, "✅");
          return await reply(
            conn,
            message,
            `🌐 *COMMUNITY DETAILS*\n\n` +
              `• *Subject:* ${meta.subject}\n` +
              `• *ID:* \`${meta.id}\`\n` +
              `• *Owner:* @${meta.owner ? meta.owner.split("@")[0] : "None"}\n` +
              `• *Participants:* ${meta.participants?.length || 0}\n` +
              (meta.desc ? `• *Description:*\n${meta.desc}` : "")
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to fetch community info: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== LINK SUBGROUP ====================
    if (sub === "link") {
      const [groupJid, communityJid] = rest;
      if (!groupJid || !communityJid) {
        return await replyFail(
          conn,
          message,
          `Usage: \`${BOT_INFO.PREFIX}community link <groupJid> <communityJid>\``
        );
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          await conn.communityLinkGroup(groupJid, communityJid);
          await ackCommand(conn, message, "✅");
          return await replyOk(
            conn,
            message,
            `Linked group \`${groupJid}\` to community \`${communityJid}\`!`
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to link group: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== UNLINK SUBGROUP ====================
    if (sub === "unlink") {
      const [groupJid, communityJid] = rest;
      if (!groupJid || !communityJid) {
        return await replyFail(
          conn,
          message,
          `Usage: \`${BOT_INFO.PREFIX}community unlink <groupJid> <communityJid>\``
        );
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          await conn.communityUnlinkGroup(groupJid, communityJid);
          await ackCommand(conn, message, "✅");
          return await replyOk(
            conn,
            message,
            `Unlinked group \`${groupJid}\` from community \`${communityJid}\`!`
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to unlink group: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== LIST LINKED SUBGROUPS ====================
    if (sub === "groups") {
      const communityJid = argText || (message.isGroup ? message.from : "");
      if (!communityJid) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}community groups <communityJid>\``);
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const groups = await conn.communityFetchLinkedGroups(communityJid);
          if (!groups || !groups.length) {
            return await reply(conn, message, "No linked subgroups found in this community.");
          }

          let text = `🌐 *LINKED SUBGROUPS (${groups.length})*\n\n`;
          groups.forEach((g, idx) => {
            text += `${idx + 1}. *${g.subject || g.id}*\n   ID: \`${g.id}\`\n`;
          });

          await ackCommand(conn, message, "✅");
          return await reply(conn, message, text);
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to fetch linked groups: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== LEAVE COMMUNITY ====================
    if (sub === "leave") {
      const communityJid = argText || (message.isGroup ? message.from : "");
      if (!communityJid) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}community leave <communityJid>\``);
      }

      try {
        await conn.communityLeave(communityJid);
        return await replyOk(conn, message, `Left community \`${communityJid}\`!`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to leave community: ${err?.message || err}`);
      }
    }

    return await replyFail(conn, message, `Unknown subcommand. Type \`${BOT_INFO.PREFIX}community\` for help.`);
  }
);
