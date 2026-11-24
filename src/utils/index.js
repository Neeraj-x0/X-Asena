/**
 * Utils Index
 * Central export point for all utility functions
 */

export {
  sendMessage,
  reply,
  sendError,
  ackCommand,
  withTyping,
  replyOk,
  replyFail,
  getCommandArgs,
  formatUptime,
  createQuote,
  getMentions,
  getQuotedParticipant,
} from "./message.js";

export {
  isAdmin,
  isBotAdmin,
  getAdmins,
  getMembers,
  getParticipantIds,
  validateGroupPermissions,
  formatGroupInfo,
  updateParticipantRole,
  findParticipant,
  displayId,
  resolveTargetUser,
  collectUserIds,
} from "./group.js";

export {
  validateCommand,
  isValidJid,
  sanitizeInput,
  validateMessageContent,
  isOwner,
  validateNumber,
} from "./validation.js";

export {
  getLIDFromPN,
  getPNFromLID,
  getPreferredIdentifier,
  getPhoneNumber,
  isLID,
  isPN,
  normalizeUserIdentifier,
} from "./lid.js";

export {
  getMode,
  setMode,
  isPrivileged,
  isOwnerMessage,
  listSudo,
  addSudo,
  removeSudo,
  checkCommandAccess,
  normalizeNumber,
} from "./access.js";

export {
  downloadQuotedOrSelf,
  createTempPath,
  safeUnlink,
  writeTempFile,
  streamToFile,
  assertAudioSize,
  assertVideoSize,
  ffmpegConvert,
  toMp3,
  withTempFiles,
  formatDuration,
  extractYoutubeId,
} from "./media.js";

export {
  getGroupSettings,
  setGroupSettings,
  toggleGroupFlag,
  getWarns,
  addWarn,
  resetWarns,
} from "./groupSettings.js";

export { t, getLang, setLang, AVAILABLE_LANGS } from "./i18n.js";

export { groupCache, msgCache, createTtlCache } from "./cache.js";

export {
  ensureAudioStickerProtoPatched,
  getSessionKey,
  getActiveSession,
  clearUserSession,
  startStickerSession,
  startAudioSession,
  getStickerMetadata,
  parseCustomMetadata,
  imageToWebpSticker,
  videoToAnimatedWebpSticker,
  convertToOggOpus,
  buildAudioMessage,
  sendCombinedAudioSticker,
  inspectMediaNode,
  downloadMediaFromNode,
} from "./audioSticker.js";

export { default as logger } from "./logger.js";
