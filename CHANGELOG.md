# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Automated end-to-end integration tests for AI agent tool calling and rate limiters

## [4.3.0] - 2026-11-27

Major feature, UX, deployment, and reliability release introducing **interactive HTML Apps & AI Games (`#html`, `send_html_app`)**, **Chat Activity Wrapped (`#wrapped`)**, **Saved Raw Messages (`#quoted` / `getquoted`)**, **Chat Raw Monitor (`#monitor`)**, **Koyeb Cloud Deployment & `#update` Auto-Deploy**, **Plug-and-Play `src/agent/` decoupling**, **1-on-1 Private Chat fixes**, and **365-day Auth & Memory hardening**.

### Added

- **Interactive HTML Rich Cards & AI Game Builder (`src/utils/htmlRich.js`, `src/plugins/html.js`, `src/agent/aiAgent.js`)**:
  - Added `#html` command (supports replied HTML text, `.html` document replies, or inline HTML) and AI tool `send_html_app` using WhatsApp's `GenAIUnifiedResponse` / `richResponseMessage` / `botForwardedMessage` + `MESSAGE_EDIT` hydration flow.
  - Pre-send static & V8 JS syntax validator (`node:vm`), external URL blocking, mobile viewport & sandbox `localStorage`/toast shims, mandatory **X-Asena** branding badge on AI HTML sends, and enforced inline Web Audio API sound synthesis (`AudioContext` / `__xSound`) for gamified builds.
- **Chat Activity Wrapped (`#wrapped`, `src/utils/wrappedStore.js`, `src/utils/wrappedHtml.js`, `src/plugins/wrapped.js`)**:
  - 5-slide interactive Spotify-Wrapped-style HTML story deck (Top Yappers leaderboard, 24h peak-hour chart, media mix, top emojis/buzzwords, superlative awards, inline Web Audio chimes) plus `#wrapped text` and `#wrapped reset`.
  - Aggregates bounded live activity flushed lazily to `BotKV` and merges persisted `#monitor` logs without double-counting.
- **Saved Quoted Messages (`#quoted`, `getquoted`, `#delquoted`, `src/utils/quotedStore.js`, `src/plugins/quoted.js`)**:
  - Captures exact raw WhatsApp message objects (`rawMessage` & `rawWebMessage`, including `interactiveMessage`, `buttonsMessage`, `listMessage`, `pollCreationMessage`, `richResponseMessage`, media, locations, and contacts) with optional media caching and replays them cleanly as originating from the bot itself via `getquoted` number replies.
- **Chat Raw Message Monitor (`#monitor`, `src/utils/monitorStore.js`, `src/plugins/monitor.js`)**:
  - Per-chat `#monitor on|off|status|list|export|clear|chats` saving raw `WAMessage` objects into chunked `BotKV` rows with serialized per-chat write queues.
- **Plug-and-Play AI Agent Architecture (`src/utils/agentBridge.js`, `src/agent/plugin.js`, `src/plugins/agent.js`)**:
  - Isolated all `src/agent/` references behind `agentBridge.js` and an optional plugin loader so deleting `src/agent/` cleanly removes agent commands, watchers, crons, and the Dashboard AI tab without breaking core bot or messaging functionality.
- **Self-Update & Koyeb Auto-Deploy (`#update`, `src/utils/updater.js`, `src/plugins/update.js`)**:
  - Fetches GitHub commits & `CHANGELOG.md` directly in WhatsApp (`#update`) and triggers automatic Koyeb redeployments (`update now` / `#update now`), with `Dockerfile`, `.dockerignore`, one-click **Deploy to Koyeb** button in `README.md`, `PORT` / `/health` probe support, and resilient `GET /health` startup checks.
- **Performance & Auth Hardening (`src/database/authSqlite.js`, `src/database/authPostgres.js`, `src/database/bufferJson.js`, `src/utils/cache.js`)**:
  - Added Signal closed-session console noise suppression (`SIGNAL_DEBUG=1` opt-in), zero-alloc `BufferJSON` + shared `encodeBufferJson`/`decodeBufferJson`/`cloneBufferJson` helpers, `BotKV` in-memory caching, SQLite WAL `PRAGMA` tuning, bounded TTL caches across moderation/socket/agent layers, and 24-hour closed-ratchet pruning.

