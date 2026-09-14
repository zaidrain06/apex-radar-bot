const config = require('../config');

class TelegramManager {
  constructor(options = {}) {
    this.token = options.token || config.telegram.botToken;
    this.channelId = options.channelId || config.telegram.channelId;
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    this.isPolling = false;
    this.lastUpdateId = 0;
    this.pollInterval = null;
  }

  init() {
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.log('ℹ️ [TelegramManager] Running in Simulation/Console mode (No bot token set). Signals will print to terminal.');
      return;
    }

    console.log('✅ [TelegramManager] Telegram Bot API initialized with native fetch engine.');
    this.startLongPolling();
  }

  async startLongPolling() {
    this.isPolling = true;

    // 1. Flush any stale pending messages on startup so bot never spams
    try {
      const flushRes = await fetch(`${this.baseUrl}/getUpdates?offset=-1`);
      if (flushRes.ok) {
        const flushData = await flushRes.json();
        if (flushData.ok && Array.isArray(flushData.result) && flushData.result.length > 0) {
          this.lastUpdateId = flushData.result[flushData.result.length - 1].update_id;
        }
      }
    } catch (e) {
      // ignore
    }

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await fetch(`${this.baseUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              this.lastUpdateId = update.update_id;
              if (update.message && update.message.text) {
                // Ignore any message older than 30 seconds to prevent replay storms
                const msgAge = Math.floor(Date.now() / 1000) - (update.message.date || 0);
                if (msgAge <= 30) {
                  this.handleIncomingMessage(update.message);
                }
              }
            }
          }
        } else if (res.status === 409) {
          // Another instance polling: wait 10s before retry
          await new Promise(r => setTimeout(r, 10000));
        }
      } catch (err) {
        // network blip, continue
      }
      if (this.isPolling) {
        setTimeout(poll, 1500);
      }
    };
    poll();
  }

  async handleIncomingMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (text === '/start') {
      const welcome = `
🚀 *Welcome to ApexRadar VIP Intelligence!*

We monitor real-time institutional liquidation cascades, whale order flow, and leverage squeezes across crypto derivatives.

*Available Commands:*
• /status — Check live WebSocket & radar health
• /plans — View VIP Membership & Whop pricing

🔒 *VIP Channel Access:*
Subscribe on Whop to unlock unfiltered real-time alerts:
${config.whop.productUrl}
`.trim();
      await this.sendMessage(chatId, welcome);
    } else if (text === '/status') {
      const statusText = `
🟢 *ApexRadar Systems: Operational*
• Feed: Binance Futures USD-M WebSocket
• Filter: Minimum $${config.binance.minLiquidationUsd.toLocaleString()} USD
• Mega Trigger: $${config.binance.megaLiquidationUsd.toLocaleString()} USD
• Latency: Real-time (<150ms)
`.trim();
      await this.sendMessage(chatId, statusText);
    } else if (text === '/plans') {
      const plansText = `
💎 *ApexRadar VIP Membership Plans*
━━━━━━━━━━━━━━━━━━━━━
• Monthly VIP: *$29.99 / Month*
• Full Access: Instant Telegram VIP Broadcast

👉 *Instant Activation on Whop:*
${config.whop.productUrl}
`.trim();
      await this.sendMessage(chatId, plansText);
    }
  }

  async sendMessage(chatId, text) {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      return res.ok;
    } catch (err) {
      console.error('❌ [TelegramManager] Send error:', err.message);
      return false;
    }
  }

  async sendAlert(formattedMessage) {
    // Alerts MUST ALWAYS go to VIP channel (-100...), never to private personal chat
    const channelTarget = (this.channelId && this.channelId.startsWith('-100'))
      ? this.channelId
      : '-1004208031753';

    return await this.sendMessage(channelTarget, formattedMessage);
  }

  stop() {
    this.isPolling = false;
  }
}

module.exports = TelegramManager;
