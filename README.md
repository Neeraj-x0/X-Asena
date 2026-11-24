# X-Asena

Open-source WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) **7.0.0-rc13**.

Optimized for a lean Node process with SQLite (or Postgres) auth, a dedicated **system log group** for onboarding and diagnostics, and an optional **enterprise control plane** (audit, feature flags, RBAC, policies, metrics, backups).

| | |
|---|---|
| **Runtime** | Node.js ≥ 20 |
| **Module** | ESM (`"type": "module"`) |
| **Auth** | better-sqlite3 (default) or Postgres |
| **Prefix** | `#` |

---

## Features

- **Messaging** — command registry, LID-aware groups, public/private mode, sudo list
- **Media** — stickers + EXIF, YouTube (`youtubei.js`), converters, TTS, social downloaders (best-effort)
- **Moderation** — welcome/goodbye, antilink, antispam, warn/mute/kick, per-group plugin toggles
- **Productivity** — notes, reminders, polls
- **Onboarding** — auto-created system log group + `#setup` wizard (no self-DM)
- **Ops** — audit log, feature flags, RBAC, global policies, job queue, metrics alerts, session backup, optional admin HTTP

---

## Requirements

- [Node.js](https://nodejs.org/) **20+**
- **FFmpeg** on `PATH` (needed for `#ytmp3`, `#play`, `#tomp3`, video stickers, `#attp`)
- WhatsApp account (multi-device)

```bash
# FFmpeg examples
choco install ffmpeg          # Windows
brew install ffmpeg           # macOS
sudo apt install ffmpeg       # Debian/Ubuntu
```

---

## Install

```bash
git clone https://github.com/Neeraj-x0/X-Asena.git
cd X-Asena
npm install
```

Create a `.env` in the project root (copy from [`.env.example`](.env.example)), then:

```bash
npm start
# development (auto-reload):
npm run dev
```

### Login

1. **QR (default)** — scan the QR printed in the terminal with WhatsApp → *Linked devices*.
2. **Pairing code** — set `PAIRING_NUMBER` to your number with country code (digits only, e.g. `919876543210`), restart, and enter the code shown in the terminal on your phone.

Session data is stored in `./database.db` by default (or in Postgres when `DATABASE_URL` is a Postgres URL).

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OWNER_NUMBER` | _(empty)_ | Owner phone(s), comma-separated, country code, no `+`. **Required** to auto-create the system log group. |
| `SUDO` | _(empty)_ | Extra privileged numbers (merged with runtime `#sudo`) |
| `BOT_MODE` | `public` | First-boot seed only: `public` \| `private` |
| `BOT_LANG` | `en` | First-boot language: `en` \| `id` \| `hi` |
| `DATABASE_URL` | `./database.db` | SQLite file path, or `postgres://` / `postgresql://` URL |
| `PAIRING_NUMBER` | _(empty)_ | Enable pairing-code login instead of QR |
| `STICKER_PACKNAME` | `X-Asena` | Default sticker pack name |
| `STICKER_AUTHOR` | `X-Asena` | Default sticker author |
| `REMOVEBG_API_KEY` | _(empty)_ | API key for `#removebg` |
| `REMOVEBG_API_URL` | `https://api.remove.bg/v1.0/removebg` | Endpoint for `#removebg`; any API that accepts the same requests and returns the image |
| `LOG_LEVEL` | `warn` | App log level: `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `BAILEYS_LOG_LEVEL` | `silent` | Baileys / pino level |
| `JOB_CONCURRENCY` | `1` | Parallel media jobs (YouTube downloads) |
| `ERROR_ALERT_THRESHOLD` | `8` | Errors per minute before alerting the system group |
| `TENANT_ID` | `default` | Label for metrics / backups |
| `ADMIN_HTTP_PORT` | _(off)_ | Enable ops HTTP when set (e.g. `8787`) |
| `ADMIN_HTTP_HOST` | `127.0.0.1` | Bind address for admin HTTP |
| `ADMIN_HTTP_TOKEN` | _(required if port set)_ | Bearer token for protected endpoints |

Example `.env`:

```env
OWNER_NUMBER=919876543210
BOT_MODE=public
BOT_LANG=en
LOG_LEVEL=warn
# PAIRING_NUMBER=919876543210
# DATABASE_URL=postgresql://user:pass@host:5432/xasena
# ADMIN_HTTP_PORT=8787
# ADMIN_HTTP_TOKEN=change-me
```

### Auth backends

- **No Postgres URL** → `better-sqlite3` with WAL (default). Path from `DATABASE_URL` or `./database.db`.
- **Postgres URL** → Sequelize Postgres. Settings (`BotKV`) use the same database.

If you upgrade from an older Sequelize + `sqlite3` install and decryption fails, delete `database.db` (and `-wal` / `-shm` if present) and link again.

---

## First run

1. Set `OWNER_NUMBER` and start the bot.
2. After connect, the bot creates a group named **`X-Asena · System`** and adds the owner.
3. Open that group and run `#setup` (mode → language → sticker pack).
4. In normal groups, admins can run `#groupsetup recommended`.

Manual fallback if auto-create fails: create a group, add the bot and yourself, then `#setlog` and `#setup`.

**Why a log group?** WhatsApp bots should not rely on DMing their own number. Setup, stack traces, and ops alerts stay in the system group. Other chats only receive short, user-safe error messages.

| Command | Scope | Description |
|---------|--------|-------------|
| `#createlog` | Owner | Create or recreate the system group |
| `#setlog` | Owner, in a group | Mark the current group as the system log group |
| `#setup` | Privileged, **log group only** | Onboarding wizard |

---

## Commands

Default prefix: `#`. Use `#menu` for the live list, or `#help <command>` for one command.

### Core

| Command | Description |
|---------|-------------|
| `#menu` / `#help` | Command list |
| `#help <cmd>` | Help for one command |
| `#ping` | Latency check |
| `#info` | Message / chat info |
| `#status` | Health (extra detail for owner/sudo) |
| `#lang` | Show or set language (`en` \| `id` \| `hi`) |

### Access

| Command | Who | Description |
|---------|-----|-------------|
| `#mode` / `#mode public\|private` | Owner/sudo | Bot access mode |
| `#sudo add\|del\|list` | Owner (mutations) | Manage sudo users |

- **public** — anyone can use normal commands  
- **private** — owner + sudo only (others are silently ignored)

### Groups

| Command | Description |
|---------|-------------|
| `#mention` | Mention everyone |
| `#tagall` / `#notify` | Tag / alert members |
| `#groupinfo` / `#admins` | Group details |
| `#promote` / `#demote` | Change admin role |
| `#groupsetup recommended\|minimal\|off` | Quick moderation preset |

### Moderation (group admins)

| Command | Description |
|---------|-------------|
| `#welcome` / `#goodbye` | Toggle or set templates (`@user`, `@group`, `@count`) |
| `#antilink` / `#antispam` | Toggle guards |
| `#groupsettings` | Show group flags |
| `#warn` / `#unwarn` / `#warns` | Warn system (kick at limit) |
| `#mute` / `#unmute` / `#kick` | Mute or remove members |
| `#disable` / `#enable` / `#plugins` | Per-group command toggles |

### Stickers & media

| Command | Description |
|---------|-------------|
| `#sticker` / `#s` | Image/video → sticker + EXIF |
| `#take` / `#steal` | Repack sticker EXIF |
| `#toimg` | Sticker → PNG |
| `#exif` | Set pack/author (privileged) |
| `#yt` / `#ytmp3` / `#ytmp4` / `#play` | YouTube info / audio / video / search |
| `#tomp3` / `#toururl` / `#url` | Convert or upload media |
| `#quote` / `#fancy` / `#tts` / `#ttp` / `#attp` | Text / TTS tools |
| `#removebg` | Background remove (needs `REMOVEBG_API_KEY`) |
| `#ig` / `#tiktok` / `#fb` | Social download (best-effort; scrapers break often) |

YouTube uses **`youtubei.js`** (no `yt-dlp`). Soft caps apply (~15 min audio / ~10 min video). Downloads are queued (`JOB_CONCURRENCY`).

### Productivity

| Command | Description |
|---------|-------------|
| `#note set\|get\|del\|list` | Personal notes |
| `#remind <time> <text>` | Reminder (`30s`, `10m`, `2h`, `1d`) |
| `#reminders` / `#cancelremind` | List / cancel |
| `#poll Q \| A \| B` | Create a poll |

### Enterprise / ops

Prefer running these in the **system log group**.

| Command | Description |
|---------|-------------|
| `#audit` | Recent privileged actions (`#audit clear` for owner) |
| `#flag list` / `#flag <name> on\|off` | Feature flags / kill switches |
| `#policy list` / `#policy <key> <value>` | Global policies (quiet hours, rate limits, …) |
| `#role list` / `#role set @user admin` | RBAC (`owner` → `admin` → `mod` → `user`) |
| `#backup` / `#backup full` | Export BotKV JSON (+ optional DB file) |
| `#metrics` | Runtime counters and job queue |
| `#broadcast <text>` | Owner: send to all groups |

Useful flags: `media`, `ytdl`, `social`, `stickers`, `moderation`, `broadcast`, `maintenance` (locks the bot to owner/sudo).

### Admin HTTP (optional)

```env
ADMIN_HTTP_PORT=8787
ADMIN_HTTP_HOST=127.0.0.1
ADMIN_HTTP_TOKEN=long-random-secret
```

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | None | Liveness, FFmpeg, setup, queue |
| `GET /metrics` | Bearer token | JSON metrics |
| `GET /metrics?format=prom` | Bearer token | Prometheus text |
| `GET /audit` | Bearer token | Audit rows |
| `GET /flags` | Bearer token | Feature flags |
| `GET /policies` | Bearer token | Global policies |

Send `Authorization: Bearer <ADMIN_HTTP_TOKEN>`.

---

## Architecture

```text
WhatsApp
   │
   ▼
makeWASocket (lean: no full history, offline on connect)
   │
   ├─ group guards (mute / antilink / antispam)
   ▼
messageHandler
   │  ACL → feature flags → policies → command
   │  audit + metrics on sensitive actions
   │
   ├─ plugins/          commands
   ├─ enterprise/       audit, flags, RBAC, policy, queue, metrics, backup, admin HTTP
   ├─ database/         AuthState + BotKV (SQLite or Postgres)
   └─ system log group  setup, stacks, alerts only
```

- **Socket:** no full history sync, no HQ link previews, `emitOwnEvents: false`, reconnect with backoff  
- **Caches:** short TTL group metadata + message retry cache  
- **Errors:** stacks and diagnostics → system log group only  

---

## Terminal shortcuts

While the process is running:

| Key | Action |
|-----|--------|
| `Q` | Logout and clear auth |
| `R` | Restart process |
| `A` | Wipe auth database (confirm with `Y`) |

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No system group | Set `OWNER_NUMBER`, restart, or `#setlog` in a group you create |
| `#ytmp3` / video sticker fails | Install FFmpeg and ensure it is on `PATH` |
| Session decrypt errors after upgrade | Delete `database.db` (+ `-wal`/`-shm`), link again |
| Social download fails | Expected often — scrapers break; treat as best-effort |
| Bot ignores everyone | Check `#mode` — `private` limits use to owner/sudo |
| Admin HTTP won’t start | Set both `ADMIN_HTTP_PORT` and `ADMIN_HTTP_TOKEN` |

---

## Scripts

```bash
npm start    # node index.js
npm run dev  # nodemon index.js
```

---

## License

[MIT](LICENSE)

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

---

**Author:** [Neeraj](https://github.com/Neeraj-x0) · **Repo:** [Neeraj-x0/X-Asena](https://github.com/Neeraj-x0/X-Asena)