### Changed

- **Compact `#menu` Layout (`src/plugins/menu.js`)**: Replaced the long per-command description list on the main `#menu` with clean categorized command lists; full descriptions and usage stay in `#menu <category>` and `#help <cmd>`.
- **License & Governance**: Switched repository license from MIT to **GNU Affero General Public License v3.0 (AGPL-3.0)** in `LICENSE`, `package.json`, and `README.md`, and added a formal non-affiliation, Terms of Service compliance, and no-liability Disclaimer to `README.md`.

### Fixed

- **Private Chats (1-on-1 DMs & Saved Messages) & `@lid` Resolution (`src/messages/serialize.js`, `src/utils/cache.js`, `src/socket/connection.js`)**: Tracked outgoing bot-sent message IDs in bounded `botSentMsgCache` instead of assuming `key.fromMe && !key.participant` is a bot echo, unblocking owner commands in private chats; added `signalRepository.lidMapping.getPNForLID()` fallback for `@lid` DMs.
- **iOS Audio Sticker Delivery & Codec (`src/utils/audioSticker.js`)**: Updated `convertToOggOpus()` to strict 16kHz mono `voip` Opus with 20ms frames and removed invalid `mediatype: "sticker"` stanza attributes on custom `audioStickerMessage` payloads.
- **Clean Rolling Deploys (`src/socket/connection.js`, `index.js`)**: Stopped auto-reconnect ping-pong loops on `440` (`connectionReplaced`) and added graceful `SIGTERM`/`SIGINT` shutdown flushing auth state and Wrapped stats.

## [4.2.0] - 2026-11-25

Feature and operations release introducing a **full-stack WhatsApp Operations Web Dashboard**, expanding the AI Agent to **56 native tools + Universal Bot Command Dispatch** across **all 132 menu commands** with structured parameter schemas, real-time event watchers, iterative loops, and critical Windows/JID stability fixes.

### Added

- **WhatsApp Operations Web Dashboard (`src/enterprise/adminHttp.js`, `src/enterprise/dashboardHtml.js`)**:
  - Single-page dark-mode control center served at `http://127.0.0.1:8787/?token=<ADMIN_HTTP_TOKEN>`.
  - **Session & Auth Telemetry (`src/socket/connection.js`)**: Live socket status (`open`, `qr`, `pairing`, `close`), local SVG QR code rendering when unlinked, on-demand Pairing Code generator, Reconnect/Logout buttons, Public/Private mode toggle, Online/Offline presence switches, memory/uptime KPIs, and an auto-refreshing live message stream.
  - **Group & Moderation Inspector**: Browse all joined groups (`groupFetchAllParticipating`), toggle group locks (`announce`), edit-info restrictions (`restrict`), disappearing message timers, guard toggles (`welcome`, `goodbye`, `antilink`, `antispam`, `antiforeign`, `filter`), invite links with one-click revoke, and per-member actions (Warn, Unwarn, Promote/Demote, Kick).
  - **Anti-Ban Messaging & Polls**: Dispatch Direct Messages (`@s.whatsapp.net` / `@lid`) and Group Messages through rate-limited throttling, and publish interactive WhatsApp polls.
  - **AI Agent Control Panel**: Interactive prompt console, API Key / Base URL / custom or discovered model selector, Prompt Injection Guardrail controls (`standard` / `strict`), and active task/watcher cancellation.
  - **Commands & Ops**: Live command runner across all 132+ commands, feature flag switches (including `maintenance` kill switch), global policy editor, and audit log viewer.

