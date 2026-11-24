/**
 * WhatsApp Call Handler (Anti-Call)
 * Listens for incoming VoIP voice/video calls, automatically rejects them, and optionally blocks callers.
 *
 * @module events/callHandler
 */

import { kvGet } from "../database/botKv.js";
import { normalizeNumber } from "../utils/access.js";

/**
 * Attaches the call event listener to the socket connection.
 *
 * @param {object} conn - Baileys socket connection
 */
export function attachCallEvents(conn) {
  conn.ev.on("call", async (calls) => {
    try {
      if (!Array.isArray(calls) || !calls.length) return;

      const antiCallSetting = (await kvGet("anti_call")) || "off";
      if (antiCallSetting === "off") return;

      for (const call of calls) {
        // Only act on call offers (incoming ringing calls)
        if (call.status !== "offer") continue;

        const callerJid = call.from;
        if (!callerJid) continue;

        // Reject the call
        try {
          await conn.rejectCall(call.id, callerJid);
        } catch (err) {
          console.error("[anti-call] Failed to reject call:", err?.message || err);
        }

        const callerNumber = normalizeNumber(callerJid);
        const isVideo = Boolean(call.isVideo);

        const warningMsg =
          `📞 *[CALL REJECTED]*\n` +
          `> Hello @${callerNumber}, voice and video calls are not supported on this automated bot number.\n` +
          (antiCallSetting === "block"
            ? `> _You have been automatically blocked for calling._`
            : `> _Please send a text message instead._`);

        try {
          await conn.sendMessage(callerJid, {
            text: warningMsg,
            mentions: [callerJid],
          });
        } catch {
          /* ignore */
        }

        // Auto-block if mode is 'block'
        if (antiCallSetting === "block") {
          try {
            await conn.updateBlockStatus(callerJid, "block");
            console.log(`[anti-call] Blocked caller ${callerNumber}`);
          } catch (err) {
            console.error(`[anti-call] Failed to block caller ${callerNumber}:`, err?.message || err);
          }
        }
      }
    } catch (err) {
      console.error("[anti-call] Error in call event handler:", err?.message || err);
    }
  });
}
