/**
 * Audio Sticker Utilities
 * Core helpers for audio sticker creation, conversion, proto-patching, and session handling.
 *
 * @module utils/audioSticker
 */

import { proto, prepareWAMessageMedia, downloadMediaMessage } from "baileys";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

import { createTempPath, safeUnlink } from "./media.js";
import { kvGet } from "../database/botKv.js";
import { MEDIA, BOT_INFO } from "../config/constants.js";
import { reply } from "./message.js";

const execFileAsync = promisify(execFile);

/** Maximum audio duration allowed for WhatsApp audio stickers (in seconds) */
export const MAX_AUDIO_DURATION = 25;

/** Maximum video duration for sticker frame animation (in seconds) */
export const MAX_STICKER_VIDEO_DURATION = 10;

/** Interactive session timeout in seconds */
export const SESSION_SECONDS = 60;

/** Target maximum size for the generated animated WebP sticker */
export const MAX_STICKER_SIZE_BYTES = 900 * 1024;

import { createTtlCache } from "./cache.js";

/**
 * Global session store to retain pending interactive sessions across turns (15-min TTL, max 100).
 * Key: `${chatJid}:${senderJid}`
 */
if (!globalThis.__audioStickerSessions) {
  globalThis.__audioStickerSessions = createTtlCache({ ttlMs: 15 * 60 * 1000, max: 100 });
}
export const sessions = globalThis.__audioStickerSessions;

// ============================================================================
// PROTOBUF PATCHING
// ============================================================================

/**
 * Patches Baileys proto definitions to support encoding and decoding WhatsApp's
 * AudioStickerMessage format (tags 210 for sticker audio and 1074 for future-proof audio sticker).
 *
 * @param {object} p - Baileys proto root object
 */
export function patchProtoInstance(p) {
  const M = p?.Message;
  if (!M || M.__audioStickerPatchedV3) return;

  if (M.StickerMessage) {
    const prevStickerEncode = M.StickerMessage.encode;
    M.StickerMessage.encode = function (message, writer) {
      const audio = message?.audioMessage;
      if (audio && Object.prototype.hasOwnProperty.call(message, "audioMessage")) {
        delete message.audioMessage;
      }
      const w = prevStickerEncode.call(this, message, writer);
      if (audio && M.AudioMessage) {
        message.audioMessage = audio;
        M.AudioMessage.encode(audio, w.uint32(210).fork()).ldelim();
      }
      return w;
    };

    if (typeof M.StickerMessage.fromObject === "function") {
      const prevStickerFromObj = M.StickerMessage.fromObject;
      M.StickerMessage.fromObject = function (object) {
        const msg = prevStickerFromObj.call(this, object);
        if (object?.audioMessage) {
          msg.audioMessage = M.AudioMessage?.fromObject
            ? M.AudioMessage.fromObject(object.audioMessage)
            : object.audioMessage;
        }
        return msg;
      };
    }
  }

  const prevMsgEncode = M.encode;
  M.encode = function (message, writer) {
    const asm = message?.audioStickerMessage;
    if (asm) {
      if (Object.prototype.hasOwnProperty.call(message, "stickerMessage")) {
        delete message.stickerMessage;
      }
      if (Object.prototype.hasOwnProperty.call(message, "audioStickerMessage")) {
        delete message.audioStickerMessage;
      }
    }
    const w = prevMsgEncode.call(this, message, writer);
    if (asm && M.FutureProofMessage) {
      message.audioStickerMessage = asm;
      M.FutureProofMessage.encode(asm, w.uint32(1074).fork()).ldelim();
    }
    return w;
  };

  if (typeof M.fromObject === "function") {
    const prevMsgFromObj = M.fromObject;
    M.fromObject = function (object) {
      const msg = prevMsgFromObj.call(this, object);
      if (object?.audioStickerMessage) {
        const inner = object.audioStickerMessage.message || object.audioStickerMessage;
        if (inner?.stickerMessage && object.audioStickerMessage.message?.stickerMessage?.audioMessage) {
          inner.stickerMessage.audioMessage =
            object.audioStickerMessage.message.stickerMessage.audioMessage;
        }
        msg.audioStickerMessage = { message: inner };
        delete msg.stickerMessage;
        if (inner) {
          Object.setPrototypeOf(msg, inner);
        }
      }
      return msg;
    };
  }

  M.__audioStickerPatchedV3 = true;
}