- **56 Native AI Agent Tools & Universal Plugin Dispatch (`src/agent/aiAgent.js`)**:
  - **Universal Bot Command Dispatch (`execute_bot_command`, `list_bot_commands`)**: Allows the AI agent to discover and invoke any registered bot plugin command (`ytdl`, `sticker`, `antilink`, `trt`, `pin`, etc.) with pre-execution validation for required arguments and quoted messages.
  - **Structured Plugin Parameter Schemas (`src/plugins.js`, `src/plugins/*.js`)**: Added explicit `usage` and `params` definitions (`argsRequired`, `requiresQuoted`, `format`, `description`, `examples`) across all **31 plugin files** (**132/132** menu commands), plus enhanced `#help <command>` output in `src/plugins/menu.js`.
  - **Real-Time Event Watchers (`src/agent/agentEvents.js`, `#agentwatchers`)**: Reactive watchers for `member_leave`, `member_join`, `member_promote`, `member_demote`, `message_contains`, `link_detected`, `profanity_detected`, and `media_received` hooked into `groupParticipants.js` and `handler.js`, with linked fallback task cancellation.
  - **Iterative Autonomous Loops (`src/agent/agentCron.js`)**: `schedule_iterative_task` for step-by-step timed actions (`kick_next_member`, `send_reminder`, `custom_prompt`) with safety caps and termination conditions.
  - **Extended Group & Moderation Tools**: `unlock_group`, `lock_group`, `set_group_edit_permission`, `set_group_member_add_mode`, `get_group_invite_link`, `revoke_group_invite_link`, `set_disappearing_messages`, `leave_group`, `kick_next_member`, `warn_group_member`, `reset_member_warnings`, `get_member_warnings`, `get_inactive_members`, `tag_filtered_members`, `create_group_poll`, `send_reaction`, `delete_message`, and `pin_chat_message`.

### Fixed

- **Windows SQLite Database Wipe `EBUSY` & Confirmation Prompt (`src/terminal/handler.js`, `src/database/authSqlite.js`, `src/database/authState.js`)**: Added `closeAuthState()` to flush queued SQLite writes, checkpoint WAL, and close the `better-sqlite3` handle before unlinking `database.db` (and `-wal`/`-shm` sidecars) with retry; fixed duplicate `stdin` listener printing `Unknown command: "Y"` during `A` → `Y` wipe confirmation.
- **Dashboard AI Agent Config Persistence (`src/enterprise/adminHttp.js`)**: Fixed BotKV key mismatch (`ai_base_url`, `ai_api_key`, `ai_model`), positional `fetchAvailableModels(baseUrl, apiKey)` arguments, and graceful discovery error handling.
- **Baileys `jidDecode` Undefined Crash (`src/agent/agentSafetyThrottle.js`, `src/enterprise/adminHttp.js`, `src/agent/aiAgent.js`)**: Fixed `groupJid` vs `targetJid` parameter mismatch in `POST /api/messages/send`, validated chat JIDs and mention arrays before Baileys calls, and added `normalizeMemberJids()` for group participant actions.
- **Duplicate Command Cleanup (`src/plugins/agent.js`)**: Removed duplicate `agentwatchers` command registration.

## [4.1.0] - 2026-11-25

Major feature release introducing an autonomous multi-modal agentic AI layer, WhatsApp Business suite, advanced group automation, prompt injection guardrails, WhatsApp anti-ban rate limiting, and Baileys 7.x LID vs JID differentiation.

### Added

- **Autonomous Agentic AI Layer (`src/agent/`)**:
  - Natural language triggers (`@bot <prompt>` and `#agent` / `#ask`).
  - OpenAI-compatible API backend with automatic model discovery (`#agentconfig`).
  - Persistent conversational memory layer (`#agentmemory`) storing facts, rules, and notes across bot restarts.
  - Autonomous cron and self-initiating background task scheduler (`#agenttasks`) with natural language time parsing (`every day at 8 AM`, `in 2 minutes`).
  - Subagent swarm delegation (`delegate_subtask`) with specialized roles (researcher, coder, moderator, analyst, summarizer).
  - Autonomous multi-step plan checklist creator (`create_plan`, `update_plan_progress`).
  - Persistent Knowledge Base RAG (`#agentkb`) for indexing and semantically querying verified FAQs and rules.
  - Multi-modal vision analysis on attached/quoted photos and generative visual creation (`generate_image`, `create_sticker`).
  - Isolated VM safe code execution sandbox (`run_code`) for calculations, algorithms, and data processing.
  - Live web search and URL webpage scraping tools (`web_search`, `fetch_webpage`).
  - Deterministic member filtering (`filter_group_members`) with phone number prefixes, digit sums, admin status, and custom conditions.
  - Dynamic agent personas (`#agentpersona`): default, executive, strict-mod, witty, tutor.
  - Human-in-the-loop safety confirmation guardrails (`#confirm`) for mass actions.

