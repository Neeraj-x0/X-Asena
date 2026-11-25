/**
 * YouTube download via youtubei.js (no yt-dlp)
 * #yt #ytmp3 #ytmp4 #play
 */

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";
import {
  createTempPath,
  safeUnlink,
  streamToFile,
  assertAudioSize,
  assertVideoSize,
  ffmpegConvert,
  formatDuration,
  extractYoutubeId,
} from "../utils/media.js";
import { MEDIA, BOT_INFO } from "../config/constants.js";
import { readFile, stat } from "fs/promises";
import { enqueueJob } from "../enterprise/queue.js";

let ytClient = null;

/**
 * Prefer clients that still return plain progressive/adaptive URLs.
 * WEB is often SABR-only (no url / cipher → "No valid URL to decipher").
 */
const STREAM_CLIENTS = ["IOS", "ANDROID", "TV", "MWEB"];

const STREAM_HEADERS = {
  accept: "*/*",
  origin: "https://www.youtube.com",
  referer: "https://www.youtube.com",
  DNT: "?1",
};

const CHUNK_BYTES = 10 * 1024 * 1024;

async function getYt() {
  if (ytClient) return ytClient;
  const { Innertube } = await import("youtubei.js");
  // No player retrieval — we only use clients that ship plaintext URLs.
  ytClient = await Innertube.create({ retrieve_player: false });
  return ytClient;
}

function pickQuery(message, pattern) {
  const args = getCommandArgs(message.body, pattern);
  if (args) return args.trim();
  if (message.quoted?.text) return String(message.quoted.text).trim();
  return "";
}

function friendlyYtError(err) {
  const msg = String(err?.message || err || "YouTube download failed.");
  if (/no valid url to decipher|streaming.?data|decipher|sabr/i.test(msg)) {
    return "YouTube blocked stream URLs for this IP/video. Try another video or again later.";
  }
  if (/stream fetch failed/i.test(msg)) {
    return "YouTube refused the stream download (403/blocked). Try again in a bit.";
  }
  return msg;
}

async function resolveVideo(query) {
  const yt = await getYt();
  const id = extractYoutubeId(query);
  if (id) {
    const info = await yt.getBasicInfo(id);
    return { id, info, yt };
  }

  const search = await yt.search(query, { type: "video" });
  const first =
    search.videos?.[0] ||
    search.results?.find((r) => r?.id) ||
    null;
  const resolvedId = first?.id;

  if (!resolvedId) {
    throw new Error("No results found.");
  }

  const info = await yt.getBasicInfo(resolvedId);
  return { id: resolvedId, info, yt };
}

function videoMeta(info) {
  const b = info?.basic_info || {};
  return {
    title: b.title || "Unknown",
    duration: b.duration || 0,
    author: b.author || b.channel?.name || "Unknown",
    url: b.url_canonical || `https://youtu.be/${b.id || ""}`,
    id: b.id,
  };
}

function listFormats(info) {
  const sd = info?.streaming_data;
  if (!sd) return [];
  return [...(sd.formats || []), ...(sd.adaptive_formats || [])];
}

/** Only formats with a ready-to-fetch URL (skip cipher/SABR). */
function withDirectUrl(formats) {
  return formats.filter((f) => typeof f.url === "string" && f.url.startsWith("http"));
}

function pickAudioFormat(formats) {
  const audio = withDirectUrl(formats).filter((f) => f.has_audio && !f.has_video);
  if (!audio.length) return null;
  audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  // Prefer mp4/m4a for easier ffmpeg → mp3
  const m4a = audio.find((f) => /mp4|mp4a/i.test(f.mime_type || ""));
  return m4a || audio[0];
}

function pickVideoFormat(formats, maxHeight = 720) {
  const video = withDirectUrl(formats).filter((f) => f.has_video && !f.has_audio);
  if (!video.length) return null;
  const capped = video.filter((f) => (f.height || 0) <= maxHeight);
  const pool = capped.length ? capped : video;
  pool.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  const mp4 = pool.find((f) => /mp4|avc1/i.test(f.mime_type || ""));
  return mp4 || pool[0];
}

