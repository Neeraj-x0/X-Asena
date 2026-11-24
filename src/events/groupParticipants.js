/**
 * Group participant welcome / goodbye + bot-added hello
 */

import { getGroupSettings } from "../utils/groupSettings.js";
import { groupCache } from "../utils/cache.js";
import logger from "../utils/logger.js";
import { isLogGroupAsync } from "../utils/logGroup.js";
import { BOT_INFO } from "../config/constants.js";
import { normalizeNumber } from "../utils/access.js";

function formatTemplate(tpl, { user, group, count }) {
  return String(tpl || "")
    .replaceAll("@user", user)
    .replaceAll("@group", group)
    .replaceAll("@count", String(count ?? ""));
}

function isBotParticipant(conn, participantJid) {
  if (!conn?.user?.id || !participantJid) return false;
  const bot = normalizeNumber(conn.user.id.replace(/:\d+@/, "@"));
  const p = normalizeNumber(participantJid);
  const botLid = normalizeNumber(conn.user.lid);
  return p === bot || (botLid && p === botLid);
}

/**
 * Wire group-participants.update on a socket
 */
export function attachGroupParticipantEvents(conn) {
  conn.ev.on("group-participants.update", async (update) => {
    try {
      const { id: groupJid, participants, action } = update;
      if (!groupJid || !participants?.length) return;

      groupCache.delete(groupJid);

      // Autonomous Event Watchers Trigger
      try {
        const { triggerGroupEventWatchers } = await import("../agent/agentEvents.js");
        triggerGroupEventWatchers({ groupJid, action, participants, conn }).catch((e) =>
          logger.warn("triggerGroupEventWatchers:", e?.message || e)
        );
      } catch {
        /* ignore */
      }

      const settings = await getGroupSettings(groupJid);
      let meta = groupCache.get(groupJid);
      try {
        if (!meta) {
          meta = await conn.groupMetadata(groupJid);
          groupCache.set(groupJid, meta);
        }
      } catch {
        meta = { subject: "Group", participants: [] };
      }

      const groupName = meta.subject || "Group";
      const count = meta.participants?.length || 0;
      const logGroup = await isLogGroupAsync(groupJid);

      for (const p of participants) {
        const mention = typeof p === "string" ? p : p?.id || p;
        if (!mention) continue;

        // Bot was added to a normal group → short onboarding tip (not in log group)
        if (action === "add" && isBotParticipant(conn, mention) && !logGroup) {
          await conn.sendMessage(groupJid, {
            text:
              `👋 *${BOT_INFO.NAME}* is here.\n\n` +
              `Admins: run \`${BOT_INFO.PREFIX}groupsetup recommended\` for welcome + antilink + antispam.\n` +
              `Or \`${BOT_INFO.PREFIX}menu\` to see commands.`,
          });
          continue;
        }

        if (logGroup) continue; // no welcome spam inside system group

        // Anti-Foreign participant auto-kick
        if (action === "add" && settings.antiforeign && settings.foreignCodes?.length) {
          const userNum = String(mention).replace(/\D/g, "");
          const isBlocked = settings.foreignCodes.some((c) => userNum.startsWith(String(c).replace(/\D/g, "")));
          if (isBlocked) {
            try {
              await conn.groupParticipantsUpdate(groupJid, [mention], "remove");
              await conn.sendMessage(groupJid, {
                text: `🚫 *@${userNum}* was automatically removed (Prohibited country code).`,
                mentions: [mention],
              });
              continue;
            } catch {
              /* ignore kick error */
            }
          }
        }

        const tag = `@${String(mention).split("@")[0]}`;

        if (action === "add" && settings.welcome) {
          const text = formatTemplate(settings.welcomeText, {
            user: tag,
            group: groupName,
            count,
          });
          await conn.sendMessage(groupJid, {
            text,
            mentions: [mention],
          });
        }

        if ((action === "remove" || action === "leave") && settings.goodbye) {
          const text = formatTemplate(settings.goodbyeText, {
            user: tag,
            group: groupName,
            count,
          });
          await conn.sendMessage(groupJid, {
            text,
            mentions: [mention],
          });
        }
      }
    } catch (err) {
      logger.warn("group-participants.update:", err?.message || err);
    }
  });
}
