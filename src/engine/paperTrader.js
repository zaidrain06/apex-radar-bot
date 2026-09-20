const fetch = require('node-fetch');

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    this.balance = 10000; // Starting fake balance: $10,000
    this.tradeAmount = 1000; // Position size per trade: $1,000
    this.leverage = 10; // 10x Leverage
  }

  async executeTrade(cascadeData) {
    if (!this.adminChatId) return;

    // cascadeData has: symbol, side, avgPrice, totalUsd
    // side === 'SELL' means Longs got liquidated (Price dropped). We counter-trade and go LONG.
    const tradeType = cascadeData.side === 'SELL' ? 'LONG' : 'SHORT';
    const entryPrice = cascadeData.avgPrice;
    const symbol = cascadeData.symbol;
    const cleanSymbol = symbol.replace('USDT', '');

    // 1. Alert Admin about entry
    const entryMsg = `
👻 *SHADOW BOT ENTRY*
🪙 Asset: #${cleanSymbol}
⚡ Action: *${tradeType} (10x Leverage)*
🎯 Entry Price: \`$${entryPrice}\`
⏱️ Holding for 3 minutes...
    `.trim();
    
    await this.telegram.sendMessage(this.adminChatId, entryMsg);

    // 2. Wait exactly 3 minutes, then close position
    setTimeout(async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const data = await res.json();
        const exitPrice = parseFloat(data.price);

        if (isNaN(exitPrice)) return;

        // Calculate PnL
        let pnlPercentage = 0;
        if (tradeType === 'LONG') {
          pnlPercentage = (exitPrice - entryPrice) / entryPrice;
        } else {
          pnlPercentage = (entryPrice - exitPrice) / entryPrice;
        }

        const leveragedPnlUsd = pnlPercentage * this.leverage * this.tradeAmount;
        this.balance += leveragedPnlUsd;

        const pnlEmoji = leveragedPnlUsd >= 0 ? '✅ PROFIT' : '❌ LOSS';
        const closeMsg = `
📊 *SHADOW BOT RESULT*
🪙 Asset: #${cleanSymbol}
⚡ Type: *${tradeType}*
🎯 Entry: \`$${entryPrice}\`
🚪 Exit: \`$${exitPrice}\`

${pnlEmoji}: *$${leveragedPnlUsd.toFixed(2)}*
💰 Total Fake Balance: *$${this.balance.toFixed(2)}*
        `.trim();

        await this.telegram.sendMessage(this.adminChatId, closeMsg);
      } catch (err) {
        console.error('❌ [PaperTrader] Fetch error:', err.message);
      }
    }, 3 * 60 * 1000); // 3 Minutes delay
  }
}

module.exports = PaperTrader;
