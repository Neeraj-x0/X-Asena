/**
 * WhatsApp Business Suite Plugin
 * Product catalogs, collections, order inspection, and business profile management.
 *
 * NOTE: Strictly guarded with safety checks to prevent ban risks on regular personal accounts.
 *
 * @module plugins/business
 */

import { command } from "../plugins.js";
import { reply, replyOk, replyFail, getCommandArgs, withTyping, ackCommand } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { isPrivileged, normalizeNumber } from "../utils/access.js";
import { resolveTargetUser, displayId } from "../utils/group.js";
import { downloadQuotedOrSelf } from "../utils/media.js";

/**
 * Checks whether the current bot connection is authorized as a WhatsApp Business account.
 * Prevents account bans by guarding business IQ queries on personal numbers.
 *
 * @param {object} conn - Baileys socket connection
 * @returns {Promise<{ isBusiness: boolean, reason?: string }>}
 */
async function verifyBusinessAccountSafety(conn) {
  const manualOverride = await kvGet("enable_business_features");
  if (manualOverride === "true" || manualOverride === "on") {
    return { isBusiness: true };
  }

  const platform = conn?.authState?.creds?.platform;
  // 'smba' (Small Business Android) or 'smbi' (Small Business iOS)
  if (platform === "smba" || platform === "smbi") {
    return { isBusiness: true };
  }

  return {
    isBusiness: false,
    reason:
      `🛑 *SAFETY GUARD: BUSINESS ACCOUNT REQUIRED*\n\n` +
      `This command uses WhatsApp Business protocol queries (Catalogs, Products, Business Profile).\n\n` +
      `⚠️ *BAN RISK WARNING:*\n` +
      `Executing business queries from a regular (personal) WhatsApp account may cause WhatsApp to flag or ban your number.\n\n` +
      `If this bot is running on a registered *WhatsApp Business* number, enable business commands by typing:\n` +
      `\`${BOT_INFO.PREFIX}business enable\``,
  };
}

// ==================== BUSINESS AUTHORIZATION CONTROLLER ====================
command(
  {
    pattern: "business",
    fromMe: true,
    desc: "Configure WhatsApp Business features authorization",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const raw = (getCommandArgs(message.body, "business") || "").trim().toLowerCase();

    if (!raw || raw === "status") {
      const active = (await kvGet("enable_business_features")) === "true";
      const platform = conn?.authState?.creds?.platform || "unknown";
      return await reply(
        conn,
        message,
        `💼 *WHATSAPP BUSINESS SUITE STATUS*\n\n` +
          `• *Detected Platform:* \`${platform}\`\n` +
          `• *Business Mode Active:* ${active ? "✅ ENABLED" : "🔒 DISABLED (Protected)"}\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}business enable\` — Enable business commands (WhatsApp Business numbers only)\n` +
          `• \`${BOT_INFO.PREFIX}business disable\` — Disable to protect against ban risks`
      );
    }

    if (raw === "enable" || raw === "on") {
      await kvSet("enable_business_features", "true");
      return await replyOk(
        conn,
        message,
        "WhatsApp Business features *ENABLED*.\nMake sure this bot is linked to an official WhatsApp Business account."
      );
    }

    if (raw === "disable" || raw === "off") {
      await kvSet("enable_business_features", "false");
      return await replyOk(conn, message, "WhatsApp Business features *DISABLED*.");
    }

    return await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}business [enable|disable]\``);
  }
);

