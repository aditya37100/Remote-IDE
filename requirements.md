# Antigravity Mobile Remote Companion: Requirements Document

**Document Version:** 1.0.0  
**Status:** In Review / Awaiting User Input  
**Target Platform:** Antigravity IDE (VS Code Architecture) & Mobile Browsers (iOS Safari / Android Chrome / PWA)

---

## 1. Executive Summary & Vision

The **Antigravity Mobile Remote Companion** is an extension system designed for Google Antigravity IDE. It enables developers to leave their workstation/laptop running anywhere (e.g., desk, home, office) and securely monitor, interact with, and steer AI agent workflows directly from any mobile device.

By pairing the workstation with a mobile browser via a private, zero-configuration secure tunnel and a one-time cryptographic pairing code or QR scan, developers gain real-time oversight of agent reasoning, terminal outputs, code diffs, and chat sessions without needing to sit at their laptop.

```
+-------------------------------------------------------------------------------+
|                             DEVELOPER WORKSTATION                             |
|                                                                               |
|  +------------------------+        +---------------------------------------+  |
|  |    Antigravity IDE     |        |      Antigravity Mobile Host          |  |
|  | (Agentic Engine & TUI) | <----> |          (VS Code Extension)          |  |
|  +------------------------+        +-------------------+-------------------+  |
|                                                        |                      |
|                                            Local Express/WS Server            |
|                                                        |                      |
|                                            Secure Tunnel Adapter              |
|                                          (Cloudflare / Pinggy / Ngrok)        |
+--------------------------------------------------------+----------------------+
                                                         |
                                             Encrypted Internet Tunnel
                                             (HTTPS / WSS + Token Auth)
                                                         |
                                                         v
                                      +--------------------------------------+
                                      |            MOBILE CLIENT             |
                                      |     (Responsive Web App / PWA)       |
                                      |                                      |
                                      |  - Live Agent Stream (Thoughts/Logs) |
                                      |  - Chat Modification & Prompts       |
                                      |  - Tool Approvals & Plan Reviews     |
                                      |  - Code Diffs & File Inspector       |
                                      +--------------------------------------+
```

---

## 2. User Scenarios & Use Cases

### Scenario A: The Long-Running Build / Refactor
> *The developer triggers an extensive feature generation or multi-step test refactoring, closes the laptop lid (configured to keep running) or leaves it on the desk, and goes to grab lunch or relax on the couch. On their phone, they observe live token streaming, reasoning steps, and tool executions.*

### Scenario B: Remote Permission & Plan Approval
> *The agent pauses because it reaches a critical decision (e.g., executing a sensitive shell command or requiring plan confirmation). The developer receives a vibration/push alert on their phone, reviews the proposed plan or command, and taps "Approve" or submits a counter-instruction.*

### Scenario C: Chat Modification & Course Correction
> *While watching the agent make progress from another room, the developer notices the agent heading down the wrong architectural path. From mobile, they immediately hit "Interrupt", modify the chat direction with a voice-to-text or typed clarification, and instruct the agent to pivot.*

---

## 3. System Architecture & Components

The solution is divided into three core subsystems:

```
[ Antigravity IDE Extension Host ] <---> [ Zero-Config Tunnel Layer ] <---> [ Mobile Web App / PWA ]
```

### 3.1. Workstation Component: IDE Extension & Companion Server
- **Extension Runtime:** Runs as an Antigravity IDE extension (VS Code extension ecosystem).
- **Embedded Web Server:** Launches a lightweight local server (Node.js HTTP/WebSocket) bound to a loopback address.
- **Agent Lifecycle Bridge:** Interfaces with Antigravity chat sessions, subagent execution traces, and artifact/file streams.
- **Tunnel Orchestrator:** Manages automated lifecycle of a secure tunnel (spawns tunnel on demand, manages lifecycle, shuts down on IDE close).
- **Pairing & Security Manager:** Generates a cryptographically random access token, pairing PIN, and terminal/IDE QR code for frictionless zero-trust pairing.
- **Keep-Awake Utility:** Prevents system sleep or network hibernation during active agent sessions.

### 3.2. Networking & Connectivity Layer (Remote Reachability)
- Requires zero port-forwarding and works behind CGNAT, corporate firewalls, and home routers.
- Options:
  1. **Automated Cloudflare Quick Tunnel (`trycloudflare.com`)**: Free, zero signup, end-to-end HTTPS/WSS, temporary public URL generated per session.
  2. **Pinggy / LocalXpose / Ngrok**: Fast tunnels with custom subdomain support or lightweight binary download.
  3. **Peer-to-Peer WebRTC / Tailscale relay**: Extreme security with direct device-to-device transport.

