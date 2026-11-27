/**
 * Interactive Spotify-Wrapped-style HTML story deck & plain-text formatter (#wrapped)
 */

import { BOT_INFO } from "../config/constants.js";

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format crisp WhatsApp plain-text fallback / `#wrapped text` report.
 */
export function formatWrappedText(w) {
  const lines = [
    `✨ *${w.chatTitle.toUpperCase()} — WRAPPED*`,
    `━━━━━━━━━━━━━━━━━━`,
    `💬 *Messages:* ${w.totalMessages.toLocaleString()} (${w.uniqueTalkers} active member${w.uniqueTalkers === 1 ? "" : "s"})`,
    `📝 *Words:* ${w.totalWords.toLocaleString()} · 😀 *Emojis:* ${w.totalEmojis.toLocaleString()}`,
    `⏰ *Peak Hour:* ${w.peakHourLabel} · *Vibe:* ${w.vibeTag}`,
    "",
  ];

  if (w.topTalkers.length) {
    lines.push("🏆 *TOP YAPPERS*");
    w.topTalkers.forEach((u, i) => {
      const medal = i === 0 ? "👑" : `${i + 1}.`;
      lines.push(`${medal} *${u.name}* — ${u.count} msgs (${u.pct}%)`);
    });
    lines.push("");
  }

  if (w.topEmojis.length) {
    lines.push(`🎭 *Top Emojis:* ${w.topEmojis.map((e) => `${e.emoji}×${e.count}`).join("  ")}`);
  }
  if (w.topWords.length) {
    lines.push(`🗣️ *Top Words:* ${w.topWords.map((t) => `${t.word} (${t.count})`).join(", ")}`);
  }

  const awards = [];
  if (w.awards.mvp) awards.push(`👑 MVP: *${w.awards.mvp.name}*`);
  if (w.awards.mediaKing) awards.push(`🎨 Media/Stickers: *${w.awards.mediaKing.name}*`);
  if (w.awards.nightOwl) awards.push(`🦉 Night Owl: *${w.awards.nightOwl.name}*`);
  if (awards.length) {
    lines.push("");
    lines.push("🏅 *AWARDS*");
    awards.forEach((a) => lines.push(`• ${a}`));
  }

  lines.push(`\n_⚡ Powered by ${BOT_INFO.NAME}_`);
  return lines.join("\n");
}

/**
 * Build a 5-slide interactive HTML Wrapped Story Card with inline Web Audio chimes.
 */
