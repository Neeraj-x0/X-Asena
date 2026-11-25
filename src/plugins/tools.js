/**
 * Accessory tools — tomp3, url, quote, fancy, tts, ttp, attp, removebg
 */

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";
import {
  downloadQuotedOrSelf,
  createTempPath,
  safeUnlink,
  writeTempFile,
  toMp3,
  assertAudioSize,
} from "../utils/media.js";
import { MEDIA, BOT_INFO } from "../config/constants.js";
import { readFile, stat } from "fs/promises";

const FANCY_MAPS = [
  // Mathematical Bold
  {
    name: "bold",
    map: (c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + (code - 97));
      return c;
    },
  },
  // Mathematical Italic
  {
    name: "italic",
    map: (c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d434 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d44e + (code - 97));
      return c;
    },
  },
  // Bubbled
  {
    name: "bubble",
    map: (c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x24b6 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x24d0 + (code - 97));
      return c;
    },
  },
  // Fullwidth
  {
    name: "fullwidth",
    map: (c) => {
      const code = c.codePointAt(0);
      if (code >= 33 && code <= 126) return String.fromCodePoint(0xff01 + (code - 33));
      return c;
    },
  },
];

function fancyText(text) {
  return FANCY_MAPS.map((f) => ({
    name: f.name,
    text: [...text].map((c) => f.map(c)).join(""),
  }));
}

command(
  {
    pattern: "tomp3",
    fromMe: false,
    desc: "Convert video/audio to mp3",
    usage: "#tomp3 (reply to video or audio)",
    params: { argsRequired: false, requiresQuoted: true, format: "", description: "Extracts or converts quoted video/voice note into MP3 audio." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      let input;
      let output;
      try {
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media || !["video", "audio"].includes(media.type)) {
          await replyFail(conn, message, "Reply to a video or audio.");
          return;
        }
        const ext = media.type === "audio" ? ".audio" : ".mp4";
        input = await writeTempFile(media.buffer, ext);
        output = await toMp3(input);
        const st = await stat(output);
        assertAudioSize(st.size);
        const buf = await readFile(output);
        await conn.sendMessage(
          message.from,
          { audio: buf, mimetype: "audio/mpeg", ptt: false },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(
          conn,
          message,
          err?.message || "tomp3 failed (need FFmpeg on PATH)."
        );
      } finally {
        await safeUnlink(input);
        await safeUnlink(output);
      }
    }, { timeoutMs: 120_000 });
  }
);

async function uploadCatbox(buffer, filename) {
  const axios = (await import("axios")).default;
  const form = new globalThis.FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([buffer]),
    filename || "file.bin"
  );
  const res = await axios.post("https://catbox.moe/user/api.php", form, {
    maxBodyLength: Infinity,
    timeout: 60_000,
  });
  return String(res.data).trim();
}

async function urlHandler(message, conn) {
  await withTyping(conn, message.from, async () => {
    try {
      const media = await downloadQuotedOrSelf(conn, message);
      if (!media) {
        await replyFail(conn, message, "Reply to an image/video/audio/document.");
        return;
      }
      let ext = "bin";
      try {
        const { fileTypeFromBuffer } = await import("file-type");
        const ft = await fileTypeFromBuffer(media.buffer);
        if (ft?.ext) ext = ft.ext;
      } catch {
        /* ignore */
      }
      const url = await uploadCatbox(media.buffer, `upload.${ext}`);
      if (!url.startsWith("http")) {
        throw new Error("Upload failed.");
      }
      await reply(conn, message, `🔗 ${url}`);
    } catch (err) {
      await replyFail(conn, message, err?.message || "Upload failed.");
    }
  }, { timeoutMs: 90_000 });
}

command(
  {
    pattern: "toururl",
    fromMe: false,
    desc: "Upload media and get a URL",
    usage: "#toururl (reply to image/video/audio)",
    params: { argsRequired: false, requiresQuoted: true, format: "", description: "Uploads quoted media file and returns a public URL." },
    type: "media",
  },
  urlHandler
);

command(
  {
    pattern: "url",
    fromMe: false,
    desc: "Alias for tourl",
    type: "media",
    dontAddCommandList: true,
  },
  urlHandler
);