- **Prompt Injection Guardrails & Output Leak Scrubber (`src/agent/agentInjectionGuard.js`)**:
  - Multi-layer defense against direct jailbreaks ("ignore previous instructions", "DAN", "developer mode").
  - System prompt leak and credential extraction prevention.
  - Explicit boundary sandboxing wrapping all untrusted user inputs and external web contents (`<untrusted_*>`).
  - Output leak prevention automatically sanitizing API keys and internal directives before delivery.
  - Dedicated inspection command `#agentguard` with configurable sensitivity modes (`strict` / `standard`), audit logs, and test scanner.

- **Direct Messaging (DMs) & Anti-Ban Rate Limiting (`src/agent/agentSafetyThrottle.js`)**:
  - Paced direct messaging (`send_direct_message`) with simulated typing presence (`composing`).
  - Batch direct messaging (`send_batch_dms`) with randomized jitter (4–7s delay) and a safety cap of 5 recipients to prevent number bans.
  - Zero-tolerance profanity and abuse filter blocking vulgar slurs and regional profanities (specifically "myr").
  - Inter-message cooldown and global dispatch rate limits.

- **WhatsApp 7.x LID vs Phone Number JID Differentiation**:
  - Fixed invalid `@s.whatsapp.net` corruption on 64-bit WhatsApp Local Identifiers (`@lid`).
  - Upgraded message serializer (`src/messages/serialize.js`) to provide distinct `senderPn`, `senderLid`, `phoneNumber`, and `isLid` properties on both primary and quoted messages.
  - Automatic resolution mapping between LIDs and real phone numbers via group metadata and Baileys signal repository (`src/utils/lid.js`).

- **WhatsApp Business Account Suite (`src/plugins/business.js`)**:
  - Account safety guard strictly checking business account authorization before running Business IQ queries.
  - Business catalog viewer (`#catalog`), collections (`#collections`), profile editor (`#setbiz`), and cover photo manager (`#coverphoto`).

- **Group Automation Suite**:
  - Prohibited word and phrase filter (`#filter on|off|add|del|list`) with auto-delete.
  - Anti-foreign country code blocker (`#antiforeign on|off|add|del|list`) auto-scanning new joins.
  - Scheduled group auto-mute and auto-unmute (`#automute` / `#autounmute` / `#autotime`).

### Fixed

- Fixed LID digits being miscalculated as phone numbers in member filters and DM dispatches.
- Fixed unhandled database exceptions during offline/decoupled testing.
- Fixed command registry pattern lookups for alias mappings.

## [4.0.0] - 2026-07-24

Major Baileys **7.0.0-rc13** rewrite on `main` (previous line preserved as `pre-v7`).

### Added

- Lean Baileys socket (no full history sync, offline on connect, safe reconnect)
- Dual auth: **better-sqlite3** (default) or **Postgres** via `DATABASE_URL`
- BotKV settings (mode, sudo, lang, sticker EXIF, group settings)
- System **log group** onboarding (`#setup`, `#createlog`, `#setlog`)
- Media plugins: stickers + EXIF, YouTube (`youtubei.js`), tools, social DLs
- Moderation: welcome/goodbye, antilink, antispam, warn/mute/kick
- Productivity: notes, reminders, polls
- Enterprise: audit, feature flags, RBAC, policies, metrics, job queue, backup
- Optional admin HTTP (`/health`, `/metrics`, `/audit`, …)
- Public/private bot mode and sudo ACL
- Multi-language strings (`en` / `id` / `hi`)

### Changed

- Command prefix and UX helpers (`#menu`, react-ack, typing)
- README rewritten for the v4 architecture

### Security

- User-facing errors stay generic; stacks go to the system log group only
- Spoof mitigations on `messages.upsert` (notify-only, ignore `requestId`)

[Unreleased]: https://github.com/Neeraj-x0/X-Asena/compare/v4.3.0...HEAD
[4.3.0]: https://github.com/Neeraj-x0/X-Asena/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.2.0
[4.1.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.1.0
[4.0.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.0.0
