/**
 * Advanced Group Management Plugin
 * Deduplicated, LID-aware, consistent utils API usage
 */

import { command } from "../plugins.js";
import {
  sendMessage,
  sendError,
  replyOk,
  replyFail,
  getMentions,
  withTyping,
  getCommandArgs,
  ackCommand,
} from "../utils/message.js";
import {
  getAdmins,
  getParticipantIds,
  formatGroupInfo,
  displayId,
  resolveTargetUser,
} from "../utils/group.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { groupCache } from "../utils/cache.js";
import { isPnUser, isLidUser } from "../functions.js";
import { USAGE_HINTS, BOT_INFO } from "../config/constants.js";

async function getGroupMeta(conn, jid) {
  const cached = groupCache.get(jid);
  if (cached) return cached;
  const meta = await conn.groupMetadata(jid);
  groupCache.set(jid, meta);
  return meta;
}

// ==================== TAG ALL ====================
command(
  {
    pattern: "tagall",
    fromMe: true,
    desc: "Tag all group members",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      await withTyping(conn, message.from, async () => {
        const groupMetadata = await getGroupMeta(conn, message.from);
        const participants = groupMetadata.participants;
        const mentionIds = getParticipantIds(groupMetadata);

        let tagMessage = `*${groupMetadata.subject}*\n\n`;
        tagMessage += `👥 *Total Members:* ${participants.length}\n\n`;

        participants.forEach((participant, index) => {
          tagMessage += `${index + 1}. @${displayId(participant)}\n`;
        });

        await sendMessage(conn, message.from, tagMessage, {
          mentions: mentionIds,
          quoted: message,
        });
      });
    } catch (error) {
      console.error("Error in tagall command:", error);
      await replyFail(conn, message, "Failed to tag all members.");
    }
  }
);

// ==================== NOTIFY ====================
command(
  {
    pattern: "notify",
    fromMe: true,
    desc: "Ping everyone with a short alert",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      await withTyping(conn, message.from, async () => {
        const groupMetadata = await getGroupMeta(conn, message.from);
        await sendMessage(conn, message.from, "🔔 Attention everyone! 🔔", {
          mentions: getParticipantIds(groupMetadata),
          quoted: message,
        });
      });
    } catch (error) {
      console.error("Error in notify command:", error);
      await replyFail(conn, message, "Failed to notify members.");
    }
  }
);

// ==================== GROUP INFO ====================
command(
  {
    pattern: "groupinfo",
    fromMe: false,
    desc: "Get detailed group information",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      const groupMetadata = await getGroupMeta(conn, message.from);
      const lidUsers = groupMetadata.participants.filter((p) => isLidUser(p.id));
      const pnUsers = groupMetadata.participants.filter((p) => isPnUser(p.id));

      let info = formatGroupInfo(groupMetadata);
      info += `\n*🆔 Identifier Types:*\n`;
      info += `• LID Users: ${lidUsers.length}\n`;
      info += `• PN Users: ${pnUsers.length}\n`;

      await sendMessage(conn, message.from, info);
    } catch (error) {
      console.error("Error in groupinfo command:", error);
      await replyFail(conn, message, "Failed to get group information.");
    }
  }
);

// ==================== PROMOTE ====================
command(
  {
    pattern: "promote",
    fromMe: false,
    desc: "Promote a member to admin (mention or reply)",
    type: "group",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const targetUser = resolveTargetUser(message) || getMentions(message)[0];
      if (!targetUser) {
        return await sendError(conn, message.from, USAGE_HINTS.promote);
      }

      await withTyping(conn, message.from, async () => {
        await conn.groupParticipantsUpdate(message.from, [targetUser], "promote");
        groupCache.delete(message.from);
        await replyOk(
          conn,
          message,
          `Promoted @${displayId(targetUser)} to admin!`,
          { mentions: [targetUser] }
        );
      });
    } catch (error) {
      console.error("Error in promote command:", error);
      await replyFail(conn, message, "Failed to promote user.");
    }
  }
);

// ==================== DEMOTE ====================
command(
  {
    pattern: "demote",
    fromMe: false,
    desc: "Demote an admin to member (mention or reply)",
    type: "group",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const targetUser = resolveTargetUser(message) || getMentions(message)[0];
      if (!targetUser) {
        return await sendError(conn, message.from, USAGE_HINTS.demote);
      }

      await withTyping(conn, message.from, async () => {
        await conn.groupParticipantsUpdate(message.from, [targetUser], "demote");
        groupCache.delete(message.from);
        await replyOk(
          conn,
          message,
          `Demoted @${displayId(targetUser)} to member!`,
          { mentions: [targetUser] }
        );
      });
    } catch (error) {
      console.error("Error in demote command:", error);
      await replyFail(conn, message, "Failed to demote user.");
    }
  }
);

