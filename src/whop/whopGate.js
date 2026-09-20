const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DB_PATH = path.join(__dirname, 'db.json');

class WhopGate {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.whop.apiKey;
    this.webhookSecret = options.webhookSecret || config.whop.webhookSecret;
    this.db = this.loadDb();
  }

  loadDb() {
    try {
      if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      }
    } catch (e) {
      console.error('[WhopGate] DB okuma hatası:', e.message);
    }
    return { members: {} };
  }

  saveDb() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.db, null, 2));
    } catch (e) {
      console.error('[WhopGate] DB yazma hatası:', e.message);
    }
  }

  /**
   * Verify Whop Webhook Signature
   */
  verifyWebhook(rawBody, signatureHeader) {
    if (!this.webhookSecret) return true; // development mode bypass
    if (!signatureHeader) return false;

    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const digest = hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  }

  /**
   * Process Whop Webhook Event
   */
  handleEvent(event) {
    const { action, data } = event;
    console.log(`[WhopGate] Received event: ${action}`);

    switch (action) {
      case 'membership.went_valid':
      case 'payment.succeeded': {
        const userId = data.user_id || data.id;
        const email = data.email || 'unknown';
        
        // Save to local DB
        this.db.members[userId] = {
          whopId: userId,
          email: email,
          status: 'active',
          telegramId: null // We will link this later via telegram bot
        };
        this.saveDb();

        console.log(`🎉 [WhopGate] New Active VIP Member! ID: ${userId} (${email})`);
        return { status: 'granted', userId };
      }

      case 'membership.went_invalid':
      case 'payment.failed': {
        const userId = data.user_id || data.id;
        
        // Find member and update status
        if (this.db.members[userId]) {
          this.db.members[userId].status = 'revoked';
          const tgId = this.db.members[userId].telegramId;
          
          if (tgId) {
             // If we know their Telegram ID, return it so the main app can kick them
             console.log(`⚠️ [WhopGate] Member Revoked: ${userId}. Needs Telegram Kick for TG_ID: ${tgId}`);
             this.saveDb();
             return { status: 'revoked_kick', userId, telegramId: tgId };
          }
        }
        
        this.saveDb();
        console.log(`⚠️ [WhopGate] Member Revoked: ID: ${userId} (No TG ID linked)`);
        return { status: 'revoked', userId };
      }

      default:
        return { status: 'ignored', action };
    }
  }

  isMemberActive(userId) {
    return this.db.members[userId] && this.db.members[userId].status === 'active';
  }
}

module.exports = WhopGate;
