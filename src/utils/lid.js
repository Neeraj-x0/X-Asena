/**
 * LID/PN Utility Functions for Baileys 7.x.x
 * 
 * These utilities help work with WhatsApp's new LID (Local Identifier) system
 * introduced in Baileys 7.x.x
 */

/**
 * Get LID from Phone Number using Baileys connection
 * @param {object} conn - Baileys connection object
 * @param {string|string[]} phoneNumbers - Phone number(s) in format: 1234567890@s.whatsapp.net
 * @returns {Promise<string|string[]|null>} LID(s) or null if not found
 */
export async function getLIDFromPN(conn, phoneNumbers) {
    try {
        if (!conn?.signalRepository?.lidMapping) {
            console.warn('LID mapping not available in connection');
            return null;
        }

        if (Array.isArray(phoneNumbers)) {
            return await conn.signalRepository.lidMapping.getLIDsForPNs(phoneNumbers);
        } else {
            return await conn.signalRepository.lidMapping.getLIDForPN(phoneNumbers);
        }
    } catch (error) {
        console.error('Error getting LID from PN:', error);
        return null;
    }
}

/**
 * Get Phone Number from LID using Baileys connection
 * @param {object} conn - Baileys connection object
 * @param {string} lid - LID in format: 123456789@lid
 * @returns {Promise<string|null>} Phone number or null if not found
 */
export async function getPNFromLID(conn, lid) {
    try {
        if (!conn?.signalRepository?.lidMapping) {
            console.warn('LID mapping not available in connection');
            return null;
        }

        return await conn.signalRepository.lidMapping.getPNForLID(lid);
    } catch (error) {
        console.error('Error getting PN from LID:', error);
        return null;
    }
}

/**
 * Get the preferred identifier (LID or PN) for a user
 * Uses the alternate fields from message keys
 * @param {object} messageKey - Message key object with potential alt fields
 * @returns {string} The preferred identifier
 */
export function getPreferredIdentifier(messageKey) {
    // For groups, use participant
    if (messageKey.participant) {
        return messageKey.participant;
    }
    
    // For DMs, use remoteJid
    return messageKey.remoteJid;
}

/**
 * Get the phone number identifier from a message key
 * Tries to get PN from alt fields or falls back to main identifier
 * @param {object} messageKey - Message key object
 * @param {boolean} isGroup - Whether this is a group message
 * @returns {string} Phone number identifier
 */
export function getPhoneNumber(messageKey, isGroup = false) {
    if (isGroup) {
        // For groups, check participantAlt first (it's the PN if participant is LID)
        return messageKey.participantAlt || messageKey.participant;
    } else {
        // For DMs, check remoteJidAlt first
        return messageKey.remoteJidAlt || messageKey.remoteJid;
    }
}

/**
 * Check if an identifier is a LID
 * @param {string} identifier - The identifier to check
 * @returns {boolean} True if it's a LID
 */
export function isLID(identifier) {
    return identifier?.endsWith('@lid');
}

/**
 * Check if an identifier is a PN (Phone Number)
 * @param {string} identifier - The identifier to check
 * @returns {boolean} True if it's a PN
 */
export function isPN(identifier) {
    return identifier?.endsWith('@s.whatsapp.net');
}

/**
 * Normalize a user identifier (prefer PN over LID for compatibility)
 * @param {object} messageKey - Message key with potential alt fields
 * @param {boolean} isGroup - Whether this is a group message
 * @returns {string} Normalized identifier (preferably PN)
 */
export function normalizeUserIdentifier(messageKey, isGroup = false) {
    const phoneNumber = getPhoneNumber(messageKey, isGroup);
    
    // If we got a phone number, use it
    if (isPN(phoneNumber)) {
        return phoneNumber;
    }
    
    // Otherwise fall back to the main identifier (might be LID)
    return getPreferredIdentifier(messageKey);
}

/**
 * Differentiate and resolve any WhatsApp identifier into its constituent PN and LID formats.
 * Prevents incorrectly appending @s.whatsapp.net to LID digits.
 *
 * @param {string} userRef - Identifier (e.g. '1234567890@s.whatsapp.net', '23456789012345@lid', or raw phone number)
 * @param {object} [context] - Optional context: { conn, groupMetadata, alt }
 * @returns {Promise<{
 *   pnJid: string|null,
 *   lidJid: string|null,
 *   phoneNumber: string|null,
 *   isLid: boolean,
 *   isPn: boolean,
 *   preferredJid: string,
 * }>}
 */
export async function resolveUserIdentifiers(userRef, context = {}) {
    const { conn, groupMetadata, alt } = context;
    if (!userRef || typeof userRef !== "string") {
        return {
            pnJid: null,
            lidJid: null,
            phoneNumber: null,
            isLid: false,
            isPn: false,
            preferredJid: null,
        };
    }

    const clean = userRef.trim();
    let pnJid = null;
    let lidJid = null;

    // 1. If explicit alt is passed
    if (alt && typeof alt === "string") {
        if (alt.endsWith("@s.whatsapp.net")) pnJid = alt;
        else if (alt.endsWith("@lid")) lidJid = alt;
    }

    // 2. Classify primary userRef
    if (clean.endsWith("@s.whatsapp.net")) {
        pnJid = clean;
    } else if (clean.endsWith("@lid")) {
        lidJid = clean;
    } else if (!clean.includes("@")) {
        // Pure numeric string / phone number e.g. "+63 912 345 6789" or "919876543210"
        const digits = clean.replace(/\D/g, "");
        if (digits.length >= 6) {
            pnJid = `${digits}@s.whatsapp.net`;
        }
    }

    // 3. Resolve missing side using groupMetadata if available
    if (groupMetadata?.participants) {
        for (const p of groupMetadata.participants) {
            const match =
                (lidJid && (p.lid === lidJid || p.id === lidJid)) ||
                (pnJid && (p.id === pnJid || p.phoneNumber === pnJid.replace(/@s\.whatsapp\.net$/, "")));

            if (match) {
                if (!lidJid && p.lid) lidJid = p.lid;
                if (!pnJid) {
                    if (p.phoneNumber) pnJid = `${p.phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
                    else if (p.id?.endsWith("@s.whatsapp.net")) pnJid = p.id;
                }
                break;
            }
        }
    }

    // 4. Resolve missing side using Baileys signalRepository LID mapping if available
    if (conn?.signalRepository?.lidMapping) {
        try {
            if (lidJid && !pnJid) {
                const mappedPn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
                if (mappedPn) {
                    pnJid = mappedPn.endsWith("@s.whatsapp.net") ? mappedPn : `${mappedPn.replace(/\D/g, "")}@s.whatsapp.net`;
                }
            } else if (pnJid && !lidJid) {
                const mappedLid = await conn.signalRepository.lidMapping.getLIDForPN(pnJid);
                if (mappedLid) {
                    lidJid = mappedLid.endsWith("@lid") ? mappedLid : `${mappedLid}@lid`;
                }
            }
        } catch {
            /* ignore mapping lookup error */
        }
    }

    const isLid = Boolean(clean.endsWith("@lid"));
    const isPn = Boolean(clean.endsWith("@s.whatsapp.net") || (!clean.includes("@") && pnJid));
    const phoneNumber = pnJid ? pnJid.replace(/@s\.whatsapp\.net$/, "") : null;
    const preferredJid = pnJid || lidJid || clean;

    return {
        pnJid,
        lidJid,
        phoneNumber,
        isLid,
        isPn,
        preferredJid,
    };
}
