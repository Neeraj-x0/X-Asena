/**
 * WhatsApp HTML Rich Response builder, validator, and sender
 * Uses WhatsApp's GenAIUnifiedResponse / richResponseMessage / botForwardedMessage envelope
 * with strict pre-send HTML & JS syntax validation so AI-generated games don't ship broken.
 */

import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { proto, generateWAMessageFromContent } from "baileys";
import { BOT_INFO } from "../config/constants.js";

const MAX_HTML_BYTES = 120_000;

const SAFETY_HEAD_SHIM = `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>*,*::before,*::after{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden;-webkit-tap-highlight-color:transparent;touch-action:manipulation}</style><script>(function(){try{var t="__wa_test__";window.localStorage.setItem(t,"1");window.localStorage.removeItem(t)}catch(e){var mem={};var api={getItem:function(k){return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null},setItem:function(k,v){mem[k]=String(v)},removeItem:function(k){delete mem[k]},clear:function(){mem={}}};try{Object.defineProperty(window,"localStorage",{value:api})}catch(_){}try{Object.defineProperty(window,"sessionStorage",{value:api})}catch(_){}}if(typeof window.__origAlert==="undefined"){var showToast=function(msg){try{var d=document.createElement("div");d.textContent=String(msg);d.style.cssText="position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,.95);color:#f8fafc;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.15);font:500 13px/1.35 system-ui,sans-serif;z-index:2147483647;max-width:90%;text-align:center";(document.body||document.documentElement).appendChild(d);setTimeout(function(){d.remove()},2800)}catch(_){}};window.alert=showToast}if(!window.__xSound){var ctx=null;var muted=false;var getCtx=function(){try{var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;if(!ctx)ctx=new AC();if(ctx.state==="suspended"&&ctx.resume)ctx.resume().catch(function(){});return ctx}catch(_){return null}};var play=function(freq,dur,type,vol){if(muted)return;try{var c=getCtx();if(!c)return;var o=c.createOscillator(),g=c.createGain();o.type=type||"sine";o.frequency.setValueAtTime(freq||440,c.currentTime);g.gain.setValueAtTime(vol||0.12,c.currentTime);g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+(dur||0.12));o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+(dur||0.12))}catch(_){}};window.__xSound={getCtx:getCtx,setMuted:function(v){muted=!!v},isMuted:function(){return muted},beep:play,click:function(){play(520,0.06,"triangle",0.1)},score:function(){play(660,0.09,"sine",0.12);setTimeout(function(){play(880,0.14,"sine",0.12)},70)},win:function(){[523,659,784,1046].forEach(function(f,i){setTimeout(function(){play(f,0.16,"triangle",0.13)},i*90)})},lose:function(){play(260,0.14,"sawtooth",0.1);setTimeout(function(){play(170,0.25,"sawtooth",0.1)},120)}};}})();</script>`;

/**
 * Strip markdown code fences (```html ... ```) if an LLM accidentally wrapped output.
 */
export function stripMarkdownCodeFences(input) {
  let s = String(input || "").trim();
  const match = s.match(/^```(?:html?|xml)?\s*\r?\n([\s\S]*?)\r?\n?```$/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return s;
}

export function applyXAsenaBranding(html) {
  let out = String(html || "");
  if (!out || out.includes('id="x-asena-brand"')) return out;

  const badge = `<div id="x-asena-brand" aria-hidden="true" style="position:fixed;bottom:8px;right:8px;z-index:2147483646;pointer-events:none;display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:rgba(15,23,42,0.82);color:#e2e8f0;border:1px solid rgba(255,255,255,0.16);font:600 10px/1 system-ui,-apple-system,sans-serif;letter-spacing:0.3px;backdrop-filter:blur(6px);box-shadow:0 2px 8px rgba(0,0,0,0.28)"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block"></span><span>⚡ ${BOT_INFO.NAME}</span></div>`;

  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${badge}</body>`);
  }
  if (/<\/html>/i.test(out)) {
    return out.replace(/<\/html>/i, `${badge}</html>`);
  }
  return `${out}${badge}`;
}

export function hasInlineHtmlSound(html) {
  const s = String(html || "");
  return (
    /\b(?:webkit)?AudioContext\b/i.test(s) ||
    /\b__xSound\b/.test(s) ||
    /<audio\b[^>]*src\s*=\s*["']?data:audio\//i.test(s) ||
    /\bnew\s+Audio\s*\(\s*["']data:audio\//i.test(s)
  );
}

function assertHtmlStaticSafety(html, { requireSound = false } = {}) {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new Error(`HTML payload too large (max ${Math.round(MAX_HTML_BYTES / 1024)} KB). Simplify styling/assets.`);
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    throw new Error(
      "External <script src=...> tags are blocked inside WhatsApp HTML cards. Inline all JavaScript inside <script>...</script>."
    );
  }
  if (/<link\b[^>]*\bhref\s*=\s*["']?https?:/i.test(html)) {
    throw new Error(
      "External <link href=https://...> stylesheets are blocked inside WhatsApp HTML cards. Inline all CSS inside <style>...</style>."
    );
  }
  if (/<(?:audio|source)\b[^>]*\bsrc\s*=\s*["']?https?:/i.test(html) || /\bnew\s+Audio\s*\(\s*["']https?:/i.test(html)) {
    throw new Error(
      "External audio URLs are blocked inside WhatsApp HTML cards. Synthesize sound inline using Web Audio API (AudioContext/webkitAudioContext) or data:audio URIs inside HTML."
    );
  }
  if (requireSound && !hasInlineHtmlSound(html)) {
    throw new Error(
      "Gamified HTML must include inline HTML sound effects using Web Audio API (AudioContext/webkitAudioContext oscillators triggered inside tap/click handlers with try/catch) and a mute toggle button."
    );
  }

  const scriptOpens = (html.match(/<script\b[^>]*>/gi) || []).length;
  const scriptCloses = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    throw new Error(`Unbalanced <script> tags (${scriptOpens} open vs ${scriptCloses} close).`);
  }

  const styleOpens = (html.match(/<style\b[^>]*>/gi) || []).length;
  const styleCloses = (html.match(/<\/style>/gi) || []).length;
  if (styleOpens !== styleCloses) {
    throw new Error(`Unbalanced <style> tags (${styleOpens} open vs ${styleCloses} close).`);
  }
}

function assertInlineScriptsValid(html) {
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let blockIndex = 0;
  let m;
  while ((m = scriptRegex.exec(html)) !== null) {
    blockIndex += 1;
    const attrs = m[1] || "";
    const code = m[2] || "";
    const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
    const scriptType = (typeMatch?.[1] || "").toLowerCase();
    if (scriptType && scriptType !== "text/javascript" && scriptType !== "application/javascript") {
      continue;
    }
    if (!code.trim()) continue;
    try {
      // eslint-disable-next-line no-new
      new vm.Script(code, { filename: `html-inline-script-${blockIndex}.js` });
    } catch (err) {
      const lineMatch = String(err?.stack || "").match(/:(\d+)/);
      const lineHint = lineMatch ? ` near line ${lineMatch[1]}` : "";
      throw new Error(`JavaScript SyntaxError in <script> block #${blockIndex}${lineHint}: ${err?.message || err}`);
    }
  }
}

