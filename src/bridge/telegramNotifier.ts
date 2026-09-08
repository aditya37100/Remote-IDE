import * as https from 'https';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor(config?: TelegramConfig) {
    this.botToken = config?.botToken || '';
    this.chatId = config?.chatId || '';
  }

  public setConfig(botToken: string, chatId: string): void {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  public isConfigured(): boolean {
    return Boolean(this.botToken.trim() && this.chatId.trim());
  }

  /**
   * Sends a free push alert to the developer's Telegram account.
   */
  public async sendAlert(title: string, text: string, deepLinkUrl?: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.log('[TelegramNotifier] Not configured, skipping alert.');
      return false;
    }

    let messageText = `*Antigravity Remote Alert*\n\n*${this.escapeMarkdown(title)}*\n${this.escapeMarkdown(text)}`;

    const payload: Record<string, any> = {
      chat_id: this.chatId,
      text: messageText,
      parse_mode: 'Markdown'
    };

    if (deepLinkUrl) {
      payload.reply_markup = {
        inline_keyboard: [
          [
            {
              text: '📱 Open Mobile Remote',
              url: deepLinkUrl
            }
          ]
        ]
      };
    }

    return this.sendTelegramRequest(payload);
  }

  /**
   * Sends a code snippet or file content directly to the user's Telegram chat.
   */
  public async sendFileContent(fileName: string, content: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    // Truncate if exceeds Telegram message limit (4096 chars)
    const truncated = content.length > 3500 ? content.substring(0, 3500) + '\n... [truncated for Telegram]' : content;
    const messageText = `📄 *Generated / Modified File:* \`${this.escapeMarkdown(fileName)}\`\n\`\`\`\n${truncated}\n\`\`\``;

    const payload = {
      chat_id: this.chatId,
      text: messageText,
      parse_mode: 'Markdown'
    };

    return this.sendTelegramRequest(payload);
  }

  /**
   * Core method to send a request to the Telegram Bot API.
   * Handles redirects, response body consumption, and error logging.
   */
  private sendTelegramRequest(payload: Record<string, any>): Promise<boolean> {
    return new Promise((resolve) => {
      const data = JSON.stringify(payload);
      const apiPath = `/bot${this.botToken}/sendMessage`;

      console.log(`[TelegramNotifier] Sending to chat_id: ${this.chatId}, path: /bot****/sendMessage`);

      const options: https.RequestOptions = {
        hostname: 'api.telegram.org',
        port: 443,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[TelegramNotifier] Message sent successfully.');
            resolve(true);
          } else {
            console.error(`[TelegramNotifier] Telegram API error: HTTP ${res.statusCode}`);
            console.error(`[TelegramNotifier] Response body: ${body}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[TelegramNotifier] Network error:', err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        console.error('[TelegramNotifier] Request timed out after 15s');
        req.destroy();
        resolve(false);
      });

      req.write(data);
      req.end();
    });
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }
}