/**
 * Ensures Baileys proto instance is patched.
 */
export async function ensureAudioStickerProtoPatched() {
  patchProtoInstance(proto);
  for (const pkg of ["baileys", "@whiskeysockets/baileys"]) {
    try {
      const mod = await import(pkg);
      if (mod?.proto) patchProtoInstance(mod.proto);
      if (mod?.default?.proto) patchProtoInstance(mod.default.proto);
    } catch {
      /* ignore if not present */
    }
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Returns session key for user and chat isolation.
 *
 * @param {object} message
 * @returns {string}
 */
export function getSessionKey(message) {
  return `${message.from}:${message.sender}`;
}

/**
 * Retrieves the active session for the key or null if absent/expired.
 *
 * @param {string} key
 * @returns {object|null}
 */
export function getActiveSession(key) {
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    clearUserSession(key);
    return null;
  }
  return session;
}

/**
 * Clears an existing session and cancels any pending timer.
 *
 * @param {string} key
 */
export function clearUserSession(key) {
  const existing = sessions.get(key);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  sessions.delete(key);
}

/**
 * Starts a session waiting for audio input.
 *
 * @param {object} params
 */
export function startStickerSession({
  conn,
  message,
  stickerBuffer,
  isAnimated,
  packname,
  author,
  commandName = "stickeraudio",
}) {
  const key = getSessionKey(message);
  clearUserSession(key);

  const timer = setTimeout(() => {
    if (sessions.has(key)) {
      sessions.delete(key);
      reply(
        conn,
        message,
        `⏰ *AUDIO STICKER SESSION EXPIRED*\n> _The ${SESSION_SECONDS}s wait time has ended. Re-run \`${BOT_INFO.PREFIX}${commandName}\` with an image/video to try again._`
      ).catch(() => {});
    }
  }, SESSION_SECONDS * 1000);

  sessions.set(key, {
    waitingFor: "audio",
    stickerBuffer,
    isAnimated,
    packname,
    author,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
    processing: false,
    timer,
  });

  return reply(
    conn,
    message,
    `🔊 *AUDIO STICKER SESSION ACTIVE*\n` +
      `> _Sticker media saved to temporary session._\n\n` +
      `╭─「 *SESSION DETAILS* 」\n` +
      `│ ◦ *Pack* : *${packname}*\n` +
      `│ ◦ *Author* : *${author}*\n` +
      `│ ◦ *Type* : \`${isAnimated ? "Animated GIF/Video" : "Static Image"}\`\n` +
      `│ ◦ *Audio Max Duration* : \`${MAX_AUDIO_DURATION}s\`\n` +
      `│ ◦ *Expires In* : \`${SESSION_SECONDS}s\`\n` +
      `╰─────────────────────\n\n` +
      `╭─「 *NEXT STEP* 」\n` +
      `│ 1. Reply to an *Audio / Voice Note* with \`${BOT_INFO.PREFIX}${commandName}\`\n` +
      `│ 2. Or send an *Audio file* with \`${BOT_INFO.PREFIX}${commandName}\`\n` +
      `│ 3. Type \`${BOT_INFO.PREFIX}${commandName} cancel\` to abort\n` +
      `╰─────────────────────`
  );
}

/**
 * Starts a session waiting for visual sticker input.
 *
 * @param {object} params
 */
export function startAudioSession({
  conn,
  message,
  audioBuffer,
  audioExt,
  audioDuration,
  packname,
  author,
  commandName = "stickeraudio",
}) {
  const key = getSessionKey(message);
  clearUserSession(key);

  const timer = setTimeout(() => {
    if (sessions.has(key)) {
      sessions.delete(key);
      reply(
        conn,
        message,
        `⏰ *AUDIO STICKER SESSION EXPIRED*\n> _The ${SESSION_SECONDS}s wait time has ended. Re-run \`${BOT_INFO.PREFIX}${commandName}\` to try again._`
      ).catch(() => {});
    }
  }, SESSION_SECONDS * 1000);

  sessions.set(key, {
    waitingFor: "visual",
    audioBuffer,
    audioExt,
    audioDuration,
    packname,
    author,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
    processing: false,
    timer,
  });

  return reply(
    conn,
    message,
    `🎵 *AUDIO RECORDED — WAITING FOR STICKER*\n` +
      `> _Audio track saved to temporary session._\n\n` +
      `╭─「 *NEXT STEP* 」\n` +
      `│ 1. Reply to an *Image / Video / Sticker* with \`${BOT_INFO.PREFIX}${commandName}\`\n` +
      `│ 2. Type \`${BOT_INFO.PREFIX}${commandName} cancel\` to abort (expires in ${SESSION_SECONDS}s)\n` +
      `╰─────────────────────`
  );
}

// ============================================================================
// EXIF AND METADATA UTILITIES
// ============================================================================

/**
 * Retrieves configured sticker pack name and author.
 *
 * @returns {Promise<{ pack: string, author: string }>}
 */
export async function getStickerMetadata() {
  const pack =
    (await kvGet("sticker_packname")) || MEDIA.STICKER_PACKNAME || "X-Asena";
  const author =
    (await kvGet("sticker_author")) || MEDIA.STICKER_AUTHOR || "Audio Sticker";
  return { pack, author };
}

/**
 * Parses custom pack name and author from command arguments (e.g. "MyPack | MyAuthor").
 *
 * @param {string} rawArgs
 * @param {object} defaults
 * @returns {{ packname: string, author: string }}
 */
export function parseCustomMetadata(rawArgs, defaults) {
  if (!rawArgs || typeof rawArgs !== "string") {
    return { packname: defaults.pack, author: defaults.author };
  }
  const clean = rawArgs.trim();
  if (clean.includes("|")) {
    const parts = clean.split("|");
    return {
      packname: parts[0].trim() || defaults.pack,
      author: parts.slice(1).join("|").trim() || defaults.author,
    };
  }
  if (clean.length > 0 && !/^(cancel|batal|stop)$/i.test(clean)) {
    return { packname: clean, author: defaults.author };
  }
  return { packname: defaults.pack, author: defaults.author };
}

/**
 * Builds standard WhatsApp sticker EXIF metadata buffer.
 *
 * @param {string} packname
 * @param {string} author
 * @returns {Buffer}
 */
export function buildExifPayload(packname, author) {
  const json = {
    "sticker-pack-id": "com.xasena.audiosticker",
    "sticker-pack-name": String(packname ?? "X-Asena"),
    "sticker-pack-publisher": String(author ?? "Audio Sticker"),
    emojis: ["🔊", "✨"],
  };
  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);
  return exif;
}

