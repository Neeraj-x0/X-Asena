/**
 * Sticker plugins — #sticker #take #toimg #exif
 */



import { command } from "../plugins.js";
import {
  reply,
  replyOk,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";

import {
  downloadQuotedOrSelf,
  createTempPath,
  safeUnlink,
  writeTempFile,
  ffmpegConvert,
} from "../utils/media.js";

import { kvGet, kvSet } from "../database/botKv.js";
import { MEDIA, BOT_INFO } from "../config/constants.js";



async function getPackMeta() {
  const pack =
    (await kvGet("sticker_packname")) || MEDIA.STICKER_PACKNAME || "X-Asena";
  const author =
    (await kvGet("sticker_author")) || MEDIA.STICKER_AUTHOR || "X-Asena";
  return { pack, author };
}



/**
 * WhatsApp sticker EXIF (JSON in EXIF IFD)
 */
function buildExifBuffer(packname, author) {
  const json = JSON.stringify({
    "sticker-pack-id": "com.xasena.whatsapp",
    "sticker-pack-name": packname,
    "sticker-pack-publisher": author,
    emojis: ["✨"],
  });
  const jsonBuff = Buffer.from(json, "utf8");
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(jsonBuff.length, 0);
  return Buffer.concat([exifAttr, len, jsonBuff]);
}



async function addExif(webpBuffer, packname, author) {
  const { Image } = await import("node-webpmux");
  const img = new Image();
  await img.load(webpBuffer);
  img.exif = buildExifBuffer(packname, author);
  return img.save(null);
}



async function imageToWebp(buffer) {
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 80 })
    .toBuffer();
}



async function videoToWebp(buffer) {
  const input = await writeTempFile(buffer, ".mp4");
  const output = createTempPath(".webp");
  try {
    await ffmpegConvert(input, output, (cmd) =>
      cmd
        .inputOptions(["-t", String(MEDIA.MAX_STICKER_VIDEO_DURATION)])
        .complexFilter([
          "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=black@0",
        ])
        .outputOptions([
          "-vcodec",
          "libwebp",
          "-loop",
          "0",
          "-ss",
          "00:00:00",
          "-preset",
          "default",
          "-an",
          "-vsync",
          "0",
        ])
        .format("webp")
    );
    const { readFile } = await import("fs/promises");
    return await readFile(output);
  } finally {
    await safeUnlink(input);
    await safeUnlink(output);
  }
}



async function makeStickerBuffer(media) {
  if (media.type === "image" || media.type === "sticker") {
    if (
      media.mimetype?.includes("webp") ||
      media.type === "sticker"
    ) {
      return media.buffer;
    }
    return imageToWebp(media.buffer);
  }
  if (media.type === "video") {
    return videoToWebp(media.buffer);
  }
  throw new Error("Reply to an image, video, gif, or sticker.");
}



async function sendSticker(conn, message, webp, pack, author) {
  const withExif = await addExif(webp, pack, author);
  await conn.sendMessage(
    message.from,
    { sticker: withExif },
    {
      quoted: {
        key: message.key,
        message: message.message,
      },
    }
  );
}



command(
  {
    pattern: "sticker",
    fromMe: false,
    desc: "Convert image/video to sticker",
    usage: "#sticker [pack|author] (reply to or send with image/video)",
    params: { argsRequired: false, requiresQuoted: "optional", format: "[pack|author]", description: "Convert image or short video into a WhatsApp WebP sticker." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media) {
          await replyFail(
            conn,
            message,
            `Reply to an image/video with \`${BOT_INFO.PREFIX}sticker\``
          );
          return;
        }
        const { pack, author } = await getPackMeta();
        const webp = await makeStickerBuffer(media);
        await sendSticker(conn, message, webp, pack, author);
      } catch (err) {
        await replyFail(conn, message, err?.message || "Sticker failed.");
      }
    }, { timeoutMs: 60_000 });
  }
);



