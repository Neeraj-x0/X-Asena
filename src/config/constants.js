/**
 * Application Constants
 * Centralized configuration for the bot
 */

export const BOT_INFO = {
  NAME: "X-Asena",
  VERSION: "4.0.0",
  PREFIX: "#",
  OWNER: process.env.OWNER_NUMBER || "",
};

export const MEDIA = {
  STICKER_PACKNAME: process.env.STICKER_PACKNAME || "X-Asena",
  STICKER_AUTHOR: process.env.STICKER_AUTHOR || "X-Asena",
  REMOVEBG_API_KEY: process.env.REMOVEBG_API_KEY || "",
  REMOVEBG_API_URL: process.env.REMOVEBG_API_URL || "https://api.remove.bg/v1.0/removebg",
  /** Soft caps before send (bytes) */
  MAX_AUDIO_BYTES: 15 * 1024 * 1024,
  MAX_VIDEO_BYTES: 60 * 1024 * 1024,
  MAX_STICKER_BYTES: 1 * 1024 * 1024,
  /** Duration caps (seconds) */
  MAX_AUDIO_DURATION: 15 * 60,
  MAX_VIDEO_DURATION: 10 * 60,
  MAX_STICKER_VIDEO_DURATION: 10,
};

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  STICKER: "sticker",
  DOCUMENT: "document",
};

export const JID_TYPES = {
  USER: "@s.whatsapp.net",
  LID: "@lid",
  GROUP: "@g.us",
  BROADCAST: "@broadcast",
  STATUS: "status@broadcast",
};

export const COMMAND_TYPES = {
  MISC: "misc",
  GROUP: "group",
  ADMIN: "admin",
  MEDIA: "media",
  INFO: "info",
  OWNER: "owner",
};

export const ERROR_MESSAGES = {
  GROUP_ONLY: "⚠️ This command can only be used in groups!",
  OWNER_ONLY: "⚠️ This command is only for the bot owner!",
  ADMIN_ONLY: "⚠️ This command is only for group admins!",
  BOT_ADMIN: "⚠️ Bot needs to be admin to perform this action!",
  FAILED: "❌ An error occurred while processing your request.",
  INVALID_FORMAT: "⚠️ Invalid format! Check command usage.",
  UNKNOWN_COMMAND: "⚠️ Unknown command. Try #menu for a list.",
};

export const SUCCESS_MESSAGES = {
  DONE: "✅ Done!",
  PROCESSING: "⏳ Processing...",
  COMPLETED: "✅ Operation completed successfully!",
};

export const USAGE_HINTS = {
  promote: `⚠️ Mention a user or reply to their message.\n*Usage:* ${BOT_INFO.PREFIX}promote @user`,
  demote: `⚠️ Mention a user or reply to their message.\n*Usage:* ${BOT_INFO.PREFIX}demote @user`,
  mention: `*Usage:* ${BOT_INFO.PREFIX}mention [text]`,
};

export const UX = {
  ACK_REACT: "⚡",
  OK_PREFIX: "✅ ",
  FAIL_PREFIX: "❌ ",
};

export const RETRY_CONFIG = {
  MAX_RETRIES: 5,
  RETRY_DELAY: 50,
  BACKOFF_MULTIPLIER: 1.5,
};

export const LOG_LEVELS = {
  SILENT: "silent",
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
};

