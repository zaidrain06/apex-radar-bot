const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');

class TelegramManager {
  constructor(options = {}) {
    this.token = options.token || config.telegram.botToken;
    this.channelId = options.channelId || config.telegram.channelId;
    this.bot = null;
    this.isMock = !this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN';
  }

  init() {
    if (this.isMock) {
      console.log('ℹ️ [TelegramManager] Running in Simulation/Console mode (No bot token set). Signals will print to terminal.');
      return;
    }

    try {
      this.bot = new TelegramBot(this.token, { polling: true });
      console.log('✅ [TelegramManager] Telegram Bot initialized with active polling.');
      this.registerCommands();
    } catch (err) {
      console.error('❌ [TelegramManager] Bot initialization failed:', err.message);
      this.isMock = true;
    }
  }

  registerCommands() {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const text = `
🚀 *Welcome to ApexRadar VIP Intelligence!*

We monitor real-time institutional liquidation cascades, whale order flow, and funding anomalies across crypto derivatives.

*Available Commands:*
• /status — Check live WebSocket & radar health
• /plans — View VIP Membership & Whop pricing

🔒 *VIP Channel Access:*
Subscribe on Whop to unlock unfiltered real-time alerts:
https://whop.com/checkout/${config.whop.planId}
`.trim();
      this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/status/, (msg) => {
      const chatId = msg.chat.id;
      const text = `
🟢 *ApexRadar Systems: Operational*
• Feed: Binance Futures USD-M WebSocket
• Filter: Minimum $${config.binance.minLiquidationUsd.toLocaleString()} USD
• Mega Trigger: $${config.binance.megaLiquidationUsd.toLocaleString()} USD
• Latency: Real-time (<150ms)
`.trim();
      this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    });
  }

  async sendAlert(formattedMessage) {
    if (this.isMock) {
      console.log('\n📱 [TELEGRAM MOCK BROADCAST]:\n' + formattedMessage + '\n');
      return true;
    }

    if (!this.channelId) {
      console.warn('⚠️ [TelegramManager] No channel ID configured. Alert skipped.');
      return false;
    }

    try {
      await this.bot.sendMessage(this.channelId, formattedMessage, { parse_mode: 'Markdown' });
      return true;
    } catch (err) {
      console.error('❌ [TelegramManager] Failed to send message to channel:', err.message);
      return false;
    }
  }
}

module.exports = TelegramManager;
