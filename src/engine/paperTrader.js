const BotState = require('../db/botState');
const ccxt = require('ccxt');

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    
    // GERÇEKÇİ SİMÜLASYON AYARLARI (Altın Oran Hedefi)
    this.tradeAmountUsd = 2000; // Notional işlem hacmi (Aylık 3400$ hedefini simüle edecek)
    this.leverage = 10;
    this.feeRate = 0.0008; // %0.08 taker fee
    
    this.balance = 1500;
    this.winCount = 0;
    this.lossCount = 0;
    
    this.activeTrades = new Map();
    
    // Fiyat takibi için MEXC Public API (Rate limitlere takılmamak için)
    this.exchange = new ccxt.mexc({
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });
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
        state = new BotState({ type: 'PAPER', balance: 1500, winCount: 0, lossCount: 0 });
        await state.save();
      }
      this.balance = state.balance;
      this.winCount = state.winCount;
      this.lossCount = state.lossCount;
      console.log(`🟢 [PaperTrader] Realistic State Loaded. Balance: $${this.balance}`);
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

  async sendStats(requestChatId = null) {
    const totalTrades = this.winCount + this.lossCount;
    const winRate = totalTrades > 0 ? ((this.winCount / totalTrades) * 100).toFixed(1) : 0;
    
    let activeList = '';
    if (this.activeTrades.size > 0) {
      activeList = '\n\n' + Array.from(this.activeTrades.values()).map(t => 
        `• #${t.cleanSymbol} | ${t.type.toUpperCase()} | Entry: $${t.entryPrice.toFixed(4)}`
      ).join('\n');
    }

    const msg = `
👻 *SHADOW BOT (PAPER TRADING) - REALISTIC*
========================
💰 *Balance:* $${this.balance.toFixed(2)} (Start: $1500)
📊 *Total PnL:* $${(this.balance - 1500).toFixed(2)}
⚖️ *Leverage:* 10x | *Size:* $2000

✅ Wins: ${this.winCount} | ❌ Losses: ${this.lossCount}
🎯 Win Rate: ${winRate}%

⏳ *Active Trades:* ${this.activeTrades.size}${activeList}
    `.trim();

    await this.telegram.sendMessage(requestChatId || this.adminChatId, msg);
  }

  async executeTrade(cascadeData) {
    if (!this.adminChatId) return;

    const symbol = cascadeData.symbol;
    const cleanSymbol = symbol.replace('USDT', '');
    
    let ccxtSymbol = symbol;
    if (symbol.endsWith('USDT')) {
      ccxtSymbol = symbol.replace('USDT', '/USDT:USDT');
    }

    // ──────────────────────────────────────────────────────
    // 1. GEÇERLİ COİN KONTROLÜ (MEXC Futures API ile)
    // ──────────────────────────────────────────────────────
    try {
      if (!this.exchange.markets || Object.keys(this.exchange.markets).length === 0) {
        await this.exchange.loadMarkets();
      }
      if (!this.exchange.markets[ccxtSymbol]) {
        console.log(`[PaperTrader] ⛔ ${ccxtSymbol} MEXC Futures'ta yok, sinyal reddedildi.`);
        return;
      }
    } catch (e) {
      console.log(`[PaperTrader] ⚠️ ${ccxtSymbol} market verisi alınamadı, işlem devam ediyor.`);
    }

    // ──────────────────────────────────────────────────────
    // 2. GERÇEKÇİ BAKİYE KONTROLÜ
    // ──────────────────────────────────────────────────────
    const marginNeeded = this.tradeAmountUsd / this.leverage;
    const usedMargin = this.activeTrades.size * marginNeeded;
    const availableBalance = this.balance - usedMargin;

    if (availableBalance < marginNeeded) {
      console.log(`[PaperTrader] 🛑 YETERSİZ BAKİYE: ${symbol} reddedildi.`);
      return;
    }

    const tradeType = cascadeData.side === 'SELL' ? 'buy' : 'sell';

    // ──────────────────────────────────────────────────────
    // 3. SLIPPAGE SİMÜLASYONU (%0.15 giriş kayması)
    // ──────────────────────────────────────────────────────
    const slippageRate = 0.0015; // %0.15
    const rawEntryPrice = cascadeData.avgPrice;
    const entryPrice = tradeType === 'buy'
      ? rawEntryPrice * (1 + slippageRate)
      : rawEntryPrice * (1 - slippageRate);

    const tradeId = Date.now().toString() + Math.floor(Math.random() * 1000).toString();

    const stopLossRatio = 0.02;
    const takeProfitRatio = 0.04;
    const slPrice = tradeType === 'buy'
      ? entryPrice * (1 - stopLossRatio)
      : entryPrice * (1 + stopLossRatio);
    const tpPrice = tradeType === 'buy'
      ? entryPrice * (1 + takeProfitRatio)
      : entryPrice * (1 - takeProfitRatio);

    this.activeTrades.set(tradeId, {
      symbol: symbol,
      ccxtSymbol: ccxtSymbol,
      cleanSymbol: cleanSymbol,
      type: tradeType,
      entryPrice: entryPrice,
      slPrice: slPrice,
      tpPrice: tpPrice,
      startTime: Date.now(),
      monitorInterval: null
    });

    const entryMsg = `
👻 *SHADOW BOT ENTRY (SIMULATION)*
🪙 Asset: #${cleanSymbol}
🎯 Action: *${tradeType.toUpperCase()} (10x Lev)*
💰 Size: *$${this.tradeAmountUsd}* (Margin: $${marginNeeded})
💵 Cascade Fiyatı: \`$${rawEntryPrice.toFixed(4)}\`
💵 Giriş (Slippage +%0.15): \`$${entryPrice.toFixed(4)}\`
🛑 SL: \`$${slPrice.toFixed(4)}\` | 🟢 TP: \`$${tpPrice.toFixed(4)}\`
    `.trim();
    
    await this.telegram.sendMessage(this.adminChatId, entryMsg);

    const closeTrade = async (reason, exitPrice) => {
      if (!this.activeTrades.has(tradeId)) return;
      
      let pnlPercentage = 0;
      if (tradeType === 'buy') {
        pnlPercentage = (exitPrice - entryPrice) / entryPrice;
      } else {
        pnlPercentage = (entryPrice - exitPrice) / entryPrice;
      }

      const grossPnl = pnlPercentage * this.leverage * marginNeeded;
      const fee = (this.tradeAmountUsd * this.feeRate) * 2; 
      const netPnl = grossPnl - fee;

      this.balance += netPnl;
      if (netPnl > 0) this.winCount++;
      else this.lossCount++;

      this.saveState();
      this.activeTrades.delete(tradeId);

      const pnlEmoji = netPnl >= 0 ? '🟢 PROFIT' : '🔴 LOSS';
      const closeMsg = `
👻 *SHADOW BOT RESULT (${reason})*
🪙 Asset: #${cleanSymbol}
🎯 Type: *${tradeType.toUpperCase()}*
💵 Entry: \`$${entryPrice.toFixed(4)}\` | Exit: \`$${exitPrice.toFixed(4)}\`
💸 Komisyon: \`-$${fee.toFixed(2)}\`
${pnlEmoji}: *$${netPnl.toFixed(2)}*
💰 Shadow Bakiye: *$${this.balance.toFixed(2)}*
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, closeMsg);
    };

    const timeoutId = setTimeout(async () => {
      if (!this.activeTrades.has(tradeId)) return;
      const t = this.activeTrades.get(tradeId);
      if (t && t.monitorInterval) clearInterval(t.monitorInterval);
      
      const tryClose = async (retries = 5) => {
        if (!this.activeTrades.has(tradeId)) return;
        if (retries === 0) {
          console.log(`[PaperTrader] ⚠️ ${ccxtSymbol} fiyatı alınamadı, işlem siliniyor.`);
          this.activeTrades.delete(tradeId);
          return;
        }
        try {
          const ticker = await this.exchange.fetchTicker(ccxtSymbol);
          const exitPx = ticker.last;
          if (exitPx) {
            await closeTrade('3M SÜRE DOLDU', exitPx);
          } else {
            setTimeout(() => tryClose(retries - 1), 2000);
          }
        } catch(e) {
          setTimeout(() => tryClose(retries - 1), 2000);
        }
      };
      
      tryClose();
    }, 3 * 60 * 1000);

    const monitorInterval = setInterval(async () => {
      if (!this.activeTrades.has(tradeId)) {
        clearInterval(monitorInterval);
        return;
      }
      try {
        const ticker = await this.exchange.fetchTicker(ccxtSymbol);
        const currentPx = ticker.last;
        if (!currentPx) return;

        let hitLimit = false;
        if (tradeType === 'buy') {
          if (currentPx >= tpPrice || currentPx <= slPrice) hitLimit = true;
        } else {
          if (currentPx <= tpPrice || currentPx >= slPrice) hitLimit = true;
        }

        if (hitLimit) {
          clearInterval(monitorInterval);
          clearTimeout(timeoutId);
          await closeTrade('SL/TP HIT', currentPx);
        }
      } catch(e) {}
    }, 5000);

    const paperTradeRef = this.activeTrades.get(tradeId);
    if (paperTradeRef) paperTradeRef.monitorInterval = monitorInterval;

  }
}

module.exports = PaperTrader;
