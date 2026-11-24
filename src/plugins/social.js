/**
 * Social downloaders — best-effort IG / TikTok / FB via HTTP
 * Scrapers break often; fail friendly.
 */

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { assertVideoSize, assertAudioSize } from "../utils/media.js";

function pickUrl(message, patterns) {
  for (const p of patterns) {
    const args = getCommandArgs(message.body, p);
    if (args) return args.trim().split(/\s+/)[0];
  }
  const text = message.quoted?.text || "";
  const m = String(text).match(/https?:\/\/\S+/);
  return m ? m[0] : "";
}

async function downloadBuffer(url, maxBytes) {
  const axios = (await import("axios")).default;
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 90_000,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  return Buffer.from(res.data);
}

async function sendMediaUrl(conn, message, mediaUrl, caption = "") {
  const axios = (await import("axios")).default;
  const head = await axios
    .head(mediaUrl, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      validateStatus: () => true,
      maxRedirects: 5,
    })
    .catch(() => null);

  const ctype = (head?.headers?.["content-type"] || "").toLowerCase();
  const buf = await downloadBuffer(mediaUrl, 60 * 1024 * 1024);

  if (ctype.includes("image") || /\.(jpe?g|png|webp)(\?|$)/i.test(mediaUrl)) {
    await conn.sendMessage(
      message.from,
      { image: buf, caption },
      { quoted: { key: message.key, message: message.message } }
    );
    return;
  }

  if (ctype.includes("audio")) {
    assertAudioSize(buf.length);
    await conn.sendMessage(
      message.from,
      { audio: buf, mimetype: ctype || "audio/mpeg" },
      { quoted: { key: message.key, message: message.message } }
    );
    return;
  }

  assertVideoSize(buf.length);
  await conn.sendMessage(
    message.from,
    { video: buf, caption, mimetype: "video/mp4" },
    { quoted: { key: message.key, message: message.message } }
  );
}

/**
 * Try tikwm API for TikTok
 */
async function fetchTikTok(url) {
  const axios = (await import("axios")).default;
  const res = await axios.get("https://www.tikwm.com/api/", {
    params: { url, hd: 1 },
    timeout: 30_000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const data = res.data?.data;
  if (!data) throw new Error("TikTok fetch returned no data.");
  const media =
    data.hdplay || data.play || data.wmplay || data.images?.[0];
  if (!media) throw new Error("No downloadable media found.");
  return {
    mediaUrl: media,
    caption: data.title ? `🎵 ${data.title}` : "TikTok",
    images: data.images || null,
  };
}

/**
 * Best-effort Instagram via public saveig-style endpoints / oEmbed fallback
 */
async function fetchInstagram(url) {
  const axios = (await import("axios")).default;

  // Attempt 1: igdown / ddinstagram redirect (media often on ddinstagram)
  try {
    const dd = url
      .replace("www.instagram.com", "ddinstagram.com")
      .replace("instagram.com", "ddinstagram.com");
    const page = await axios.get(dd, {
      timeout: 25_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
    const html = String(page.data || "");
    const video =
      html.match(/<meta property="og:video" content="([^"]+)"/i)?.[1] ||
      html.match(/<meta name="twitter:player:stream" content="([^"]+)"/i)?.[1];
    const image = html.match(
      /<meta property="og:image" content="([^"]+)"/i
    )?.[1];
    const title =
      html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
      "Instagram";
    if (video || image) {
      return {
        mediaUrl: decodeURIComponent(video || image),
        caption: `📸 ${title}`,
      };
    }
  } catch {
    /* try next */
  }

  // Attempt 2: oEmbed (image thumbnail only for some posts)
  try {
    const oembed = await axios.get("https://www.instagram.com/api/v1/oembed", {
      params: { url },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (oembed.data?.thumbnail_url) {
      return {
        mediaUrl: oembed.data.thumbnail_url,
        caption: `📸 ${oembed.data.title || "Instagram"} _(thumbnail — full media may need a login)_`,
      };
    }
  } catch {
    /* ignore */
  }

  throw new Error(
    "Could not fetch Instagram media. The scraper may be blocked — try again later or use a public post URL."
  );
}

/**
 * Facebook: og:video scrape via public page fetch
 */
async function fetchFacebook(url) {
  const axios = (await import("axios")).default;
  const page = await axios.get(url, {
    timeout: 25_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html",
    },
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
  });
  const html = String(page.data || "");
  const video =
    html.match(/"playable_url(?:_quality_hd)?"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/<meta property="og:video" content="([^"]+)"/i)?.[1] ||
    html.match(/<meta property="og:video:url" content="([^"]+)"/i)?.[1];
  const image = html.match(
    /<meta property="og:image" content="([^"]+)"/i
  )?.[1];
  const title =
    html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    "Facebook";

  const media = video || image;
  if (!media) {
    throw new Error(
      "Could not fetch Facebook media (login wall or scraper change)."
    );
  }
  return {
    mediaUrl: media.replace(/\\u0025/g, "%").replace(/\\/g, ""),
    caption: `📘 ${title}`,
  };
}

