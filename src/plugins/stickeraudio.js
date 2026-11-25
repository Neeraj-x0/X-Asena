/**
 * Audio Sticker Plugin (Sound Stickers) for WhatsApp
 *
 * Allows users to create WhatsApp stickers that play audio when viewed or tapped.
 * Supports:
 * - Single-step video: creates animated sticker + extracts audio track in one shot
 * - Two-step interactive session: image/sticker + audio/voice note combined within 60s
 * - Aliases: #stickeraudio, #audiosticker, #asticker, #sa
 * - Cancel session: #stickeraudio cancel
 * - Custom metadata: #stickeraudio PackName | AuthorName
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";

import {
  getSessionKey,
  getActiveSession,
  clearUserSession,
  startStickerSession,
  startAudioSession,
  getStickerMetadata,
  parseCustomMetadata,
  imageToWebpSticker,
  videoToAnimatedWebpSticker,
  isWebpAnimated,
  addStickerExif,
  buildAudioMessage,
  sendCombinedAudioSticker,
  inspectMediaNode,
  downloadMediaFromNode,
} from "../utils/audioSticker.js";

/**
 * Main command controller for Audio Stickers.
 *
 * @param {object} message - Serialized message object
 * @param {object} conn - Baileys socket connection
 * @param {string} commandName - Name of the invoked command
 */