function pickMuxedFormat(formats, maxHeight = 720) {
  const muxed = withDirectUrl(formats).filter((f) => f.has_video && f.has_audio);
  if (!muxed.length) return null;
  const capped = muxed.filter((f) => (f.height || 0) <= maxHeight);
  const pool = capped.length ? capped : muxed;
  pool.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return pool[0];
}

function withCpn(url, cpn) {
  if (!url || !cpn || /[?&]cpn=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}cpn=${cpn}`;
}

async function fetchChunk(url, start, end) {
  const res = await fetch(`${url}&range=${start}-${end}`, {
    headers: STREAM_HEADERS,
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Stream fetch failed (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fetchUrlToFile(url, ext, cpn, contentLength) {
  const filePath = createTempPath(ext);
  const src = withCpn(url, cpn);
  try {
    let knownLen = Number(contentLength) || 0;
    if (!knownLen) {
      // Probe with a tiny range so googlevideo returns Content-Range.
      const probe = await fetch(`${src}&range=0-1023`, {
        headers: STREAM_HEADERS,
        redirect: "follow",
      });
      if (probe.ok) {
        const cr = probe.headers.get("content-range");
        const total = cr && /\/(\d+)$/.exec(cr);
        if (total) knownLen = Number(total[1]);
        await probe.arrayBuffer();
      }
    }

    if (knownLen > 0) {
      const { createWriteStream } = await import("fs");
      const out = createWriteStream(filePath);
      let start = 0;
      try {
        while (start < knownLen) {
          const end = Math.min(start + CHUNK_BYTES, knownLen) - 1;
          const buf = await fetchChunk(src, start, end);
          if (!buf.length) break;
          await new Promise((resolve, reject) => {
            out.write(buf, (err) => (err ? reject(err) : resolve()));
          });
          start = end + 1;
        }
      } finally {
        await new Promise((resolve) => out.end(resolve));
      }
      return filePath;
    }

    const res = await fetch(src, { headers: STREAM_HEADERS, redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Stream fetch failed (${res.status}).`);
    }
    if (!res.body) {
      throw new Error("Empty stream body.");
    }
    await streamToFile(res.body, filePath);
    return filePath;
  } catch (err) {
    await safeUnlink(filePath);
    throw err;
  }
}

async function downloadFormat(info, format, ext) {
  try {
    const stream = await info.download({
      itag: format.itag,
      type:
        format.has_video && format.has_audio
          ? "video+audio"
          : format.has_video
            ? "video"
            : "audio",
      format: "any",
    });
    const filePath = createTempPath(ext);
    await streamToFile(stream, filePath);
    return filePath;
  } catch {
    return fetchUrlToFile(format.url, ext, info.cpn, format.content_length);
  }
}

async function eachStreamClient(yt, videoId, fn) {
  let lastErr;
  for (const client of STREAM_CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const formats = withDirectUrl(listFormats(info));
      if (!formats.length) {
        lastErr = new Error(`No direct URLs from ${client}`);
        continue;
      }
      const result = await fn(info, formats);
      if (result) return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("No downloadable YouTube streams.");
}

async function mergeVideoAudio(videoPath, audioPath, outPath) {
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
      ])
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(err))
      .save(outPath);
  });
}

async function sendAudioFile(conn, message, filePath, meta) {
  const st = await stat(filePath);
  assertAudioSize(st.size);
  const buf = await readFile(filePath);
  await conn.sendMessage(
    message.from,
    {
      audio: buf,
      mimetype: "audio/mpeg",
      fileName: `${(meta.title || "audio").slice(0, 60)}.mp3`,
      ptt: false,
    },
    { quoted: { key: message.key, message: message.message } }
  );
}

async function sendVideoFile(conn, message, filePath, meta) {
  const st = await stat(filePath);
  assertVideoSize(st.size);
  const buf = await readFile(filePath);
  await conn.sendMessage(
    message.from,
    {
      video: buf,
      caption: `🎬 *${meta.title}*\n⏱ ${formatDuration(meta.duration)}\n${meta.url}`,
      fileName: `${(meta.title || "video").slice(0, 60)}.mp4`,
      mimetype: "video/mp4",
    },
    { quoted: { key: message.key, message: message.message } }
  );
}

