/**
 * Signal Formatter
 * Formats liquidation events and whale alerts into high-converting, professional Telegram Markdown.
 */

function formatNumber(num) {
  if (isNaN(num) || num === undefined || num === null) return '0';
  return Math.round(num).toLocaleString('en-US');
}

function formatPrice(price) {
  if (isNaN(price) || price === undefined || price === null) return '0.00';
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
  const isLong = side === 'SELL';
  const typeText = isLong ? 'LONG LIQUIDATED (Squeeze Down)' : 'SHORT LIQUIDATED (Squeeze Up)';
  const headerEmoji = getSignalEmoji(side, usdValue, isMega);

  const cleanSymbol = symbol.replace('USDT', '');
  const dateStr = new Date(timestamp || Date.now()).toISOString().substring(11, 19) + ' UTC';

  let banner = isMega ? '⚡ MEGA WHALE LIQUIDATION ALERT ⚡' : '💥 WHALE LIQUIDATION RADAR';
  let insight = isLong 
    ? '⚠️ <b>Market Impact:</b> Longs flushed out. Potential liquidity sweep at support.'
    : '🚀 <b>Market Impact:</b> Shorts trapped. Potential upward momentum or local top.';

  // Using HTML Parse Mode for safety
  return `
${headerEmoji} <b>${banner}</b> ${headerEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Asset:</b> #${cleanSymbol} / USDT
📊 <b>Event:</b> <b>${typeText}</b>
💰 <b>Volume:</b> <b>$${formatNumber(usdValue)} USD</b>
🎯 <b>Liquidation Price:</b> <code>$${formatPrice(price)}</code>
📦 <b>Contract Qty:</b> <code>${qty.toLocaleString('en-US')} ${cleanSymbol}</code>
⏰ <b>Time:</b> <code>${dateStr}</code>
━━━━━━━━━━━━━━━━━━━━━
${insight}
🛰 <i>Powered by ApexRadar VIP</i>
  `.trim();
}

function formatCascadeSignal(data) {
  const { symbol, side, totalUsd, avgPrice, count } = data;
  const isLong = side === 'SELL';
  const typeText = isLong ? 'MASS LONG CASCADE (SQUEEZE DOWN) 🩸' : 'MASS SHORT SQUEEZE (PUMP) 🚀';
  const emoji = isLong ? '🩸🩸🩸' : '🚀🚀🚀';
  const cleanSymbol = symbol.replace('USDT', '');

  return `
${emoji} <b>LIQUIDATION CASCADE DETECTED!</b> ${emoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 <b>Asset:</b> #${cleanSymbol} / USDT
⚡ <b>Event:</b> <b>${typeText}</b>
🔥 <b>Intensity:</b> <b>${count} Liquidations in &lt;15s</b>
💰 <b>Cumulative Drain:</b> <b>$${formatNumber(totalUsd)} USD</b>
📍 <b>Average Zone:</b> <code>$${formatPrice(avgPrice)}</code>
━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Actionable Insight:</b> Major volatility cluster. Wait for fakeout or momentum continuation.
🛰 <i>ApexRadar VIP Intelligence</i>
  `.trim();
}

function formatFreeSignal(data, configObj) {
  const { symbol, side, isMega } = data;
  const isLong = side === 'SELL';
  const direction = isLong ? '🔴 LONG LIQUIDATED' : '🟢 SHORT LIQUIDATED';
  const cleanSymbol = symbol.replace('USDT', '');
  const count = data.count || 3;
  // Fallback gracefully for usdValue (from standard liquidation) vs totalUsd (from cascade)
  const usdValue = data.totalUsd || data.usdValue || 0;
  const headerEmoji = isMega ? '🚨🚨🚨' : (isLong ? '🔴' : '🟢');
  const price = data.avgPrice || data.price || 0;

  return `
${headerEmoji} <b>ApexRadar Free Radar</b> ${headerEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 <b>${cleanSymbol}/USDT</b> — ${direction}
💰 <b>$${formatNumber(usdValue)} USD</b> liquidated
💲 Price Zone: <code>$${formatPrice(price)}</code>
━━━━━━━━━━━━━━━━━━━━━
🔒 <b>Cascade alerts, squeeze analysis & all signals in VIP</b>
👉 Get VIP Access — $9.99 (1st Month) 🔥:
${configObj.telegram.whopUrl}
`.trim();
}

module.exports = {
  formatLiquidationSignal,
  formatCascadeSignal,
  formatFreeSignal
};
