/**
 * Interactive WhatsApp Management Dashboard (Single-Page HTML)
 * Served by src/enterprise/adminHttp.js
 */

export function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>X-Asena • WhatsApp Operations Dashboard</title>
  <style>
    :root {
      --bg: #090d12;
      --bg-elev: #111822;
      --bg-card: #151e2b;
      --bg-hover: #1c2738;
      --border: #233044;
      --text: #e6edf3;
      --text-muted: #8b9bb4;
      --accent: #10b981;
      --accent-dim: rgba(16, 185, 129, 0.14);
      --blue: #3b82f6;
      --amber: #f59e0b;
      --red: #ef4444;
      --purple: #a855f7;
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      line-height: 1.45;
    }

    /* Auth Gate */
    .auth-screen {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: radial-gradient(circle at top, #12232c 0%, var(--bg) 60%);
    }
    .auth-card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    }
    .auth-logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .logo-badge {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: linear-gradient(135deg, #10b981, #059669);
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 18px;
      color: #031911;
    }

    /* Main Layout */
    .app { display: flex; min-height: 100vh; }
    .sidebar {
      width: 250px;
      background: var(--bg-elev);
      border-right: 1px solid var(--border);
      padding: 20px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }
    .brand-title { font-weight: 700; font-size: 16px; }
    .brand-sub { font-size: 11px; color: var(--accent); font-family: var(--mono); }

    .nav-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 10px 12px;
      border-radius: 9px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
    }
    .nav-btn:hover { background: var(--bg-hover); color: var(--text); }
    .nav-btn.active { background: var(--accent-dim); color: var(--accent); font-weight: 600; }

    .sidebar-footer {
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .main {
      flex: 1;
      padding: 24px 28px;
      overflow-y: auto;
      max-width: 1440px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
    }
    .page-title { font-size: 22px; font-weight: 700; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--bg-card);
      border: 1px solid var(--border);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); }
    .dot.online { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
    .dot.offline { background: var(--red); }

    /* Cards & Grids */
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 10px;
    }
    .card-title { font-size: 15px; font-weight: 600; color: var(--text); }
    .kpi-label { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
    .kpi-val { font-size: 24px; font-weight: 700; font-family: var(--mono); }
    .kpi-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

    /* Inputs & Buttons */
    label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; font-weight: 500; }
    input, select, textarea {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-family: var(--font);
      outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--accent); }
    textarea { resize: vertical; min-height: 82px; font-family: var(--font); }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--bg-hover);
      color: var(--text);
      transition: all 0.15s ease;
    }
    .btn:hover { filter: brightness(1.12); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: #042216; border-color: var(--accent); }
    .btn-blue { background: rgba(59,130,246,0.18); color: #60a5fa; border-color: rgba(59,130,246,0.4); }
    .btn-amber { background: rgba(245,158,11,0.16); color: #fbbf24; border-color: rgba(245,158,11,0.4); }
    .btn-danger { background: rgba(239,68,68,0.16); color: #f87171; border-color: rgba(239,68,68,0.4); }
    .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 6px; }

    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .stack { display: flex; flex-direction: column; gap: 12px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--mono);
      background: var(--bg-hover);
      color: var(--text-muted);
    }
    .badge-green { background: var(--accent-dim); color: var(--accent); }
    .badge-amber { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .badge-red { background: rgba(239,68,68,0.15); color: #f87171; }
    .badge-blue { background: rgba(59,130,246,0.15); color: #60a5fa; }

    /* Tables & Lists */
    .list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 11px 12px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      gap: 10px;
    }
    .list-item.clickable { cursor: pointer; }
    .list-item.clickable:hover { border-color: var(--accent); }
    .list-item.selected { border-color: var(--accent); background: rgba(16, 185, 129, 0.06); }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
    th { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em; }

    .mono { font-family: var(--mono); font-size: 12px; }
    .muted { color: var(--text-muted); font-size: 12px; }

    .qr-box {
      background: #ffffff;
      padding: 14px;
      border-radius: 12px;
      display: inline-block;
      margin: 10px 0;
    }

    .terminal-out {
      background: #06090d;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-family: var(--mono);
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 300px;
      overflow-y: auto;
      color: #c9d1d9;
    }

    .toggle-switch {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--bg-elev);
      border: 1px solid var(--accent);
      color: var(--text);
      padding: 12px 18px;
      border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.45);
      font-size: 13px;
      z-index: 9999;
      display: none;
    }
    .toast.error { border-color: var(--red); }

    .hidden { display: none !important; }

    @media (max-width: 860px) {
      .app { flex-direction: column; }
      .sidebar { width: 100%; height: auto; position: static; flex-direction: row; flex-wrap: wrap; }
      .brand { width: 100%; }
      .sidebar-footer { width: 100%; flex-direction: row; }
      .main { padding: 16px; }
    }
  </style>
</head>
<body>

  <!-- Auth Gate -->
  <div id="authScreen" class="auth-screen hidden">
    <div class="auth-card">
      <div class="auth-logo">
        <div class="logo-badge">X</div>
        <div>
          <div style="font-size: 18px; font-weight: 700;">X-Asena Admin</div>
          <div class="muted">WhatsApp Operations Dashboard</div>
        </div>
      </div>
      <div class="stack">
        <div>
          <label for="tokenInput">Admin HTTP Token</label>
          <input id="tokenInput" type="password" placeholder="Enter ADMIN_HTTP_TOKEN..." />
        </div>
        <button id="loginBtn" class="btn btn-primary" style="width: 100%;">Unlock Dashboard</button>
        <div id="authErr" class="muted" style="color: var(--red);"></div>
      </div>
    </div>
  </div>

  <!-- Main Dashboard -->
  <div id="appShell" class="app hidden">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo-badge" style="width: 34px; height: 34px; font-size: 15px;">X</div>
        <div>
          <div class="brand-title">X-Asena</div>
          <div class="brand-sub" id="versionTag">v4.1.0 Ops</div>
        </div>
      </div>

      <button class="nav-btn active" data-tab="overview">📊 Overview & Session</button>
      <button class="nav-btn" data-tab="groups">👥 Groups & Moderation</button>
      <button class="nav-btn" data-tab="messaging">💬 Messaging & Polls</button>
      <button class="nav-btn" data-tab="agent">🤖 AI Agent Control</button>
      <button class="nav-btn" data-tab="commands">🧩 Commands & Plugins</button>
      <button class="nav-btn" data-tab="ops">🛡️ Flags, Policies & Audit</button>

      <div class="sidebar-footer">
        <button id="refreshAllBtn" class="btn btn-sm" style="width: 100%;">🔄 Refresh Data</button>
        <button id="signOutBtn" class="btn btn-sm btn-danger" style="width: 100%;">🔒 Lock Dashboard</button>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="page-title" id="pageTitle">Overview & WhatsApp Session</div>
          <div class="muted" id="subStatus">Live Socket Telemetry</div>
        </div>
        <div class="row">
          <div class="status-pill">
            <span class="dot" id="connDot"></span>
            <span id="connLabel">CHECKING...</span>
          </div>
          <div class="status-pill">
            <span class="muted">Mode:</span>
            <span id="modeBadge" class="mono">...</span>
          </div>
        </div>
      </div>

      <!-- TAB: OVERVIEW -->
      <section id="tab-overview" class="tab-panel">
        <div class="grid-4">
          <div class="card">
            <div class="kpi-label">Bot Uptime</div>
            <div class="kpi-val" id="kpiUptime">--</div>
            <div class="kpi-sub" id="kpiNode">Node --</div>
          </div>
          <div class="card">
            <div class="kpi-label">Memory (RSS)</div>
            <div class="kpi-val" id="kpiRam">--</div>
            <div class="kpi-sub" id="kpiQueue">Queue: 0</div>
          </div>
          <div class="card">
            <div class="kpi-label">Commands Executed</div>
            <div class="kpi-val" id="kpiCmds">0</div>
            <div class="kpi-sub" id="kpiErrs">Errors (1m): 0</div>
          </div>
          <div class="card">
            <div class="kpi-label">Connected Groups</div>
            <div class="kpi-val" id="kpiGroups">--</div>
            <div class="kpi-sub" id="kpiSetup">Setup: --</div>
          </div>
        </div>

        <div class="grid-2">
          <!-- WhatsApp Session & QR -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">📱 WhatsApp Connection & Auth</div>
              <div class="row">
                <button class="btn btn-sm btn-blue" onclick="apiAction('/api/bot/reconnect', {})">Reconnect</button>
                <button class="btn btn-sm btn-danger" onclick="confirmLogout()">Logout</button>
              </div>
            </div>
            <div id="sessionBody" class="stack">
              <div class="muted">Loading WhatsApp session state...</div>
            </div>
            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border);">
              <div class="row">
                <button class="btn btn-sm" id="btnModePublic" onclick="setBotMode('public')">Mode: Public</button>
                <button class="btn btn-sm" id="btnModePrivate" onclick="setBotMode('private')">Mode: Private</button>
                <button class="btn btn-sm" onclick="apiAction('/api/bot/presence', { status: 'available' })">Set Online</button>
                <button class="btn btn-sm" onclick="apiAction('/api/bot/presence', { status: 'unavailable' })">Set Offline</button>
              </div>
            </div>
          </div>

          <!-- Live Feed -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">📡 Live Message & Activity Stream</div>
              <span class="badge badge-green">LIVE</span>
            </div>
            <div id="liveFeed" class="stack" style="max-height: 360px; overflow-y: auto;">
              <div class="muted">No recent messages captured yet...</div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB: GROUPS & MODERATION -->
      <section id="tab-groups" class="tab-panel hidden">
        <div class="grid-2" style="grid-template-columns: 340px 1fr;">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Joined Groups</div>
              <button class="btn btn-sm" onclick="loadGroups()">↻</button>
            </div>
            <input id="groupSearch" placeholder="Search groups..." oninput="renderGroupsList()" style="margin-bottom: 12px;" />
            <div id="groupsList" class="stack" style="max-height: 600px; overflow-y: auto;">
              <div class="muted">Loading groups...</div>
            </div>
          </div>

          <div class="card" id="groupInspector">
            <div class="muted">Select a group from the left panel to inspect settings, permissions, invite links, and participants.</div>
          </div>
        </div>
      </section>

      <!-- TAB: MESSAGING & POLLS -->
      <section id="tab-messaging" class="tab-panel hidden">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">✉️ Send Direct Message or Group Message</div>
              <span class="badge badge-green">Anti-Ban Protected</span>
            </div>
            <div class="stack">
              <div>
                <label>Target Type</label>
                <select id="msgTargetType" onchange="toggleMsgTargetUI()">
                  <option value="group">WhatsApp Group</option>
                  <option value="dm">Direct Message (Phone / LID)</option>
                </select>
              </div>
              <div id="msgGroupSelectWrap">
                <label>Select Group</label>
                <select id="msgGroupSelect"></select>
              </div>
              <div id="msgDmInputWrap" class="hidden">
                <label>Recipient Phone Number or LID (e.g. 919876543210 or 12345@lid)</label>
                <input id="msgDmTarget" placeholder="919876543210" />
              </div>
              <div>
                <label>Message Text</label>
                <textarea id="msgText" placeholder="Write your message..."></textarea>
              </div>
              <button class="btn btn-primary" onclick="sendChatMessage()">Send Message</button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">📊 Send Interactive WhatsApp Poll</div>
            </div>
            <div class="stack">
              <div>
                <label>Target Group</label>
                <select id="pollGroupSelect"></select>
              </div>
              <div>
                <label>Poll Question</label>
                <input id="pollQuestion" placeholder="What should we build next?" />
              </div>
              <div>
                <label>Options (one per line, 2 to 12 options)</label>
                <textarea id="pollOptions" placeholder="Option A&#10;Option B&#10;Option C"></textarea>
              </div>
              <div>
                <label>Max Selectable Choices</label>
                <input id="pollSelectable" type="number" min="1" max="12" value="1" />
              </div>
              <button class="btn btn-primary" onclick="sendPoll()">Create Poll</button>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB: AI AGENT CONTROL -->
      <section id="tab-agent" class="tab-panel hidden">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">🧠 AI Agent Interactive Console</div>
              <span class="badge badge-blue">56 Native Tools + 132 Plugins</span>
            </div>
            <div class="stack">
              <div>
                <label>Execution Context (Group or Bot Self)</label>
                <select id="agentContextJid"></select>
              </div>
              <div>
                <label>Natural Language Instruction</label>
                <textarea id="agentPromptInput" placeholder="e.g. unlock the group when @user leaves or check inactive members"></textarea>
              </div>
              <button class="btn btn-primary" id="runAgentBtn" onclick="runAgentConsole()">Execute Agent Prompt</button>
              <div>
                <label>Agent Response</label>
                <div id="agentOutput" class="terminal-out">Ready. Enter a command or natural language request above.</div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">⚙️ AI Provider & Security Guardrails</div>
            </div>
            <div class="stack">
              <div>
                <label>Base URL</label>
                <input id="aiBaseUrl" placeholder="https://api.groq.com/openai/v1" />
              </div>
              <div>
                <label>API Key (leave blank to keep existing: <span id="aiMaskedKey" class="mono">...</span>)</label>
                <input id="aiApiKey" type="password" placeholder="sk-... / gsk_..." />
              </div>
              <div>
                <label>Default Model (select discovered or type custom)</label>
                <div class="row" style="margin-bottom: 8px;">
                  <input id="aiModelInput" list="aiModelsDatalist" placeholder="gpt-4o-mini / llama-3.3-70b-versatile" style="flex: 1;" />
                  <datalist id="aiModelsDatalist"></datalist>
                  <select id="aiModelSelect" style="flex: 1;" onchange="if(this.value) document.getElementById('aiModelInput').value = this.value;"></select>
                </div>
                <div class="row">
                  <button class="btn btn-sm btn-primary" onclick="saveAgentConfig(false)">Save Config</button>
                  <button class="btn btn-sm btn-blue" onclick="saveAgentConfig(true)">Save & Discover Models</button>
                </div>
              </div>
              <div style="border-top: 1px solid var(--border); padding-top: 12px;">
                <div class="card-title" style="margin-bottom: 10px;">🛡️ Prompt Injection Guardrails</div>
                <div class="row">
                  <button class="btn btn-sm" id="guardToggleBtn" onclick="toggleGuardrails()">Toggle Guardrails</button>
                  <button class="btn btn-sm" onclick="setGuardMode('standard')">Mode: Standard</button>
                  <button class="btn btn-sm btn-amber" onclick="setGuardMode('strict')">Mode: Strict</button>
                  <button class="btn btn-sm btn-danger" onclick="clearGuardLogs()">Clear Logs</button>
                </div>
                <div id="guardSummary" class="muted" style="margin-top: 8px;">...</div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">⏰ Scheduled Autonomous & Iterative Tasks</div>
            </div>
            <div id="agentTasksList" class="stack">
              <div class="muted">No scheduled tasks active.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">🎯 Real-Time Event Watchers</div>
            </div>
            <div id="agentWatchersList" class="stack">
              <div class="muted">No event watchers active.</div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB: COMMANDS & PLUGINS -->
      <section id="tab-commands" class="tab-panel hidden">
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">⚡ Quick Execute Plugin Command</div>
          </div>
          <div class="row">
            <div style="flex: 1; min-width: 180px;">
              <label>Target Chat</label>
              <select id="cmdTargetJid"></select>
            </div>
            <div style="flex: 1; min-width: 160px;">
              <label>Command Name</label>
              <input id="cmdExecName" placeholder="e.g. ping, groupsettings, antilink" />
            </div>
            <div style="flex: 2; min-width: 220px;">
              <label>Arguments</label>
              <input id="cmdExecArgs" placeholder="e.g. on" />
            </div>
            <div style="align-self: flex-end;">
              <button class="btn btn-primary" onclick="executePluginCommand()">Run Command</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🧩 Registered Bot Commands & Parameter Schemas (<span id="cmdCount">0</span>)</div>
            <input id="cmdSearch" placeholder="Search commands or params..." oninput="renderCommandsTable()" style="max-width: 280px;" />
          </div>
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Category</th>
                  <th>Input Format / Params</th>
                  <th>Permissions</th>
                  <th>Description</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="commandsTbody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB: OPS (FLAGS, POLICIES, AUDIT) -->
      <section id="tab-ops" class="tab-panel hidden">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">🚩 Global Feature Flags & Kill Switches</div>
            </div>
            <div id="flagsContainer" class="stack"></div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">📜 Global Policies</div>
            </div>
            <div id="policiesContainer" class="stack"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🧾 Security & Operations Audit Log</div>
            <button class="btn btn-sm btn-danger" onclick="clearAuditLogs()">Clear Audit Log</button>
          </div>
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Meta</th>
                </tr>
              </thead>
              <tbody id="auditTbody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    let TOKEN = "";
    let stateOverview = null;
    let groupsCache = [];
    let selectedGroupJid = null;
    let commandsCache = [];

    function esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function showToast(msg, isError = false) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.className = "toast" + (isError ? " error" : "");
      el.style.display = "block";
      setTimeout(() => { el.style.display = "none"; }, 3500);
    }

    async function api(path, opts = {}) {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + TOKEN,
        ...(opts.headers || {}),
      };
      const res = await fetch(path, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem("xasena_admin_token");
        document.getElementById("appShell").classList.add("hidden");
        document.getElementById("authScreen").classList.remove("hidden");
        throw new Error("Unauthorized (invalid token)");
      }
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    async function apiAction(path, body) {
      try {
        const res = await api(path, { method: "POST", body: JSON.stringify(body || {}) });
        showToast(res.message || "Action completed!");
        await refreshAll();
        return res;
      } catch (err) {
        showToast(err.message, true);
      }
    }

    // Tab Navigation
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
        document.getElementById("tab-" + tab).classList.remove("hidden");
        document.getElementById("pageTitle").textContent = btn.textContent.replace(/^[^a-zA-Z]+/, "");
      });
    });

    function formatUptime(s) {
      s = Number(s) || 0;
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return d + "d " + h + "h " + m + "m";
      if (h > 0) return h + "h " + m + "m";
      return m + "m " + (s % 60) + "s";
    }

    async function loadOverview() {
      const ov = await api("/api/overview");
      stateOverview = ov;

      const agentEnabled = ov.agentEnabled !== false;
      const agentNavBtn = document.querySelector('[data-tab="agent"]');
      const agentTab = document.getElementById("tab-agent");
      if (agentNavBtn) agentNavBtn.classList.toggle("hidden", !agentEnabled);
      if (agentTab && !agentEnabled) agentTab.classList.add("hidden");

      document.getElementById("versionTag").textContent = "v" + esc(ov.version) + " Ops";
      document.getElementById("kpiUptime").textContent = formatUptime(ov.metrics.uptime_s);
      document.getElementById("kpiNode").textContent = "Node " + esc(ov.nodeVersion);
      document.getElementById("kpiRam").textContent = (ov.memoryMb?.rss || 0) + " MB";
      document.getElementById("kpiQueue").textContent = "Queue: " + (ov.queue?.running || 0) + " active / " + (ov.queue?.queued || 0) + " queued";
      document.getElementById("kpiCmds").textContent = ov.metrics.counters?.commands || 0;
      document.getElementById("kpiErrs").textContent = "Errors (1m): " + (ov.metrics.errors_last_min || 0);
      document.getElementById("kpiGroups").textContent = ov.groupCount ?? "--";
      document.getElementById("kpiSetup").textContent = "Setup: " + (ov.setup ? "Done" : "Pending") + " • FFmpeg: " + (ov.ffmpeg ? "OK" : "Missing");

      document.getElementById("modeBadge").textContent = String(ov.mode || "public").toUpperCase();
      document.getElementById("btnModePublic").className = "btn btn-sm " + (ov.mode === "public" ? "btn-primary" : "");
      document.getElementById("btnModePrivate").className = "btn btn-sm " + (ov.mode === "private" ? "btn-primary" : "");

      const dot = document.getElementById("connDot");
      const lbl = document.getElementById("connLabel");
      const s = ov.connection || {};
      if (s.connected) {
        dot.className = "dot online";
        lbl.textContent = "ONLINE • " + (s.user?.id?.split(":")[0] || "Connected");
      } else if (s.status === "qr" || s.qr) {
        dot.className = "dot";
        lbl.textContent = "SCAN QR CODE";
      } else if (s.status === "pairing") {
        dot.className = "dot";
        lbl.textContent = "PAIRING CODE READY";
      } else {
        dot.className = "dot offline";
        lbl.textContent = String(s.status || "DISCONNECTED").toUpperCase();
      }

      const sb = document.getElementById("sessionBody");
      const aStat = ov.authStats;
      const statsHtml = aStat
        ? '<div class="list-item"><div class="mono muted">Signal DB (' + esc(aStat.backend) + '): ' +
            aStat.sessions + ' sessions • ' + aStat.preKeys + ' prekeys • ' +
            aStat.senderKeys + ' sender-keys • ' + (s.sessionRotations || 0) + ' rotations' +
            '</div><button class="btn btn-sm" onclick="apiAction(\\'/api/auth/prune\\', {})">Prune Old Ratchets</button></div>'
        : '';

      if (s.connected) {
        sb.innerHTML =
          '<div class="list-item"><div><div style="font-weight:600;">' + esc(s.user?.name || "X-Asena Bot") + '</div>' +
          '<div class="mono muted">PN JID: ' + esc(s.user?.id || "N/A") + '</div>' +
          (s.user?.lid ? '<div class="mono muted">LID: ' + esc(s.user.lid) + '</div>' : '') +
          '</div><span class="badge badge-green">LINKED</span></div>' + statsHtml;
      } else {
        let html = '<div class="muted">WhatsApp socket status: <strong>' + esc(s.status) + '</strong></div>';
        if (ov.qrSvg) {
          html += '<div style="text-align:center;"><div class="qr-box">' + ov.qrSvg + '</div><div class="muted">Scan via WhatsApp → Linked Devices</div></div>';
        }
        if (s.pairingCode) {
          html += '<div class="list-item"><span>Pairing Code:</span><span class="mono" style="font-size:18px;color:var(--accent);font-weight:700;">' + esc(s.pairingCode) + '</span></div>';
        }
        html += '<div class="row" style="margin-top:8px;">' +
          '<input id="pairNumInput" placeholder="Phone with country code (e.g. 919876543210)" style="flex:1;" />' +
          '<button class="btn btn-sm btn-primary" onclick="requestPairing()">Get Pairing Code</button></div>' + statsHtml;
        sb.innerHTML = html;
      }

      // Live Feed
      const feed = document.getElementById("liveFeed");
      const msgs = ov.recentMessages || [];
      if (!msgs.length) {
        feed.innerHTML = '<div class="muted">Waiting for incoming WhatsApp messages...</div>';
      } else {
        feed.innerHTML = msgs.slice(0, 25).map((m) =>
          '<div class="list-item" style="align-items:flex-start;">' +
            '<div style="flex:1; min-width:0;">' +
              '<div class="row" style="gap:6px;">' +
                '<span class="badge ' + (m.isGroup ? 'badge-blue' : 'badge-green') + '">' + (m.isGroup ? 'GROUP' : 'DM') + '</span>' +
                '<span style="font-weight:600; font-size:13px;">' + esc(m.senderName || m.sender?.split("@")[0] || "User") + '</span>' +
                '<span class="mono muted">' + new Date(m.ts).toLocaleTimeString() + '</span>' +
              '</div>' +
              '<div style="margin-top:4px; font-size:13px; word-break:break-word;">' + esc(m.body || "[" + m.type + "]") + '</div>' +
            '</div>' +
          '</div>'
        ).join("");
      }
    }

    async function requestPairing() {
      const num = document.getElementById("pairNumInput")?.value?.trim();
      if (!num) return showToast("Enter a phone number with country code", true);
      const res = await apiAction("/api/bot/pairing", { phoneNumber: num });
      if (res?.code) showToast("Pairing code: " + res.code);
    }

    async function setBotMode(mode) {
      await apiAction("/api/bot/mode", { mode });
    }

    async function confirmLogout() {
      if (!confirm("Logout WhatsApp session and clear auth credentials?")) return;
      await apiAction("/api/bot/logout", {});
    }

    // Groups & Moderation
    async function loadGroups() {
      try {
        const res = await api("/api/groups");
        groupsCache = res.groups || [];
        renderGroupsList();
        populateChatSelectors();
      } catch (err) {
        document.getElementById("groupsList").innerHTML = '<div class="muted">' + esc(err.message) + '</div>';
      }
    }

    function populateChatSelectors() {
      const optionsHtml = groupsCache.map((g) =>
        '<option value="' + esc(g.id) + '">' + esc(g.subject || g.id) + ' (' + g.size + ')</option>'
      ).join("");
      const selfOpt = stateOverview?.connection?.user?.id
        ? '<option value="' + esc(stateOverview.connection.user.id.replace(/:\\d+@/, "@")) + '">Bot Owner / Self Chat</option>'
        : "";

      document.getElementById("msgGroupSelect").innerHTML = optionsHtml || '<option value="">No groups available</option>';
      document.getElementById("pollGroupSelect").innerHTML = optionsHtml || '<option value="">No groups available</option>';
      document.getElementById("agentContextJid").innerHTML = selfOpt + optionsHtml;
      document.getElementById("cmdTargetJid").innerHTML = selfOpt + optionsHtml;
    }

    function renderGroupsList() {
      const q = (document.getElementById("groupSearch").value || "").toLowerCase();
      const filtered = groupsCache.filter((g) =>
        (g.subject || "").toLowerCase().includes(q) || g.id.toLowerCase().includes(q)
      );
      const el = document.getElementById("groupsList");
      if (!filtered.length) {
        el.innerHTML = '<div class="muted">No matching groups found.</div>';
        return;
      }
      el.innerHTML = filtered.map((g) =>
        '<div class="list-item clickable ' + (selectedGroupJid === g.id ? "selected" : "") + '" onclick="inspectGroup(\\'' + esc(g.id) + '\\')">' +
          '<div style="min-width:0;">' +
            '<div style="font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(g.subject || "Unnamed Group") + '</div>' +
            '<div class="mono muted">' + g.size + ' members • ' + (g.announce ? "🔒 Locked" : "🔓 Open") + '</div>' +
          '</div>' +
        '</div>'
      ).join("");
    }

    async function inspectGroup(jid) {
      selectedGroupJid = jid;
      renderGroupsList();
      const el = document.getElementById("groupInspector");
      el.innerHTML = '<div class="muted">Loading group details...</div>';

      try {
        const g = await api("/api/groups/" + encodeURIComponent(jid));
        const s = g.settings || {};

        let html =
          '<div class="card-header">' +
            '<div><div style="font-size:18px;font-weight:700;">' + esc(g.subject) + '</div>' +
            '<div class="mono muted">' + esc(g.id) + ' • ' + g.participants.length + ' participants</div></div>' +
            '<div class="row">' +
              '<button class="btn btn-sm ' + (g.announce ? 'btn-primary' : 'btn-amber') + '" onclick="updateGroupSetting(\\'' + esc(g.id) + '\\', \\'announce\\', ' + (!g.announce) + ')">' +
                (g.announce ? '🔓 Unlock Group' : '🔒 Lock Group (Admins Only)') +
              '</button>' +
              '<button class="btn btn-sm" onclick="updateGroupSetting(\\'' + esc(g.id) + '\\', \\'restrict\\', ' + (!g.restrict) + ')">' +
                (g.restrict ? '✏️ Allow All Edit Info' : '🛡️ Admins Only Edit Info') +
              '</button>' +
            '</div>' +
          '</div>';

        if (g.inviteLink) {
          html += '<div class="list-item" style="margin-bottom:14px;">' +
            '<span class="mono" style="word-break:break-all;">' + esc(g.inviteLink) + '</span>' +
            '<button class="btn btn-sm btn-danger" onclick="revokeGroupLink(\\'' + esc(g.id) + '\\')">Revoke Link</button>' +
          '</div>';
        }

        // Guard flags
        const guardKeys = [
          ["welcome", "Welcome"],
          ["goodbye", "Goodbye"],
          ["antilink", "Anti-Link"],
          ["antispam", "Anti-Spam"],
          ["antiforeign", "Anti-Foreign"],
          ["filter", "Word Filter"],
        ];
        html += '<div style="margin-bottom:16px;"><div class="card-title" style="margin-bottom:8px;">Moderation Guards & Disappearing Messages</div><div class="row">';
        guardKeys.forEach(([k, label]) => {
          const on = Boolean(s[k]);
          html += '<button class="btn btn-sm ' + (on ? 'btn-primary' : '') + '" onclick="updateGroupSetting(\\'' + esc(g.id) + '\\', \\'' + k + '\\', ' + (!on) + ')">' +
            (on ? '✅ ' : '⬜ ') + label + '</button>';
        });
        html += '<select style="width:auto;" onchange="updateGroupSetting(\\'' + esc(g.id) + '\\', \\'ephemeral\\', Number(this.value))">' +
          '<option value="">Timer: ' + (g.ephemeralDuration || 0) + 's</option>' +
          '<option value="0">Timer: Off</option>' +
          '<option value="86400">Timer: 24h</option>' +
          '<option value="604800">Timer: 7d</option>' +
          '<option value="7776000">Timer: 90d</option>' +
        '</select></div></div>';

        // Participants table
        html += '<div class="card-title" style="margin-bottom:8px;">Participants (' + g.participants.length + ')</div>' +
          '<div style="max-height: 360px; overflow-y: auto;"><table><thead><tr><th>Member (PN / LID)</th><th>Role</th><th>Warns</th><th>Actions</th></tr></thead><tbody>';

        g.participants.forEach((p) => {
          const roleBadge = p.admin === "superadmin"
            ? '<span class="badge badge-amber">OWNER</span>'
            : p.admin === "admin"
            ? '<span class="badge badge-green">ADMIN</span>'
            : '<span class="badge">MEMBER</span>';

          const idLabel = p.phoneNumber
            ? '+' + esc(p.phoneNumber) + (p.lid ? ' <span class="muted">(' + esc(p.lid.split("@")[0]) + '@lid)</span>' : '')
            : esc(p.id);

          html += '<tr>' +
            '<td class="mono">' + idLabel + '</td>' +
            '<td>' + roleBadge + '</td>' +
            '<td class="mono">' + (p.warns || 0) + '</td>' +
            '<td><div class="row" style="gap:4px;">' +
              '<button class="btn btn-sm" onclick="memberAction(\\'' + esc(g.id) + '\\', \\'' + esc(p.id) + '\\', \\'warn\\')">Warn</button>' +
              '<button class="btn btn-sm" onclick="memberAction(\\'' + esc(g.id) + '\\', \\'' + esc(p.id) + '\\', \\'unwarn\\')">Unwarn</button>' +
              (p.admin ? '<button class="btn btn-sm btn-amber" onclick="memberAction(\\'' + esc(g.id) + '\\', \\'' + esc(p.id) + '\\', \\'demote\\')">Demote</button>'
                       : '<button class="btn btn-sm btn-blue" onclick="memberAction(\\'' + esc(g.id) + '\\', \\'' + esc(p.id) + '\\', \\'promote\\')">Promote</button>') +
              '<button class="btn btn-sm btn-danger" onclick="memberAction(\\'' + esc(g.id) + '\\', \\'' + esc(p.id) + '\\', \\'kick\\')">Kick</button>' +
            '</div></td>' +
          '</tr>';
        });

        html += '</tbody></table></div>';
        el.innerHTML = html;
      } catch (err) {
        el.innerHTML = '<div class="muted" style="color:var(--red);">' + esc(err.message) + '</div>';
      }
    }

    async function updateGroupSetting(groupJid, key, value) {
      await apiAction("/api/groups/settings", { groupJid, key, value });
      await inspectGroup(groupJid);
    }

    async function memberAction(groupJid, userJid, action) {
      if (action === "kick" && !confirm("Remove participant " + userJid + " from group?")) return;
      await apiAction("/api/groups/member", { groupJid, userJid, action });
      await inspectGroup(groupJid);
    }

    async function revokeGroupLink(groupJid) {
      const res = await apiAction("/api/groups/revoke", { groupJid });
      if (res?.inviteLink) await inspectGroup(groupJid);
    }

    // Messaging & Polls
    function toggleMsgTargetUI() {
      const type = document.getElementById("msgTargetType").value;
      document.getElementById("msgGroupSelectWrap").classList.toggle("hidden", type !== "group");
      document.getElementById("msgDmInputWrap").classList.toggle("hidden", type !== "dm");
    }

    async function sendChatMessage() {
      const type = document.getElementById("msgTargetType").value;
      const target = type === "group"
        ? document.getElementById("msgGroupSelect").value
        : document.getElementById("msgDmTarget").value.trim();
      const text = document.getElementById("msgText").value.trim();
      if (!target || !text) return showToast("Target and message text are required", true);
      const res = await apiAction("/api/messages/send", { target, text });
      if (res?.success) document.getElementById("msgText").value = "";
    }

    async function sendPoll() {
      const groupJid = document.getElementById("pollGroupSelect").value;
      const question = document.getElementById("pollQuestion").value.trim();
      const options = document.getElementById("pollOptions").value.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
      const selectableCount = Number(document.getElementById("pollSelectable").value) || 1;
      if (!groupJid || !question || options.length < 2) {
        return showToast("Provide group, question, and at least 2 options", true);
      }
      await apiAction("/api/messages/poll", { groupJid, question, options, selectableCount });
    }

    // AI Agent Control
    async function loadAgent() {
      const data = await api("/api/agent");
      if (data.enabled === false) return;
      document.getElementById("aiBaseUrl").value = data.config?.baseUrl || "";
      document.getElementById("aiMaskedKey").textContent = data.config?.maskedKey || "Not set";

      const modelSel = document.getElementById("aiModelSelect");
      const modelInp = document.getElementById("aiModelInput");
      const modelList = document.getElementById("aiModelsDatalist");
      const current = data.config?.model || "";
      if (document.activeElement !== modelInp) {
        modelInp.value = current;
      }
      const models = new Set([current, ...(data.discoveredModels || [])].filter(Boolean));
      const optHtml = [...models].map((m) =>
        '<option value="' + esc(m) + '" ' + (m === current ? 'selected' : '') + '>' + esc(m) + '</option>'
      ).join("");
      modelSel.innerHTML = '<option value="">-- Discovered Models (' + models.size + ') --</option>' + optHtml;
      modelList.innerHTML = [...models].map((m) => '<option value="' + esc(m) + '">').join("");

      const g = data.guardrails || {};
      document.getElementById("guardToggleBtn").textContent = g.enabled ? "Guardrails: ON" : "Guardrails: OFF";
      document.getElementById("guardToggleBtn").className = "btn btn-sm " + (g.enabled ? "btn-primary" : "btn-danger");
      document.getElementById("guardSummary").textContent =
        "Mode: " + String(g.mode || "standard").toUpperCase() + " • Blocked Attempts Logged: " + (data.blockedLogs?.length || 0);

      const tasksEl = document.getElementById("agentTasksList");
      const tasks = data.tasks || [];
      tasksEl.innerHTML = tasks.length ? tasks.map((t) =>
        '<div class="list-item"><div><div style="font-weight:600;">' + esc(t.taskPrompt) + '</div>' +
        '<div class="mono muted">' + esc(t.id) + ' • Next: ' + new Date(t.nextRunAt).toLocaleString() + '</div></div>' +
        '<button class="btn btn-sm btn-danger" onclick="apiAction(\\'/api/agent/tasks/cancel\\', { taskId: \\'' + esc(t.id) + '\\' })">Cancel</button></div>'
      ).join("") : '<div class="muted">No scheduled tasks active.</div>';

      const watchEl = document.getElementById("agentWatchersList");
      const watchers = data.watchers || [];
      watchEl.innerHTML = watchers.length ? watchers.map((w) =>
        '<div class="list-item"><div><div style="font-weight:600;">[' + esc(w.eventType) + '] → "' + esc(w.action) + '"</div>' +
        '<div class="mono muted">' + esc(w.id) + (w.targetUser ? ' • Target: ' + esc(w.targetUser) : '') + '</div></div>' +
        '<button class="btn btn-sm btn-danger" onclick="apiAction(\\'/api/agent/watchers/cancel\\', { watcherId: \\'' + esc(w.id) + '\\' })">Cancel</button></div>'
      ).join("") : '<div class="muted">No event watchers active.</div>';
    }

    async function runAgentConsole() {
      const prompt = document.getElementById("agentPromptInput").value.trim();
      const chatJid = document.getElementById("agentContextJid").value;
      if (!prompt) return showToast("Enter a prompt", true);
      const btn = document.getElementById("runAgentBtn");
      const out = document.getElementById("agentOutput");
      btn.disabled = true;
      out.textContent = "⏳ Running AI agent...";
      try {
        const res = await api("/api/agent/prompt", {
          method: "POST",
          body: JSON.stringify({ prompt, chatJid }),
        });
        out.textContent = res.response || "Done";
        await loadAgent();
      } catch (err) {
        out.textContent = "❌ Error: " + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    async function saveAgentConfig(discover = false) {
      const baseUrl = document.getElementById("aiBaseUrl").value.trim();
      const apiKey = document.getElementById("aiApiKey").value.trim();
      const model = document.getElementById("aiModelInput").value.trim() || document.getElementById("aiModelSelect").value;
      const res = await apiAction("/api/agent/config", { baseUrl, apiKey: apiKey || undefined, model: model || undefined, discover });
      if (res) document.getElementById("aiApiKey").value = "";
    }

    async function toggleGuardrails() {
      await apiAction("/api/agent/guardrails", { toggle: true });
    }
    async function setGuardMode(mode) {
      await apiAction("/api/agent/guardrails", { mode });
    }
    async function clearGuardLogs() {
      await apiAction("/api/agent/guardrails", { clearLogs: true });
    }

    // Commands & Plugins
    async function loadCommands() {
      const data = await api("/api/commands");
      commandsCache = data.commands || [];
      document.getElementById("cmdCount").textContent = commandsCache.length;
      renderCommandsTable();
    }

    function renderCommandsTable() {
      const q = (document.getElementById("cmdSearch").value || "").toLowerCase();
      const filtered = commandsCache.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q) ||
        (c.usage || "").toLowerCase().includes(q)
      );
      document.getElementById("commandsTbody").innerHTML = filtered.map((c) => {
        const perm = c.fromMe ? "Owner" : c.adminOnly ? "Admin" : "All";
        return '<tr>' +
          '<td class="mono" style="color:var(--accent);font-weight:600;">#' + esc(c.name) + '</td>' +
          '<td><span class="badge">' + esc(c.type) + '</span></td>' +
          '<td class="mono">' + esc(c.params?.format || c.usage || "-") + '</td>' +
          '<td>' + esc(perm) + (c.groupOnly ? ' (Group)' : '') + '</td>' +
          '<td>' + esc(c.desc) + '</td>' +
          '<td><button class="btn btn-sm" onclick="prefillCommand(\\'' + esc(c.name) + '\\')">Select</button></td>' +
        '</tr>';
      }).join("");
    }

    function prefillCommand(name) {
      document.getElementById("cmdExecName").value = name;
      document.getElementById("cmdExecArgs").focus();
    }

    async function executePluginCommand() {
      const commandName = document.getElementById("cmdExecName").value.trim();
      const args = document.getElementById("cmdExecArgs").value.trim();
      const chatJid = document.getElementById("cmdTargetJid").value;
      if (!commandName) return showToast("Enter command name", true);
      await apiAction("/api/commands/run", { commandName, args, chatJid });
    }

    // Ops: Flags, Policies, Audit
    async function loadOps() {
      const [flags, policies, audit] = await Promise.all([
        api("/flags"),
        api("/policies"),
        api("/audit?limit=40"),
      ]);

      document.getElementById("flagsContainer").innerHTML = Object.entries(flags).map(([k, v]) =>
        '<div class="toggle-switch">' +
          '<div><span class="mono" style="font-weight:600;">' + esc(k) + '</span>' +
          (k === "maintenance" ? ' <span class="badge badge-red">KILL SWITCH</span>' : '') + '</div>' +
          '<button class="btn btn-sm ' + (v ? 'btn-primary' : 'btn-danger') + '" onclick="apiAction(\\'/api/flags\\', { name: \\'' + esc(k) + '\\', value: ' + (!v) + ' })">' +
            (v ? 'ON' : 'OFF') +
          '</button>' +
        '</div>'
      ).join("");

      document.getElementById("policiesContainer").innerHTML = Object.entries(policies).map(([k, v]) =>
        '<div class="list-item">' +
          '<span class="mono">' + esc(k) + '</span>' +
          '<div class="row" style="gap:6px;">' +
            '<input id="pol_' + esc(k) + '" value="' + esc(v === null ? "" : v) + '" style="width:120px; padding:5px 8px;" />' +
            '<button class="btn btn-sm btn-blue" onclick="savePolicy(\\'' + esc(k) + '\\')">Save</button>' +
          '</div>' +
        '</div>'
      ).join("");

      document.getElementById("auditTbody").innerHTML = (audit || []).map((r) =>
        '<tr>' +
          '<td class="mono muted">' + new Date(r.ts).toLocaleTimeString() + '</td>' +
          '<td class="mono">' + esc(r.action) + '</td>' +
          '<td class="mono">' + esc(r.actor) + '</td>' +
          '<td class="mono">' + esc(r.target || "-") + '</td>' +
          '<td class="mono muted">' + esc(r.meta ? JSON.stringify(r.meta) : "-") + '</td>' +
        '</tr>'
      ).join("") || '<tr><td colspan="5" class="muted">No audit entries recorded.</td></tr>';
    }

    async function savePolicy(key) {
      let val = document.getElementById("pol_" + key).value.trim();
      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (val === "" || val === "null") val = null;
      else if (/^\\d+$/.test(val)) val = Number(val);
      await apiAction("/api/policies", { key, value: val });
    }

    async function clearAuditLogs() {
      if (!confirm("Clear all audit logs?")) return;
      await apiAction("/api/audit/clear", {});
    }

    async function refreshAll() {
      await Promise.all([
        loadOverview(),
        loadGroups(),
        loadAgent(),
        loadCommands(),
        loadOps(),
      ]);
    }

    async function attemptLogin(tok) {
      TOKEN = tok.trim();
      if (!TOKEN) return;
      try {
        await api("/api/overview");
        sessionStorage.setItem("xasena_admin_token", TOKEN);
        document.getElementById("authScreen").classList.add("hidden");
        document.getElementById("appShell").classList.remove("hidden");
        await refreshAll();
        // Clean token from URL bar for cleaner display
        if (window.location.search.includes("token=")) {
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (err) {
        document.getElementById("authErr").textContent = err.message;
        document.getElementById("authScreen").classList.remove("hidden");
        document.getElementById("appShell").classList.add("hidden");
      }
    }

    document.getElementById("loginBtn").addEventListener("click", () => {
      attemptLogin(document.getElementById("tokenInput").value);
    });
    document.getElementById("tokenInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") attemptLogin(e.target.value);
    });
    document.getElementById("refreshAllBtn").addEventListener("click", refreshAll);
    document.getElementById("signOutBtn").addEventListener("click", () => {
      sessionStorage.removeItem("xasena_admin_token");
      location.reload();
    });

    // Boot
    (function boot() {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      const savedToken = sessionStorage.getItem("xasena_admin_token");
      if (urlToken || savedToken) {
        attemptLogin(urlToken || savedToken);
      } else {
        document.getElementById("authScreen").classList.remove("hidden");
      }

      // Auto-poll Overview & Live Stream every 5 seconds when logged in
      setInterval(() => {
        if (TOKEN && !document.getElementById("appShell").classList.contains("hidden")) {
          loadOverview().catch(() => {});
        }
      }, 5000);
    })();
  </script>
</body>
</html>`;
}
