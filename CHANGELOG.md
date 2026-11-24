# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Automated end-to-end integration tests for AI agent tool calling and rate limiters

## [4.1.0] - 2026-11-25

Major feature release introducing an autonomous multi-modal agentic AI layer, WhatsApp Business suite, advanced group automation, prompt injection guardrails, WhatsApp anti-ban rate limiting, and Baileys 7.x LID vs JID differentiation.

### Added

- **Autonomous Agentic AI Layer (`src/agent/`)**:
  - Full suite of **56 native function tools** enabling complete autonomous execution of any WhatsApp administration, moderation, polling, and intelligence task.
  - **Universal Bot Command Dispatch (`execute_bot_command`, `list_bot_commands`)**: The agent can now programmatically execute any of the 148 registered bot plugin commands (e.g. `ytdl`, `ping`, `runtime`, `antilink`, `welcome`, `goodbye`, `antispam`, `trt`, `qr`, `sticker`, `pin`, `weather`, etc.) with arguments directly on behalf of the user.
  - **Real-Time Event Automation & Watchers (`src/agent/agentEvents.js`, `#agentwatchers`)**: Dynamic event monitoring for member leaves (`member_leave`), joins (`member_join`), promotions, demotions, message keyword matches, links, profanity, and media arrivals, triggering autonomous actions and auto-cancelling linked fallback tasks.
  - **Iterative Autonomous Loops (`schedule_iterative_task`)**: Configurable repetitive task loops (e.g. kicking non-admins one by one each minute until empty, periodic reminders, or custom prompt iterations) backed by WhatsApp anti-ban rate limiting.
  - **Comprehensive Group Administration**: Tools for group locking/unlocking (`unlock_group`, `lock_group`), edit permissions (`set_group_edit_permission`), member add approval modes (`set_group_member_add_mode`), invite link generation & revocation (`get_group_invite_link`, `revoke_group_invite_link`), disappearing messages (`set_disappearing_messages`), and bot departure (`leave_group`).
  - **Advanced Moderation & Engagement**: Native WhatsApp interactive polls (`create_group_poll`), message reactions (`send_reaction`), message pinning (`pin_chat_message`), message deletion (`delete_message`), member warnings (`warn_group_member`, `reset_member_warnings`), inactive member audits (`get_inactive_members`), single-step kicks (`kick_next_member`), and mass filtered tags (`tag_filtered_members`).
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
  - Human-in-the-loop safety confirmation guardrails (`#confirm` / `#cancelaction`) for mass actions.

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
  - Account safety guard strictly checking `conn.user.isBusiness` with fallback warnings to prevent non-business account bans.
  - Business profile viewer/editor (`#bprofile`), business hours (`#bhours`), quick replies (`#quickreply`), catalog viewer (`#catalog`), away messages (`#awaymsg`), and greeting messages (`#greetmsg`).

- **Group Automation Suite**:
  - Prohibited word and phrase filter (`#filter add|del|list`) with auto-delete.
  - Anti-foreign country code blocker (`#antiforeign on|off|allow 91,63|action kick|warn`) auto-scanning new joins.
  - Scheduled group auto-mute and auto-unmute (`#automute` / `#autounmute`).

- **Command Architecture Harmonization**:
  - Reorganized all 148 bot commands into 13 dedicated categories (`core`, `group`, `moderation`, `automation`, `tools`, `business`, `media`, `stickers`, `download`, `productivity`, `enterprise`, `settings`, `misc`).
  - Upgraded interactive `#menu` displaying real-time RAM, uptime, and categorized commands.

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

[Unreleased]: https://github.com/Neeraj-x0/X-Asena/compare/v4.1.0...HEAD
[4.1.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.1.0
[4.0.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.0.0
