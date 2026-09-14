const crypto = require('crypto');
const config = require('../config');

class WhopGate {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.whop.apiKey;
    this.webhookSecret = options.webhookSecret || config.whop.webhookSecret;
    this.activeMembers = new Set();
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
        this.activeMembers.add(userId);
        console.log(`🎉 [WhopGate] New Active VIP Member! ID: ${userId} (${email})`);
        return { status: 'granted', userId };
      }

      case 'membership.went_invalid':
      case 'payment.failed': {
        const userId = data.user_id || data.id;
        this.activeMembers.delete(userId);
        console.log(`⚠️ [WhopGate] Member Revoked: ID: ${userId}`);
        return { status: 'revoked', userId };
      }

      default:
        return { status: 'ignored', action };
    }
  }

  isMemberActive(userId) {
    return this.activeMembers.has(userId);
  }
}

module.exports = WhopGate;