command(
  {
    pattern: "quote",
    fromMe: false,
    desc: "Fake quote sticker from text / reply",
    usage: "#quote <text> (or reply to message)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "[text]", description: "Creates a fake chat quote sticker from message or text." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        let text =
          getCommandArgs(message.body, "quote") ||
          message.quoted?.text ||
          "";
        text = String(text).trim().slice(0, 200);
        if (!text) {
          await replyFail(
            conn,
            message,
            `Usage: \`${BOT_INFO.PREFIX}quote <text>\` or reply to a message`
          );
          return;
        }
        const name = message.quoted
          ? message.message?.contextInfo?.participant?.split("@")[0] ||
            message.pushName ||
            "User"
          : message.pushName || "User";

        const sharp = (await import("sharp")).default;
        const escaped = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="32" fill="#1f2c34"/>
  <text x="40" y="80" font-size="28" fill="#53bdeb" font-family="Arial,sans-serif">${String(name).slice(0, 24)}</text>
  <foreignObject x="40" y="110" width="432" height="340">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#e9edef;font-size:26px;font-family:Arial,sans-serif;line-height:1.35;word-wrap:break-word;">
      ${escaped}
    </div>
  </foreignObject>
</svg>`;
        const webp = await sharp(Buffer.from(svg))
          .webp({ quality: 85 })
          .toBuffer();
        await conn.sendMessage(
          message.from,
          { sticker: webp },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "quote failed.");
      }
    });
  }
);

command(
  {
    pattern: "fancy",
    fromMe: false,
    desc: "Fancy unicode text styles",
    usage: "#fancy <text>",
    params: { argsRequired: true, requiresQuoted: false, format: "<text>", description: "Generates decorative Unicode font variants of the input text." },
    type: "media",
  },
  async (message, conn) => {
    const text =
      getCommandArgs(message.body, "fancy") ||
      message.quoted?.text ||
      "";
    if (!String(text).trim()) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}fancy <text>\``);
      return;
    }
    const styles = fancyText(String(text).trim().slice(0, 80));
    await reply(
      conn,
      message,
      styles.map((s) => `*${s.name}*\n${s.text}`).join("\n\n")
    );
  }
);

command(
  {
    pattern: "tts",
    fromMe: false,
    desc: "Google TTS audio",
    usage: "#tts [lang_code] <text>",
    params: { argsRequired: true, requiresQuoted: "optional", format: "[lang] <text>", description: "Converts text to Google TTS voice audio (e.g. 'en Hello world' or 'es Hola')." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        let text =
          getCommandArgs(message.body, "tts") ||
          message.quoted?.text ||
          "";
        text = String(text).trim();
        if (!text) {
          await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}tts <text>\``);
          return;
        }
        // lang:text or just text
        let lang = "en";
        const m = text.match(/^([a-z]{2})[:|]\s*(.+)$/i);
        if (m) {
          lang = m[1].toLowerCase();
          text = m[2];
        }
        text = text.slice(0, 200);
        const { getAudioUrl } = await import("google-tts-api");
        const url = getAudioUrl(text, {
          lang,
          slow: false,
          host: "https://translate.google.com",
        });
        const axios = (await import("axios")).default;
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });
        const buf = Buffer.from(res.data);
        await conn.sendMessage(
          message.from,
          { audio: buf, mimetype: "audio/mpeg", ptt: true },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "tts failed.");
      }
    });
  }
);

