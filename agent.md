# Antigravity Mobile Remote Companion: Agent Handbook (`agent.md`)

This file provides comprehensive technical context, architecture specifications, file maps, terminal commands, and execution protocols for any AI agent picking up or continuing work on this codebase.

---

## 1. Project Overview & Mission

- **Project Name:** `antigravity-mobile-remote`
- **Author / Developer:** Aditya (`https://github.com/aditya37100`)
- **Publisher ID:** `aditya`
- **GitHub Repository:** `https://github.com/aditya37100/antigravity-mobile-remote`
- **Purpose:** A Google Antigravity IDE extension that allows developers to leave their workstation/laptop running anywhere and monitor, steer, and interact with running AI agents from a mobile device (iOS Safari, Android Chrome, or PWA) at **$0 hosting cost**.
- **Core Architecture:** Localhost-as-Server. The workstation runs an embedded Express & WebSocket server, which is securely exposed over an encrypted ephemeral Cloudflare Quick Tunnel (`trycloudflare.com`) with zero-trust token and 6-digit PIN authentication.
- **Current Version:** `0.1.0`
- **Package Output:** `antigravity-mobile-remote-0.1.0.vsix` (installable directly into Antigravity IDE).

---

## 2. Directory & File Blueprint

```
c:\Users\SAMADHAN PATIL\OneDrive\Desktop\New folder\extension/
├── agent.md                         # This handbook for AI agents
├── requirements.md                  # Complete product requirements and architectural specs
├── README.md                        # User-facing installation and usage guide
├── LICENSE                          # MIT open-source license
├── package.json                     # Extension manifest, commands, views, settings, scripts
├── tsconfig.json                    # TypeScript compiler config (ES2022, CommonJS)
├── esbuild.config.js                # Fast bundle orchestrator producing dist/extension.js
├── .gitignore                       # Git ignore list
├── .vscodeignore                    # VSIX package exclusion filter
│
├── dist/
│   ├── extension.js                 # Self-contained bundled extension (CommonJS, Node target)
│   └── extension.js.map             # Source map for debugging
│
├── resources/
│   └── mobile-icon.svg              # Activity Bar icon (smartphone with broadcast pulse)
│
├── src/
│   ├── extension.ts                 # Main extension entrypoint (activation, commands, status bar)
│   │
│   ├── server/
│   │   ├── app.ts                   # Express server hosting REST APIs & PWA static assets
│   │   ├── auth.ts                  # AuthManager: 24-byte crypto tokens, 6-digit PIN, rate limiter
│   │   ├── socket.ts                # SocketManager: WebSocket server (/ws) with 25s keepalive
│   │   └── tunnel.ts                # TunnelManager: Cloudflare Quick Tunnel process manager & LAN IP fallback
│   │
│   ├── bridge/
│   │   ├── keepAwake.ts             # SessionLifecycleManager: Windows sleep prevention & timer
│   │   ├── workspaceFiles.ts        # WorkspaceManager: Sandboxed file explorer & git diff reader
│   │   └── telegramNotifier.ts      # TelegramNotifier: 100% free Telegram push notifications
│   │
│   └── views/
│       └── sidebarProvider.ts       # SidebarViewProvider: Activity Bar webview (QR, PIN, timer, paired devices)
│
└── web/                             # Mobile Client (Served over HTTPS tunnel directly to phones)
    ├── index.html                   # Mobile-first app shell & navigation tabs
    ├── manifest.json                # PWA manifest for "Add to Home Screen"
    ├── css/
    │   └── app.css                  # Dark-mode glassmorphic theme, responsive mobile styles
    ├── js/
    │   ├── app.js                   # Client state, WebSocket reconnect logic, chat stream, diffs
    │   └── audio.js                 # HTML5 Web Audio synthesizer (approval & completion chimes)
    └── icons/
        └── icon.svg                 # PWA vector application icon
```

---

## 3. Terminal Commands Reference

When working in this directory (`c:\Users\SAMADHAN PATIL\OneDrive\Desktop\New folder\extension`):

### Development & Build
```powershell
# Install npm dependencies
npm install

# Type-check TypeScript code (tsc)
npm run compile

# Watch TypeScript code for type errors
npm run watch

# Bundle extension into dist/extension.js via esbuild (sub-second build)
npm run build

# Watch and bundle on file changes
npm run build:watch
```