### 3.3. Mobile Web App (Client PWA)
- Hosted locally and served through the secure tunnel directly to mobile browsers.
- Installable as a Progressive Web App (PWA) with "Add to Home Screen" support for full-screen native app feel.
- Dark-mode first UI optimized for mobile touch interactions, virtual keyboards, and low latency.
- Audio/haptic feedback on agent milestones and approval requests.

---

## 4. Functional Requirements

### 4.1. Pairing & Authentication
- **FR-01 (Zero-Friction Pairing):** When started, the extension must display a clickable link and a high-resolution QR code inside Antigravity IDE (via Status Bar and dedicated side panel).
- **FR-02 (Pairing Code / PIN):** Scanning the QR code embeds a secure cryptographic session token in the URL anchor or query. Alternatively, the user can type a 6-digit numeric PIN shown in the IDE.
- **FR-03 (Session Management):** Workstation tracks active mobile sessions. The developer can view paired mobile devices and revoke any session instantly from the IDE with one click ("Disconnect All Mobile Clients").
- **FR-04 (Brute Force Protection):** Rate-limiting on incorrect PIN/token attempts (maximum 5 failed attempts before a 5-minute lockout).

### 4.2. Live Agent Monitoring & Streaming
- **FR-05 (Real-Time Chat Synchronization):** Mobile UI streams all conversation turns, system notifications, user messages, and agent responses with millisecond latency via WebSockets.
- **FR-06 (Reasoning & Thought Traces):** Collapsible/expandable "Thinking" sections matching Antigravity IDE's reasoning displays.
- **FR-07 (Tool Execution Visibility):** Live visualization of tools executed by the agent (terminal commands, file edits, web searches, subagent calls) including real-time stdout/stderr.
- **FR-08 (Status Indicators):** Clear status indicators: `Idle`, `Thinking`, `Executing Tool`, `Waiting for Approval`, `Error`.

### 4.3. Chat Interaction & Remote Control
- **FR-09 (Message Dispatching):** Ability to compose and send prompts to the agent from mobile, including multi-line text and code snippets.
- **FR-10 (Agent Interrupt / Stop):** Dedicated prominent "Pause / Interrupt" button on mobile to halt runaway agent actions immediately.
- **FR-11 (Tool & Plan Approval):** Interactive cards for actions requiring permission (e.g. command execution or implementation plan review), with "Approve", "Reject", or "Provide Feedback" actions.
- **FR-12 (Context / Slash Commands):** Mobile shortcuts for frequently used slash commands (e.g., `/goal`, `/schedule`, `/learn`).

### 4.4. Code Inspection & Artifacts
- **FR-13 (File Diffs Viewer):** Mobile-optimized unified diff viewer showing modified files with syntax highlighting and collapsible hunks.
- **FR-14 (Artifact Reader):** Renders generated markdown artifacts, implementation plans, and walkthroughs with formatted tables, mermaid diagrams, and alerts.

### 4.5. Device Power & Keep-Alive
- **FR-15 (System Sleep Prevention):** Workstation extension keeps the machine awake while an agent task is actively executing (utilizing native OS power assertions / `powerSaveBlocker`).

---

## 5. Non-Functional Requirements

### 5.1. Security & Privacy
- **NFR-01 (No Third-Party Intermediaries):** No agent prompts, source code, or terminal output should be stored or decrypted on third-party cloud servers. Tunnels must act purely as encrypted transport pipes.
- **NFR-02 (Zero-Trust Access):** Every API and WebSocket handshake must require authentication with the cryptographically secure session token.
- **NFR-03 (Local-First Design):** The mobile web client assets are bundled and served directly by the local extension server.

### 5.2. Mobile UX & Performance
- **NFR-04 (Touch-Friendly Responsive UI):** Designed specifically for 360px–430px smartphone viewports with high ergonomics (thumb-reachable action buttons, bottom sheets, pull-to-refresh).
- **NFR-05 (Bandwidth Efficiency):** Incremental JSON/delta streaming over WebSockets to preserve mobile data and battery life.
- **NFR-06 (Fast Reconnection):** When the mobile phone screen turns off and on, or transitions between Wi-Fi and 5G, the client must automatically resume the WebSocket connection and reconcile state within 1.5 seconds.

---

## 6. Architecture & Implementation Options

## 6. Architecture & Confirmed Design Choices

Based on user requirements and cost considerations ($0 setup, 100% free):

