/**
 * HTML Rich Response Plugin (#html)
 * Reply to HTML text or a .html document (or pass inline HTML) to send it inside WhatsApp's rich HTML card.
 */

import { command } from "../plugins.js";
import { replyFail, getCommandArgs, withTyping } from "../utils/message.js";
import { downloadQuotedOrSelf } from "../utils/media.js";
import { sendHtmlRichMessage } from "../utils/htmlRich.js";
import { toWhatsAppJid } from "../utils/access.js";

command(
  {
    pattern: "html",
    fromMe: true,
    desc: "Send HTML text or a .html file as a WhatsApp rich HTML response",
    usage: "#html [jid|number] (reply to HTML text or .html document) | #html <html>...</html>",
    params: {
      argsRequired: false,
      requiresQuoted: "optional",
      format: "[jid|number|inline_html]",
      description:
        "Renders replied HTML text, a quoted .html document, or inline HTML inside a WhatsApp richResponseMessage envelope.",
      examples: ["", "919876543210", "<h1>Hello</h1>"],
    },
    type: "tools",
  },
  async (message, conn) => {
    const rawArg = (getCommandArgs(message.body, "html") || "").trim();
    let html = "";
    let usedInlineHtml = false;

    if (message.quoted?.type === "document") {
      try {
        const downloaded = await downloadQuotedOrSelf(conn, message, { preferQuoted: true });
        html = downloaded?.buffer?.toString("utf8").trim() || "";
      } catch (err) {
        await replyFail(conn, message, `Failed to download document: ${err?.message || err}`);
        return;
      }
    } else if (message.quoted?.text) {
      html = message.quoted.text.trim();
    } else if (rawArg.includes("<")) {
      html = rawArg;
      usedInlineHtml = true;
    }

    if (!html) {
      await replyFail(
        conn,
        message,
        "Reply to a message containing HTML (or a `.html` file), or pass inline HTML."
      );
      return;
    }

    let targetJid = message.from;
    if (!usedInlineHtml && rawArg) {
      targetJid = toWhatsAppJid(rawArg);
      if (!targetJid) {
        await replyFail(conn, message, "Invalid JID or phone number.");
        return;
      }
    }

    await withTyping(conn, targetJid, async () => {
      try {
        await sendHtmlRichMessage(conn, targetJid, html);
      } catch (err) {
        await replyFail(conn, message, `Could not send HTML: ${err?.message || err}`);
      }
    });
  }
);
