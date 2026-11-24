/**
 * Non-command group moderation guards (mute / antilink / antispam)
 */

import { shouldBlockGroupMessage, tryDeleteMessage } from "../utils/moderation.js";
import { isPrivileged } from "../utils/access.js";
import { t } from "../utils/i18n.js";
import { isAdmin, isBotAdmin } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";

/**
 * @returns {Promise<boolean>} true if message should not continue to command handler
 * Note: for antilink/antispam we still allow commands from admins/privileged
 */
export async function processGroupGuards({ message, conn }) {
  if (!message?.isGroup) return false;
  if (message.key?.fromMe) return false;

  // Anti View-Once auto-sniffer
  if (message.isViewOnce) {
    import("../plugins/antiviewonce.js")
      .then(({ handleAutoViewOnce }) => handleAutoViewOnce?.(message, conn))
      .catch(() => {});
  }

  const privileged = await isPrivileged(message, conn);

  let meta = groupCache.get(message.from);
  if (!meta) {
    try {
      meta = await conn.groupMetadata(message.from);
      groupCache.set(message.from, meta);
    } catch {
      meta = null;
    }
  }

  const admin =
    meta &&
    (isAdmin(meta, message.sender) ||
      isAdmin(meta, message.participant) ||
      isAdmin(meta, message.participantAlt));

  const { getGroupSettings } = await import("../utils/groupSettings.js");
  const settings = await getGroupSettings(message.from);

  // Anti-Foreign country code sender filter
  if (settings.antiforeign && settings.foreignCodes?.length && !privileged && !admin) {
    const senderNum = (message.sender || message.participant || "").replace(/\D/g, "");
    const matchCode = settings.foreignCodes.some((c) => senderNum.startsWith(String(c).replace(/\D/g, "")));
    if (matchCode) {
      if (meta && isBotAdmin(meta, conn)) {
        await tryDeleteMessage(conn, message);
        await conn.groupParticipantsUpdate(message.from, [message.sender], "remove");
        await conn.sendMessage(message.from, {
          text: `🚫 *@${message.sender.split("@")[0]}* was removed (Prohibited country code).`,
          mentions: [message.sender],
        });
        return true;
      }
    }
  }

  // Prohibited Word Filter
  if (settings.wordFilter && settings.filteredWords?.length && !privileged && !admin) {
    const text = (message.body || "").toLowerCase();
    const hit = settings.filteredWords.find((w) => {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text) || text.includes(w.toLowerCase());
    });
    if (hit) {
      if (meta && isBotAdmin(meta, conn)) {
        await tryDeleteMessage(conn, message);
      }
      await conn.sendMessage(message.from, {
        text: `⚠️ *@${(message.sender || "").split("@")[0]}*, your message contained a prohibited word and was deleted.`,
        mentions: [message.sender],
      });
      return true;
    }
  }

  const result = await shouldBlockGroupMessage(message, conn);
  if (!result.block) return false;

  // Admins / privileged bypass antilink & antispam (not mute — mute is explicit)
  if (result.reason !== "MUTED" && (privileged || admin)) {
    return false;
  }

  if (result.deleteMsg && meta && isBotAdmin(meta, conn)) {
    await tryDeleteMessage(conn, message);
  }

  if (result.reason === "ANTILINK") {
    try {
      await conn.sendMessage(message.from, {
        text: await t("ANTILINK"),
      });
    } catch {
      /* ignore */
    }
    return true;
  }

  if (result.reason === "ANTISPAM") {
    try {
      await conn.sendMessage(message.from, {
        text: await t("ANTISPAM"),
      });
    } catch {
      /* ignore */
    }
    return true;
  }

  if (result.reason === "MUTED") {
    // Silent delete if possible; don't route commands
    return true;
  }

  return true;
}
