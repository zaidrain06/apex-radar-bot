/**
 * Signal Formatter
 * Formats liquidation events and whale alerts into high-converting, professional Telegram Markdown.
 */

function formatNumber(num) {
  return Math.round(num).toLocaleString('en-US');
}

function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function getSignalEmoji(side, usdValue, isMega) {
  if (isMega) return '🚨🚨🚨';
  return side === 'SELL' ? '🔴' : '🟢';
}

function formatLiquidationSignal(data) {
  const { symbol, side, price, qty, usdValue, isMega, timestamp } = data;
  const isLong = side === 'SELL'; // In Binance Futures: SELL order = Long position forced liquidated
  const typeText = isLong ? 'LONG LIQUIDATED (Squeeze Down)' : 'SHORT LIQUIDATED (Squeeze Up)';
  const headerEmoji = getSignalEmoji(side, usdValue, isMega);

  const cleanSymbol = symbol.replace('USDT', '');
  const dateStr = new Date(timestamp || Date.now()).toISOString().substring(11, 19) + ' UTC';

  let banner = isMega ? '⚡ MEGA WHALE LIQUIDATION ALERT ⚡' : '💥 WHALE LIQUIDATION RADAR';

  let insight = isLong 
    ? '⚠️ *Market Impact:* Longs flushed out. Potential liquidity sweep at support.'
    : '🚀 *Market Impact:* Shorts trapped. Potential upward momentum or local top.';

  return `
${headerEmoji} *${banner}* ${headerEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 *Asset:* #${cleanSymbol} / USDT
📊 *Event:* *${typeText}*
💰 *Volume:* *$${formatNumber(usdValue)} USD*
🎯 *Liquidation Price:* \`$${formatPrice(price)}\`
📦 *Contract Qty:* \`${qty.toLocaleString()} ${cleanSymbol}\`
⏰ *Time:* \`${dateStr}\`
━━━━━━━━━━━━━━━━━━━━━
${insight}
🛰 _Powered by ApexRadar VIP_
`.trim();
}

function formatCascadeSignal(data) {
  const { symbol, count, totalUsd, side, avgPrice } = data;
  const isLong = side === 'SELL';
  const typeText = isLong ? 'MASS LONG CASCADE' : 'MASS SHORT SQUEEZE';
  const cleanSymbol = symbol.replace('USDT', '');

  return `
🌊🌊 *LIQUIDATION CASCADE DETECTED!* 🌊🌊
━━━━━━━━━━━━━━━━━━━━━
🪙 *Asset:* #${cleanSymbol} / USDT
⚡ *Cascade Type:* *${typeText}*
🔥 *Total Liquidations:* *${count} orders in < 15s*
💰 *Cumulative Drain:* *$${formatNumber(totalUsd)} USD*
📍 *Average Zone:* \`$${formatPrice(avgPrice)}\`
━━━━━━━━━━━━━━━━━━━━━
⚠️ *High Volatility Warning:* Cascade in progress. Rapid momentum continuation expected.
🛰 _ApexRadar Real-Time Intelligence_
`.trim();
}

/**
 * Free channel teaser — shows the liquidation but hides cascade analysis.
 * Always appends a VIP upsell CTA.
 */
function formatFreeSignal(data, whopUrl, inviteLink) {
  const { symbol, side, price, usdValue, isMega } = data;
  const isLong = side === 'SELL';
  const direction = isLong ? '🔴 LONG LIQUIDATED' : '🟢 SHORT LIQUIDATED';
  const cleanSymbol = symbol.replace('USDT', '');
  const headerEmoji = isMega ? '🚨🚨🚨' : (isLong ? '🔴' : '🟢');

  const priceFormatted = price >= 1000 ? price.toLocaleString('en-US', { minimumFractionDigits: 2 }) : price.toFixed(4);
  const usdFormatted = Math.round(usdValue).toLocaleString('en-US');

  return `
${headerEmoji} *ApexRadar Free Radar* ${headerEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 *${cleanSymbol}/USDT* — ${direction}
💰 *$${usdFormatted} USD* liquidated
💲 Price Zone: $${priceFormatted}
━━━━━━━━━━━━━━━━━━━━━
🔒 *Cascade alerts, squeeze analysis & all signals in VIP*
👉 Get VIP Access — $9.99 (1st Month) 🔥:
${whopUrl}
📲 VIP Telegram Channel:
${inviteLink}
`.trim();
}

module.exports = {
  formatLiquidationSignal,
  formatCascadeSignal,
  formatFreeSignal
};