| Component | Selected Approach | Details & Rationale |
| :--- | :--- | :--- |
| **Hosting & Servers** | **Localhost-as-Server ($0 Cost)** | No external cloud server needed. Your laptop acts as the server. Your files stay on your machine. |
| **Tunnel Provider** | **Cloudflare Quick Tunnel (`cloudflared`)** | 100% free, no account/sign-up required. Generates an encrypted temporary HTTPS/WSS URL with a configurable session expiry timer. Supports multi-device pairing. |
| **Authentication** | **Dynamic QR Code + 6-digit PIN** | Scan QR code from Antigravity IDE or type the 6-digit PIN. Session tokens expire when the tunnel closes or upon manual revocation. |
| **File Access Scope** | **Workspace File Browser & Diff Viewer** | Direct access to all workspace files, diffs, and chat logs served directly from your laptop without any cloud storage or hosting fees. Safe sandboxed path traversal protection. |
| **Mobile Notifications** | **Web Chimes + Free Telegram Bot Integration** | Built-in browser audio/vibration chimes + optional 100% free Telegram Bot alerts (via Telegram Bot API) that ping your phone when the agent needs approval. |
| **Mobile Client** | **Mobile-First PWA (HTML5 / CSS / Vanilla JS)** | Zero-dependency, ultra-fast loading on mobile Safari/Chrome, installable to Home Screen, dark-mode glassmorphic theme. |

---

## 7. Detailed Feature Specifications

### 7.1. Quick Tunnel & Expiry Lifecycle
- **Automated Tunnel Spawning:** The extension automatically spins up an encrypted quick tunnel on demand.
- **Session Expiry Timer:** The user can configure how long the remote session stays alive (e.g., 1 hour, 3 hours, 8 hours, or indefinite until closed). A visible countdown appears on both the IDE and the mobile screen.
- **Multi-Device Pairing:** Multiple devices (e.g., phone and tablet) can connect to the same session by scanning the QR code or inputting the active PIN.
- **Instant Kill Switch:** Clicking "Stop Remote Session" in Antigravity IDE immediately terminates the tunnel and invalidates all active tokens.

### 7.2. Zero-Cost Full Workspace File Explorer & Diff Viewer
- **File Tree:** Browse all project files and folders from the phone.
- **File Reader:** View source code with mobile-friendly syntax highlighting.
- **Live Diff Inspector:** Review changes made by the agent line-by-line (split or unified diff).
- **Security Guard:** Strict workspace boundary checking (prevents path traversal to sensitive operating system files).

### 7.3. Real-Time Agent Control & Chat
- **Live Event Stream:** Streams agent reasoning ("Thinking..."), terminal command outputs, and tool status over WebSockets.
- **Interruption:** Tap "Pause / Stop Agent" to halt execution immediately.
- **Prompt Input & Chat Modification:** Send new instructions, ask questions, or clarify goals from the mobile keyboard.
- **Approval Cards:** When the agent prompts for tool execution or plan review, an approval card appears on mobile with "Approve", "Reject", or "Edit Instruction".

### 7.4. Free Telegram Bot Alerts (Optional Add-on)
- **Zero Cost:** Telegram's Bot API is completely free forever.
- **Setup:** The developer enters their bot token and chat ID in the extension settings.
- **Alert Triggers:** The bot sends an alert when:
  - Agent completes a task or reaches a milestone.
  - Agent requests permission to run a command or review a plan.
  - An unexpected error occurs.
  - Direct deep-link back to the mobile web app.

---

## 8. Technology Stack Specification

| Tier | Technology | Rationale & Specifications |
| :--- | :--- | :--- |
| **Extension Host** | **TypeScript & VS Code Extension API** | Runs natively inside Antigravity IDE. Leverages `vscode` APIs for status bar, commands, webview sidebar, and workspace file tracking. |
| **Embedded Server** | **Node.js HTTP + Express** | Lightweight, zero-latency local HTTP server to host the mobile PWA and handle sandboxed REST requests for file trees and diffs. |
| **Real-time Protocol** | **WebSockets (`ws`)** | Bi-directional, sub-50ms latency streaming for token generation, agent reasoning traces, command outputs, and instant approvals. |
| **Tunneling Engine** | **Cloudflare Quick Tunnel (`cloudflared`)** | Zero-configuration, 100% free HTTPS/WSS tunnel. Ephemeral URLs (`https://*.trycloudflare.com`) with zero account setup. |
| **Security & Cryptography** | **Node.js `crypto`** | Cryptographically secure random session tokens, timing-safe token verification, and 6-digit PIN hashing. |
| **Mobile Frontend** | **Mobile-First PWA (HTML5, Vanilla JS, CSS3)** | Zero build-step bloat, ultra-fast initial paint (<300ms), 60 FPS mobile transitions, dark-mode glassmorphism, responsive for iOS Safari & Android Chrome. |
| **Hardware / Mobile APIs**| **PWA Manifest, Web Audio, Vibration, WakeLock** | Enables "Add to Home Screen" app experience, synthetic audio chimes for approvals, haptic feedback, and screen keep-awake. |
| **Alerts & Integrations** | **Telegram Bot API (HTTPS REST)** | 100% free external alerts directly to your phone's Telegram app without needing any third-party paid services. |
| **Packaging & Distribution**| **`@vscode/vsce`** | Standard packaging utility producing a `.vsix` bundle installable in Antigravity IDE and publishable to marketplaces. |