### Packaging & Distribution
```powershell
# Bundle and package into installable .vsix package
npx @vscode/vsce package --no-dependencies

# Publish to Visual Studio Marketplace (requires publisher login & PAT)
npx @vscode/vsce publish

# Publish to Open VSX Registry (requires Open VSX token)
npx ovsx publish antigravity-mobile-remote-0.1.0.vsix -p <token>
```

### MSYS2 / Mingw64 Environment (User Preference)
The user has MSYS2 installed at `C:\msys64`. If native C/C++ packages, unix tools, or compilation utilities are needed:
- Pacman package manager: `& "C:\msys64\usr\bin\pacman.exe" <args>`
- Mingw64 binaries: `C:\msys64\mingw64\bin`

---

## 4. Communication & Event Protocol Specifications

### 4.1. WebSocket Protocol (`/ws`)
Client connects with: `wss://<host>/ws?token=<sessionToken>&deviceId=<uniqueId>`

#### Server -> Client Events:
- `auth:success`: Payload `{ deviceId, connectedDevicesCount }`
- `auth:required` / `auth:error`: Payload `{ message, error }`
- `agent:status`: Payload `{ status: 'idle' | 'working' | 'waiting' | 'error', label: string }`
- `agent:thought`: Payload `{ content: string }` (streams reasoning deltas)
- `agent:message`: Payload `{ content: string, delta: boolean }`
- `agent:tool_call`: Payload `{ name: string, detail: string, status: 'started' | 'completed' }`
- `agent:approval_request`: Payload `{ id: string, description: string, type: 'command' | 'plan' }`
- `agent:complete`: Payload `{ summary: string }`
- `ping`: Payload `{ time: number }` (heartbeat sent every 25 seconds)

#### Client -> Server Events:
- `auth:submit_pin`: Payload `{ pin: string, deviceId: string }`
- `auth:submit_token`: Payload `{ token: string, deviceId: string }`
- `client:prompt`: Payload `{ text: string }` (user dispatches prompt from mobile)
- `client:interrupt`: Payload `{ reason: string }` (user pauses/stops agent)
- `client:approval_response`: Payload `{ id: string, approved: boolean }`
- `pong`: Payload `{ time: number }`

### 4.2. REST Endpoints (Express)
- `GET /api/status`: Health check, returns `{ status, workspaceRoot, connectedDevices, expiresAt }`
- `POST /api/auth/pin`: Validates 6-digit PIN; returns `{ success, token, expiresAt }`
- `GET /api/files/tree`: (Protected via Bearer or `?token=`) returns sandboxed file directory tree
- `GET /api/files/content?path=<relPath>`: (Protected) returns `{ content, language }`
- `GET /api/git/diff`: (Protected) returns list of modified files and unified diffs

---

## 5. Security & Isolation Invariants

1. **Path-Traversal Protection:** Any file access through `WorkspaceManager` resolves paths relative to `vscode.workspace.workspaceFolders[0]`. If `path.resolve` does not start with the workspace root, it is rejected with 404/403.
2. **Timing-Safe Auth:** `AuthManager.verifyToken` uses Node.js `crypto.timingSafeEqual` to prevent timing attacks.
3. **PIN Brute-Force Lockout:** After 5 incorrect attempts, PIN validation locks for 5 minutes.
4. **Session Expiry:** Tunnels and tokens are ephemeral. If the timer elapses, the tunnel process is terminated via OS signal / `taskkill`.
5. **No Cloud Data Storage:** No user code, git diffs, or chat prompts touch any third-party database.

---

## 6. Pending User Inputs & Customization Points

Before publishing or creating git commits, the AI agent must consult the user for:
1. **GitHub Repository URL:** Custom URL for `package.json` (`repository.url`) and `README.md`.
2. **Publisher Name / ID:** The user's preferred publisher identifier for the VS Code Marketplace.
3. **Default Companion Port:** Default is `39871` (configurable in settings).
4. **Default Session Expiry Hours:** Default is `3` hours.
5. **Telegram Bot Credentials:** If the user wants phone alerts, obtain `botToken` and `chatId`.
