/**
 * Group Mention Command
 */

import { command } from "../plugins.js";
import { sendMessage, getCommandArgs, sendError, withTyping } from "../utils/message.js";
import { getParticipantIds } from "../utils/group.js";
import { groupCache } from "../utils/cache.js";

command(
  {
    pattern: "mention",
    fromMe: false,
    desc: "Mention all users in group",
    usage: "#mention [custom_text]",
    params: { argsRequired: false, requiresQuoted: false, format: "[text]", description: "Mention all participants in the group with optional message text." },
    type: "group",
    groupOnly: true,
  },
  async (message, conn) => {
    try {
      let mentionText = getCommandArgs(message.body, "mention");

      if (!mentionText && message.quoted) {
        mentionText = message.quoted.text || message.quoted.caption;
      }

      if (!mentionText) {
        mentionText = "🔔 *_Notified Everyone_*";
      }

      await withTyping(conn, message.from, async () => {
        let groupMetadata = groupCache.get(message.from);
        if (!groupMetadata) {
          groupMetadata = await conn.groupMetadata(message.from);
          groupCache.set(message.from, groupMetadata);
        }
        const participantIds = getParticipantIds(groupMetadata);

        await sendMessage(conn, message.from, mentionText, {
          mentions: participantIds,
        });
      });
    } catch (error) {
      console.error("Error in mention command:", error);
      await sendError(conn, message.from, "FAILED");
    }
  }
);
