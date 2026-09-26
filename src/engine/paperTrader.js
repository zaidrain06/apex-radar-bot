const BotState = require('../db/botState');
const MLDataset = require('../db/mlDataset');
const ccxt = require('ccxt');

// ──────────────────────────────────────────────────────
// Major coin listesi: Bu coinlerde TP daha düşük tutulur
// çünkü likidite duvarları kalın, fiyat çok esnemez.
// ──────────────────────────────────────────────────────
const MAJOR_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT'];

class PaperTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;

    // GERÇEKÇİ SİMÜLASYON AYARLARI (Altın Oran Hedefi)
    this.tradeAmountUsd = 2000;
    this.leverage = 10;
    this.feeRate = 0.0008; // %0.08 taker fee

    this.balance = 2000;
    this.winCount = 0;
    this.lossCount = 0;

    this.activeTrades = new Map();

    // ──────────────────────────────────────────────────────
    // Akıllı Şalter (Drawdown Limit)
    // ──────────────────────────────────────────────────────
    this.consecutiveLosses = 0;
    this.maxConsecutiveLosses = 3;
    this.lastResetDay = new Date().toDateString();

    // Fiyat takibi için MEXC Public API
    this.exchange = new ccxt.mexc({
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });
  }

  // Günlük sayacı gece yarısı sıfırla
  checkDailyReset() {
    // Gece 12'de sıfırlanması için Türkiye Saati (UTC+3) kullanıyoruz
    const options = { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' };
    const today = new Intl.DateTimeFormat('tr-TR', options).format(new Date());

    if (today !== this.lastResetDay) {
      this.consecutiveLosses = 0;
      this.lastResetDay = today;
      console.log('[PaperTrader] 🌅 Yeni gün (TRT 00:00) — Peş peşe zarar sayacı sıfırlandı.');
      this.saveState();
    }
  }

  async init() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        console.warn('⚠️ [PaperTrader] MongoDB not connected, falling back to initial stats.');
        return;
      }
      let state = await BotState.findOne({ type: 'PAPER_V2' }).maxTimeMS(5000);

      const options = { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' };
      const today = new Intl.DateTimeFormat('tr-TR', options).format(new Date());

      if (!state) {
        state = new BotState({ type: 'PAPER_V2', balance: 2000, winCount: 0, lossCount: 0, consecutiveLosses: 0, lastResetDay: today });
        await state.save();
      }
      this.balance = state.balance;
      this.winCount = state.winCount;
      this.lossCount = state.lossCount;
      this.consecutiveLosses = state.consecutiveLosses || 0;
      this.lastResetDay = state.lastResetDay || today;
      console.log(`🟢 [PaperTrader] Realistic State Loaded. Balance: $${this.balance} | Drawdown: ${this.consecutiveLosses}/${this.maxConsecutiveLosses}`);
    } catch (e) {
      console.error('❌ [PaperTrader] MongoDB Init error:', e.message);
    }
  }

  async saveState() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) return;
      await BotState.updateOne(
        { type: 'PAPER_V2' },
        { balance: this.balance, winCount: this.winCount, lossCount: this.lossCount, consecutiveLosses: this.consecutiveLosses, lastResetDay: this.lastResetDay },
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
💰 *Balance:* $${this.balance.toFixed(2)} (Start: $2000)
📊 *Total PnL:* $${(this.balance - 2000).toFixed(2)}
⚖️ *Leverage:* 10x | *Size:* $2000

✅ Wins: ${this.winCount} | ❌ Losses: ${this.lossCount}
🎯 Win Rate: ${winRate}%

🛑 Peş Peşe Zarar: ${this.consecutiveLosses}/${this.maxConsecutiveLosses}
⏳ *Active Trades:* ${this.activeTrades.size}${activeList}
    `.trim();

    await this.telegram.sendMessage(requestChatId || this.adminChatId, msg);
  }

  async executeTrade(cascadeData) {
    if (!this.adminChatId) return;

    // ──────────────────────────────────────────────────────
    // 0. AKILLI ŞALTER KONTROLÜ (Drawdown Limit)
    // ──────────────────────────────────────────────────────
    this.checkDailyReset();
    
    const isMegaCascade = cascadeData.totalUsd >= 150000;

    if (this.consecutiveLosses >= this.maxConsecutiveLosses && !isMegaCascade) {
      console.log(`[PaperTrader] 🛑 ŞALTER İNDİ! Peş peşe ${this.maxConsecutiveLosses} zarar. Bugünlük işlem durduruldu.`);
      return;
    } else if (this.consecutiveLosses >= this.maxConsecutiveLosses && isMegaCascade) {
      console.log(`[PaperTrader] ⚡ ŞALTER DEVRE DIŞI! MEGA CASCADE tespit edildi ($${Math.floor(cascadeData.totalUsd)}), işleme zorla giriliyor.`);
    }

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
    // 2. BTC TREND FİLTRESİ (Genel Çöküş Koruması)
    // ──────────────────────────────────────────────────────
    const tradeType = cascadeData.side === 'SELL' ? 'buy' : 'sell';
    let btcChange = 0; // Makine Öğrenimi için global tanımlandı
    try {
      const btcOhlcv = await this.exchange.fetchOHLCV('BTC/USDT:USDT', '1m', undefined, 6);
      if (btcOhlcv && btcOhlcv.length >= 2) {
        const btcPriceBefore = btcOhlcv[0][4]; // 5 dakika önceki kapanış
        const btcPriceNow = btcOhlcv[btcOhlcv.length - 1][4]; // Şu anki kapanış
        btcChange = (btcPriceNow - btcPriceBefore) / btcPriceBefore;

        if (btcChange < -0.01 && tradeType === 'buy') {
          console.log(`[PaperTrader] 🛑 BTC Filtresi: BTC ${(btcChange * 100).toFixed(2)}% düştü, BUY cascade reddedildi. (Genel çöküş)`);
          return;
        }
        if (btcChange > 0.01 && tradeType === 'sell') {
          console.log(`[PaperTrader] 🛑 BTC Filtresi: BTC ${(btcChange * 100).toFixed(2)}% yükseldi, SELL cascade reddedildi. (Genel pump)`);
          return;
        }
        console.log(`[PaperTrader] ✅ BTC Filtresi geçildi: BTC değişim ${(btcChange * 100).toFixed(2)}%`);
      }
    } catch (e) {
      console.log(`[PaperTrader] ⚠️ BTC Filtresi API hatası, işlem devam ediyor: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    // 3. GERÇEKÇİ BAKİYE KONTROLÜ
    // ──────────────────────────────────────────────────────
    const marginNeeded = this.tradeAmountUsd / this.leverage;
    const usedMargin = this.activeTrades.size * marginNeeded;
    const availableBalance = this.balance - usedMargin;

    if (availableBalance < marginNeeded) {
      console.log(`[PaperTrader] 🛑 YETERSİZ BAKİYE: ${symbol} reddedildi. (Bakiye: $${this.balance.toFixed(2)}, Kullanılan: $${usedMargin.toFixed(2)})`);
      return;
    }

    // ──────────────────────────────────────────────────────
    // 3. SLIPPAGE SİMÜLASYONU (%0.15 giriş kayması)
    // ──────────────────────────────────────────────────────
    const slippageRate = 0.0015;
    const rawEntryPrice = cascadeData.avgPrice;
    const entryPrice = tradeType === 'buy'
      ? rawEntryPrice * (1 + slippageRate)
      : rawEntryPrice * (1 - slippageRate);

    // ──────────────────────────────────────────────────────
    // 4. DİNAMİK TP (MAJOR vs ALTCOIN AYRIMI)
    // Major coinlerde likidite kalın, fiyat az esner → düşük TP
    // Altcoinlerde volatilite yüksek → yüksek TP hedefi
    // ──────────────────────────────────────────────────────
    const isMajor = MAJOR_COINS.includes(cleanSymbol.toUpperCase());
    const stopLossRatio = 0.02;                     // Tüm coinlerde %2 SL
    const takeProfitRatio = isMajor ? 0.015 : 0.04; // Major: %1.5 | Altcoin: %4

    const slPrice = tradeType === 'buy'
      ? entryPrice * (1 - stopLossRatio)
      : entryPrice * (1 + stopLossRatio);
    const tpPrice = tradeType === 'buy'
      ? entryPrice * (1 + takeProfitRatio)
      : entryPrice * (1 - takeProfitRatio);

    const tradeId = Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    const coinTag = isMajor ? '🏛️ MAJOR' : '🪙 ALTCOIN';

    this.activeTrades.set(tradeId, {
      symbol: symbol,
      ccxtSymbol: ccxtSymbol,
      cleanSymbol: cleanSymbol,
      type: tradeType,
      entryPrice: entryPrice,
      slPrice: slPrice,
      tpPrice: tpPrice,
      btcChange5m: btcChange,
      startTime: Date.now(),
      monitorInterval: null
    });

    const entryMsg = `
👻 *SHADOW BOT ENTRY (SIMULATION)*
${coinTag} Asset: #${cleanSymbol}
🎯 Action: *${tradeType.toUpperCase()} (10x Lev)*
💰 Size: *$${this.tradeAmountUsd}* (Margin: $${marginNeeded})
💵 Cascade Fiyatı: \`$${rawEntryPrice.toFixed(4)}\`
💵 Giriş (Slippage +%0.15): \`$${entryPrice.toFixed(4)}\`
🛑 SL: \`$${slPrice.toFixed(4)}\` | 🟢 TP: \`$${tpPrice.toFixed(4)}\` (${isMajor ? '%1.5' : '%4'})
🛑 Peş Peşe Zarar: ${this.consecutiveLosses}/${this.maxConsecutiveLosses}
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
      if (netPnl > 0) {
        this.winCount++;
        this.consecutiveLosses = 0; // Win gelirse şalteri sıfırla!
      } else {
        this.lossCount++;
        this.consecutiveLosses++; // Loss gelirse sayacı artır
      }

      this.saveState();
      
      const tradeData = this.activeTrades.get(tradeId);
      
      // ──────────────────────────────────────────────────────
      // DATA HARVESTER (Yapay Zeka İçin Veri Toplama)
      // ──────────────────────────────────────────────────────
      try {
        const mlData = new MLDataset({
          tradeId: tradeId,
          botType: 'PAPER',
          symbol: tradeData.symbol,
          side: tradeData.type.toUpperCase(),
          btcChange5m: tradeData.btcChange5m || 0,
          entryPrice: entryPrice,
          exitPrice: exitPrice,
          tradeDurationMs: Date.now() - tradeData.startTime,
          closeReason: reason,
          pnlPercent: pnlPercentage,
          isWin: netPnl > 0
        });
        await mlData.save();
        console.log(`[PaperTrader] 🧠 ML Dataset Kaydedildi: ${tradeData.symbol} -> Win: ${netPnl > 0}`);
      } catch (e) {
        console.error('[PaperTrader] ❌ ML Dataset Kayıt Hatası:', e.message);
      }

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

    // ──────────────────────────────────────────────────────
    // 5 DAKİKA TIMEOUT (Momentum bitti, piyasa yapıcılar devreye girer)
    // ──────────────────────────────────────────────────────
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
            await closeTrade('5DK MOMENTUM BİTTİ', exitPx);
          } else {
            setTimeout(() => tryClose(retries - 1), 2000);
          }
        } catch (e) {
          setTimeout(() => tryClose(retries - 1), 2000);
        }
      };

      tryClose();
    }, 5 * 60 * 1000);

    // ──────────────────────────────────────────────────────
    // 5 SANİYEDE BİR SL/TP RADAR
    // ──────────────────────────────────────────────────────
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
        let exactExitPrice = currentPx;
        let reasonStr = 'TIMEOUT/OTHER';

        if (tradeType === 'buy') {
          if (currentPx >= tpPrice) {
            hitLimit = true;
            exactExitPrice = tpPrice;
            reasonStr = 'TP HIT';
          } else if (currentPx <= slPrice) {
            hitLimit = true;
            exactExitPrice = slPrice;
            reasonStr = 'SL HIT';
          }
        } else { // sell
          if (currentPx <= tpPrice) {
            hitLimit = true;
            exactExitPrice = tpPrice;
            reasonStr = 'TP HIT';
          } else if (currentPx >= slPrice) {
            hitLimit = true;
            exactExitPrice = slPrice;
            reasonStr = 'SL HIT';
          }
        }

        if (hitLimit) {
          clearInterval(monitorInterval);
          clearTimeout(timeoutId);
          // SIMULASYON MÜKEMMELLİĞİ: Gecikmeli güncel fiyat (currentPx) yerine 
          // tam sınır fiyatı (exactExitPrice) kullanarak -90$ gibi slippage hatalarını önle.
          await closeTrade(reasonStr, exactExitPrice);
        }
      } catch (e) {}
    }, 5000);

    const paperTradeRef = this.activeTrades.get(tradeId);
    if (paperTradeRef) paperTradeRef.monitorInterval = monitorInterval;
  }
}

module.exports = PaperTrader;
