# Antigravity Mobile Remote Companion

A secure, zero-cost extension for **Google Antigravity IDE** that allows you to leave your laptop running anywhere and monitor, steer, and interact with your running AI agents directly from your smartphone browser or PWA.

---

## Features

- 📱 **Mobile-First Real-Time Agent Control:** Watch agent thoughts ("Thinking..."), terminal commands, and tool executions with sub-50ms latency.
- ⚡ **Chat Steering & Interruption:** Pause running agents with one tap, send prompts, modify upcoming directions, and steer tasks from your phone.
- 🔔 **Interactive Approvals:** Receive real-time push cards and audio chimes when the agent requests permission to run shell commands or review implementation plans.
- 📁 **Workspace File Tree & Git Diffs:** Browse all project files and inspect syntax-highlighted git diffs directly on mobile.
- 🔒 **Zero-Config Quick Tunnel ($0 Cost):** Automated, encrypted Cloudflare Quick Tunnel (`https://*.trycloudflare.com`). No account, no signup, no credit card required.
- 📲 **Instant QR Pairing & 6-Digit PIN:** Scan the QR code displayed in your Antigravity IDE sidebar or enter the 6-digit PIN.
- ⏱️ **Configurable Session Expiry:** Automated shutdown timer (1h, 3h, 8h, or manual) with countdown and one-click extension.
- 💻 **Laptop Sleep Prevention:** Automatically keeps your workstation awake while an agent task is active.
- 💬 **Free Telegram Bot Integration:** Optional instant pings to your Telegram app with one-tap deep links back to your mobile web app.

---

## Installation & Quick Start

1. **Install the Extension:**
   - In Antigravity IDE, press `Ctrl+Shift+P` -> `Extensions: Install from VSIX...` and select `antigravity-mobile-remote-0.1.0.vsix`.
2. **Start a Remote Session:**
   - Click the **Antigravity Remote** icon in the Activity Bar or click `Remote: Offline` in the Status Bar.
   - Click **Start Remote Session**.
3. **Connect Your Phone:**
   - Scan the rendered **QR code** with your smartphone camera, or open the link and type the 6-digit PIN.
4. **Add to Home Screen (Optional):**
   - On iOS Safari, tap *Share* -> *Add to Home Screen*.
   - On Android Chrome, tap the menu -> *Install app*.

---

## Configuration Settings

In Antigravity IDE Settings (`Ctrl+,` search for `antigravityRemote`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `antigravityRemote.port` | `39871` | Local port for the companion server |
| `antigravityRemote.sessionExpiryHours` | `3` | Hours before tunnel automatically shuts down (0 = no expiry) |
| `antigravityRemote.autoStartOnLaunch` | `false` | Start remote session automatically on IDE launch |
| `antigravityRemote.preventSleep` | `true` | Prevent laptop from sleeping during active runs |
| `antigravityRemote.telegramBotToken` | `""` | Optional: Telegram Bot Token from `@BotFather` |
| `antigravityRemote.telegramChatId` | `""` | Optional: Your Telegram Chat ID for alerts |

---

## License

MIT License. Free and open source.