// ==================== CATALOG INSPECTOR ====================
command(
  {
    pattern: "catalog",
    fromMe: false,
    desc: "View product catalog of a business account",
    type: "tools",
  },
  async (message, conn) => {
    const safety = await verifyBusinessAccountSafety(conn);
    if (!safety.isBusiness) {
      return await reply(conn, message, safety.reason);
    }

    let target = resolveTargetUser(message);
    if (!target) {
      const raw = (getCommandArgs(message.body, "catalog") || "").trim();
      if (raw) target = `${normalizeNumber(raw)}@s.whatsapp.net`;
    }
    target = target || conn.user?.id;

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "🛍️");
        const catalog = await conn.getCatalog({ jid: target, limit: 10 });
        if (!catalog || !catalog.products || !catalog.products.length) {
          await ackCommand(conn, message, "ℹ️");
          return await reply(conn, message, `No products found in catalog for @${displayId(target)}.`, {
            mentions: [target],
          });
        }

        let text = `🛍️ *PRODUCT CATALOG (${catalog.products.length})*\n`;
        text += `• *Merchant:* @${displayId(target)}\n\n`;

        catalog.products.forEach((prod, i) => {
          text += `*${i + 1}. ${prod.name}*\n`;
          if (prod.price) text += `   • Price: ${prod.currency || "USD"} ${prod.price / 1000}\n`;
          if (prod.description) text += `   • Desc: ${prod.description}\n`;
          text += `   • ID: \`${prod.id}\`\n\n`;
        });

        await ackCommand(conn, message, "✅");
        return await reply(conn, message, text, { mentions: [target] });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to fetch catalog: ${err?.message || err}`);
      }
    });
  }
);

// ==================== COLLECTIONS ====================
command(
  {
    pattern: "collections",
    fromMe: false,
    desc: "View product collections of a business account",
    type: "tools",
  },
  async (message, conn) => {
    const safety = await verifyBusinessAccountSafety(conn);
    if (!safety.isBusiness) {
      return await reply(conn, message, safety.reason);
    }

    let target = resolveTargetUser(message);
    if (!target) {
      const raw = (getCommandArgs(message.body, "collections") || "").trim();
      if (raw) target = `${normalizeNumber(raw)}@s.whatsapp.net`;
    }
    target = target || conn.user?.id;

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "📦");
        const res = await conn.getCollections(target);
        if (!res || !res.collections || !res.collections.length) {
          return await reply(conn, message, `No product collections found for @${displayId(target)}.`, {
            mentions: [target],
          });
        }

        let text = `📦 *PRODUCT COLLECTIONS (${res.collections.length})*\n`;
        text += `• *Merchant:* @${displayId(target)}\n\n`;

        res.collections.forEach((col, idx) => {
          text += `*${idx + 1}. ${col.name}*\n`;
          text += `   • ID: \`${col.id}\`\n`;
          text += `   • Products Count: ${col.products?.length || 0}\n\n`;
        });

        await ackCommand(conn, message, "✅");
        return await reply(conn, message, text, { mentions: [target] });
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to fetch collections: ${err?.message || err}`);
      }
    });
  }
);

// ==================== UPDATE BUSINESS PROFILE ====================
command(
  {
    pattern: "setbiz",
    fromMe: true,
    desc: "Update business profile fields (address|email|desc|website)",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const safety = await verifyBusinessAccountSafety(conn);
    if (!safety.isBusiness) {
      return await reply(conn, message, safety.reason);
    }

    const raw = (getCommandArgs(message.body, "setbiz") || "").trim();
    if (!raw) {
      return await reply(
        conn,
        message,
        `💼 *UPDATE BUSINESS PROFILE*\n\n` +
          `*Commands:*\n` +
          `• \`${BOT_INFO.PREFIX}setbiz address <Physical Address>\`\n` +
          `• \`${BOT_INFO.PREFIX}setbiz email <support@example.com>\`\n` +
          `• \`${BOT_INFO.PREFIX}setbiz desc <Company Description>\`\n` +
          `• \`${BOT_INFO.PREFIX}setbiz website <https://example.com>\``
      );
    }

    const [field, ...rest] = raw.split(/\s+/);
    const value = rest.join(" ").trim();
    if (!value) return await replyFail(conn, message, `Please provide a value for \`${field}\`.`);

    try {
      const payload = {};
      if (field === "address") payload.address = value;
      else if (field === "email") payload.email = value;
      else if (field === "desc" || field === "description") payload.description = value;
      else if (field === "website" || field === "web") payload.websites = [value];
      else {
        return await replyFail(conn, message, "Invalid field. Options: `address`, `email`, `desc`, `website`");
      }

      await conn.updateBussinesProfile(payload);
      return await replyOk(conn, message, `Business profile field *${field}* updated successfully!`);
    } catch (err) {
      return await replyFail(conn, message, `Failed to update business profile: ${err?.message || err}`);
    }
  }
);

// ==================== BUSINESS COVER PHOTO ====================
command(
  {
    pattern: "coverphoto",
    fromMe: true,
    desc: "Upload or remove WhatsApp Business cover photo from quoted image",
    type: "owner",
  },
  async (message, conn) => {
    const privileged = await isPrivileged(message, conn);
    if (!privileged) return await replyFail(conn, message, "Owner only.");

    const safety = await verifyBusinessAccountSafety(conn);
    if (!safety.isBusiness) {
      return await reply(conn, message, safety.reason);
    }

    const raw = (getCommandArgs(message.body, "coverphoto") || "").trim().toLowerCase();

    if (raw === "del" || raw === "remove") {
      try {
        await conn.removeCoverPhoto();
        return await replyOk(conn, message, "Business cover photo removed.");
      } catch (err) {
        return await replyFail(conn, message, `Failed to remove cover photo: ${err?.message || err}`);
      }
    }

    if (!message.quoted) {
      return await replyFail(
        conn,
        message,
        `Reply to an image with \`${BOT_INFO.PREFIX}coverphoto\` to update cover banner, or \`${BOT_INFO.PREFIX}coverphoto del\` to remove.`
      );
    }

    await withTyping(conn, message.from, async () => {
      try {
        await ackCommand(conn, message, "⏳");
        const media = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        if (!media || media.type !== "image" || !media.buffer) {
          await ackCommand(conn, message, "❌");
          return await replyFail(conn, message, "Please reply to a valid image.");
        }

        await conn.updateCoverPhoto(media.buffer);
        await ackCommand(conn, message, "✅");
        return await replyOk(conn, message, "Business cover photo updated successfully!");
      } catch (err) {
        await ackCommand(conn, message, "❌");
        return await replyFail(conn, message, `Failed to update cover photo: ${err?.message || err}`);
      }
    });
  }
);