/**
 * Injects EXIF metadata directly into WebP RIFF chunks if webpmux is unavailable.
 *
 * @param {Buffer} webpBuffer
 * @param {Buffer} exifData
 * @returns {Buffer}
 */
export function injectExifRiff(webpBuffer, exifData) {
  if (
    !Buffer.isBuffer(webpBuffer) ||
    webpBuffer.length < 16 ||
    webpBuffer.toString("ascii", 0, 4) !== "RIFF" ||
    webpBuffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return webpBuffer;
  }

  const chunks = [];
  let offset = 12;
  let hasVp8x = false;
  let isAnim = false;

  while (offset + 8 <= webpBuffer.length) {
    const id = webpBuffer.toString("ascii", offset, offset + 4);
    const size = webpBuffer.readUInt32LE(offset + 4);
    const padded = size + (size % 2);
    const end = Math.min(webpBuffer.length, offset + 8 + padded);
    const rawChunk = Buffer.from(webpBuffer.subarray(offset, end));

    if (id === "VP8X") hasVp8x = true;
    if (id === "ANIM" || id === "ANMF") isAnim = true;
    if (id !== "EXIF") chunks.push({ id, rawChunk });

    offset = end;
  }

  if (!hasVp8x) {
    const vp8x = Buffer.alloc(18);
    vp8x.write("VP8X", 0, 4, "ascii");
    vp8x.writeUInt32LE(10, 4);
    vp8x[8] = 0x18;
    vp8x.writeUIntLE(511, 12, 3);
    vp8x.writeUIntLE(511, 15, 3);
    chunks.unshift({ id: "VP8X", rawChunk: vp8x });
  } else {
    const vp8xEntry = chunks.find((c) => c.id === "VP8X");
    if (vp8xEntry && vp8xEntry.rawChunk.length >= 18) {
      vp8xEntry.rawChunk[8] |= 0x08;
      if (isAnim) vp8xEntry.rawChunk[8] |= 0x02;
    }
  }

  const padByte = exifData.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
  const exifHeader = Buffer.alloc(8);
  exifHeader.write("EXIF", 0, 4, "ascii");
  exifHeader.writeUInt32LE(exifData.length, 4);
  chunks.push({ id: "EXIF", rawChunk: Buffer.concat([exifHeader, exifData, padByte]) });

  const body = Buffer.concat(chunks.map((c) => c.rawChunk));
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, 4, "ascii");

  return Buffer.concat([header, body]);
}