async function fetchAudioMp3(yt, videoId, duration) {
  if (duration && duration > MEDIA.MAX_AUDIO_DURATION) {
    throw new Error(
      `Audio too long (max ${MEDIA.MAX_AUDIO_DURATION / 60} min).`
    );
  }

  const rawPath = await eachStreamClient(yt, videoId, async (info, formats) => {
    const fmt = pickAudioFormat(formats) || pickMuxedFormat(formats);
    if (!fmt) return null;
    return downloadFormat(info, fmt, ".audio");
  });

  const mp3Path = createTempPath(".mp3");
  try {
    await ffmpegConvert(rawPath, mp3Path, (cmd) =>
      cmd.noVideo().audioCodec("libmp3lame").audioBitrate("128k").format("mp3")
    );
    await safeUnlink(rawPath);
    return mp3Path;
  } catch (err) {
    await safeUnlink(rawPath);
    await safeUnlink(mp3Path);
    throw new Error(
      /ffmpeg/i.test(String(err?.message || err))
        ? "FFmpeg failed converting audio. Is FFmpeg installed on PATH?"
        : friendlyYtError(err)
    );
  }
}

async function fetchVideoMp4(yt, videoId, duration) {
  if (duration && duration > MEDIA.MAX_VIDEO_DURATION) {
    throw new Error(
      `Video too long (max ${MEDIA.MAX_VIDEO_DURATION / 60} min).`
    );
  }

  return eachStreamClient(yt, videoId, async (info, formats) => {
    const videoFmt = pickVideoFormat(formats, 720);
    const audioFmt = pickAudioFormat(formats);
    if (videoFmt && audioFmt) {
      const videoPath = await downloadFormat(info, videoFmt, ".v");
      let audioPath;
      const outPath = createTempPath(".mp4");
      try {
        audioPath = await downloadFormat(info, audioFmt, ".a");
        await mergeVideoAudio(videoPath, audioPath, outPath);
        return outPath;
      } catch {
        await safeUnlink(outPath);
      } finally {
        await safeUnlink(videoPath);
        await safeUnlink(audioPath);
      }
    }

    const muxed = pickMuxedFormat(formats, 720);
    if (!muxed) return null;
    return downloadFormat(info, muxed, ".mp4");
  });
}

command(
  {
    pattern: "yt",
    fromMe: false,
    desc: "YouTube info / usage",
    usage: "#yt <youtube_url>",
    params: { argsRequired: false, requiresQuoted: false, format: "<youtube_url>", description: "Display metadata/details or usage info for a YouTube video." },
    type: "downloader",
  },
  async (message, conn) => {
    const query = pickQuery(message, "yt");
    if (!query) {
      await reply(
        conn,
        message,
        `*YouTube*\n` +
          `\`${BOT_INFO.PREFIX}yt <url|query>\` — info\n` +
          `\`${BOT_INFO.PREFIX}ytmp3 <url|query>\` — audio\n` +
          `\`${BOT_INFO.PREFIX}ytmp4 <url|query>\` — video ≤720p\n` +
          `\`${BOT_INFO.PREFIX}play <query>\` — search → audio\n\n` +
          `_Caps: ~${MEDIA.MAX_AUDIO_DURATION / 60}min audio / ~${MEDIA.MAX_VIDEO_DURATION / 60}min video. Needs system FFmpeg._`
      );
      return;
    }

    await withTyping(conn, message.from, async () => {
      try {
        const { info } = await resolveVideo(query);
        const meta = videoMeta(info);
        await reply(
          conn,
          message,
          `🎬 *${meta.title}*\n` +
            `👤 ${meta.author}\n` +
            `⏱ ${formatDuration(meta.duration)}\n` +
            `🔗 ${meta.url}\n\n` +
            `Use \`${BOT_INFO.PREFIX}ytmp3\` / \`${BOT_INFO.PREFIX}ytmp4\` to download.`
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "YouTube lookup failed.");
      }
    }, { timeoutMs: 45_000 });
  }
);

