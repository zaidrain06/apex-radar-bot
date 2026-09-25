const crypto = require('crypto');
const config = require('../config');
const WhopMember = require('../db/whopMember');

class WhopGate {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.whop.apiKey;
    this.webhookSecret = options.webhookSecret || config.whop.webhookSecret;
  }

  /**
   * Verify Whop Webhook Signature
   */
  verifyWebhook(rawBody, signatureHeader) {
    if (!this.webhookSecret) {
      console.error('❌ [WhopGate] WHOP_WEBHOOK_SECRET is missing. Rejecting webhook for safety.');
      return false;
    }
    if (!signatureHeader) return false;

    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const digest = hmac.update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
    } catch (e) {
      return false;
    }
  }

  /**
   * Process Whop Webhook Event
   */
  async handleEvent(event) {
    const { action, data } = event;
    console.log(`[WhopGate] Received event: ${action}`);

    switch (action) {
      case 'membership.went_valid':
      case 'payment.succeeded': {
        const userId = data.user_id || data.id;
        const email = data.email || 'unknown';

        // Üyeyi MongoDB'ye kaydet (varsa güncelle)
        await WhopMember.findOneAndUpdate(
          { whopId: userId },
          { whopId: userId, email: email, status: 'active' },
          { upsert: true, new: true }
        );

        console.log(`🎉 [WhopGate] New Active VIP Member! ID: ${userId} (${email})`);
        return { status: 'granted', userId };
      }

      case 'membership.went_invalid':
      case 'payment.failed': {
        const userId = data.user_id || data.id;

        const member = await WhopMember.findOneAndUpdate(
          { whopId: userId },
          { status: 'revoked' },
          { new: true }
        );

        if (member && member.telegramId) {
          console.log(`⚠️ [WhopGate] Member Revoked: ${userId}. Kicking Telegram ID: ${member.telegramId}`);
          return { status: 'revoked_kick', userId, telegramId: member.telegramId };
        }

        console.log(`⚠️ [WhopGate] Member Revoked: ID: ${userId} (No TG ID linked)`);
        return { status: 'revoked', userId };
      }

      default:
        return { status: 'ignored', action };
    }
  }

  /**
   * Link a Telegram user to their Whop account by email.
   * Guards against account hijacking: if the email is already linked to a
   * DIFFERENT Telegram ID, the request is rejected. The legitimate owner
   * must contact support to re-link (or the admin resets telegramId in DB).
   */
  async linkTelegramByEmail(email, telegramId) {
    const member = await WhopMember.findOne({
      email: email.toLowerCase(),
      status: 'active'
    });

    if (!member) return null;

    // Already linked to this exact Telegram ID — idempotent, allow through
    if (member.telegramId && member.telegramId === telegramId.toString()) {
      return member;
    }

    // Already linked to a DIFFERENT Telegram ID — reject to prevent hijacking
    if (member.telegramId && member.telegramId !== telegramId.toString()) {
      console.warn(`[WhopGate] ⚠️ /auth hijack attempt: email=${email} already linked to TG ${member.telegramId}, rejected TG ${telegramId}`);
      return null;
    }

    member.telegramId = telegramId.toString();
    await member.save();
    return member;
  }

  async isMemberActive(userId) {
    const member = await WhopMember.findOne({ whopId: userId });
    return member && member.status === 'active';
  }
}

module.exports = WhopGate;
