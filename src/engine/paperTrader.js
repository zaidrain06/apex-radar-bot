// Native fetch is available in Node 18+, no need to require external node-fetch

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    this.balance = 10000; // Starting fake balance: $10,000
    this.tradeAmount = 1000; // Position size per trade: $1,000
    this.leverage = 10; // 10x Leverage
    
    // Stats tracking
    this.winCount = 0;
    this.lossCount = 0;
    this.activeTrades = new Map(); // Keep track of pending closures
  }

  async sendStats(requestChatId) {
    const totalTrades = this.winCount + this.lossCount;
    const winRate = totalTrades > 0 ? ((this.winCount / totalTrades) * 100).toFixed(1) : 0;
    const netProfit = this.balance - 10000;
    
    let activeList = '';
    if (this.activeTrades.size === 0) {
      activeList = 'None';
    } else {
      for (const [symbol, trade] of this.activeTrades.entries()) {
        const timePassed = Math.floor((Date.now() - trade.startTime) / 1000);
        const timeLeft = Math.max(0, 180 - timePassed);
        activeList += `\n• #${symbol}: ${trade.type} @ $${trade.entryPrice} (${timeLeft}s left)`;
      }
    }

    const pnlEmoji = netProfit >= 0 ? '🟩' : '🟥';
    
    const msg = `
🕵️‍♂️ *SHADOW BOT REPORT*
━━━━━━━━━━━━━━━━━━━━━
💰 *Total Balance:* \`$${this.balance.toFixed(2)}\`
${pnlEmoji} *Net PnL:* \`$${netProfit.toFixed(2)}\`

📈 *Performance:*
• Wins: ${this.winCount} | Losses: ${this.lossCount}
• Win Rate: ${winRate}%

⏳ *Active Trades:* ${this.activeTrades.size}${activeList}
    `.trim();

    await this.telegram.sendMessage(requestChatId || this.adminChatId, msg);
  }

  async executeTrade(cascadeData) {
    if (!this.adminChatId) return;

    // cascadeData has: symbol, side, avgPrice, totalUsd
    // side === 'SELL' means Longs got liquidated (Price dropped). We counter-trade and go LONG.
    const tradeType = cascadeData.side === 'SELL' ? 'LONG' : 'SHORT';
    const entryPrice = cascadeData.avgPrice;
    const symbol = cascadeData.symbol;
    const cleanSymbol = symbol.replace('USDT', '');

    // Track active trade
    this.activeTrades.set(cleanSymbol, {
      type: tradeType,
      entryPrice: entryPrice,
      startTime: Date.now()
    });

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

        if (isNaN(exitPrice)) {
          this.activeTrades.delete(cleanSymbol);
          return;
        }

        // Calculate PnL
        let pnlPercentage = 0;
        if (tradeType === 'LONG') {
          pnlPercentage = (exitPrice - entryPrice) / entryPrice;
        } else {
          pnlPercentage = (entryPrice - exitPrice) / entryPrice;
        }

        const leveragedPnlUsd = pnlPercentage * this.leverage * this.tradeAmount;
        this.balance += leveragedPnlUsd;
        
        if (leveragedPnlUsd >= 0) this.winCount++;
        else this.lossCount++;

        this.activeTrades.delete(cleanSymbol);

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
        this.activeTrades.delete(cleanSymbol);
      }
    }, 3 * 60 * 1000); // 3 Minutes delay
  }
}

module.exports = PaperTrader;