command(
  {
    pattern: "ytdl",
    fromMe: false,
    desc: "Alias for yt",
    type: "downloader",
    dontAddCommandList: true,
  },
  async (message, conn) => {
    const query = pickQuery(message, "ytdl");
    if (!query) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}ytdl <url|query>\``);
      return;
    }
    await withTyping(conn, message.from, async () => {
      try {
        const { info } = await resolveVideo(query);
        const meta = videoMeta(info);
        await reply(
          conn,
          message,
          `🎬 *${meta.title}*\n👤 ${meta.author}\n⏱ ${formatDuration(meta.duration)}\n🔗 ${meta.url}`
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "YouTube lookup failed.");
      }
    }, { timeoutMs: 45_000 });
  }
);

command(
  {
    pattern: "ytmp3",
    fromMe: false,
    desc: "Download YouTube audio (mp3)",
    usage: "#ytmp3 <youtube_url>",
    params: { argsRequired: true, requiresQuoted: false, format: "<youtube_url>", description: "YouTube video/shorts URL to download as MP3 audio." },
    type: "downloader",
  },
  async (message, conn) => {
    const query = pickQuery(message, "ytmp3");
    if (!query) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}ytmp3 <url|query>\``);
      return;
    }
    await withTyping(conn, message.from, async () => {
      await enqueueJob("ytmp3", async () => {
        let filePath;
        try {
          const { id, info, yt } = await resolveVideo(query);
          const meta = videoMeta(info);
          filePath = await fetchAudioMp3(yt, id, meta.duration);
          await sendAudioFile(conn, message, filePath, meta);
        } catch (err) {
          await replyFail(conn, message, friendlyYtError(err) || "ytmp3 failed.");
        } finally {
          await safeUnlink(filePath);
        }
      });
    }, { timeoutMs: 180_000 });
  }
);

command(
  {
    pattern: "ytmp4",
    fromMe: false,
    desc: "Download YouTube video ≤720p",
    usage: "#ytmp4 <youtube_url>",
    params: { argsRequired: true, requiresQuoted: false, format: "<youtube_url>", description: "YouTube video URL to download as MP4 video (max 720p)." },
    type: "downloader",
  },
  async (message, conn) => {
    const query = pickQuery(message, "ytmp4");
    if (!query) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}ytmp4 <url|query>\``);
      return;
    }
    await withTyping(conn, message.from, async () => {
      await enqueueJob("ytmp4", async () => {
        let filePath;
        try {
          const { id, info, yt } = await resolveVideo(query);
          const meta = videoMeta(info);
          filePath = await fetchVideoMp4(yt, id, meta.duration);
          await sendVideoFile(conn, message, filePath, meta);
        } catch (err) {
          await replyFail(conn, message, friendlyYtError(err) || "ytmp4 failed.");
        } finally {
          await safeUnlink(filePath);
        }
      });
    }, { timeoutMs: 240_000 });
  }
);

command(
  {
    pattern: "play",
    fromMe: false,
    desc: "Search YouTube and play first audio",
    usage: "#play <song_name_or_query>",
    params: { argsRequired: true, requiresQuoted: false, format: "<search_query>", description: "Searches YouTube and sends the audio for the top result." },
    type: "downloader",
  },
  async (message, conn) => {
    const query = pickQuery(message, "play");
    if (!query) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}play <query>\``);
      return;
    }
    await withTyping(conn, message.from, async () => {
      await enqueueJob("play", async () => {
        let filePath;
        try {
          const { id, info, yt } = await resolveVideo(query);
          const meta = videoMeta(info);
          await reply(conn, message, `▶️ *${meta.title}* · ${formatDuration(meta.duration)}`);
          filePath = await fetchAudioMp3(yt, id, meta.duration);
          await sendAudioFile(conn, message, filePath, meta);
        } catch (err) {
          await replyFail(conn, message, friendlyYtError(err) || "play failed.");
        } finally {
          await safeUnlink(filePath);
        }
      });
    }, { timeoutMs: 180_000 });
  }
);

