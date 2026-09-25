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
🚀 <b>Welcome to ApexRadar VIP Intelligence!</b>

We monitor real-time institutional liquidation cascades, whale order flow, and leverage squeezes across crypto derivatives.

<b>Available Commands:</b>
• /status — Check live WebSocket &amp; radar health
• /plans — View VIP Membership &amp; Whop pricing
• <code>/auth email@adresin.com</code> — Link your Whop VIP account

🔒 <b>VIP Channel Access:</b>
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
💎 <b>ApexRadar VIP Membership Plans</b>
━━━━━━━━━━━━━━━━━━━━━
• 1st Month Special: <b>$9.99</b> 🔥 (then $14.99/mo)
• Annual VIP: <b>$149.99 / Year</b> 👑 (Save ~20%)
• Full Access: Instant Telegram VIP Broadcast

👉 <b>Instant Activation on Whop:</b>
${config.whop.productUrl}
`.trim();
      await this.sendMessage(chatId, plansText);
    } else if (text === '/shadow') {
      // ONLY Admin can use this
      if (chatId.toString() === (config.telegram.adminChatId || '').toString()) {
        this.emit('admin_shadow_request', chatId);
      }
    } else if (text === '/trade on' || text === '/trade off') {
      // ONLY Admin can use this
      if (chatId.toString() !== (config.telegram.adminChatId || '').toString()) {
        await this.sendMessage(chatId, `❌ *Yetkisiz erişim:* Bu komut sadece admin içindir.`);
        return;
      }
      
      if (text === '/trade on') {
        process.env.REAL_TRADING_ENABLED = 'true';
        await this.sendMessage(chatId, `✅ <b>Gerçek İşlemler (Real Trade) AÇILDI.</b>\nSistem bir sonraki sinyalde MEXC'ye emir gönderecek.`);
        console.log(`[TelegramManager] 👑 Admin overridden REAL_TRADING_ENABLED = 'true'`);
      } else {
        process.env.REAL_TRADING_ENABLED = 'false';
        await this.sendMessage(chatId, `🔒 <b>Gerçek İşlemler (Real Trade) KAPATILDI.</b>\nSistem artık sadece kağıt üzerinde (Shadow Bot) işlem yapacak.`);
        console.log(`[TelegramManager] 👑 Admin overridden REAL_TRADING_ENABLED = 'false'`);
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
    if (!this.channelId || !this.channelId.startsWith('-100')) {
      console.error('❌ [TelegramManager] TELEGRAM_CHANNEL_ID is not configured. Dropping VIP alert.');
      return false;
    }
    return await this.sendMessage(this.channelId, formattedMessage);
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
