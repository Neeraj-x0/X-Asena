# X-Asena

[![Release](https://img.shields.io/badge/release-v4.1.0-blue.svg)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.1.0)
[![Baileys](https://img.shields.io/badge/Baileys-7.0.0--rc13-green.svg)](https://github.com/WhiskeySockets/Baileys)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Production-grade WhatsApp bot and autonomous agent platform built on [Baileys](https://github.com/WhiskeySockets/Baileys) **7.0.0-rc13**.

Engineered for reliability, multi-device speed, and enterprise safety. Features a fully autonomous **multi-modal AI Agent layer**, **WhatsApp Business integration**, **group automation**, **prompt injection defense**, **anti-ban rate limiting**, and **LID vs JID differentiation**.

---

## What's New in v4.1.0

- 🤖 **Autonomous Multi-Modal AI Agent Layer** — OpenAI-compatible backend with automatic model discovery (`#agentconfig`), natural language invocation (`@bot`), persistent conversational memory (`#agentmemory`), self-initiating background cron tasks (`#agenttasks`), subagent swarm delegation, milestone planning, and verified Knowledge Base RAG (`#agentkb`).
- 🛡️ **Prompt Injection Guardrails** — Defense against direct jailbreaks, "ignore previous instructions", DAN/Developer mode bypasses, credential leak probing, boundary sandboxing (`<untrusted_*>`), and automated output secret scrubbing (`#agentguard`).
- ⚡ **Safe Direct Messaging (DMs) & Anti-Ban Engine** — Private messaging capabilities equipped with human typing simulation (`composing`), inter-message delays, batch DM queue pacing, and zero-tolerance profanity filtering ("myr").
- 🆔 **Baileys 7.x LID vs PN JID Differentiation** — Full resolution and separation of WhatsApp Local Identifiers (`@lid`) from Phone Number JIDs (`@s.whatsapp.net`), preventing invalid JID corruptions.
- 💼 **WhatsApp Business Suite** — Profile editing (`#bprofile`), business hours (`#bhours`), quick replies (`#quickreply`), and catalog browsing (`#catalog`), guarded to prevent personal account bans.
- ⚙️ **Group Automation Suite** — Prohibited word filter with auto-delete (`#filter`), anti-foreign country code blocker (`#antiforeign`), and scheduled auto-mute (`#automute` / `#autounmute`).
- 📑 **Harmonized 148-Command Architecture** — All commands categorized into 13 dedicated domains with an upgraded interactive `#menu`.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [AI Agent Environment](#ai-agent-environment)
- [Autonomous AI Agent Layer](#autonomous-ai-agent-layer)
- [Command Reference](#command-reference)
  - [Core](#core)
  - [AI Agent & Tools](#ai-agent--tools)
  - [Group Management](#group-management)
  - [Moderation](#moderation)
  - [Group Automation](#group-automation)
  - [WhatsApp Business Suite](#whatsapp-business-suite)
  - [Media & Stickers](#media--stickers)
  - [Downloads](#downloads)
  - [Productivity](#productivity)
  - [Enterprise & Ops](#enterprise--ops)
- [Safety & WhatsApp Anti-Ban Architecture](#safety--whatsapp-anti-ban-architecture)
- [Changelog & Releases](#changelog--releases)
- [License](#license)

---

## Features

- **Autonomous Agentic AI** — Multi-step tool-calling agent, memory layer, cron scheduler, web search, webpage scraping, VM code sandbox, generative images, and vision analysis.
- **WhatsApp Anti-Ban Protection** — Simulated human typing pauses, inter-message cooldowns, batch queue jitter, and velocity quotas.
- **LID / PN Dual Support** — First-class handling of modern WhatsApp 64-bit Local Identifiers (`@lid`) alongside phone numbers (`@s.whatsapp.net`).
- **Security & Guardrails** — Prompt injection defense, secret redaction, and human-in-the-loop approvals (`#confirm`) for high-impact actions.
- **Business Suite** — Manage business profiles, catalogs, away notices, and hours on verified business accounts.
- **Media Engine** — High-speed sticker creation with EXIF metadata, YouTube audio/video (`youtubei.js`), converters, TTS, and social scrapers.
- **Group Moderation** — Anti-link, anti-spam, anti-foreign phone numbers, prohibited word filters, auto-mute schedules, and warn/kick systems.
- **Enterprise Operations** — Structured audit logging, runtime feature flags, RBAC roles, metrics counters, database backups, and optional admin HTTP REST API.

---

## Requirements

- [Node.js](https://nodejs.org/) **≥ 20.0.0**
- **FFmpeg** on `PATH` (required for audio conversion, stickers, and YouTube audio)
- Active WhatsApp account

```bash
# Installing FFmpeg
choco install ffmpeg          # Windows (Chocolatey)
brew install ffmpeg           # macOS (Homebrew)
sudo apt update && sudo apt install ffmpeg  # Debian / Ubuntu
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Neeraj-x0/X-Asena.git
cd X-Asena

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your OWNER_NUMBER and preferences

# 4. Start the bot
npm start

# For development with auto-reload:
npm run dev
```

### Authentication & Pairing

1. **QR Code (Default)** — Scan the QR printed in the terminal via WhatsApp → *Linked devices*.
2. **Pairing Code** — Set `PAIRING_NUMBER=919876543210` in `.env` (digits only with country code) to receive an 8-character pairing code in the terminal.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OWNER_NUMBER` | _(empty)_ | Owner phone number with country code, no `+`. **Required** to auto-create system log group. |
| `SUDO` | _(empty)_ | Comma-separated extra privileged numbers. |
| `BOT_MODE` | `public` | Access mode: `public` (open to all) \| `private` (owner/sudo only). |
| `BOT_LANG` | `en` | Bot language: `en` \| `id` \| `hi`. |
| `DATABASE_URL` | `./database.db` | SQLite path, or PostgreSQL URL (`postgresql://user:pass@host:5432/db`). |
| `PAIRING_NUMBER` | _(empty)_ | Phone number for pairing code authentication. |
| `AI_API_KEY` | _(empty)_ | OpenAI-compatible API key (can also be set via `#agentconfig key <key>`). |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Custom endpoint (e.g. Groq, Ollama, DeepSeek, LocalAI). |
| `AI_MODEL` | `gpt-4o-mini` | Default LLM model name. |
| `STICKER_PACKNAME` | `X-Asena` | Default sticker pack name. |
| `STICKER_AUTHOR` | `X-Asena` | Default sticker author. |
| `REMOVEBG_API_KEY` | _(empty)_ | Optional API key for `#removebg`. |
| `JOB_CONCURRENCY` | `1` | Max concurrent media jobs. |
| `ADMIN_HTTP_PORT` | _(off)_ | Port for enterprise REST API (e.g. `8787`). |
| `ADMIN_HTTP_TOKEN` | _(empty)_ | Bearer authentication token for admin HTTP API. |

### AI Agent Environment

You can configure the autonomous AI layer directly via `.env` or dynamically at runtime:

```env
AI_API_KEY=gsk_your_groq_or_openai_key
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

Or in chat:
```text
#agentconfig key <your_api_key>
#agentconfig url https://api.groq.com/openai/v1
```
*Note: Setting key and URL triggers automatic model discovery from the endpoint.*

---

## Autonomous AI Agent Layer

The agent can be prompted in natural language simply by tagging `@bot` in any message or using `#agent <prompt>`:

```text
@bot calculate the first 25 prime numbers and their sum
@bot in 2 minutes DM me to check the server status
@bot search who won today's football match and summarize
@bot audit this group and create an action plan
@bot remember that quiet hours begin at 10 PM
```

### Agent Features

| Capability | Description | Tool |
|------------|-------------|------|
| **Model Auto-Discovery** | Dynamically queries `/v1/models` to list and select models | `#agentconfig` |
| **Direct Messaging (DMs)** | Paced private messaging with anti-ban human typing delays | `send_direct_message`, `send_batch_dms` |
| **Autonomous Cron** | Self-initiating scheduled tasks via cron or relative delays | `schedule_task`, `#agenttasks` |
| **Persistent Memory** | Long-term memory store across restarts | `remember`, `recall`, `#agentmemory` |
| **Knowledge Base (RAG)** | Verified community documentation and FAQ retrieval | `query_knowledge_base`, `#agentkb` |
| **Swarm Delegation** | Delegates subtasks to specialized roles (researcher, coder, analyst) | `delegate_subtask` |
| **Autonomous Planning** | Generates checklist plans and streams step progress | `create_plan`, `update_plan_progress` |
| **Deterministic Math** | Filters group members by prefix, digit sums, and admin status | `filter_group_members` |
| **Safe VM Sandbox** | Executes JavaScript code safely in an isolated sandbox | `run_code` |
| **Live Browsing** | DuckDuckGo web search and real-time URL webpage scraping | `web_search`, `fetch_webpage` |
| **Multi-Modal Vision** | Inspects and analyzes images quoted or attached to prompts | Vision API |
| **Safety Guardrails** | Blocks prompt injections and requires admin approval for mass actions | `#agentguard`, `#confirm` |

---

## Command Reference

The bot features **148 commands** organized across **13 dedicated categories**. Use `#menu` to view the interactive list.

### Core

| Command | Usage | Description |
|---------|-------|-------------|
| `#menu` / `#help` | `#menu` | Interactive categorized command list |
| `#ping` | `#ping` | Speed and latency test |
| `#info` | `#info` | Chat, user, and message identifier information |
| `#status` | `#status` | Runtime health, memory, uptime, and system info |
| `#lang` | `#lang [en\|id\|hi]` | Display or change bot language |

### AI Agent & Tools

| Command | Usage | Description |
|---------|-------|-------------|
| `#agent` / `#ask` | `#agent <prompt>` | Prompt the autonomous multi-tool AI agent |
| `#agentconfig` | `#agentconfig [key\|url\|model]` | Configure AI endpoint with auto model discovery |
| `#agentguard` | `#agentguard [status\|on\|off\|mode\|logs\|test]` | Manage prompt injection and safety guardrails |
| `#agentpersona` | `#agentpersona [default\|executive\|strict-mod\|witty\|tutor]` | Change agent operational tone and personality |
| `#agentkb` | `#agentkb [add\|list\|del\|search]` | Manage persistent Knowledge Base articles |
| `#agentmemory` | `#agentmemory [clear]` | View or reset agent persistent memories |
| `#agenttasks` | `#agenttasks [cancel <id>]` | Inspect or cancel autonomous scheduled jobs |
| `#confirm` | `#confirm <id>` | Approve a high-risk mass action flagged by guardrails |
| `#cancelaction` | `#cancelaction <id>` | Cancel a pending high-risk action |

### Group Management

| Command | Usage | Description |
|---------|-------|-------------|
| `#groupinfo` | `#groupinfo` | Detailed group metadata, participants, and settings |
| `#admins` | `#admins` | Tag all group administrators |
| `#mention` / `#tagall` | `#mention [text]` | Tag all group members |
| `#notify` | `#notify <text>` | High-visibility administrative alert |
| `#promote` / `#demote` | `#promote @user` | Change member administrator permissions |
| `#groupsetup` | `#groupsetup [recommended\|minimal\|off]` | Apply quick group moderation presets |
| `#revoke` | `#revoke` | Reset group invite link |

### Moderation

| Command | Usage | Description |
|---------|-------|-------------|
| `#mute` / `#unmute` | `#mute` | Mute group (only admins can send messages) |
| `#kick` | `#kick @user` | Remove participant from the group |
| `#warn` / `#unwarn` | `#warn @user [reason]` | Issue formal warning (auto-kick at limit) |
| `#warns` | `#warns [@user]` | Inspect warning count |
| `#antilink` | `#antilink [on\|off\|action]` | Block unauthorized link sharing |
| `#antispam` | `#antispam [on\|off]` | Prevent flood and repetitive message spam |
| `#welcome` / `#goodbye` | `#welcome on\|off` | Custom member join and leave greeting messages |
| `#enable` / `#disable` | `#disable <command>` | Toggle specific commands per group |

### Group Automation

| Command | Usage | Description |
|---------|-------|-------------|
| `#filter` | `#filter add <word> \| <action>` | Auto-delete messages containing prohibited phrases |
| `#antiforeign` | `#antiforeign [on\|off\|allow <codes>\|action kick]` | Auto-block foreign country code numbers on join |
| `#automute` | `#automute 22:00` | Schedule automatic group mute time |
| `#autounmute` | `#autounmute 07:00` | Schedule automatic group unmute time |

### WhatsApp Business Suite

*Guarded strictly for WhatsApp Business accounts to prevent personal account bans.*

| Command | Usage | Description |
|---------|-------|-------------|
| `#bprofile` | `#bprofile` | View or update business address, email, description, and website |
| `#bhours` | `#bhours` | Inspect or update business operating hours |
| `#quickreply` | `#quickreply [add\|list\|del]` | Create shortcut quick reply templates |
| `#catalog` | `#catalog` | Browse and share product catalog items |
| `#awaymsg` | `#awaymsg [on\|off\|set]` | Automated away message during off-hours |
| `#greetmsg` | `#greetmsg [on\|off\|set]` | Automated customer greeting message |

### Media & Stickers

| Command | Usage | Description |
|---------|-------|-------------|
| `#sticker` / `#s` | Reply to image/video | Convert image or short video to sticker |
| `#take` / `#steal` | `#take <pack> \| <author>` | Repack sticker with custom EXIF metadata |
| `#toimg` | Reply to sticker | Convert sticker back to PNG image |
| `#tomp3` | Reply to video/audio | Extract and convert audio to MP3 |
| `#tourl` | Reply to media | Upload media and generate public URL |
| `#tts` | `#tts <lang> <text>` | Google Text-to-Speech audio |
| `#attp` / `#ttp` | `#attp <text>` | Animated rainbow text sticker |

### Downloads

| Command | Usage | Description |
|---------|-------|-------------|
| `#play` | `#play <song name>` | Search YouTube and stream MP3 audio |
| `#ytmp3` / `#ytmp4` | `#ytmp3 <url>` | Download YouTube audio or video directly |
| `#ig` | `#ig <url>` | Instagram photo / reel downloader (best-effort) |
| `#tiktok` | `#tiktok <url>` | TikTok video downloader without watermark |
| `#fb` | `#fb <url>` | Facebook video downloader |

### Productivity

| Command | Usage | Description |
|---------|-------|-------------|
| `#note` | `#note set <name> <text>` | Save and retrieve personal notes |
| `#remind` | `#remind 30m Check oven` | Schedule personal reminders |
| `#poll` | `#poll Question \| Option 1 \| Option 2` | Interactive WhatsApp poll |

### Enterprise & Ops

| Command | Usage | Description |
|---------|-------|-------------|
| `#audit` | `#audit [clear]` | View sensitive admin action logs |
| `#flag` | `#flag <name> [on\|off]` | Toggle runtime feature flags (kill switches) |
| `#policy` | `#policy <key> <val>` | Global platform policy configuration |
| `#role` | `#role set @user admin` | Role-Based Access Control (RBAC) |
| `#backup` | `#backup [full]` | Export configuration database snapshot |
| `#metrics` | `#metrics` | Process memory, latency, and queue counters |
| `#broadcast` | `#broadcast <text>` | Owner broadcast message across all groups |

---

## Safety & WhatsApp Anti-Ban Architecture

WhatsApp monitors automated accounts for spam, burst messaging, and abuse. X-Asena incorporates an extensive defense-in-depth safety engine:

```text
Incoming Message
       │
       ▼
1. LID / PN Differentiation ──► Resolves @lid vs @s.whatsapp.net correctly
       │
       ▼
2. Prompt Injection Guard ────► Blocks jailbreaks, DAN mode, overrides, & credential probes
       │
       ▼
3. Zero-Tolerance Filter ────► Rejects vulgar slurs & abusive language ("myr")
       │
       ▼
4. Autonomous AI Agent ──────► Multi-tool reasoning & execution
       │
       ▼
5. Output Secret Scrubber ───► Strips API keys, Bearer tokens, & system prompts
       │
       ▼
6. Anti-Ban Safe Dispatch ───► Simulates typing (composing), throttles cooldowns, & paces DMs
```

1. **LID vs JID Resolution**: WhatsApp Local Identifiers (`@lid`) are 64-bit cryptographic tokens. The bot ensures LIDs are never corrupted into `@s.whatsapp.net` addresses, mapping phone numbers accurately via group metadata and signal repositories.
2. **Human Typing Simulation**: Automated messages trigger natural `composing` indicators for 1.5–2.5 seconds before dispatching.
3. **Queue Pacing & Batch Caps**: Direct messages are spaced with a minimum 3.5s cooldown, and batch DMs enforce randomized 4–7s pauses with a hard cap of 5 recipients per batch.
4. **Human-in-the-Loop Confirmation**: Destructive actions impacting more than 3 members (e.g. mass kicks) trigger approval guardrails requiring explicit admin confirmation.

---

## Changelog & Releases

Full version history and detailed patch notes are available in [CHANGELOG.md](CHANGELOG.md).

- **Current Release**: [v4.1.0 (2026-11-25)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.1.0)
- **Previous Release**: [v4.0.0 (2026-07-24)](https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.0.0)

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by [Neeraj](https://github.com/Neeraj-x0).
