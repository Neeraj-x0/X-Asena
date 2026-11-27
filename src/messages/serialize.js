import { isBotSentId } from "../utils/cache.js";

const MIME_TYPE_MAP = {
    conversation: "text",
    imageMessage: "image",
    videoMessage: "video",
    ptvMessage: "video",
    stickerMessage: "sticker",
    documentMessage: "document",
    audioMessage: "audio",
    documentWithCaptionMessage: "document",
    viewOnceMessageV2: "image",
    viewOnceMessageV2Extension: "image",
    extendedTextMessage: "text",
    interactiveMessage: "interactive",
    buttonsMessage: "buttons",
    listMessage: "list",
    templateMessage: "template",
    pollCreationMessage: "poll",
    pollCreationMessageV2: "poll",
    pollCreationMessageV3: "poll",
    locationMessage: "location",
    liveLocationMessage: "location",
    contactMessage: "contact",
    contactsArrayMessage: "contacts",
    productMessage: "product",
    orderMessage: "order",
    eventMessage: "event",
    albumMessage: "album",
    groupInviteMessage: "invite",
    richResponseMessage: "rich",
};

const IGNORED_META_KEYS = new Set([
    "messageContextInfo",
    "senderKeyDistributionMessage",
    "protocolMessage",
]);

const WRAPPER_KEYS = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "templateMessage",
    "botForwardedMessage",
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
    let { key: quotedKey, mime } = getMessageMimeType(unwrapped);
    if ((mime === "unknown" || !quotedKey) && unwrapped && typeof unwrapped === "object") {
        const fallbackKey = Object.keys(unwrapped).find(
            (k) => !IGNORED_META_KEYS.has(k) && unwrapped[k] != null
        );
        if (fallbackKey) {
            quotedKey = fallbackKey;
            mime = fallbackKey.replace(/Message.*$/i, "") || "unknown";
        }
    }
    if (!quotedKey) return null;

    let content = unwrapped[quotedKey];
    let q;

    // Nested wrappers (e.g. documentWithCaptionMessage)
    if (content?.message) {
        const nested = unwrapMessage(content.message);
        const { key: nestKey, mime: nestMime } = getMessageMimeType(nested);
        if (nestMime !== "unknown" && nestKey) {
            content = nested[nestKey];
            q = normalizeQuoted(content, nestMime, nestKey, nested);
        }
    }

    if (!q) {
        q = normalizeQuoted(content, mime, quotedKey, unwrapped);
    }
    q.isViewOnce = isViewOnce;
    q.stanzaId = contextInfo.stanzaId || null;
    q.rawQuotedMessage = contextInfo.quotedMessage;

    // Attach rich LID/PN sender metadata to quoted message
    const rawParticipant = contextInfo.participant || contextInfo.remoteJid || null;
    const rawParticipantAlt = contextInfo.participantAlt || null;

    let quotedPn = null;
    let quotedLid = null;

    if (rawParticipant?.endsWith("@s.whatsapp.net")) quotedPn = rawParticipant;
    else if (rawParticipant?.endsWith("@lid")) quotedLid = rawParticipant;

    if (rawParticipantAlt?.endsWith("@s.whatsapp.net")) quotedPn = rawParticipantAlt;
    else if (rawParticipantAlt?.endsWith("@lid")) quotedLid = rawParticipantAlt;

    q.participant = rawParticipant;
    q.participantAlt = rawParticipantAlt;
    q.sender = quotedPn || quotedLid || rawParticipant;
    q.senderPn = quotedPn;
    q.senderLid = quotedLid;
    q.isLid = Boolean(rawParticipant?.endsWith("@lid"));
    q.phoneNumber = quotedPn ? quotedPn.replace(/@s\.whatsapp\.net$/, "") : null;

    return q;
}