async function textToSticker(message, conn, { animated = false } = {}) {
  const pattern = animated ? "attp" : "ttp";
  let text =
    getCommandArgs(message.body, pattern) ||
    message.quoted?.text ||
    "";
  text = String(text).trim().slice(0, 40);
  if (!text) {
    await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}${pattern} <text>\``);
    return;
  }

  const sharp = (await import("sharp")).default;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (!animated) {
    const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="transparent"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
    font-size="64" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="6"
    paint-order="stroke" font-family="Arial Black,Arial,sans-serif">${escaped}</text>
</svg>`;
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
    await conn.sendMessage(
      message.from,
      { sticker: webp },
      { quoted: { key: message.key, message: message.message } }
    );
    return;
  }

  // Simple “animated” attp: cycle fill colors across frames via sharp → ffmpeg webp
  const colors = ["#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
  const frames = [];
  try {
    for (let i = 0; i < colors.length; i++) {
      const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="transparent"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
    font-size="64" font-weight="700" fill="${colors[i]}" stroke="#000000" stroke-width="6"
    paint-order="stroke" font-family="Arial Black,Arial,sans-serif">${escaped}</text>
</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const fp = await writeTempFile(png, `.f${i}.png`);
      frames.push(fp);
    }
    const listFile = createTempPath(".txt");
    const { writeFile } = await import("fs/promises");
    await writeFile(
      listFile,
      frames.map((f) => `file '${f.replace(/\\/g, "/")}'\nduration 0.12`).join("\n") +
        `\nfile '${frames[frames.length - 1].replace(/\\/g, "/")}'`
    );
    const out = createTempPath(".webp");
    const { ffmpegConvert } = await import("../utils/media.js");
    try {
      await ffmpegConvert(listFile, out, (cmd) =>
        cmd
          .inputOptions(["-f", "concat", "-safe", "0"])
          .outputOptions(["-vcodec", "libwebp", "-loop", "0", "-an"])
          .format("webp")
      );
      const buf = await readFile(out);
      await conn.sendMessage(
        message.from,
        { sticker: buf },
        { quoted: { key: message.key, message: message.message } }
      );
    } finally {
      await safeUnlink(listFile);
      await safeUnlink(out);
    }
  } catch {
    // Fallback static if ffmpeg anim fails
    const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
    font-size="64" font-weight="700" fill="#ff0055" stroke="#000" stroke-width="6"
    paint-order="stroke" font-family="Arial Black,Arial,sans-serif">${escaped}</text>
</svg>`;
    const webp = await sharp(Buffer.from(svg)).webp().toBuffer();
    await conn.sendMessage(
      message.from,
      { sticker: webp },
      { quoted: { key: message.key, message: message.message } }
    );
  } finally {
    await Promise.all(frames.map(safeUnlink));
  }
}

command(
  {
    pattern: "ttp",
    fromMe: false,
    desc: "Text to sticker",
    usage: "#ttp <text>",
    params: { argsRequired: true, requiresQuoted: false, format: "<text>", description: "Renders input text onto a styled transparent WhatsApp sticker." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        await textToSticker(message, conn, { animated: false });
      } catch (err) {
        await replyFail(conn, message, err?.message || "ttp failed.");
      }
    });
  }
);

command(
  {
    pattern: "attp",
    fromMe: false,
    desc: "Animated text sticker",
    usage: "#attp <text>",
    params: { argsRequired: true, requiresQuoted: false, format: "<text>", description: "Renders color-cycling animated text onto a WhatsApp sticker." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        await textToSticker(message, conn, { animated: true });
      } catch (err) {
        await replyFail(conn, message, err?.message || "attp failed.");
      }
    }, { timeoutMs: 60_000 });
  }
);

command(
  {
    pattern: "removebg",
    fromMe: false,
    desc: "Remove image background (API key)",
    usage: "#removebg (reply to an image)",
    params: { argsRequired: false, requiresQuoted: true, format: "", description: "Removes background from quoted image (requires REMOVEBG_API_KEY)." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        const key = MEDIA.REMOVEBG_API_KEY;
        if (!key) {
          await replyFail(
            conn,
            message,
            "Set `REMOVEBG_API_KEY` in env to use this command."
          );
          return;
        }
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media || media.type !== "image") {
          await replyFail(conn, message, "Reply to an image.");
          return;
        }
        const axios = (await import("axios")).default;
        const form = new globalThis.FormData();
        form.append("size", "auto");
        form.append(
          "image_file",
          new Blob([media.buffer]),
          "image.png"
        );
        const res = await axios.post(
          MEDIA.REMOVEBG_API_URL,
          form,
          {
            headers: { "X-Api-Key": key },
            responseType: "arraybuffer",
            timeout: 60_000,
            validateStatus: () => true,
          }
        );
        if (res.status !== 200) {
          const msg = Buffer.from(res.data || "").toString("utf8").slice(0, 200);
          throw new Error(msg || `remove.bg error ${res.status}`);
        }
        await conn.sendMessage(
          message.from,
          { image: Buffer.from(res.data), caption: "🎨 Background removed" },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "removebg failed.");
      }
    }, { timeoutMs: 90_000 });
  }
);

