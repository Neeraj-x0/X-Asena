/**
 * WhatsApp Channels (Newsletters) Plugin
 * Manage and interact with WhatsApp Channels: create, query, follow, mute, and post updates.
 *
 * @module plugins/channel
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { isPrivileged } from "../utils/access.js";
import { downloadQuotedOrSelf } from "../utils/media.js";

command(
  {
    pattern: "channel",
    fromMe: true,
    desc: "WhatsApp Channel management (create|info|follow|unfollow|mute|unmute|post)",
    usage: "#channel <create|info|follow|unfollow|mute|unmute|post> <args>",
    params: {
      argsRequired: true,
      requiresQuoted: false,
      format: "<create Name | Desc | info <JID|code> | follow <JID> | unfollow <JID> | mute <JID> | unmute <JID> | post <JID> <message>>",
      description: "Manage WhatsApp Channels/Newsletters.",
      examples: ["create Tech News | Daily updates", "info 120363...@newsletter", "post 120363...@newsletter Hello subscribers!"],
    },
    type: "social",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) {
      return await replyFail(conn, message, "Only the bot owner can manage channels.");
    }

    const raw = (getCommandArgs(message.body, "channel") || "").trim();
    if (!raw) {
      return await reply(
        conn,
        message,
        `📢 *WHATSAPP CHANNELS (NEWSLETTERS)*\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}channel create <Name> | [Description]\` — Create a new channel\n` +
          `• \`${BOT_INFO.PREFIX}channel info <JID | Invite Code>\` — Inspect channel details\n` +
          `• \`${BOT_INFO.PREFIX}channel follow <JID>\` — Follow a channel\n` +
          `• \`${BOT_INFO.PREFIX}channel unfollow <JID>\` — Leave a channel\n` +
          `• \`${BOT_INFO.PREFIX}channel mute <JID>\` — Mute channel notifications\n` +
          `• \`${BOT_INFO.PREFIX}channel unmute <JID>\` — Unmute channel notifications\n` +
          `• \`${BOT_INFO.PREFIX}channel post <JID> <Message>\` — Broadcast a post to your channel`
      );
    }

    const [subcmd, ...rest] = raw.split(/\s+/);
    const sub = subcmd.toLowerCase();
    const argText = rest.join(" ").trim();

    // ==================== CREATE CHANNEL ====================
    if (sub === "create") {
      if (!argText) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}channel create Channel Name | Description\``);
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
          const res = await conn.newsletterCreate(name, desc);
          await ackCommand(conn, message, "✅");
          return await reply(
            conn,
            message,
            `🎉 *CHANNEL CREATED SUCCESSFULLY!*\n\n` +
              `• *Name:* ${res.name}\n` +
              `• *JID:* \`${res.id}\`\n` +
              `• *Subscribers:* ${res.subscribers ?? 0}\n` +
              (res.invite ? `• *Invite Link:* https://whatsapp.com/channel/${res.invite}\n` : "") +
              (res.description ? `• *Description:* ${res.description}\n` : "")
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to create channel: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== CHANNEL INFO ====================
    if (sub === "info") {
      if (!argText) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}channel info <channelJid | inviteCode>\``);
      }

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const isJid = argText.endsWith("@newsletter");
          const type = isJid ? "JID" : "INVITE";
          const key = isJid ? argText : argText.replace(/https?:\/\/whatsapp\.com\/channel\//i, "");

          const info = await conn.newsletterMetadata(type, key);
          if (!info) return await replyFail(conn, message, "Channel not found or metadata unavailable.");

          const name = info.name || info.thread_metadata?.name?.text || "Unknown";
          const desc = info.description || info.thread_metadata?.description?.text || "No description";
          const subs = info.subscribers ?? info.thread_metadata?.subscribers_count ?? 0;
          const verified = info.verification || info.thread_metadata?.verification;
          const invite = info.invite || info.thread_metadata?.invite;

          await ackCommand(conn, message, "✅");
          return await reply(
            conn,
            message,
            `📢 *CHANNEL INFORMATION*\n\n` +
              `• *Name:* ${name}\n` +
              `• *JID:* \`${info.id || argText}\`\n` +
              `• *Subscribers:* ${subs}\n` +
              `• *Verified:* ${verified === "VERIFIED" ? "✅ Yes" : "❌ No"}\n` +
              (invite ? `• *Invite Link:* https://whatsapp.com/channel/${invite}\n` : "") +
              `• *Description:*\n${desc}`
          );
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to fetch channel info: ${err?.message || err}`);
        }
      });
      return;
    }

    // ==================== FOLLOW CHANNEL ====================
    if (sub === "follow") {
      const jid = argText.endsWith("@newsletter") ? argText : `${argText}@newsletter`;
      try {
        await conn.newsletterFollow(jid);
        return await replyOk(conn, message, `Followed channel \`${jid}\`!`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to follow channel: ${err?.message || err}`);
      }
    }

    // ==================== UNFOLLOW CHANNEL ====================
    if (sub === "unfollow") {
      const jid = argText.endsWith("@newsletter") ? argText : `${argText}@newsletter`;
      try {
        await conn.newsletterUnfollow(jid);
        return await replyOk(conn, message, `Unfollowed channel \`${jid}\`!`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to unfollow channel: ${err?.message || err}`);
      }
    }

    // ==================== MUTE / UNMUTE CHANNEL ====================
    if (sub === "mute") {
      const jid = argText.endsWith("@newsletter") ? argText : `${argText}@newsletter`;
      try {
        await conn.newsletterMute(jid);
        return await replyOk(conn, message, `Muted channel notifications for \`${jid}\`!`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to mute channel: ${err?.message || err}`);
      }
    }

    if (sub === "unmute") {
      const jid = argText.endsWith("@newsletter") ? argText : `${argText}@newsletter`;
      try {
        await conn.newsletterUnmute(jid);
        return await replyOk(conn, message, `Unmuted channel notifications for \`${jid}\`!`);
      } catch (err) {
        return await replyFail(conn, message, `Failed to unmute channel: ${err?.message || err}`);
      }
    }

    // ==================== POST TO CHANNEL ====================
    if (sub === "post") {
      const [targetJid, ...postWords] = rest;
      if (!targetJid) {
        return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}channel post <channelJid> [message text]\``);
      }
      const channelJid = targetJid.endsWith("@newsletter") ? targetJid : `${targetJid}@newsletter`;
      const postText = postWords.join(" ").trim();

      await withTyping(conn, message.from, async () => {
        try {
          await ackCommand(conn, message, "⏳");
          const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });

          if (media && media.buffer) {
            const payload = {};
            if (media.type === "image") {
              payload.image = media.buffer;
              payload.caption = postText;
            } else if (media.type === "video") {
              payload.video = media.buffer;
              payload.caption = postText;
            } else if (media.type === "audio") {
              payload.audio = media.buffer;
              payload.mimetype = media.mimetype || "audio/ogg; codecs=opus";
            } else {
              payload.document = media.buffer;
              payload.mimetype = media.mimetype || "application/octet-stream";
              payload.caption = postText;
            }
            await conn.sendMessage(channelJid, payload);
          } else if (postText) {
            await conn.sendMessage(channelJid, { text: postText });
          } else {
            return await replyFail(conn, message, "Provide text or quote media to broadcast to the channel.");
          }

          await ackCommand(conn, message, "✅");
          return await replyOk(conn, message, `Post sent to channel \`${channelJid}\`!`);
        } catch (err) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, `Failed to post to channel: ${err?.message || err}`);
        }
      });
      return;
    }

    return await replyFail(conn, message, `Unknown subcommand. Type \`${BOT_INFO.PREFIX}channel\` for help.`);
  }
);
