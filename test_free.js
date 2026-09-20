require('dotenv').config();
const TelegramManager = require('./src/bot/telegramManager');

const telegram = new TelegramManager();

const msg = `🚨🚨🚨 *ApexRadar Free Radar* 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━
🪙 *BTC/USDT* — 🔴 LONG LIQUIDATED
💰 *$1,250,000 USD* liquidated
💲 Price Zone: $62,450.00
━━━━━━━━━━━━━━━━━━━━━
🔒 *Cascade alerts, squeeze analysis & all signals in VIP*
👉 Get VIP Access — $9.99 (1st Month) 🔥:
https://whop.com/apexradar/apexradar-vip-intelligence
📲 VIP Telegram Channel:
https://t.me/+7olzpqcRqMthNmM0`;

telegram.sendFreeAlert(msg).then(success => {
  console.log('Mesaj Gönderildi mi?', success);
}).catch(console.error);
