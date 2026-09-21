// Native fetch is available in Node 18+, no need to require external node-fetch
const fs = require('fs');
const path = require('path');

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    this.dbPath = path.join(__dirname, '../../shadow_state.json');
    this.leverage = 10; // 10x Leverage
    this.tradeAmount = 1000; // $1,000 per trade
    
    // Default stats
    this.balance = 10000;
    this.winCount = 0;
    this.lossCount = 0;
    
    // Load existing state if it survives deployment
    this.loadState();
    
    this.activeTrades = new Map(); // Pendings are kept in RAM since 3 min wait resets on deploy anyway
  }

  loadState() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const data = JSON.parse(raw);
        this.balance = data.balance ?? 10000;
        this.winCount = data.winCount ?? 0;
        this.lossCount = data.lossCount ?? 0;
      }
    } catch (e) {
      console.error('❌ [PaperTrader] loadState error:', e.message);
    }
  }

  saveState() {
    try {
      const data = {
        balance: this.balance,
        winCount: this.winCount,
        lossCount: this.lossCount
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('❌ [PaperTrader] saveState error:', e.message);
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