command(
  {
    pattern: "s",
    fromMe: false,
    desc: "Alias for sticker",
    type: "media",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    // Reuse sticker logic via re-dispatch is awkward; call same flow
    await withTyping(conn, message.from, async () => {
      try {
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media) {
          await replyFail(
            conn,
            message,
            `Reply to an image/video with \`${BOT_INFO.PREFIX}s\``
          );
          return;
        }
        const { pack, author } = await getPackMeta();
        const webp = await makeStickerBuffer(media);
        await sendSticker(conn, message, webp, pack, author);
      } catch (err) {
        await replyFail(conn, message, err?.message || "Sticker failed.");
      }
    }, { timeoutMs: 60_000 });
  }
);



async function takeHandler(message, conn) {
  await withTyping(conn, message.from, async () => {
    try {
      if (!message.quoted || message.quoted.type !== "sticker") {
        await replyFail(conn, message, "Reply to a sticker.");
        return;
      }
      const media = await downloadQuotedOrSelf(conn, message);
      if (!media) {
        await replyFail(conn, message, "Could not download sticker.");
        return;
      }
      const args =
        getCommandArgs(message.body, "take") ||
        getCommandArgs(message.body, "steal") ||
        "";
      let pack;
      let author;
      if (args.includes("|")) {
        const [p, a] = args.split("|").map((x) => x.trim());
        pack = p || (await getPackMeta()).pack;
        author = a || (await getPackMeta()).author;
      } else if (args.trim()) {
        pack = args.trim();
        author = (await getPackMeta()).author;
      } else {
        ({ pack, author } = await getPackMeta());
      }
      await sendSticker(conn, message, media.buffer, pack, author);
    } catch (err) {
      await replyFail(conn, message, err?.message || "Take failed.");
    }
  });
}



command(
  {
    pattern: "take",
    fromMe: false,
    desc: "Repack sticker EXIF (Pack|Author)",
    usage: "#take <pack_name>|<author_name> (reply to sticker)",
    params: { argsRequired: false, requiresQuoted: true, format: "[pack|author]", description: "Re-write sticker metadata EXIF pack and author names." },
    type: "media",
  },
  takeHandler
);



command(
  {
    pattern: "steal",
    fromMe: false,
    desc: "Alias for take",
    type: "media",
    dontAddCommandList: true,
  },
  takeHandler
);



command(
  {
    pattern: "toimg",
    fromMe: false,
    desc: "Convert sticker to PNG",
    usage: "#toimg (reply to sticker)",
    params: { argsRequired: false, requiresQuoted: true, format: "", description: "Converts a static sticker back into a PNG image." },
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        if (!message.quoted || message.quoted.type !== "sticker") {
          await replyFail(conn, message, "Reply to a sticker.");
          return;
        }
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media) {
          await replyFail(conn, message, "Could not download sticker.");
          return;
        }
        const sharp = (await import("sharp")).default;
        const png = await sharp(media.buffer).png().toBuffer();
        await conn.sendMessage(
          message.from,
          { image: png, caption: "🖼️" },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "toimg failed.");
      }
    });
  }
);



command(
  {
    pattern: "exif",
    fromMe: true,
    desc: "Set sticker pack|author (owner)",
    usage: "#exif <pack_name>|<author_name>",
    params: { argsRequired: true, requiresQuoted: false, format: "<pack>|<author>", description: "Set global default sticker pack and author names." },
    type: "owner",
  },
  async (message, conn) => {
    const args = (getCommandArgs(message.body, "exif") || "").trim();
    if (!args) {
      const { pack, author } = await getPackMeta();
      await reply(
        conn,
        message,
        `*Sticker EXIF*\nPack: ${pack}\nAuthor: ${author}\n\n` +
          `Usage: \`${BOT_INFO.PREFIX}exif PackName|Author\``
      );
      return;
    }
    const [pack, author] = args.split("|").map((x) => x.trim());
    if (!pack) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}exif Pack|Author\``);
      return;
    }
    await kvSet("sticker_packname", pack);
    if (author) await kvSet("sticker_author", author);
    await replyOk(
      conn,
      message,
      `EXIF set — Pack: *${pack}* · Author: *${author || (await getPackMeta()).author}*`
    );
  }
);