export function buildWrappedHtml(w) {
  const safeTitle = escHtml(w.chatTitle);
  const maxHour = Math.max(1, ...w.hourly);
  const totalTypes = Math.max(1, (w.types.text || 0) + (w.types.sticker || 0) + (w.types.media || 0) + (w.types.other || 0));

  const leaderboardHtml = w.topTalkers.length
    ? w.topTalkers
        .map((u, i) => {
          const width = Math.max(10, Math.round((u.count / Math.max(1, w.topTalkers[0].count)) * 100));
          const colors = ["#22c55e", "#38bdf8", "#a855f7", "#f59e0b", "#ec4899"];
          const col = colors[i % colors.length];
          return `<div class="lb-row"><div class="lb-head"><span>${i === 0 ? "👑" : `#${i + 1}`} ${escHtml(u.name)}</span><span>${u.count} (${u.pct}%)</span></div><div class="bar-bg"><div class="bar-fill" style="width:${width}%;background:${col}"></div></div></div>`;
        })
        .join("")
    : `<div class="muted">No sender data yet</div>`;

  const hourlyBarsHtml = w.hourly
    .map((cnt, h) => {
      const pct = Math.max(6, Math.round((cnt / maxHour) * 100));
      const isPeak = h === w.peakHour;
      return `<div class="hbar-wrap" title="${h}:00 (${cnt})"><div class="hbar${isPeak ? " peak" : ""}" style="height:${pct}%"></div></div>`;
    })
    .join("");

  const emojisHtml = w.topEmojis.length
    ? w.topEmojis.map((e) => `<div class="chip">${escHtml(e.emoji)} <b>${e.count}</b></div>`).join("")
    : `<div class="muted">No emojis tracked yet</div>`;

  const wordsHtml = w.topWords.length
    ? w.topWords.map((t) => `<span class="tag">#${escHtml(t.word)} <em>${t.count}</em></span>`).join("")
    : `<span class="muted">Keep chatting!</span>`;

  const pct = (n) => Math.round(((n || 0) / totalTypes) * 100);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#09090f;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:10px}
.deck{width:100%;max-width:360px;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.14);background:linear-gradient(155deg,#111827 0%,#1e1b4b 55%,#0f172a 100%);box-shadow:0 16px 40px rgba(0,0,0,.55);position:relative}
.progress{display:flex;gap:5px;padding:12px 12px 0}
.pdot{flex:1;height:4px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden;cursor:pointer}
.pdot.active{background:#22c55e}
.pdot.done{background:rgba(34,197,94,.55)}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:8px 14px 2px;font-size:11px;color:#cbd5e1}
.mute-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
.slides{padding:14px;min-height:300px;display:flex;flex-direction:column;justify-content:center}
.slide{display:none;animation:fade .25s ease}
.slide.active{display:block}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.kicker{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#38bdf8;margin-bottom:6px}
h1{font-size:22px;line-height:1.15;margin-bottom:8px;background:linear-gradient(90deg,#f8fafc,#38bdf8,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.big-num{font-size:44px;font-weight:800;line-height:1;color:#22c55e;margin:10px 0 4px}
.sub{font-size:13px;color:#cbd5e1;line-height:1.45}
.pill-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.chip{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 10px;font-size:13px}
.tag{background:rgba(168,85,247,.2);border:1px solid rgba(168,85,247,.4);border-radius:8px;padding:4px 8px;font-size:12px}
.tag em{font-style:normal;color:#cbd5e1;font-size:11px}
.lb-row{margin-bottom:10px}
.lb-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:4px}
.bar-bg{height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
.bar-fill{height:100%;border-radius:99px;transition:width .4s ease}
.hchart{display:flex;align-items:flex-end;gap:3px;height:96px;margin:14px 0 8px;padding:8px;border-radius:12px;background:rgba(0,0,0,.28)}
.hbar-wrap{flex:1;height:100%;display:flex;align-items:flex-end}
.hbar{width:100%;border-radius:3px 3px 0 0;background:#6366f1}
.hbar.peak{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.6)}
.award{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:8px 11px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
.nav{display:flex;gap:8px;padding:0 14px 16px}
.btn{flex:1;min-height:42px;border:none;border-radius:12px;font-weight:700;font-size:13px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff}
.btn.primary{background:linear-gradient(90deg,#22c55e,#10b981);color:#04120a}
.muted{color:#94a3b8;font-size:12px}
</style>
</head>
<body>
<div class="deck">
  <div class="progress" id="prog"></div>
  <div class="topbar">
    <span id="slideCounter">1 / 5 · WRAPPED</span>
    <button class="mute-btn" id="muteBtn">🔊 Sound On</button>
  </div>
  <div class="slides">
    <div class="slide active">
      <div class="kicker">✨ Chat Recap</div>
      <h1>${safeTitle}</h1>
      <div class="big-num">${w.totalMessages.toLocaleString()}</div>
      <div class="sub">messages sent across <b>${w.uniqueTalkers}</b> active member${w.uniqueTalkers === 1 ? "" : "s"}</div>
      <div class="pill-row">
        <div class="chip">📝 ${w.totalWords.toLocaleString()} words</div>
        <div class="chip">😀 ${w.totalEmojis.toLocaleString()} emojis</div>
        <div class="chip">${escHtml(w.vibeTag)}</div>
      </div>
    </div>

    <div class="slide">
      <div class="kicker">🏆 Leaderboard</div>
      <h1>Top Yappers</h1>
      <div style="margin-top:8px">${leaderboardHtml}</div>
    </div>

    <div class="slide">
      <div class="kicker">⏰ Active Rhythm</div>
      <h1>Peak Hour: ${escHtml(w.peakHourLabel)}</h1>
      <div class="sub">Group energy hits max gear with <b>${escHtml(w.vibeTag)}</b></div>
      <div class="hchart">${hourlyBarsHtml}</div>
      <div class="topbar" style="padding:0;font-size:10px"><span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span></div>
    </div>

    <div class="slide">
      <div class="kicker">🎭 Personality & Mix</div>
      <h1>Media & Favorites</h1>
      <div class="pill-row">
        <div class="chip">💬 Text ${pct(w.types.text)}%</div>
        <div class="chip">🎭 Stickers ${pct(w.types.sticker)}%</div>
        <div class="chip">🖼️ Media ${pct(w.types.media)}%</div>
      </div>
      <div class="kicker" style="margin-top:14px">Top Emojis</div>
      <div class="pill-row">${emojisHtml}</div>
      <div class="kicker" style="margin-top:14px">Buzzwords</div>
      <div class="pill-row">${wordsHtml}</div>
    </div>

    <div class="slide">
      <div class="kicker">🏅 Hall of Fame</div>
      <h1>Superlatives</h1>
      <div style="margin-top:8px">
        <div class="award"><span>👑 Main Character (MVP)</span><b>${escHtml(w.awards.mvp?.name || "—")}</b></div>
        <div class="award"><span>🎙️ Biggest Yapper (Avg)</span><b>${escHtml(w.awards.yapper ? `${w.awards.yapper.name} (${w.awards.yapper.avgWords}w)` : "—")}</b></div>
        <div class="award"><span>🎨 Media / Sticker King</span><b>${escHtml(w.awards.mediaKing?.name || "—")}</b></div>
        <div class="award"><span>🦉 Late-Night Legend</span><b>${escHtml(w.awards.nightOwl?.name || "—")}</b></div>
      </div>
    </div>
  </div>
  <div class="nav">
    <button class="btn" id="prevBtn">← Prev</button>
    <button class="btn primary" id="nextBtn">Next →</button>
  </div>
</div>
<script>
(function(){
  var cur=0,slides=[].slice.call(document.querySelectorAll(".slide")),prog=document.getElementById("prog"),counter=document.getElementById("slideCounter"),prev=document.getElementById("prevBtn"),next=document.getElementById("nextBtn"),muteBtn=document.getElementById("muteBtn"),muted=false,AC=window.AudioContext||window.webkitAudioContext,ctx=null;
  function tone(f,d,t){if(muted)return;try{if(!AC)return;ctx=ctx||new AC();if(ctx.state==="suspended")ctx.resume();var o=ctx.createOscillator(),g=ctx.createGain();o.type=t||"triangle";o.frequency.setValueAtTime(f,ctx.currentTime);g.gain.setValueAtTime(0.11,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+d);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+d);}catch(e){}}
  function fanfare(){[523,659,784,1046].forEach(function(f,i){setTimeout(function(){tone(f,0.16,"triangle")},i*85);});}
  slides.forEach(function(_,i){var d=document.createElement("div");d.className="pdot"+(i===0?" active":"");d.addEventListener("click",function(){go(i)});prog.appendChild(d);});
  var dots=[].slice.call(prog.children);
  function go(idx){
    cur=(idx+slides.length)%slides.length;
    slides.forEach(function(s,i){s.classList.toggle("active",i===cur);});
    dots.forEach(function(d,i){d.className="pdot"+(i===cur?" active":i<cur?" done":"");});
    counter.textContent=(cur+1)+" / "+slides.length+" · WRAPPED";
    next.textContent=cur===slides.length-1?"Replay ↻":"Next →";
    if(cur===slides.length-1)fanfare();else tone(440+cur*80,0.09,"sine");
  }
  prev.addEventListener("click",function(){go(cur-1)});
  next.addEventListener("click",function(){go(cur+1)});
  muteBtn.addEventListener("click",function(){muted=!muted;muteBtn.textContent=muted?"🔇 Muted":"🔊 Sound On";if(!muted)tone(660,0.07,"sine");});
})();
</script>
</body>
</html>`;
}
