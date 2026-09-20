require('dotenv').config();

module.exports = {
  // Binance Futures WebSocket Streams
  binance: {
    wsBaseUrl: 'wss://fstream.binance.com',
    liquidationStream: '/market/ws/!forceOrder@arr',
    // Minimum threshold for a single liquidation to trigger an alert ($ USD)
    minLiquidationUsd: parseFloat(process.env.MIN_LIQUIDATION_USD || '25000'),
    megaLiquidationUsd: parseFloat(process.env.MEGA_LIQUIDATION_USD || '150000'),
    // Cascade settings: 3+ liquidations on same asset within 15 seconds
    cascadeWindowMs: 15000,
    cascadeCountThreshold: 3
  },

  // Telegram Configuration
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    // VIP Channel — paid subscribers only (cascade + all signals)
    channelId: (process.env.TELEGRAM_CHANNEL_ID && process.env.TELEGRAM_CHANNEL_ID.startsWith('-100'))
      ? process.env.TELEGRAM_CHANNEL_ID
      : '-1004208031753',
    // FREE Channel — public, filtered big liquidations + VIP CTA
    freeChannelId: process.env.TELEGRAM_FREE_CHANNEL_ID || '',
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '1339587201',
    inviteLink: process.env.TELEGRAM_INVITE_LINK || 'https://t.me/+7olzpqcRqMthNmM0',
    whopUrl: process.env.WHOP_PRODUCT_URL || 'https://whop.com/apexradar/apexradar-vip-intelligence'
  },

  // Whop Configuration
  whop: {
    apiKey: process.env.WHOP_API_KEY || '',
    webhookSecret: process.env.WHOP_WEBHOOK_SECRET || '',
    planId: process.env.WHOP_PLAN_ID || 'plan_apex_vip_monthly',
    productUrl: 'https://whop.com/apexradar/apexradar-vip-intelligence',
    priceUsd: 29.99
  },

  // Server port for webhook listeners and health checks
  server: {
    port: parseInt(process.env.PORT || '3000', 10)
  }
};