/**
 * Attaches sticker EXIF metadata (Pack, Author) to a WebP buffer.
 *
 * @param {Buffer} webpBuffer
 * @param {string} packname
 * @param {string} author
 * @returns {Promise<Buffer>}
 */
export async function addStickerExif(webpBuffer, packname, author) {
  const exifData = buildExifPayload(packname, author);
  try {
    const webpMod = await import("node-webpmux");
    const WebpImage = webpMod.default?.Image || webpMod.Image || webpMod.default;
    if (WebpImage) {
      const img = new WebpImage();
      await img.load(webpBuffer);
      img.exif = exifData;
      return await img.save(null);
    }
  } catch {
    /* fallback to RIFF chunk injection */
  }
  return injectExifRiff(webpBuffer, exifData);
}

// ============================================================================
// MEDIA PROCESSING (STICKER & AUDIO)
// ============================================================================

/**
 * Checks whether a WebP buffer contains animation.
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isWebpAnimated(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return false;
  if (buf.toString("ascii", 12, 16) === "VP8X" && (buf[20] & 0x02) !== 0) return true;
  return buf.includes(Buffer.from("ANIM"));
}

/**
 * Converts a static image buffer to a 512x512 WebP sticker.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function imageToWebpSticker(buffer) {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buffer, { animated: true })
      .rotate()
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    const inPath = createTempPath(".jpg");
    const outPath = createTempPath(".webp");
    try {
      await fs.writeFile(inPath, buffer);
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        inPath,
        "-vf",
        "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1",
        "-c:v",
        "libwebp",
        "-lossless",
        "0",
        "-q:v",
        "80",
        "-an",
        outPath,
      ]);
      return await fs.readFile(outPath);
    } finally {
      await safeUnlink(inPath);
      await safeUnlink(outPath);
    }
  }
}

/**
 * Converts a video/GIF buffer into an animated 512x512 WebP sticker.
 * Iterates through adaptive encoding profiles to stay under size limits.
 *
 * @param {Buffer} buffer
 * @param {number} [maxDuration=MAX_STICKER_VIDEO_DURATION]
 * @returns {Promise<Buffer>}
 */
export async function videoToAnimatedWebpSticker(buffer, maxDuration = MAX_STICKER_VIDEO_DURATION) {
  const inPath = createTempPath(".mp4");
  const outPath = createTempPath(".webp");

  const encodeProfile = async (fps, quality) => {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-t",
      String(maxDuration),
      "-vf",
      `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1`,
      "-c:v",
      "libwebp",
      "-lossless",
      "0",
      "-compression_level",
      "6",
      "-q:v",
      String(quality),
      "-loop",
      "0",
      "-preset",
      "picture",
      "-an",
      "-vsync",
      "0",
      outPath,
    ]);
    return await fs.readFile(outPath);
  };

  try {
    await fs.writeFile(inPath, buffer);
    const profiles = [
      [10, 50],
      [8, 36],
      [6, 24],
      [5, 16],
    ];

    let result = null;
    for (const [fps, quality] of profiles) {
      result = await encodeProfile(fps, quality);
      if (result.length <= MAX_STICKER_SIZE_BYTES) break;
    }
    return result;
  } finally {
    await safeUnlink(inPath);
    await safeUnlink(outPath);
  }
}

/**
 * Parses time=HH:MM:SS.xx from ffmpeg stderr to compute duration in seconds.
 *
 * @param {string} stderrText
 * @returns {number}
 */
