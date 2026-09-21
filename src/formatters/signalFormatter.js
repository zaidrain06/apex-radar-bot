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
  const { symbol, side, price, qty, usdValue, isMega } = data;
  const isLong = side === 'SELL'; // Longs get liquidated by sell orders
  const direction = isLong ? '🔴 LONG LIQUIDATED' : '🟢 SHORT LIQUIDATED';
  const cleanSymbol = symbol.replace('USDT', '');
  const headerEmoji = isMega ? '🚨 MEGA LIQUIDATION' : '💥 LIQUIDATION';

  const priceFormatted = price >= 1000 ? price.toLocaleString('en-US', { minimumFractionDigits: 2 }) : price.toFixed(4);
  const usdFormatted = Math.round(usdValue).toLocaleString('en-US');
  const qtyFormatted = qty.toLocaleString('en-US', { maximumFractionDigits: 4 });

  // Note: Using precise, clean markdown to prevent Telegram parser errors
  return `
${headerEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 Asset: #${cleanSymbol} / USDT
⚡ Event: ${direction}
💰 Value: $${usdFormatted}
💲 Price: $${priceFormatted}
📦 Size: ${qtyFormatted} ${cleanSymbol}
━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

/**
 * Format a Cascade (Squeeze) event for VIP (e.g. 5+ liquidations within 15 seconds)
 */
function formatCascadeSignal(data) {
  const { symbol, side, totalUsd, avgPrice, count } = data;
  const isLong = side === 'SELL'; // Longs got squeezed -> Dump
  const typeText = isLong ? 'LONG CASCADE / DUMP' : 'SHORT SQUEEZE / PUMP';
  const emoji = isLong ? '🩸' : '🚀';
  const cleanSymbol = symbol.replace('USDT', '');

  const priceFormatted = avgPrice >= 1000 ? avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) : avgPrice.toFixed(4);
  
  return `
${emoji} CASCADE DETECTED ${emoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 Asset: #${cleanSymbol} / USDT
⚡ Event: ${typeText}
🔥 Intensity: ${count} Liquidations in <15s
💰 Cumulative Drain: $${formatNumber(totalUsd)} USD
💲 Avg Price: $${priceFormatted}
━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

/**
 * Free channel teaser — shows the liquidation but hides cascade analysis.
 * Always appends a VIP upsell CTA.
 */
function formatFreeSignal(data, whopUrl, inviteLink) {
  const { symbol, side, usdValue, isMega } = data;
  const isLong = side === 'SELL';
  const direction = isLong ? '🔴 LONG LIQUIDATED' : '🟢 SHORT LIQUIDATED';
  const cleanSymbol = symbol.replace('USDT', '');
  const count = data.count || 3;
  const totalUsd = data.totalUsd || 0;
  const headerEmoji = isMega ? '🚨🚨🚨' : (isLong ? '🔴' : '🟢');

  // Cascade events provide avgPrice, regular liquidations provide price
  const price = data.avgPrice || data.price || 0;

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
