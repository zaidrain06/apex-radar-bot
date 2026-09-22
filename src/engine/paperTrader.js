const BotState = require('../db/botState');

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    this.leverage = 10;
    this.tradeAmount = 1000;
    
    this.balance = 11000;
    this.winCount = 0;
    this.lossCount = 0;
    
    this.activeTrades = new Map();
  }

  async init() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
         console.warn('⚠️ [PaperTrader] MongoDB not connected, falling back to initial stats.');
         return;
      }
      let state = await BotState.findOne({ type: 'PAPER' }).maxTimeMS(5000);
      if (!state) {
        state = new BotState({ type: 'PAPER', balance: 11000, winCount: 0, lossCount: 0 });
        await state.save();
      }
      this.balance = state.balance;
      this.winCount = state.winCount;
      this.lossCount = state.lossCount;
      console.log(`✅ [PaperTrader] MongoDB State Loaded. Balance: $${this.balance}`);
    } catch (e) {
      console.error('❌ [PaperTrader] MongoDB Init error:', e.message);
    }
  }

  async saveState() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) return;
      await BotState.updateOne(
        { type: 'PAPER' },
        { balance: this.balance, winCount: this.winCount, lossCount: this.lossCount },
        { upsert: true }
      );
    } catch (e) {
      console.error('❌ [PaperTrader] MongoDB Save error:', e.message);
    }
  }

  async sendStats(requestChatId) {
    const totalTrades = this.winCount + this.lossCount;
    const winRate = totalTrades > 0 ? ((this.winCount / totalTrades) * 100).toFixed(1) : 0;
    const netProfit = this.balance - 10000;
    
    let activeList = '';
    if (this.activeTrades.size === 0) {
      activeList = 'None';
    } else {
      for (const [tradeId, trade] of this.activeTrades.entries()) {
        const timePassed = Math.floor((Date.now() - trade.startTime) / 1000);
        const timeLeft = Math.max(0, 180 - timePassed);
        activeList += `\n• #${trade.symbol}: ${trade.type} @ $${trade.entryPrice} (${timeLeft}s left)`;
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

    const tradeType = cascadeData.side === 'SELL' ? 'LONG' : 'SHORT';
    const entryPrice = cascadeData.avgPrice;
    const symbol = cascadeData.symbol;
    const cleanSymbol = symbol.replace('USDT', '');
    const tradeId = Date.now().toString() + Math.floor(Math.random() * 1000).toString();

    // Track active trade with a UNIQUE ID so they don't overwrite each other
    this.activeTrades.set(tradeId, {
      symbol: cleanSymbol,
      type: tradeType,
      entryPrice: entryPrice,
      startTime: Date.now()
    });

    const entryMsg = `
👻 *SHADOW BOT ENTRY*
🪙 Asset: #${cleanSymbol}
⚡ Action: *${tradeType} (10x Leverage)*
🎯 Entry Price: \`$${entryPrice}\`
⏱️ Holding for 3 minutes...
    `.trim();
    
    await this.telegram.sendMessage(this.adminChatId, entryMsg);

    setTimeout(async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const data = await res.json();
        const exitPrice = parseFloat(data.price);

        if (isNaN(exitPrice)) {
          this.activeTrades.delete(tradeId);
          return;
        }

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

        this.saveState();

        this.activeTrades.delete(tradeId); // Correctly delete the specific trade

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
        this.activeTrades.delete(tradeId);
      }
    }, 3 * 60 * 1000);
  }
}

module.exports = PaperTrader;