export function parseFfmpegDuration(stderrText) {
  const matches = [...String(stderrText || "").matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!matches.length) return 0;
  const last = matches[matches.length - 1];
  const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Number.isFinite(sec) ? sec : 0;
}

/**
 * Generates an audio waveform byte buffer for WhatsApp voice playback visualization.
 *
 * @param {Buffer} seedBuf
 * @param {number} [length=64]
 * @returns {Buffer}
 */
export function generateWaveform(seedBuf, length = 64) {
  const wf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    const b = seedBuf && seedBuf.length ? seedBuf[(i * 19 + 7) % seedBuf.length] : i * 11;
    wf[i] = 18 + (b % 76);
  }
  return wf;
}

/**
 * Converts audio/video media into WhatsApp-compliant OGG Opus mono 48kHz audio.
 *
 * @param {Buffer} buffer
 * @param {string} [ext='mp3']
 * @param {number} [maxDuration=MAX_AUDIO_DURATION]
 * @returns {Promise<{ oggBuffer: Buffer, duration: number }>}
 */
export async function convertToOggOpus(buffer, ext = "mp3", maxDuration = MAX_AUDIO_DURATION) {
  const inPath = createTempPath(`.${ext}`);
  const outPath = createTempPath(".ogg");
  try {
    await fs.writeFile(inPath, buffer);
    // Use strict 16kHz mono Opus VOIP profile matching native WhatsApp iOS/Android PTT streams
    const { stderr } = await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-vn",
      "-map",
      "0:a:0",
      "-t",
      String(maxDuration),
      "-af",
      "aresample=16000:async=1:first_pts=0",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-vbr",
      "on",
      "-compression_level",
      "10",
      "-frame_duration",
      "20",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-application",
      "voip",
      "-avoid_negative_ts",
      "make_zero",
      "-f",
      "ogg",
      outPath,
    ]);

    const oggBuffer = await fs.readFile(outPath);
    if (!oggBuffer || oggBuffer.length < 200) {
      throw new Error("Converted audio is empty or too short.");
    }
    const duration = parseFfmpegDuration(stderr);
    return { oggBuffer, duration };
  } finally {
    await safeUnlink(inPath);
    await safeUnlink(outPath);
  }
}

/**
 * Uploads audio to WhatsApp and formats it as an AudioMessage for embedding into the sticker.
 *
 * @param {object} conn
 * @param {Buffer} audioBuffer
 * @param {string} [ext='mp3']
 * @param {number} [fallbackDuration=0]
 * @returns {Promise<object>}
 */
export async function buildAudioMessage(conn, audioBuffer, ext = "mp3", fallbackDuration = 0) {
  const { oggBuffer, duration } = await convertToOggOpus(audioBuffer, ext);

  const { audioMessage } = await prepareWAMessageMedia(
    {
      audio: oggBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    },
    { upload: conn.waUploadToServer }
  );

  const chosenSec = duration > 0 ? duration : fallbackDuration > 0 ? fallbackDuration : 5;
  const finalSeconds = Math.max(1, Math.min(MAX_AUDIO_DURATION, Math.round(chosenSec)));

  audioMessage.seconds = finalSeconds;
  audioMessage.ptt = true;
  audioMessage.mimetype = "audio/ogg; codecs=opus";
  if (!audioMessage.waveform || !audioMessage.waveform.length) {
    audioMessage.waveform = generateWaveform(oggBuffer);
  }

  return audioMessage;
}

/**
 * Prepares and relays the combined audio sticker message.
 *
 * @param {object} conn
 * @param {string} chatJid
 * @param {Buffer} stickerBuffer
 * @param {boolean} isAnimated
 * @param {object} audioMessage
 * @param {object} [quoted]
 */
export async function sendCombinedAudioSticker(conn, chatJid, stickerBuffer, isAnimated, audioMessage, quoted) {
  await ensureAudioStickerProtoPatched();

  const prepared = await prepareWAMessageMedia(
    { sticker: stickerBuffer, isAnimated: Boolean(isAnimated) },
    { upload: conn.waUploadToServer }
  );

  prepared.stickerMessage.mimetype = prepared.stickerMessage.mimetype || "image/webp";
  prepared.stickerMessage.isAnimated = Boolean(isAnimated);
  prepared.stickerMessage.audioMessage = audioMessage;

  const payload = {
    audioStickerMessage: { message: prepared },
    messageContextInfo: { messageSecret: randomBytes(32) },
  };

  const options = {};
  if (quoted?.key) {
    options.quoted = {
      key: quoted.key,
      message: quoted.message,
    };
  }

  return await conn.relayMessage(chatJid, payload, options);
}