function wrapHtmlDocument(html) {
  const hasHtmlTag = /<html\b/i.test(html);
  const hasHeadTag = /<head\b/i.test(html);
  const hasBodyTag = /<body\b/i.test(html);

  if (!hasHtmlTag && !hasBodyTag) {
    return `<!DOCTYPE html><html><head>${SAFETY_HEAD_SHIM}</head><body>${html}</body></html>`;
  }
  if (hasHeadTag) {
    return html.includes("__wa_test__")
      ? html
      : html.replace(/<head\b([^>]*)>/i, `<head$1>${SAFETY_HEAD_SHIM}`);
  }
  if (hasHtmlTag) {
    return html.replace(/<html\b([^>]*)>/i, `<html$1><head>${SAFETY_HEAD_SHIM}</head>`);
  }
  return `<!DOCTYPE html><html><head>${SAFETY_HEAD_SHIM}</head>${html}</html>`;
}

/**
 * Validate HTML structure and syntax-check every inline <script> block via node:vm.
 * Auto-wraps partial fragments and injects mobile viewport + safe sandbox shims.
 */
export function validateAndPrepareHtml(rawHtml, { branding = false, requireSound = false } = {}) {
  const stripped = stripMarkdownCodeFences(rawHtml);
  if (!stripped) {
    throw new Error("HTML payload is empty.");
  }

  assertHtmlStaticSafety(stripped, { requireSound });
  assertInlineScriptsValid(stripped);

  const wrapped = wrapHtmlDocument(stripped);
  return branding ? applyXAsenaBranding(wrapped) : wrapped;
}

/**
 * Build richResponseMessage payload wrapping HTML in GenAIUnifiedResponse.
 */
export function buildRichHtmlContent(html, fallbackText = "HTML rich response — open on a compatible WhatsApp client.") {
  const responseId = randomUUID();
  const response = {
    __typename: "GenAIUnifiedResponse",
    response_id: responseId,
    sections: [
      {
        __typename: "GenAIUnifiedResponseSection",
        view_model: {
          __typename: "GenAISingleLayoutViewModel",
          primitive: {
            __typename: "FOAHtmlPrimitiveDemoDONOTUSE",
            trusted_sources: [],
            payload: html,
          },
        },
      },
    ],
  };

  return {
    messageContextInfo: { botMetadata: { botResponseId: responseId } },
    richResponseMessage: {
      messageType: 1,
      submessages: [
        {
          messageType: 2,
          messageText: String(fallbackText || "HTML rich response — open on a compatible WhatsApp client."),
        },
      ],
      unifiedResponse: { data: Buffer.from(JSON.stringify(response), "utf8") },
      contextInfo: { isForwarded: true, forwardOrigin: 4 },
    },
  };
}

/**
 * Send HTML via botForwardedMessage + richResponseMessage + follow-up MESSAGE_EDIT hydration.
 */
export async function sendHtmlRichMessage(conn, jid, rawHtml, options = {}) {
  if (!conn || !jid) throw new Error("Missing WhatsApp connection or target JID.");

  const {
    fallbackText = "Interactive HTML — open on a compatible WhatsApp client.",
    validate = true,
  } = options;

  const html = validate ? validateAndPrepareHtml(rawHtml) : String(rawHtml || "");
  const content = buildRichHtmlContent(html, fallbackText);

  const message = generateWAMessageFromContent(jid, content, {
    userJid: conn.user?.id,
  });

  const { messageContextInfo, ...innerMessage } = message.message;
  message.message = proto.Message.fromObject({
    messageContextInfo,
    botForwardedMessage: { message: innerMessage },
  });

  await conn.relayMessage(jid, message.message, { messageId: message.key.id });

  const edit = generateWAMessageFromContent(
    jid,
    proto.Message.fromObject({
      botForwardedMessage: {
        message: {
          protocolMessage: {
            key: message.key,
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            timestampMs: Date.now(),
            editedMessage: message.message,
          },
        },
      },
    }),
    { userJid: conn.user?.id }
  );

  await conn.relayMessage(jid, edit.message, { messageId: edit.key.id });
  return message;
}