async function igHandler(message, conn) {
  const url = pickUrl(message, ["ig", "insta"]);
  if (!url || !/instagram\.com/i.test(url)) {
    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}ig <instagram url>\``
    );
    return;
  }
  await withTyping(conn, message.from, async () => {
    try {
      const result = await fetchInstagram(url);
      await sendMediaUrl(conn, message, result.mediaUrl, result.caption);
    } catch (err) {
      await replyFail(conn, message, err?.message || "Instagram download failed.");
    }
  }, { timeoutMs: 90_000 });
}

command(
  {
    pattern: "ig",
    fromMe: false,
    desc: "Download Instagram media (best-effort)",
    type: "downloader",
  },
  igHandler
);

command(
  {
    pattern: "insta",
    fromMe: false,
    desc: "Alias for ig",
    type: "downloader",
    dontAddCommandList: true,
  },
  igHandler
);

async function ttHandler(message, conn) {
  const url = pickUrl(message, ["tiktok", "tt"]);
  if (!url || !/tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}tiktok <url>\``
    );
    return;
  }
  await withTyping(conn, message.from, async () => {
    try {
      const result = await fetchTikTok(url);
      if (result.images?.length) {
        for (const img of result.images.slice(0, 5)) {
          await sendMediaUrl(conn, message, img, result.caption);
        }
        return;
      }
      await sendMediaUrl(conn, message, result.mediaUrl, result.caption);
    } catch (err) {
      await replyFail(
        conn,
        message,
        err?.message ||
          "TikTok download failed. The free API may be down — try later."
      );
    }
  }, { timeoutMs: 90_000 });
}

command(
  {
    pattern: "tiktok",
    fromMe: false,
    desc: "Download TikTok video (best-effort)",
    type: "downloader",
  },
  ttHandler
);

command(
  {
    pattern: "tt",
    fromMe: false,
    desc: "Alias for tiktok",
    type: "downloader",
    dontAddCommandList: true,
  },
  ttHandler
);

command(
  {
    pattern: "fb",
    fromMe: false,
    desc: "Download Facebook media (best-effort)",
    type: "downloader",
  },
  async (message, conn) => {
    const url = pickUrl(message, ["fb"]);
    if (!url || !/facebook\.com|fb\.watch/i.test(url)) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}fb <facebook url>\``
      );
      return;
    }
    await withTyping(conn, message.from, async () => {
      try {
        const result = await fetchFacebook(url);
        await sendMediaUrl(conn, message, result.mediaUrl, result.caption);
      } catch (err) {
        await replyFail(
          conn,
          message,
          err?.message ||
            "Facebook download failed. Public posts work best; scrapers break often."
        );
      }
    }, { timeoutMs: 90_000 });
  }
);

