# X-Asena

[![Release](https://img.shields.io/badge/release-v4.2.0-blue.svg)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.2.0)
[![Baileys](https://img.shields.io/badge/Baileys-7.0.0--rc13-green.svg)](https://github.com/WhiskeySockets/Baileys)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Multi-device WhatsApp bot and autonomous agent platform built on [Baileys](https://github.com/WhiskeySockets/Baileys) **7.0.0-rc13**.

---

## Highlights

- **WhatsApp Operations Web Dashboard** — Localhost control center (`http://127.0.0.1:8787/?token=...`) featuring live SVG QR & pairing-code authentication, group/member moderation, anti-ban messaging & polls, interactive AI agent console, plugin command runner, feature flags, policies, and audit logs.
- **Autonomous Multi-Modal AI Agent (56 Tools)** — OpenAI-compatible backend with automatic model discovery (`#agentconfig`), persistent memory (`#agentmemory`), Knowledge Base RAG (`#agentkb`), subagent delegation, cron & iterative loops (`#agenttasks`), real-time event watchers (`#agentwatchers`), live web search, JS VM sandbox, and vision analysis.
- **Universal Plugin Dispatch** — Structured `usage` and `params` definitions across all **31 plugin files** (**132 menu commands**), enabling the AI agent to inspect formats and invoke any bot command via `execute_bot_command`.
- **Anti-Ban & Security Architecture** — Prompt injection guardrails (`#agentguard`), output secret scrubbing, zero-tolerance abuse filtering, simulated typing delays, DM pacing, human-in-the-loop approvals (`#confirm`), and Baileys 7.x `@lid` vs `@s.whatsapp.net` differentiation.
- **Complete WhatsApp Feature Suite** — Group automation (`#filter`, `#antiforeign`, `#automute`), channels & communities (`#channel`, `#community`), stickers & audio stickers, YouTube & social downloads, WhatsApp Business tools (`#catalog`, `#setbiz`), and enterprise ops (RBAC, audit, feature flags, backups).

---

## Requirements

- [Node.js](https://nodejs.org/) **>= 20.0.0**
- **FFmpeg** available on `PATH` (for audio, video, and sticker conversions)
- Active WhatsApp account

```bash
# Install FFmpeg
choco install ffmpeg                        # Windows
brew install ffmpeg                         # macOS
sudo apt update && sudo apt install ffmpeg  # Debian / Ubuntu
```

---

## Quick Start

```bash
git clone https://github.com/Neeraj-x0/X-Asena.git
cd X-Asena
npm install
cp .env.example .env
# Edit .env with OWNER_NUMBER and preferences
npm start
```

For development auto-reload:

```bash
npm run dev
```

### Pairing & Terminal Shortcuts

1. **QR Code** — Scan the QR code shown in the terminal or in the Web Dashboard via WhatsApp → *Linked devices*.
2. **Pairing Code** — Set `PAIRING_NUMBER=919876543210` in `.env` (digits only with country code), or request a pairing code live from the dashboard.
3. **Terminal Controls** — `Q` (logout & clear auth), `R` (restart), `A` → `Y` (wipe database cleanly), `Ctrl+C` (exit).

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OWNER_NUMBER` | _(empty)_ | Owner phone number with country code, no `+`. Required to auto-create the system log group. |
| `SUDO` | _(empty)_ | Comma-separated extra privileged phone numbers. |
| `BOT_MODE` | `public` | Access mode: `public` \| `private`. |
| `BOT_LANG` | `en` | Language: `en` \| `id` \| `hi`. |
| `DATABASE_URL` | `./database.db` | SQLite file path or PostgreSQL URL (`postgresql://...`). |
| `PAIRING_NUMBER` | _(empty)_ | Phone number (digits) for pairing-code login. |
| `AI_API_KEY` | _(empty)_ | OpenAI-compatible API key (or configure via `#agentconfig` / dashboard). |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Provider Base URL (OpenAI, Groq, Ollama, OpenRouter, DeepSeek, etc.). |
| `AI_MODEL` | `gpt-4o-mini` | Default LLM model ID. |
| `ADMIN_HTTP_PORT` | _(off)_ | Port for the Web Dashboard & Ops HTTP server (falls back to `PORT` on Koyeb/PaaS). |
| `ADMIN_HTTP_HOST` | `127.0.0.1` | Bind host (`0.0.0.0` automatically when `PORT` is set). |
| `ADMIN_HTTP_TOKEN` | _(empty)_ | Authentication token required for dashboard and API endpoints. |
| `STICKER_PACKNAME` | `X-Asena` | Default sticker EXIF pack name. |
| `STICKER_AUTHOR` | `X-Asena` | Default sticker EXIF author name. |
| `REMOVEBG_API_KEY` | _(empty)_ | Optional API key for `#removebg`. |

---

## Deploy on Koyeb

X-Asena includes a production `Dockerfile` (with `ffmpeg` pre-installed), `.dockerignore`, and automatic `PORT` / `/health` probe support:

1. Create a **PostgreSQL** database on Koyeb (or external Postgres such as Neon/Supabase) so sessions survive restarts.
2. Deploy this repository as a **Web Service** on Koyeb using the included **Dockerfile** builder (HTTP health check path: `/health`, default port `8000`).
3. Set the required environment variables:
   - `DATABASE_URL` — PostgreSQL connection string (`postgresql://...`)
   - `OWNER_NUMBER` — Your WhatsApp phone number (country code, no `+`)
   - `ADMIN_HTTP_TOKEN` — Strong secret to protect the Web Dashboard & Ops APIs
   - `PAIRING_NUMBER` _(optional)_ — Phone number for pairing-code login, or scan the QR live in the Web Dashboard (`https://<your-app>.koyeb.app/?token=YOUR_TOKEN`)

> Without `ADMIN_HTTP_TOKEN`, Koyeb deployments automatically stay in **health-check-only mode** (`/health` returns `200 OK`; the dashboard and API routes stay disabled).

---

## Web Operations Dashboard

When `ADMIN_HTTP_PORT` and `ADMIN_HTTP_TOKEN` are set in `.env`:

```text
http://127.0.0.1:8787/?token=YOUR_TOKEN
```

| Section | Live Capabilities |
|---------|-------------------|
| **Overview & Session** | Live socket status, local SVG QR & pairing code generator, reconnect/logout, public/private mode, presence toggle, uptime/RAM/queue KPIs, live message stream |
| **Groups & Moderation** | Joined groups browser, lock/unlock chat, edit-info restriction, invite link & revoke, disappearing timers, guard flags, per-member Warn / Unwarn / Promote / Demote / Kick |
| **Messaging & Polls** | Send anti-ban paced DMs (PN or `@lid`) or group messages, and publish interactive native WhatsApp polls |
| **AI Agent Control** | Interactive agent prompt console, API key/URL/model configuration with discovery, injection guardrail controls, active task & event watcher cancellation |
| **Commands & Plugins** | Searchable catalog of all 132 commands with input parameter schemas and one-click execution |
| **Flags, Policies & Audit** | Feature flag switches (`maintenance` kill switch), global policy editor, and security audit trail |

---

## Autonomous AI Agent Layer

Invoke the agent in natural language by mentioning `@bot <prompt>` or using `#agent <prompt>` / `#ask <prompt>`:

```text
#ask check who is inactive in this group and warn spammers
#ask unlock the group when @user leaves or kick non-admins every 1m
#ask search today's tech news and summarize in 3 bullets
#ask remember quiet hours start at 23:00
```

| Capability | Tools / Commands |
|------------|------------------|
| **Universal Plugin Dispatch** | `execute_bot_command`, `list_bot_commands` |
| **Real-Time Event Watchers** | `watch_group_event`, `list_event_watchers`, `cancel_event_watcher`, `#agentwatchers` |
| **Iterative & Scheduled Loops** | `schedule_iterative_task`, `schedule_task`, `#agenttasks` |
| **Group Settings & Moderation** | `unlock_group`, `lock_group`, `set_group_edit_permission`, `set_group_member_add_mode`, `get_group_invite_link`, `revoke_group_invite_link`, `set_disappearing_messages`, `kick_members`, `kick_next_member`, `warn_group_member`, `get_inactive_members`, `tag_filtered_members` |
| **Messaging & Engagement** | `send_direct_message`, `send_batch_dms`, `send_group_message`, `create_group_poll`, `pin_chat_message`, `delete_message`, `send_reaction` |
| **Memory, RAG & Intelligence** | `remember`, `recall`, `forget`, `#agentmemory`, `#agentkb`, `web_search`, `fetch_webpage`, `run_code`, `generate_image`, `create_sticker`, Vision |
| **Safety & Personas** | `#agentguard`, `#agentpersona`, `#confirm` |

---

## Command Reference

Run `#menu` in WhatsApp for the interactive categorized list, or `#help <command>` to inspect input format, required replies, and examples.

| Category | Key Commands |
|----------|--------------|
| **Core & Info** | `#menu`, `#help`, `#ping`, `#status`, `#info`, `#lang` |
| **AI Agent** | `#agent` (`#ask`), `#agentconfig`, `#agentguard`, `#agentpersona`, `#agentkb`, `#agentmemory`, `#agenttasks`, `#agentwatchers`, `#confirm` |
| **Group & Moderation** | `#groupinfo`, `#group`, `#admins`, `#mention` (`#tagall`), `#notify`, `#promote`, `#demote`, `#setname`, `#setdesc`, `#setppgc`, `#delppgc`, `#invite`, `#revoke`, `#requests`, `#approve`, `#reject`, `#kick`, `#warn`, `#unwarn`, `#warns`, `#mute`, `#unmute`, `#welcome`, `#goodbye`, `#antilink`, `#antispam`, `#groupsetup`, `#groupsettings`, `#disappearing`, `#enable`, `#disable`, `#plugins` |
| **Group Automation** | `#filter`, `#antiforeign`, `#automute`, `#autounmute`, `#autotime` |
| **Security & Chats** | `#anticall`, `#vv` (`#antiviewonce`), `#antidelete`, `#block`, `#unblock`, `#blocklist`, `#privacy`, `#archive`, `#unarchive`, `#pinchat`, `#unpinchat`, `#mutechat`, `#star`, `#unstar`, `#clearchat`, `#pin`, `#edit` |
| **Channels & Communities** | `#channel`, `#community` |
| **Business Suite** | `#business`, `#catalog`, `#collections`, `#setbiz`, `#coverphoto` |
| **Status** | `#save` (`#statussaver`), `#poststatus`, `#autostatus` |
| **Media & Downloads** | `#sticker` (`#s`), `#take` (`#steal`), `#toimg`, `#stickeraudio` (`#sa`), `#tomp3`, `#toururl` (`#url`), `#quote`, `#fancy`, `#tts`, `#ttp`, `#attp`, `#removebg`, `#play`, `#yt` (`#ytdl`), `#ytmp3`, `#ytmp4`, `#ig`, `#tiktok`, `#fb` |
| **Tools & Productivity** | `#note`, `#remind`, `#reminders`, `#cancelremind`, `#poll`, `#vcard`, `#loc`, `#checkwa`, `#whois`, `#getbio`, `#inspect`, `#join` |
| **Enterprise & Owner** | `#audit`, `#flag`, `#policy`, `#role`, `#backup`, `#metrics`, `#broadcast`, `#mode`, `#sudo`, `#setnamebot`, `#setpp`, `#delpp`, `#setbio`, `#exif`, `#createlog`, `#setlog`, `#setup` |

---

## Safety & Anti-Ban Architecture

1. **LID vs PN Resolution (`src/utils/lid.js`)** — Keeps 64-bit WhatsApp Local Identifiers (`@lid`) separate from Phone Number JIDs (`@s.whatsapp.net`) via group metadata and signal repository mappings.
2. **Prompt Injection Guardrails (`src/agent/agentInjectionGuard.js`)** — Detects jailbreaks, credential probes, and override attempts; wraps untrusted text in `<untrusted_*>` tags and scrubs leaked tokens from outputs.
3. **Anti-Ban Pacing & Filtering (`src/agent/agentSafetyThrottle.js`)** — Triggers `composing` presence delays, enforces per-chat/global rate caps, caps batch DMs at 5 recipients with randomized jitter, and blocks abusive language.
4. **Admin Confirmation Guardrails (`src/agent/agentGuardrails.js`)** — Mass operations impacting more than 3 members require explicit `#confirm` approval.

---

## Disclaimer

- **No Affiliation:** X-Asena is an independent open-source project and is not affiliated with, endorsed by, or connected to WhatsApp LLC or Meta Platforms, Inc.
- **Compliance & Risk:** Automating WhatsApp accounts via unofficial clients carries inherent risk of rate limits or account bans. Use responsibly and in compliance with WhatsApp's Terms of Service and local laws.
- **Liability:** The software is provided *"as is"* without warranty. Maintainers and contributors are not liable for account restrictions, third-party LLM/API charges, data loss, or actions triggered by users or autonomous agents.

---

## Changelog & Releases

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

- **Current Release:** [v4.2.0 (2026-11-25)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.2.0)
- **Previous Releases:** [v4.1.0 (2026-11-25)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.1.0) · [v4.0.0 (2026-07-24)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.0.0)

---

## License

Copyright (c) 2023–2026 Neeraj and X-Asena contributors.

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** — see [LICENSE](LICENSE). Any redistributed fork or modified instance hosted over a network (including SaaS/cloud bot hosting) must make its complete source code publicly available under AGPL-3.0. *(Releases up to `v4.2.0` remain available under the previous MIT License.)*
