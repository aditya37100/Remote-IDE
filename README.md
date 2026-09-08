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

## ⚙️ Requirements
- Windows, macOS, or Linux
- Node.js (v18+)
- VS Code (v1.80+)
- Global Antigravity CLI (`agy`) installed in your environment

## 🚀 Building & Installation from Source

If you want to build and modify the extension yourself:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aditya37100/Antigravity-Remote-IDE.git
   cd Antigravity-Remote-IDE
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the VSIX package:**
   ```bash
   npm run package
   ```
   *This uses `vsce` internally to generate a `.vsix` file (e.g., `antigravity-remote-ide-0.1.0.vsix`).*

4. **Install in VS Code:**
   - Open VS Code.
   - Go to the **Extensions** panel (`Ctrl+Shift+X` / `Cmd+Shift+X`).
   - Click the `...` menu in the top right.
   - Select **Install from VSIX...** and choose the generated `.vsix` file.

## 📱 How to Use

1. Once installed, click the **Antigravity Remote** icon in the VS Code Activity Bar.
2. Click **Start Session**.
3. Scan the generated QR code with your phone.
4. Enter the **6-digit PIN** displayed in VS Code to authenticate.
5. Start chatting! The prompt will instantly execute on your IDE's `agy` CLI process, streaming output back to your phone.

## 📄 License
MIT License.