export async function handleAudioSticker(message, conn, commandName = "stickeraudio") {
  const sessionKey = getSessionKey(message);
  const activeSession = getActiveSession(sessionKey);

  // Extract command arguments
  const rawBody = String(message.body || "").trim();
  const args = rawBody
    .replace(new RegExp(`^${BOT_INFO.PREFIX}(?:${commandName}|audiosticker|asticker|sa)\\b`, "i"), "")
    .trim();

  // Cancel command
  if (/^(cancel|batal|stop)$/i.test(args)) {
    if (!activeSession) {
      return await replyFail(conn, message, "No active Audio Sticker session to cancel.");
    }
    clearUserSession(sessionKey);
    await ackCommand(conn, message, "✅");
    return await replyOk(conn, message, "Audio Sticker session has been cancelled.");
  }

  // Resolve metadata (Pack & Author)
  const defaultMeta = await getStickerMetadata();
  const { packname, author } = parseCustomMetadata(args, defaultMeta);

  // Inspect incoming media
  const selfInfo = inspectMediaNode(message);
  const quotedInfo = inspectMediaNode(message.quoted);
  const hasQuoted = Boolean(quotedInfo.kind);
  const hasSelf = Boolean(selfInfo.kind);

  // --------------------------------------------------------------------------
  // 1. ACTIVE SESSION RESUMPTION
  // --------------------------------------------------------------------------
  if (activeSession && !activeSession.processing) {
    // Session is waiting for AUDIO
    if (activeSession.waitingFor === "audio") {
      const audioSource =
        quotedInfo.kind === "audio" || quotedInfo.kind === "video"
          ? "quoted"
          : selfInfo.kind === "audio"
          ? "self"
          : null;

      if (audioSource) {
        activeSession.processing = true;
        await ackCommand(conn, message, "⏳");

        await withTyping(conn, message.from, async () => {
          try {
            const audioBuf = await downloadMediaFromNode(conn, message, audioSource);
            if (!audioBuf || !audioBuf.length) {
              throw new Error("Could not download audio stream.");
            }

            const info = audioSource === "quoted" ? quotedInfo : selfInfo;
            const ext = info.kind === "video" ? "mp4" : /ogg|opus/i.test(info.mime) ? "ogg" : "mp3";
            const audioMsg = await buildAudioMessage(conn, audioBuf, ext, info.seconds);

            await sendCombinedAudioSticker(
              conn,
              message.from,
              activeSession.stickerBuffer,
              activeSession.isAnimated,
              audioMsg,
              message
            );

            clearUserSession(sessionKey);
            await ackCommand(conn, message, "✅");
          } catch (err) {
            activeSession.processing = false;
            await ackCommand(conn, message, "❌");
            await replyFail(conn, message, `Failed to combine sound into sticker: ${err?.message || err}`);
          }
        }, { timeoutMs: 60_000 });
        return;
      }
    }

    // Session is waiting for VISUAL (Image / Video / Sticker)
    if (activeSession.waitingFor === "visual") {
      const visualSource =
        quotedInfo.kind === "video" || quotedInfo.kind === "image" || quotedInfo.kind === "sticker"
          ? "quoted"
          : selfInfo.kind === "video" || selfInfo.kind === "image" || selfInfo.kind === "sticker"
          ? "self"
          : null;

      if (visualSource) {
        activeSession.processing = true;
        await ackCommand(conn, message, "⏳");

        await withTyping(conn, message.from, async () => {
          try {
            const visualBuf = await downloadMediaFromNode(conn, message, visualSource);
            if (!visualBuf || !visualBuf.length) {
              throw new Error("Could not download visual media.");
            }

            const info = visualSource === "quoted" ? quotedInfo : selfInfo;
            let rawWebp;
            let isAnimated = false;

            if (info.kind === "video") {
              rawWebp = await videoToAnimatedWebpSticker(visualBuf);
              isAnimated = true;
            } else if (info.kind === "sticker") {
              rawWebp = visualBuf;
              isAnimated = isWebpAnimated(visualBuf);
            } else {
              rawWebp = await imageToWebpSticker(visualBuf);
              isAnimated = false;
            }

            const stickerBuffer = await addStickerExif(rawWebp, activeSession.packname, activeSession.author);
            const audioMsg = await buildAudioMessage(
              conn,
              activeSession.audioBuffer,
              activeSession.audioExt,
              activeSession.audioDuration
            );

            await sendCombinedAudioSticker(conn, message.from, stickerBuffer, isAnimated, audioMsg, message);

            clearUserSession(sessionKey);
            await ackCommand(conn, message, "✅");
          } catch (err) {
            activeSession.processing = false;
            await ackCommand(conn, message, "❌");
            await replyFail(conn, message, `Failed to create audio sticker: ${err?.message || err}`);
          }
        }, { timeoutMs: 60_000 });
        return;
      }
    }

    // Remind user of active pending session
    const remainingSec = Math.max(1, Math.ceil((activeSession.expiresAt - Date.now()) / 1000));
    return await reply(
      conn,
      message,
      `⏳ *AUDIO STICKER SESSION ACTIVE*\n` +
        `> Waiting for: *${activeSession.waitingFor === "audio" ? "Audio / Voice Note / Video" : "Image / Video / Sticker"}*\n` +
        `> Time remaining: \`${remainingSec}s\`\n\n` +
        `Reply to media with \`${BOT_INFO.PREFIX}${commandName}\` or type \`${BOT_INFO.PREFIX}${commandName} cancel\` to abort.`
    );
  }

  // --------------------------------------------------------------------------
  // 2. NO ACTIVE SESSION — START OR DIRECT PROCESS
  // --------------------------------------------------------------------------
  const primarySource = hasQuoted ? "quoted" : hasSelf ? "self" : null;
  const primaryInfo = hasQuoted ? quotedInfo : hasSelf ? selfInfo : null;

  if (!primarySource || !primaryInfo?.kind) {
    return await reply(
      conn,
      message,
      `🔊 *AUDIO STICKER CREATOR*\n` +
        `Create a sticker that plays audio on WhatsApp!\n\n` +
        `╭─「 *HOW TO USE* 」\n` +
        `│ • *1-Step:* Reply to a *Video* with \`${BOT_INFO.PREFIX}${commandName}\` (extracts video + audio automatically!)\n` +
        `│ • *2-Step:* Reply to an *Image/Sticker* with \`${BOT_INFO.PREFIX}${commandName}\`, then reply to an *Audio/Voice Note*\n` +
        `│ • *Cancel:* \`${BOT_INFO.PREFIX}${commandName} cancel\`\n` +
        `│ • *Custom Pack:* \`${BOT_INFO.PREFIX}${commandName} PackName | AuthorName\`\n` +
        `╰─────────────────────`
    );
  }

  // CASE A: VIDEO (Auto 1-step extraction)
  if (primaryInfo.kind === "video") {
    return await withTyping(conn, message.from, async () => {
      await ackCommand(conn, message, "⏳");
      try {
        const videoBuf = await downloadMediaFromNode(conn, message, primarySource);
        if (!videoBuf || !videoBuf.length) {
          throw new Error("Could not download video.");
        }

        const rawWebp = await videoToAnimatedWebpSticker(videoBuf);
        const stickerBuffer = await addStickerExif(rawWebp, packname, author);

        let audioMsg = null;
        try {
          audioMsg = await buildAudioMessage(conn, videoBuf, "mp4", primaryInfo.seconds);
        } catch {
          // Silent video fallback
        }

        if (audioMsg) {
          await sendCombinedAudioSticker(conn, message.from, stickerBuffer, true, audioMsg, message);
          await ackCommand(conn, message, "✅");
          return;
        }

        // Silent video: start audio waiting session
        return startStickerSession({
          conn,
          message,
          stickerBuffer,
          isAnimated: true,
          packname,
          author,
          commandName,
        });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to process video: ${err?.message || err}`);
      }
    }, { timeoutMs: 90_000 });
  }

  // CASE B: IMAGE OR STICKER
  if (primaryInfo.kind === "image" || primaryInfo.kind === "sticker") {
    return await withTyping(conn, message.from, async () => {
      await ackCommand(conn, message, "⏳");
      try {
        const visualBuf = await downloadMediaFromNode(conn, message, primarySource);
        if (!visualBuf || !visualBuf.length) {
          throw new Error("Could not download image/sticker.");
        }

        let rawWebp;
        let isAnimated = false;
        if (primaryInfo.kind === "sticker") {
          rawWebp = visualBuf;
          isAnimated = isWebpAnimated(visualBuf);
        } else {
          rawWebp = await imageToWebpSticker(visualBuf);
          isAnimated = false;
        }

        const stickerBuffer = await addStickerExif(rawWebp, packname, author);
        await ackCommand(conn, message, "🔊");

        return startStickerSession({
          conn,
          message,
          stickerBuffer,
          isAnimated,
          packname,
          author,
          commandName,
        });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to prepare sticker: ${err?.message || err}`);
      }
    }, { timeoutMs: 45_000 });
  }

  // CASE C: AUDIO
  if (primaryInfo.kind === "audio") {
    return await withTyping(conn, message.from, async () => {
      await ackCommand(conn, message, "⏳");
      try {
        const audioBuf = await downloadMediaFromNode(conn, message, primarySource);
        if (!audioBuf || !audioBuf.length) {
          throw new Error("Could not download audio.");
        }

        const ext = /ogg|opus/i.test(primaryInfo.mime) ? "ogg" : "mp3";
        await ackCommand(conn, message, "🎵");

        return startAudioSession({
          conn,
          message,
          audioBuffer: audioBuf,
          audioExt: ext,
          audioDuration: primaryInfo.seconds,
          packname,
          author,
          commandName,
        });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to prepare audio: ${err?.message || err}`);
      }
    }, { timeoutMs: 45_000 });
  }
}

// ============================================================================
// COMMAND REGISTRATIONS
// ============================================================================

/** Main command: stickeraudio */
command(
  {
    pattern: "stickeraudio",
    fromMe: false,
    desc: "Create an audio sticker (sound sticker) from image/video and audio",
    usage: "#stickeraudio (reply to audio/image/video)",
    params: { argsRequired: false, requiresQuoted: true, format: "[pack|author]", description: "Reply to an image/video or audio message to create a sound sticker." },
    type: "media",
  },
  async (message, conn) => {
    await handleAudioSticker(message, conn, "stickeraudio");
  }
);

/** Alias: audiosticker */
command(
  {
    pattern: "audiosticker",
    fromMe: false,
    desc: "Alias for stickeraudio",
    type: "media",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    await handleAudioSticker(message, conn, "audiosticker");
  }
);

/** Alias: asticker */
command(
  {
    pattern: "asticker",
    fromMe: false,
    desc: "Alias for stickeraudio",
    type: "media",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    await handleAudioSticker(message, conn, "asticker");
  }
);

/** Short alias: sa */
command(
  {
    pattern: "sa",
    fromMe: false,
    desc: "Short alias for stickeraudio",
    type: "media",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    await handleAudioSticker(message, conn, "sa");
  }
);