export function extractMessagePreviewText(content, mime = "") {
    if (typeof content === "string") return content;
    if (!content || typeof content !== "object") return "";
    if (mime === "interactive") {
        return content.body?.text || content.header?.title || content.footer?.text || "";
    }
    if (mime === "buttons") {
        return content.contentText || content.text || content.header?.title || "";
    }
    if (mime === "list") {
        return content.title || content.description || content.buttonText || "";
    }
    if (mime === "template") {
        const hyd = content.hydratedTemplate || content.hydratedFourRowTemplate || {};
        return hyd.hydratedContentText || hyd.hydratedTitleText || "";
    }
    if (mime === "poll") return content.name || "";
    if (mime === "location") return content.name || content.address || "";
    if (mime === "contact") return content.displayName || "";
    if (mime === "contacts") return content.displayName || `${content.contacts?.length || 0} contacts`;
    if (mime === "event") return content.name || content.description || "";
    if (mime === "product") return content.product?.title || content.body || "";
    if (mime === "rich") return content.submessages?.[0]?.messageText || "HTML Rich Card";
    return (
        content.text ||
        content.caption ||
        content.body?.text ||
        content.header?.title ||
        content.contentText ||
        content.name ||
        content.displayName ||
        content.title ||
        ""
    );
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
        text: extractMessagePreviewText(content, mime),
        caption: content?.caption,
        mimetype: content?.mimetype,
        messageTypeKey,
        raw,
    };
}

/**
 * Determines sender information with explicit LID vs PN JID differentiation.
 */
async function getSenderInfo(key, isGroup, conn) {
    // Only mark as bot-generated when the message ID came from this bot's socket.
    // Private chats (1-on-1 DMs / Saved Messages) never have key.participant even when sent by the owner's phone.
    const isBotMessage = Boolean(key.fromMe && isBotSentId(key.id));

    const rawPrimary = isGroup ? (key.participant || null) : key.remoteJid;
    const rawAlt = isGroup ? (key.participantAlt || null) : (key.remoteJidAlt || null);

    let senderPn = null;
    let senderLid = null;

    if (rawPrimary?.endsWith("@s.whatsapp.net")) {
        senderPn = rawPrimary;
    } else if (rawPrimary?.endsWith("@lid")) {
        senderLid = rawPrimary;
    }

    if (rawAlt?.endsWith("@s.whatsapp.net")) {
        senderPn = rawAlt;
    } else if (rawAlt?.endsWith("@lid")) {
        senderLid = rawAlt;
    }

    // Resolve PN for @lid DMs when remoteJidAlt was not attached
    if (!isGroup && !key.fromMe && !senderPn && senderLid && conn?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const resolvedPn = await conn.signalRepository.lidMapping.getPNForLID(senderLid);
            if (resolvedPn) {
                senderPn = resolvedPn.replace(/:\d+@/, "@");
            }
        } catch {
            /* ignore LID lookup errors */
        }
    }

    if (key.fromMe) {
        if (conn?.user?.id) {
            senderPn = conn.user.id.replace(/:\d+@/, "@").replace(/@s\.whatsapp\.net/, "") + "@s.whatsapp.net";
        }
        if (conn?.user?.lid) {
            senderLid = conn.user.lid;
        }
    }

    // sender prefers real PN JID for all plugins, fallback to LID, fallback to primary
    const sender = key.fromMe
        ? (conn?.user?.id || senderPn || senderLid || rawPrimary)
        : (senderPn || senderLid || rawPrimary);

    const isLid = Boolean(rawPrimary?.endsWith("@lid"));
    const phoneNumber = senderPn ? senderPn.replace(/@s\.whatsapp\.net$/, "") : null;

    return {
        participant: rawPrimary,
        participantAlt: rawAlt,
        sender,
        senderPn,
        senderLid,
        isLid,
        phoneNumber,
        isBotMessage,
    };
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

    const {
        participant,
        participantAlt,
        sender,
        senderPn,
        senderLid,
        isLid,
        phoneNumber,
        isBotMessage,
    } = await getSenderInfo(key, isGroup, conn);

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
        senderPn,
        senderLid,
        isLid,
        phoneNumber,
        isBotMessage,
    };
}

export { serialize };

