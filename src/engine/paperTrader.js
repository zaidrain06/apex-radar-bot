const BotState = require('../db/botState');

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

  async sendStats(requestChatId) {
    const totalTrades = this.winCount + this.lossCount;
    const winRate = totalTrades > 0 ? ((this.winCount / totalTrades) * 100).toFixed(1) : 0;
    const netProfit = this.balance - 1500;
    
    let activeList = '';
    if (this.activeTrades.size === 0) {
      activeList = 'None';
    } else {
      for (const [tradeId, trade] of this.activeTrades.entries()) {
        const timePassed = Math.floor((Date.now() - trade.startTime) / 1000);
        const timeLeft = Math.max(0, 180 - timePassed);
        activeList += `\n🔸 #${trade.symbol}: ${trade.type} @ $${trade.entryPrice} (${timeLeft}s left)`;
      }
    }

    const pnlEmoji = netProfit >= 0 ? '🟢' : '🔴';
    
    const msg = `
📊 *SHADOW BOT (REALISTIC SIMULATION)*
=====================
💰 *Total Balance:* \`$${this.balance.toFixed(2)}\`
${pnlEmoji} *Net PnL:* \`$${netProfit.toFixed(2)}\`

🚀 *Performance:*
✅ Wins: ${this.winCount} | ❌ Losses: ${this.lossCount}
🎯 Win Rate: ${winRate}%

⏳ *Active Trades:* ${this.activeTrades.size}${activeList}
    `.trim();

    await this.telegram.sendMessage(requestChatId || this.adminChatId, msg);
  }

  async executeTrade(cascadeData) {
    if (!this.adminChatId) return;

    // GERÇEKÇİ BAKİYE KONTROLÜ
    const marginNeeded = this.tradeAmountUsd / this.leverage;
    const usedMargin = this.activeTrades.size * marginNeeded;
    const availableBalance = this.balance - usedMargin;

    if (availableBalance < marginNeeded) {
      console.log(`[PaperTrader] 🛑 YETERSİZ BAKİYE SİMÜLASYONU: ${cascadeData.symbol} işlemi reddedildi.`);
      return; // İşleme girme!
    }

    const tradeType = cascadeData.side === 'SELL' ? 'buy' : 'sell';
    const entryPrice = cascadeData.avgPrice;
    const symbol = cascadeData.symbol;
    const cleanSymbol = symbol.replace('USDT', '');
    const tradeId = Date.now().toString() + Math.floor(Math.random() * 1000).toString();

    // SL ve TP Hesaplama
    const stopLossRatio = 0.02;
    const takeProfitRatio = 0.04;
    let slPrice, tpPrice;
    
    if (tradeType === 'buy') {
      slPrice = entryPrice * (1 - stopLossRatio);
      tpPrice = entryPrice * (1 + takeProfitRatio);
    } else {
      slPrice = entryPrice * (1 + stopLossRatio);
      tpPrice = entryPrice * (1 - takeProfitRatio);
    }

    // Aktif işleme kaydet
    this.activeTrades.set(tradeId, {
      symbol: symbol, // raw binance symbol for fetching price
      cleanSymbol: cleanSymbol,
      type: tradeType,
      entryPrice: entryPrice,
      slPrice: slPrice,
      tpPrice: tpPrice,
      startTime: Date.now()
    });

    const entryMsg = `
👻 *SHADOW BOT ENTRY (SIMULATION)*
🪙 Asset: #${cleanSymbol}
🎯 Action: *${tradeType.toUpperCase()} (10x Lev)*
💰 Size: *$${this.tradeAmountUsd}* (Margin: $${marginNeeded})
💵 Entry Price: \`$${entryPrice.toFixed(4)}\`
🛑 SL: \`$${slPrice.toFixed(4)}\` | 🟢 TP: \`$${tpPrice.toFixed(4)}\`
    `.trim();
    
    await this.telegram.sendMessage(this.adminChatId, entryMsg);

    // Kapatma Fonksiyonu
    const closeTrade = async (reason, exitPrice) => {
      if (!this.activeTrades.has(tradeId)) return;
      
      let pnlPercentage = 0;
      if (tradeType === 'buy') {
        pnlPercentage = (exitPrice - entryPrice) / entryPrice;
      } else {
        pnlPercentage = (entryPrice - exitPrice) / entryPrice;
      }

      // Brüt Kâr/Zarar
      const grossPnl = pnlPercentage * this.leverage * marginNeeded;
      
      // Komisyon Kesintisi (Giriş + Çıkış)
      const fee = (this.tradeAmountUsd * this.feeRate) * 2;
      
      // Net Kâr/Zarar
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
💵 Entry: \`$${entryPrice.toFixed(4)}\`
💵 Exit: \`$${exitPrice.toFixed(4)}\`

💸 Fees Paid: \`-$${fee.toFixed(2)}\`
${pnlEmoji}: *$${netPnl.toFixed(2)}*
💰 Total Fake Balance: *$${this.balance.toFixed(2)}*
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, closeMsg);
    };

    // 1. Acil Çıkış (3 Dakika Süre Sınırı)
    const timeoutId = setTimeout(async () => {
      if (!this.activeTrades.has(tradeId)) return;
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const data = await res.json();
        const exitPx = parseFloat(data.price);
        
        if (!isNaN(exitPx)) {
          await closeTrade('TIME LIMIT 3M', exitPx);
        } else {
          // Fiyat gelmezse marjini boşaltmak için işlemi zorla sil
          console.error(`[PaperTrader] ${symbol} için 3. dakika kapanış fiyatı alınamadı (NaN). İşlem siliniyor.`);
          this.activeTrades.delete(tradeId);
        }
      } catch(e) {
        console.error(`[PaperTrader] ${symbol} zaman aşımı API hatası:`, e.message);
        this.activeTrades.delete(tradeId); // Hata olursa da sil, bakiye bloke kalmasın
      }
    }, 3 * 60 * 1000);

    // 2. Fiyat Radarı (5 Saniyede Bir SL/TP Kontrolü)
    const monitorInterval = setInterval(async () => {
      if (!this.activeTrades.has(tradeId)) {
        clearInterval(monitorInterval);
        return;
      }
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const data = await res.json();
        const currentPx = parseFloat(data.price);
        if (isNaN(currentPx)) return;

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

  }
}

module.exports = PaperTrader;
