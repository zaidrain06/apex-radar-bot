const config = require('../config');
const EventEmitter = require('events');

class TelegramManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.token = options.token || config.telegram.botToken;
    this.channelId = options.channelId || config.telegram.channelId;
    this.freeChannelId = options.freeChannelId || config.telegram.freeChannelId || '';
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    this.isPolling = false;
    this.lastUpdateId = 0;
    this.pollInterval = null;
  }

  init(whopGate) {
    if (!this.token || this.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      console.log('ℹ️ [TelegramManager] Running in Simulation/Console mode (No bot token set). Signals will print to terminal.');
      return;
    }

    console.log('✅ [TelegramManager] Telegram Bot API initialized with native fetch engine.');
    this.startLongPolling(whopGate);
  }

  async startLongPolling(whopGate) {
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
                  this.handleIncomingMessage(update.message, whopGate);
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

  async handleIncomingMessage(msg, whopGate) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const userId = msg.from.id;

    if (text === '/start') {
      const welcome = `
🚀 *Welcome to ApexRadar VIP Intelligence!*

We monitor real-time institutional liquidation cascades, whale order flow, and leverage squeezes across crypto derivatives.

*Available Commands:*
• /status — Check live WebSocket & radar health
• /plans — View VIP Membership & Whop pricing
• \`/auth email@adresin.com\` — Link your Whop VIP account

🔒 *VIP Channel Access:*
Subscribe on Whop to unlock unfiltered real-time alerts:
${config.whop.productUrl}
`.trim();
      await this.sendMessage(chatId, welcome);
    } else if (text.startsWith('/auth ')) {
      const email = text.replace('/auth ', '').trim().toLowerCase();

      // MongoDB üzerinden email ile üyeyi bul ve Telegram ID'sini kaydet
      const foundMember = await whopGate.linkTelegramByEmail(email, userId);

      if (foundMember) {
        await this.sendMessage(chatId, `✅ <b>Başarılı!</b> Whop hesabın eşleştirildi.\n\nVIP Kanala Katıl: ${config.telegram.inviteLink}`);
      } else {
        await this.sendMessage(chatId, `❌ <b>Hata:</b> '${email}' adresine ait aktif bir VIP aboneliği bulunamadı. Lütfen Whop üzerinden satın aldığınız emaili doğru girdiğinizden emin olun.`);
      }

    } else if (text === '/debug') {
      if (chatId.toString() !== config.telegram.adminChatId) {
        await this.sendMessage(chatId, `❌ *Yetkisiz erişim:* Bu komut sadece admin içindir.`);
        return;
      }
      const debugText = `
🛠 *Debug Info:*
• VIP Channel ID: ${this.channelId}
• Free Channel ID: ${this.freeChannelId || 'BOŞ (Okunamadı)'}
• Env Token: ${this.token ? 'YÜKLÜ' : 'YOK'}
`.trim();
      await this.sendMessage(chatId, debugText);
    } else if (text === '/status') {
      const statusText = `
🟢 <b>ApexRadar Systems: Operational</b>
• Feed: Binance Futures USD-M WebSocket
• Filter: Minimum $${config.binance.minLiquidationUsd.toLocaleString()} USD
• Mega Trigger: $${config.binance.megaLiquidationUsd.toLocaleString()} USD
• Latency: Real-time (under 150ms)
`.trim();
      await this.sendMessage(chatId, statusText);
    } else if (text === '/plans') {
      const plansText = `
💎 *ApexRadar VIP Membership Plans*
━━━━━━━━━━━━━━━━━━━━━
• 1st Month Special: *$9.99* 🔥 (then $14.99/mo)
• Annual VIP: *$149.99 / Year* 👑 (Save ~20%)
• Full Access: Instant Telegram VIP Broadcast

👉 *Instant Activation on Whop:*
${config.whop.productUrl}
`.trim();
      await this.sendMessage(chatId, plansText);
    } else if (text === '/shadow') {
      // ONLY Admin can use this
      if (chatId.toString() === (process.env.TELEGRAM_ADMIN_CHAT_ID || '1339587201').toString()) {
        this.emit('admin_shadow_request', chatId);
      }
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
          parse_mode: 'HTML'
        })
      });
      if (!res.ok) {
        const errorData = await res.json();
        console.error(`❌ [TelegramManager] Send error to ${chatId}:`, errorData.description || errorData);
      }
      return res.ok;
    } catch (err) {
      console.error(`❌ [TelegramManager] Send exception to ${chatId}:`, err.message);
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

  async sendFreeAlert(formattedMessage) {
    // Only send if a free channel is configured
    if (!this.freeChannelId || !this.freeChannelId.startsWith('-100')) {
      console.log('ℹ️ [TelegramManager] Free channel not configured, skipping free broadcast.');
      return false;
    }
    return await this.sendMessage(this.freeChannelId, formattedMessage);
  }

  async kickMember(userId) {
    if (!this.channelId || !this.channelId.startsWith('-100')) return false;
    
    try {
      const res = await fetch(`${this.baseUrl}/banChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.channelId,
          user_id: userId,
          revoke_messages: false // Don't delete their past messages, just kick
        })
      });
      if (res.ok) {
        console.log(`👢 [TelegramManager] Kullanıcı kanaldan atıldı: ${userId}`);
        
        // Optional: unban them immediately so they can rejoin if they pay again
        await fetch(`${this.baseUrl}/unbanChatMember`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.channelId, user_id: userId, only_if_banned: true })
        });
        
        return true;
      }
      return false;
    } catch (e) {
      console.error('❌ [TelegramManager] Kick error:', e.message);
      return false;
    }
  }

  stop() {
    this.isPolling = false;
  }
}

module.exports = TelegramManager;