// ==================== ADMINS ====================
command(
  {
    pattern: "admins",
    fromMe: false,
    desc: "List all group admins",
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      const groupMetadata = await getGroupMeta(conn, message.from);
      const adminsList = getAdmins(groupMetadata);

      if (adminsList.length === 0) {
        return await sendError(conn, message.from, "No admins found in this group.");
      }

      let adminList = `*👑 GROUP ADMINS*\n\n`;
      adminList += `*Group:* ${groupMetadata.subject}\n`;
      adminList += `*Total Admins:* ${adminsList.length}\n\n`;

      const mentionIds = [];
      adminsList.forEach((admin, index) => {
        mentionIds.push(admin.id);
        const role = admin.admin === "superadmin" ? "👑 Super Admin" : "🛡️ Admin";
        adminList += `${index + 1}. @${displayId(admin)} - ${role}\n`;
      });

      await sendMessage(conn, message.from, adminList, { mentions: mentionIds });
    } catch (error) {
      console.error("Error in admins command:", error);
      await replyFail(conn, message, "Failed to get admin list.");
    }
  }
);

// ==================== SET GROUP NAME ====================
command(
  {
    pattern: "setname",
    fromMe: false,
    desc: "Change the group subject/name",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const newName = (getCommandArgs(message.body, "setname") || "").trim();
    if (!newName) {
      return await replyFail(conn, message, `Provide a new name: \`${BOT_INFO.PREFIX}setname New Group Name\``);
    }
    try {
      await conn.groupUpdateSubject(message.from, newName);
      groupCache.delete(message.from);
      await replyOk(conn, message, `Group name changed to: *${newName}*`);
    } catch (err) {
      await replyFail(conn, message, `Failed to change group name: ${err?.message || err}`);
    }
  }
);

// ==================== SET GROUP DESCRIPTION ====================
command(
  {
    pattern: "setdesc",
    fromMe: false,
    desc: "Change the group description",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    let newDesc = (getCommandArgs(message.body, "setdesc") || "").trim();
    if (!newDesc && message.quoted) {
      newDesc = message.quoted.text || message.quoted.caption || "";
    }
    if (!newDesc) {
      return await replyFail(conn, message, `Provide text or quote a message: \`${BOT_INFO.PREFIX}setdesc New Description\``);
    }
    try {
      await conn.groupUpdateDescription(message.from, newDesc);
      groupCache.delete(message.from);
      await replyOk(conn, message, "Group description updated successfully!");
    } catch (err) {
      await replyFail(conn, message, `Failed to update description: ${err?.message || err}`);
    }
  }
);

// ==================== SET GROUP PICTURE ====================
command(
  {
    pattern: "setppgc",
    fromMe: false,
    desc: "Set group profile picture from quoted image",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    if (!message.quoted) {
      return await replyFail(conn, message, `Reply to an image with \`${BOT_INFO.PREFIX}setppgc\``);
    }
    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (!media || media.type !== "image" || !media.buffer) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, "Please reply to a valid image.");
        }
        await conn.updateProfilePicture(message.from, media.buffer);
        groupCache.delete(message.from);
        await ackCommand(conn, message, "✅");
        await replyOk(conn, message, "Group profile picture updated!");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        await replyFail(conn, message, `Failed to update group picture: ${err?.message || err}`);
      }
    });
  }
);

// ==================== DELETE GROUP PICTURE ====================
command(
  {
    pattern: "delppgc",
    fromMe: false,
    desc: "Remove the group profile picture",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      await conn.removeProfilePicture(message.from);
      groupCache.delete(message.from);
      await replyOk(conn, message, "Group profile picture removed!");
    } catch (err) {
      await replyFail(conn, message, `Failed to remove group picture: ${err?.message || err}`);
    }
  }
);

// ==================== GROUP SETTINGS TOGGLE (OPEN / CLOSE / LOCKED / UNLOCKED) ====================
command(
  {
    pattern: "group",
    fromMe: false,
    desc: "Configure group settings (open/close/locked/unlocked)",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const raw = (getCommandArgs(message.body, "group") || "").trim().toLowerCase();
    if (!raw) {
      return await reply(
        conn,
        message,
        `⚙️ *GROUP SETTINGS OPTIONS*\n\n` +
          `• \`${BOT_INFO.PREFIX}group open\` — Allow all members to send messages\n` +
          `• \`${BOT_INFO.PREFIX}group close\` — Only admins can send messages\n` +
          `• \`${BOT_INFO.PREFIX}group locked\` — Only admins can edit group info\n` +
          `• \`${BOT_INFO.PREFIX}group unlocked\` — All members can edit group info`
      );
    }

    try {
      if (raw === "open" || raw === "unmute") {
        await conn.groupSettingUpdate(message.from, "not_announcement");
        return await replyOk(conn, message, "Group is now *OPEN* (All members can send messages).");
      }
      if (raw === "close" || raw === "mute") {
        await conn.groupSettingUpdate(message.from, "announcement");
        return await replyOk(conn, message, "Group is now *CLOSED* (Only admins can send messages).");
      }
      if (raw === "locked") {
        await conn.groupSettingUpdate(message.from, "locked");
        return await replyOk(conn, message, "Group info is now *LOCKED* (Only admins can edit info).");
      }
      if (raw === "unlocked") {
        await conn.groupSettingUpdate(message.from, "unlocked");
        return await replyOk(conn, message, "Group info is now *UNLOCKED* (All members can edit info).");
      }
      return await replyFail(conn, message, `Invalid option. Type \`${BOT_INFO.PREFIX}group\` for options.`);
    } catch (err) {
      return await replyFail(conn, message, `Failed to update group setting: ${err?.message || err}`);
    }
  }
);

