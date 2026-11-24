/**
 * Info Command
 * Shows detailed message and user information (Baileys 7.x.x compatible)
 */

import { command } from "../plugins.js";
import { reply } from "../utils/message.js";
import { isPnUser, isLidUser, isGroup } from "../functions.js";

command(
    {
        pattern: "info",
        fromMe: false,
        desc: "Shows user and message information",
        type: "info",
    },
    async (message, conn) => {
        try {
            let info = "📱 *Message Information*\n\n";
            
            // Chat Information
            info += `*Chat Type:* ${message.isGroup ? "Group" : "Direct Message"}\n`;
            info += `*Chat ID:* ${message.from}\n`;
            
            // Show alternate identifier if available
            if (message.fromAlt) {
                info += `*Chat ID (Alt):* ${message.fromAlt}\n`;
            }
            
            // Sender Information
            info += `\n*Sender:* ${message.pushName || "Unknown"}\n`;
            info += `*Sender ID:* ${message.participant}\n`;
            
            // Show alternate participant if available
            if (message.participantAlt) {
                info += `*Sender ID (Alt):* ${message.participantAlt}\n`;
            }
            
            // Show the preferred identifier
            info += `*Preferred ID:* ${message.sender}\n`;
            
            // Identifier Type Detection
            const senderType = isLidUser(message.participant) 
                ? "LID (Local Identifier)" 
                : isPnUser(message.participant) 
                ? "PN (Phone Number)" 
                : "Unknown";
            info += `*ID Type:* ${senderType}\n`;
            
            // Message Details
            info += `\n*Message Type:* ${message.type}\n`;
            info += `*Message ID:* ${message.id}\n`;
            
            // Show quoted message if exists
            if (message.quoted) {
                info += `*Quoted:* Yes\n`;
            }
            
            // Group-specific information
            if (message.isGroup) {
                try {
                    const groupMetadata = await conn.groupMetadata(message.from);
                    info += `\n*Group Name:* ${groupMetadata.subject}\n`;
                    info += `*Participants:* ${groupMetadata.participants.length}\n`;
                    
                    // In Baileys 7.x, group metadata has LID+PN pairs
                    if (groupMetadata.owner) {
                        info += `*Owner ID:* ${groupMetadata.owner}\n`;
                    }
                    if (groupMetadata.ownerPn) {
                        info += `*Owner PN:* ${groupMetadata.ownerPn}\n`;
                    }
                } catch (error) {
                    info += `\n_Could not fetch group metadata_\n`;
                }
            }
            
            // Send the information
            await reply(conn, message, info);
            
        } catch (error) {
            console.error("Error in info command:", error);
            await reply(conn, message, "❌ Failed to get information.");
        }
    }
);
