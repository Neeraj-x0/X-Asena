/**
 * Anti-Delete Event Handler
 * Detects message revocations ("Delete for Everyone") and restores deleted messages.
 *
 * @module events/antiDelete
 */

import { proto } from "baileys";
import { msgCache, groupCache } from "../utils/cache.js";
import { getGroupSettings } from "../utils/groupSettings.js";
import { kvGet } from "../database/botKv.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";

/**
 * Handles incoming protocol messages and detects revoked messages.
 *
 * @param {object} conn - Baileys socket connection
 * @param {object} msg - Incoming raw message from messages.upsert
 */
export async function handleAntiDelete(conn, msg) {
  try {
    const protoMsg = msg?.message?.protocolMessage;
    if (!protoMsg || protoMsg.type !== proto.Message.ProtocolMessage.Type.REVOKE) {
      return false;
    }

    const deletedKey = protoMsg.key;
    if (!deletedKey?.id) return false;

    const cached = msgCache.get(deletedKey.id);
    if (!cached) return false;

    const chatJid = msg.key?.remoteJid || deletedKey.remoteJid;
    if (!chatJid || chatJid === "status@broadcast") return false;

    const isGroup = chatJid.endsWith("@g.us");

    // Check group or global anti-delete setting
    let isEnabled = false;
    let targetDestination = chatJid; // 'chat' | 'pm'

    if (isGroup) {
      const gset = await getGroupSettings(chatJid);
      if (gset.antidelete) {
        isEnabled = true;
        if (gset.antidelete === "pm") {
          targetDestination = BOT_INFO.OWNER
            ? `${normalizeNumber(BOT_INFO.OWNER)}@s.whatsapp.net`
            : chatJid;
        }
      }
    }

    // Check global anti-delete if group is not explicitly enabled
    if (!isEnabled) {
      const globalSetting = await kvGet("global_antidelete");
      if (globalSetting && globalSetting !== "off") {
        isEnabled = true;
        if (globalSetting === "pm") {
          targetDestination = BOT_INFO.OWNER
            ? `${normalizeNumber(BOT_INFO.OWNER)}@s.whatsapp.net`
            : chatJid;
        }
      }
    }

    if (!isEnabled) return false;

    const senderJid = cached.sender || deletedKey.participant || msg.key?.participant || chatJid;
    const senderNumber = normalizeNumber(senderJid);
    const deleterJid = msg.key?.participant || msg.participant || senderJid;
    const deleterNumber = normalizeNumber(deleterJid);

    let chatTitle = "Direct Message";
    if (isGroup) {
      const meta = groupCache.get(chatJid) || (await conn.groupMetadata(chatJid).catch(() => ({})));
      chatTitle = meta?.subject || "Group Chat";
    }

    const timeStr = new Date().toLocaleTimeString();
    let header = `🗑️ *[ANTI-DELETE DETECTED]*\n\n`;
    header += `• *Chat:* ${chatTitle}\n`;
    header += `• *Sender:* @${senderNumber}\n`;
    if (deleterNumber !== senderNumber) {
      header += `• *Deleted by:* @${deleterNumber}\n`;
    }
    header += `• *Time:* ${timeStr}\n\n`;
    header += `─「 *DELETED CONTENT* 」─`;

    const rawMessage = cached.message || cached;

    // If message is text
    const textContent =
      rawMessage.conversation ||
      rawMessage.extendedTextMessage?.text ||
      null;

    const mentions = [senderJid];
    if (deleterJid !== senderJid) mentions.push(deleterJid);

    if (textContent) {
      await conn.sendMessage(targetDestination, {
        text: `${header}\n\n${textContent}`,
        mentions,
      });
      return true;
    }

    // If message has caption
    const mediaMessage =
      rawMessage.imageMessage ||
      rawMessage.videoMessage ||
      rawMessage.audioMessage ||
      rawMessage.stickerMessage ||
      rawMessage.documentMessage;

    if (mediaMessage) {
      // Send header notice first
      await conn.sendMessage(targetDestination, { text: header, mentions });

      // Forward/send the raw deleted media content
      await conn.sendMessage(targetDestination, {
        forward: {
          key: deletedKey,
          message: rawMessage,
        },
      }).catch(async () => {
        // Fallback: send message content directly
        await conn.sendMessage(targetDestination, rawMessage);
      });
      return true;
    }

    // Fallback: send header notice
    await conn.sendMessage(targetDestination, {
      text: `${header}\n\n_(Message content type could not be rendered)_`,
      mentions,
    });
    return true;
  } catch (err) {
    console.error("[anti-delete] Error handling revoked message:", err?.message || err);
    return false;
  }
}