// ==================== GROUP INVITE LINK & REVOKE ====================
command(
  {
    pattern: "invite",
    fromMe: false,
    desc: "Get group invite link",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const code = await conn.groupInviteCode(message.from);
      await reply(conn, message, `🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}`);
    } catch (err) {
      await replyFail(conn, message, `Failed to get invite link: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "revoke",
    fromMe: false,
    desc: "Revoke and reset group invite link",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const newCode = await conn.groupRevokeInvite(message.from);
      await replyOk(conn, message, `Invite link revoked!\n*New Link:* https://chat.whatsapp.com/${newCode}`);
    } catch (err) {
      await replyFail(conn, message, `Failed to revoke invite link: ${err?.message || err}`);
    }
  }
);

// ==================== GROUP JOIN REQUESTS (LIST, APPROVE, REJECT) ====================
command(
  {
    pattern: "requests",
    fromMe: false,
    desc: "List pending group join requests",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    try {
      const list = await conn.groupRequestParticipantsList(message.from);
      if (!list || !list.length) {
        return await reply(conn, message, "📋 No pending join requests for this group.");
      }

      let text = `📋 *PENDING JOIN REQUESTS (${list.length})*\n\n`;
      const mentions = [];
      list.forEach((req, idx) => {
        mentions.push(req.jid);
        text += `${idx + 1}. @${displayId(req.jid)}\n`;
      });
      text += `\n*Approve:* \`${BOT_INFO.PREFIX}approve @user\` or \`${BOT_INFO.PREFIX}approve all\`\n`;
      text += `*Reject:* \`${BOT_INFO.PREFIX}reject @user\` or \`${BOT_INFO.PREFIX}reject all\``;

      await reply(conn, message, text, { mentions });
    } catch (err) {
      await replyFail(conn, message, `Failed to fetch join requests: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "approve",
    fromMe: false,
    desc: "Approve group join requests (@user or all)",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const rawArgs = (getCommandArgs(message.body, "approve") || "").trim().toLowerCase();
    try {
      if (rawArgs === "all") {
        const list = await conn.groupRequestParticipantsList(message.from);
        if (!list || !list.length) return await reply(conn, message, "No pending requests to approve.");
        const jids = list.map((r) => r.jid);
        await conn.groupRequestParticipantsUpdate(message.from, jids, "approve");
        return await replyOk(conn, message, `Approved all ${jids.length} pending join request(s)!`);
      }

      const target = resolveTargetUser(message);
      if (!target) return await replyFail(conn, message, `Mention a user or type \`${BOT_INFO.PREFIX}approve all\``);

      await conn.groupRequestParticipantsUpdate(message.from, [target], "approve");
      await replyOk(conn, message, `Approved join request for @${displayId(target)}`, { mentions: [target] });
    } catch (err) {
      await replyFail(conn, message, `Failed to approve request: ${err?.message || err}`);
    }
  }
);

command(
  {
    pattern: "reject",
    fromMe: false,
    desc: "Reject group join requests (@user or all)",
    type: "admin",
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
  },
  async (message, conn) => {
    const rawArgs = (getCommandArgs(message.body, "reject") || "").trim().toLowerCase();
    try {
      if (rawArgs === "all") {
        const list = await conn.groupRequestParticipantsList(message.from);
        if (!list || !list.length) return await reply(conn, message, "No pending requests to reject.");
        const jids = list.map((r) => r.jid);
        await conn.groupRequestParticipantsUpdate(message.from, jids, "reject");
        return await replyOk(conn, message, `Rejected all ${jids.length} pending join request(s)!`);
      }

      const target = resolveTargetUser(message);
      if (!target) return await replyFail(conn, message, `Mention a user or type \`${BOT_INFO.PREFIX}reject all\``);

      await conn.groupRequestParticipantsUpdate(message.from, [target], "reject");
      await replyOk(conn, message, `Rejected join request for @${displayId(target)}`, { mentions: [target] });
    } catch (err) {
      await replyFail(conn, message, `Failed to reject request: ${err?.message || err}`);
    }
  }
);