---

## 9. Scope & Scalability Analysis

### 9.1. In-Scope (Version 1.0)
- **Workstation-as-Server:** Laptop hosts everything at $0 cost; no cloud database or server needed.
- **Quick Tunnel with Auto-Expiry:** One-click launch of secure tunnel with configurable auto-termination (1h, 3h, 8h, or manual).
- **Dynamic Pairing:** High-resolution QR code rendering in the IDE sidebar + 6-digit PIN fallback.
- **Multi-Device Support:** Simultaneous connections from multiple personal devices (e.g. phone + tablet).
- **Live Stream Monitoring:** Real-time agent thought streaming, terminal output logs, and tool execution status.
- **Chat Steering & Modification:** Send prompts, insert context, stop/interrupt the agent, and edit upcoming instructions.
- **Interactive Approvals:** Push cards for tool execution permissions and plan approvals with one-tap responses.
- **Workspace File & Diff Inspection:** Sandboxed file tree navigation, file contents viewer, and live git diff review.
- **Zero-Cost Alert System:** Browser audio chimes + vibration + optional free Telegram bot notifications.
- **Laptop Keep-Awake:** Prevents system sleep while agent tasks are actively running.

### 9.2. Out-of-Scope (Deferred to Future Versions)
- Heavy raw source-code editing from mobile (viewing and diff inspection are supported; heavy line-by-line editing on touchscreens is error-prone).
- Multi-user team collaboration / enterprise access delegation (v1 is tailored for personal remote developer control).
- Custom permanent domain configuration without manual tunnel setup (v1 uses automated zero-config quick tunnels).

### 9.3. Scalability & Resilience
- **Network Resilience:** The mobile client incorporates automated heartbeat pings and exponential backoff reconnection. If you lock your phone or switch between Wi-Fi and 5G, the session reconnects and reconciles state in <1.5 seconds.
- **Resource Footprint:** Node.js event-driven architecture consumes <1% CPU and ~30MB RAM on the laptop, having zero measurable impact on agent performance.
- **Bandwidth Efficiency:** WebSocket delta encoding transmits only new characters/tokens, consuming minimal mobile cellular data.

---

## 10. Packaging & Marketplace Publishing

Can this extension be published? **Yes!** Antigravity IDE is built upon the VS Code extension architecture, which gives you several distribution pathways:

1. **Direct VSIX Distribution (Private / Team Use):**
   - Run `npx @vscode/vsce package` to produce an `antigravity-mobile-remote-1.0.0.vsix` file.
   - Any user can install it immediately in Antigravity IDE via `Extensions: Install from VSIX...` or via command line.
2. **Visual Studio Marketplace Publishing (Public):**
   - Free to register a Microsoft publisher account at `marketplace.visualstudio.com`.
   - Run `vsce publish` to make it publicly searchable and installable by any developer.
3. **Open VSX Registry (Open-Source Ecosystem):**
   - Free publishing to `open-vsx.org`, making it available to all open-source VS Code compatible IDEs.
4. **GitHub Open Source Release:**
   - Host the repo on GitHub with automated `.vsix` releases via GitHub Actions.

---

## 11. Phased Execution Roadmap

- [x] **Phase 1: Project Scaffolding & Core Extension Host**
  - Setup TypeScript, `package.json`, VS Code extension manifest, build scripts, and base activation lifecycle.
- [x] **Phase 2: Local Server, Authentication & Workspace File Bridge**
  - Express HTTP server, WebSocket streaming engine, 6-digit PIN & token auth, sandboxed workspace file reader.
- [x] **Phase 3: Automated Quick Tunnel & Session Expiry**
  - Process wrapper for `cloudflared` quick tunnel, URL capture, countdown timer, and kill switch.
- [x] **Phase 4: Mobile Web App (PWA) Client**
  - Dark-mode glassmorphic interface, real-time chat stream, thinking blocks, approval cards, file & diff inspector, Web Audio chimes.
- [x] **Phase 5: Antigravity IDE Sidebar UI & Free Telegram Alerts**
  - Interactive sidebar displaying QR code, PIN, status, timer, and paired devices; optional free Telegram bot alert sender.
- [x] **Phase 6: End-to-End Verification & VSIX Packaging**
  - Full end-to-end integration test, build optimization, and `.vsix` package generation.


