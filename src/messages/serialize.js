const MIME_TYPE_MAP = {
    conversation: "text",
    imageMessage: "image",
    videoMessage: "video",
    stickerMessage: "sticker",
    documentMessage: "document",
    audioMessage: "audio",
    documentWithCaptionMessage: "document",
    viewOnceMessageV2: "image",
    viewOnceMessageV2Extension: "image",
    extendedTextMessage: "text",
};

const WRAPPER_KEYS = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "templateMessage",
];

/**
 * Gets the message type and MIME type from a message object.
 * @param {object} message - The message object to analyze.
 * @returns {{key: string, mime: string}} The message type key and MIME type.
 */
function getMessageMimeType(message) {
    if (!message) return { key: "unknown", mime: "unknown" };

    for (const key in message) {
        if (MIME_TYPE_MAP[key]) {
            return { key, mime: MIME_TYPE_MAP[key] };
        }
    }

    return { key: "unknown", mime: "unknown" };
}

/**
 * Unwrap nested WA message wrappers to the inner content object
 */
function unwrapMessage(msg) {
    let current = msg;
    for (let i = 0; i < 4 && current; i++) {
        let unwrapped = false;
        for (const key of WRAPPER_KEYS) {
            if (current[key]?.message) {
                current = current[key].message;
                unwrapped = true;
                break;
            }
        }
        if (!unwrapped) break;
    }
    return current;
}

/**
 * Extracts quoted message content from context info.
 * Returns a rich object with type + raw for media downloads.
 */
function extractQuotedMessage(contextInfo) {
    if (!contextInfo?.quotedMessage) return null;

    const isViewOnce = Boolean(
        contextInfo.quotedMessage?.viewOnceMessage ||
        contextInfo.quotedMessage?.viewOnceMessageV2 ||
        contextInfo.quotedMessage?.viewOnceMessageV2Extension ||
        contextInfo.quotedMessage?.documentWithCaptionMessage?.message?.viewOnceMessage ||
        contextInfo.quotedMessage?.documentWithCaptionMessage?.message?.viewOnceMessageV2
    );

    const unwrapped = unwrapMessage(contextInfo.quotedMessage);
    const { key: quotedKey, mime } = getMessageMimeType(unwrapped);
    if (mime === "unknown" || !quotedKey) return null;

    let content = unwrapped[quotedKey];

    // Nested wrappers (e.g. documentWithCaptionMessage)
    if (content?.message) {
        const nested = unwrapMessage(content.message);
        const { key: nestKey, mime: nestMime } = getMessageMimeType(nested);
        if (nestMime !== "unknown" && nestKey) {
            content = nested[nestKey];
            const q = normalizeQuoted(content, nestMime, nestKey, nested);
            q.isViewOnce = isViewOnce;
            return q;
        }
    }

    const q = normalizeQuoted(content, mime, quotedKey, unwrapped);
    q.isViewOnce = isViewOnce;
    return q;
}

function normalizeQuoted(content, mime, messageTypeKey, raw) {
    if (mime === "text") {
        const text =
            typeof content === "string"
                ? content
                : content?.text || content?.caption || "";
        return {
            type: "text",
            text,
            caption: content?.caption,
            messageTypeKey,
            raw,
            mimetype: content?.mimetype,
        };
    }

    return {
        ...(typeof content === "object" && content ? content : {}),
        type: mime,
        text: content?.caption || content?.text || "",
        caption: content?.caption,
        mimetype: content?.mimetype,
        messageTypeKey,
        raw,
    };
}

/**
 * Determines sender information with LID/PN support.
 */
function getSenderInfo(key, isGroup, conn) {
    const isBotMessage = key.fromMe && !key.participant;

    if (isGroup) {
        const participant = key.participant || null;
        const participantAlt = key.participantAlt || null;

        const sender = isBotMessage
            ? conn.user?.id
            : (participantAlt || participant);

        return { participant, participantAlt, sender, isBotMessage };
    } else {
        const participant = key.remoteJid;
        const participantAlt = key.remoteJidAlt || null;

        const sender = key.fromMe
            ? conn.user?.id
            : (participantAlt || participant);

        return { participant, participantAlt, sender, isBotMessage };
    }
}

/**
 * Serializes a Baileys message object to make it easier to work with.
 * Updated for Baileys 7.x.x with LID support.
 */
async function serialize(message, conn) {
    if (!message?.key?.remoteJid || !message?.message) return null;

    const { key, message: msgContent, pushName } = message;

    const unwrapped = unwrapMessage(msgContent);
    const { key: messageTypeKey, mime: messageMime } = getMessageMimeType(unwrapped);
    if (messageMime === "unknown") return null;

    const messageContent = unwrapped[messageTypeKey];
    const isGroup = key.remoteJid.endsWith("@g.us");

    const from = key.remoteJid;
    const fromAlt = key.remoteJidAlt || null;

    const { participant, participantAlt, sender, isBotMessage } = getSenderInfo(key, isGroup, conn);

    const contextInfo = messageContent?.contextInfo;
    const quoted = extractQuotedMessage(contextInfo);

    const body = messageTypeKey === "conversation"
        ? messageContent
        : (messageContent?.text || messageContent?.caption || "");

    const isViewOnce = Boolean(
        msgContent?.viewOnceMessage ||
        msgContent?.viewOnceMessageV2 ||
        msgContent?.viewOnceMessageV2Extension ||
        msgContent?.documentWithCaptionMessage?.message?.viewOnceMessage ||
        msgContent?.documentWithCaptionMessage?.message?.viewOnceMessageV2
    );

    return {
        key,
        id: key.id,
        pushName: pushName || "",
        isGroup,
        isViewOnce,
        from,
        fromAlt,
        type: messageMime,
        message: messageContent,
        messageTypeKey,
        rawMessage: unwrapped,
        body,
        quoted,
        participant,
        participantAlt,
        sender,
        isBotMessage,
    };
}

export { serialize };