// ============================================================================
// MEDIA EXTRACTION & INSPECTION
// ============================================================================

/**
 * Unwraps view-once, ephemeral, or edited wrappers to find inner content.
 *
 * @param {object} raw
 * @returns {object}
 */
export function unwrapMessage(raw) {
  let cur = raw;
  for (let i = 0; i < 6 && cur; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.viewOnceMessageV2Extension?.message ||
      cur.viewOnceMessage?.message ||
      cur.documentWithCaptionMessage?.message ||
      cur.editedMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur || {};
}

/**
 * Inspects a message node to classify media kind ('video', 'image', 'sticker', 'audio').
 *
 * @param {object} node
 * @returns {{ kind: string|null, mime: string, seconds: number, isAnimated: boolean, mediaKeyName: string|null }}
 */
export function inspectMediaNode(node) {
  if (!node) return { kind: null, mime: "", seconds: 0, isAnimated: false, mediaKeyName: null };

  const container = unwrapMessage(node.raw || node.message || node.rawMessage || {});
  const type = String(node.type || "").toLowerCase();
  const mime = String(node.mimetype || node.msg?.mimetype || "").toLowerCase();
  const seconds = Number(node.seconds || node.message?.seconds || node.raw?.seconds || 0);

  if (type === "video" || /video/i.test(mime) || container.videoMessage) {
    return { kind: "video", mime: mime || "video/mp4", seconds, isAnimated: true, mediaKeyName: "videoMessage" };
  }
  if (type === "sticker" || /webp/i.test(mime) || container.stickerMessage) {
    const isAnim = Boolean(node.isAnimated || container.stickerMessage?.isAnimated);
    return { kind: "sticker", mime: "image/webp", seconds: 0, isAnimated: isAnim, mediaKeyName: "stickerMessage" };
  }
  if (type === "image" || /image/i.test(mime) || container.imageMessage) {
    return { kind: "image", mime: mime || "image/jpeg", seconds: 0, isAnimated: false, mediaKeyName: "imageMessage" };
  }
  if (type === "audio" || /audio|ogg|opus|mpeg|mp3|wav|m4a|aac/i.test(mime) || container.audioMessage) {
    return { kind: "audio", mime: mime || "audio/mpeg", seconds, isAnimated: false, mediaKeyName: "audioMessage" };
  }

  return { kind: null, mime: "", seconds: 0, isAnimated: false, mediaKeyName: null };
}

/**
 * Downloads media buffer from a message or quoted message node.
 *
 * @param {object} conn
 * @param {object} message
 * @param {string} source - 'quoted' | 'self'
 * @returns {Promise<Buffer|null>}
 */
export async function downloadMediaFromNode(conn, message, source = "quoted") {
  const target = source === "quoted" ? message.quoted : message;
  if (!target) return null;

  const info = inspectMediaNode(target);
  if (!info.kind || !info.mediaKeyName) return null;

  // Build a synthetic WAMessage suitable for Baileys downloadMediaMessage
  const container = unwrapMessage(target.raw || target.message || target.rawMessage || {});
  const innerContent =
    container[info.mediaKeyName] ||
    (target.raw && target.raw[info.mediaKeyName]) ||
    target.message ||
    target;

  const downloadMsg = {
    key: {
      remoteJid: message.from,
      id: source === "quoted" ? message.quoted?.id || "quoted-media" : message.id,
      fromMe: false,
      participant: message.quoted?.participant || message.participant,
    },
    message: {
      [info.mediaKeyName]: innerContent,
    },
  };

  try {
    const buf = await downloadMediaMessage(
      downloadMsg,
      "buffer",
      {},
      {
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
        reuploadRequest: conn.updateMediaMessage?.bind(conn),
      }
    );
    if (buf && buf.length) {
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    }
  } catch (err) {
    // If synthetic download fails, try direct method if available
    if (typeof target.download === "function") {
      try {
        const directBuf = await target.download();
        if (directBuf && directBuf.length) return Buffer.from(directBuf);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
