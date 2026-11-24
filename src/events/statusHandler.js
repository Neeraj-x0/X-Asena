/**
 * WhatsApp Status (Stories) Event Handler
 * Handles auto-reading and auto-reacting to contact statuses.
 *
 * @module events/statusHandler
 */

import { kvGet } from "../database/botKv.js";

/**
 * Handles incoming status updates from status@broadcast.
 *
 * @param {object} conn - Baileys socket connection
 * @param {object} msg - Raw message object
 */
export async function handleIncomingStatus(conn, msg) {
  try {
    if (msg.key?.remoteJid !== "status@broadcast") return;

    const autoStatus = await kvGet("auto_status");
    if (!autoStatus || autoStatus === "off") return;

    // Mark status as read
    try {
      await conn.readMessages([msg.key]);
    } catch {
      /* non-fatal */
    }

    // Auto-react if emoji configured (e.g. 💚 or ❤️)
    const reactEmoji = await kvGet("auto_status_react");
    if (reactEmoji && typeof reactEmoji === "string" && reactEmoji.trim()) {
      try {
        await conn.sendMessage("status@broadcast", {
          react: { text: reactEmoji.trim(), key: msg.key },
        });
      } catch {
        /* non-fatal */
      }
    }
  } catch (err) {
    console.error("[status-handler] Error processing incoming status:", err?.message || err);
  }
}
