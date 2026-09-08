# Remote IDE (Antigravity Companion)

Welcome to the **Remote IDE**! This extension allows you to seamlessly monitor, steer, and interact with your Antigravity AI agents directly from your mobile phone—at exactly **$0 hosting cost**.

## 🚀 Features

- **True Headless Steering:** Start an AI agent task on your laptop/workstation and walk away. Track its reasoning, review its outputs, and issue new prompts remotely from your phone.
- **Dynamic CWD Sync:** The remote agent automatically syncs to the workspace folder currently open in your IDE.
- **Live Model Switching:** Switch between AI models (e.g., Gemini 3.8 Flash, Claude Sonnet 4.6) mid-conversation natively through the mobile UI dropdown!
- **Interactive Permissions:** Securely approve or deny agent CLI executions (like `[y/N]`) directly from your phone's chat input.
- **Native Markdown Rendering:** Beautifully renders bold text, code blocks, lists, and tables inside your mobile browser.
- **Zero-Trust Security:** Hosted over an ephemeral, encrypted Cloudflare tunnel (`trycloudflare.com`) secured by a 6-digit PIN and stateless session tokens.

## 🛠️ How It Works

This extension runs a lightweight local WebSocket server embedded directly inside VS Code. When you click **Start Session**, it spawns a secure Cloudflare tunnel to expose the web interface to the public internet temporarily. You can then scan the QR code to open it on your phone!

All processing, LLM requests, and code execution happen on your local machine.

## 📱 Installation & Usage

1. Open VS Code and install the generated `.vsix` file.
2. In the Activity Bar, click the **Antigravity Remote** icon.
3. Click **Start Session**.
4. Scan the QR code with your phone.
5. Enter the **6-digit PIN** displayed in VS Code to authenticate.
6. Start chatting! The prompt will instantly execute on your IDE's `agy` CLI process, streaming output back to your phone.

## ⚙️ Requirements
- Windows OS
- Node.js (v18+)
- VS Code (v1.80+)
- MSYS2 (MinGW 64) for Git execution
- Global Antigravity CLI (`agy`) installed in your `LOCALAPPDATA`

## 📄 License
MIT License.
