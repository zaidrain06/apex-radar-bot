const ccxt = require('ccxt');
const BotState = require('../db/botState');

class RealTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    
    // RİSK YÖNETİMİ - 50 DOLARLIK TEST
    this.tradeAmountUsd = 50; 
    this.leverage = 10;
    this.activeTrades = new Map();

    // Default Stats
    this.totalPnl = 0;
    this.winCount = 0;
    this.lossCount = 0;

    // MEXC API Bağlantısı
    const apiKey = process.env.MEXC_API_KEY;
    const secret = process.env.MEXC_API_SECRET;

    if (apiKey && secret) {
      this.exchange = new ccxt.mexc({
        apiKey: apiKey,
        secret: secret,
        enableRateLimit: true,
        options: { defaultType: 'swap' }
      });
      console.log('✅ [RealTrader] MEXC API Anahtarları yüklendi. GERÇEK İŞLEM MOTORU AKTİF.');
    } else {
      console.warn('⚠️ [RealTrader] MEXC API anahtarları bulunamadı. Gerçek işlemler kapalı.');
      this.exchange = null;
    }
  }

  async init() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
         console.warn('⚠️ [RealTrader] MongoDB not connected, falling back to initial stats.');
         return;
      }
      let state = await BotState.findOne({ type: 'REAL' }).maxTimeMS(5000);
      if (!state) {
        state = new BotState({ type: 'REAL', totalPnl: 0, winCount: 0, lossCount: 0 });
        await state.save();
      }
      this.totalPnl = state.totalPnl;
      this.winCount = state.winCount;
      this.lossCount = state.lossCount;
      console.log(`✅ [RealTrader] MongoDB State Loaded. Total PNL: $${this.totalPnl}`);
    } catch (e) {
      console.error('❌ [RealTrader] MongoDB Init error:', e.message);
    }
  }

  async saveState() {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) return;
      await BotState.updateOne(
        { type: 'REAL' },
        { totalPnl: this.totalPnl, winCount: this.winCount, lossCount: this.lossCount },
        { upsert: true }
      );
    } catch (e) {
      console.error('❌ [RealTrader] MongoDB Save error:', e.message);
    }
  }

  async executeTrade(cascadeData) {
    if (!this.exchange) return;

    try {
      const { symbol, side, avgPrice } = cascadeData;
      
      // FIX: Binance sends 'ETHUSDT'. CCXT expects 'ETH/USDT:USDT' for MEXC Futures.
      let ccxtSymbol = symbol;
      if (symbol.endsWith('USDT')) {
        ccxtSymbol = symbol.replace('USDT', '/USDT:USDT');
      }

      // Ensure markets are loaded to access contractSize
      if (!this.exchange.markets || Object.keys(this.exchange.markets).length === 0) {
        await this.exchange.loadMarkets();
      }
      const market = this.exchange.markets[ccxtSymbol];
      if (!market) {
        console.warn(`[RealTrader] ${ccxtSymbol} için market verisi bulunamadı!`);
        return;
      }

      // Cascade bounce mantığı: Longs eridiyse fiyat düştü → toparlanma için BUY
      const isLongSqueeze = side === 'SELL';
      const orderSide = isLongSqueeze ? 'buy' : 'sell';
      const closeSide = orderSide === 'buy' ? 'sell' : 'buy';

      // Coin'in anlık fiyatını alalım
      const ticker = await this.exchange.fetchTicker(ccxtSymbol);
      const currentPrice = ticker.last;

      // 50$ lık pozisyon için kaç kontrat lazım?
      const coinAmount = this.tradeAmountUsd / currentPrice;
      const contractSize = market.contractSize || 1;
      const contractsRaw = coinAmount / contractSize;
      const contracts = Math.max(1, Math.floor(contractsRaw));

      console.log(`[RealTrader] ⚡ İşlem Tetiklendi: ${ccxtSymbol} | Yön: ${orderSide.toUpperCase()} | Kontrat: ${contracts}`);

      // GÜVENLİK: Önce kaldıracı ve marjin modunu ayarla
      try {
        await this.exchange.setMarginMode('isolated', ccxtSymbol);
        await this.exchange.setLeverage(this.leverage, ccxtSymbol);
      } catch (e) {
        console.log(`[RealTrader] Kaldıraç ayarlanırken uyarı: ${e.message}`);
      }

      // GERÇEK EMRİ PİYASAYA GÖNDER
      const order = await this.exchange.createMarketOrder(ccxtSymbol, orderSide, contracts);
      const tradeId = `REAL_${ccxtSymbol}_${Date.now()}`;
      const entryPrice = order.average || currentPrice;

      // SL/TP Fiyatlarını Hesapla
      const slRatio = 0.02; // %2 zarar
      const tpRatio = 0.04; // %4 kâr
      const slPrice = orderSide === 'buy'
        ? entryPrice * (1 - slRatio)
        : entryPrice * (1 + slRatio);
      const tpPrice = orderSide === 'buy'
        ? entryPrice * (1 + tpRatio)
        : entryPrice * (1 - tpRatio);

      // =====================================================
      // 🛡️ NATIVE SL/TP: MEXC'E BORSADA KAYDEDİYORUZ
      // MARK PRICE kullanır → İğne (wick) geçirmez!
      // Render çökse bile MEXC pozisyonu kendi kapatır.
      // =====================================================
      let slOrderId = null;
      let tpOrderId = null;
      let nativeSLTPActive = false;

      try {
        // Native Stop Loss (MARK_PRICE ile - wick korumalı)
        const slOrder = await this.exchange.createOrder(
          ccxtSymbol,
          'STOP_MARKET',
          closeSide,
          contracts,
          undefined,
          {
            stopPrice: parseFloat(slPrice.toFixed(market.precision?.price || 4)),
            reduceOnly: true,
            workingType: 'MARK_PRICE'
          }
        );
        slOrderId = slOrder.id;
        console.log(`[RealTrader] 🛡️ Native SL yerleştirildi: $${slPrice.toFixed(4)} (Mark Price)`);

        // Native Take Profit (MARK_PRICE ile - wick korumalı)
        const tpOrder = await this.exchange.createOrder(
          ccxtSymbol,
          'TAKE_PROFIT_MARKET',
          closeSide,
          contracts,
          undefined,
          {
            stopPrice: parseFloat(tpPrice.toFixed(market.precision?.price || 4)),
            reduceOnly: true,
            workingType: 'MARK_PRICE'
          }
        );
        tpOrderId = tpOrder.id;
        console.log(`[RealTrader] 🛡️ Native TP yerleştirildi: $${tpPrice.toFixed(4)} (Mark Price)`);
        nativeSLTPActive = true;
      } catch (e) {
        console.warn(`[RealTrader] ⚠️ Native SL/TP yerleştirilemedi (fallback fiyat polling'e): ${e.message}`);
        nativeSLTPActive = false;
      }

      // Trade nesnesini kaydet
      this.activeTrades.set(tradeId, {
        symbol: ccxtSymbol,
        side: orderSide,
        entryPrice: entryPrice,
        amount: order.filled || contracts,
        slPrice,
        tpPrice,
        slOrderId,
        tpOrderId,
        nativeSLTPActive,
        orderId: order.id,
        timestamp: Date.now(),
        monitorInterval: null,
        isClosing: false
      });

      // Telegram Bildirimi
      const nativeTag = nativeSLTPActive
        ? '\n🛡️ <b>Native SL/TP AKTİF</b> (Mark Price, Wick Korumalı)'
        : '\n⚠️ <b>Fallback Polling Modu</b> (Native SL/TP başarısız)';
      const msg = `
🟢 <b>GERÇEK İŞLEM AÇILDI (TEST)</b> 🟢
=====================
🪙 <b>${ccxtSymbol}</b>
🎯 Yön: <b>${orderSide.toUpperCase()}</b>
💰 Büyüklük: <b>$${this.tradeAmountUsd} USD</b> (Teminat: ~$5)
💵 Giriş Fiyatı: <code>$${entryPrice.toFixed(4)}</code>
🛑 SL: <code>$${slPrice.toFixed(4)}</code> | 🟢 TP: <code>$${tpPrice.toFixed(4)}</code>${nativeTag}
=====================
🤖 <i>RealTrader Engine v2</i>
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, msg);

      // =====================================================
      // POZİSYON TAKİP DÖNGÜSÜ
      // Native SL/TP aktifse: MEXC'teki pozisyonu izle
      // Fallback modundaysa: Fiyatı izle (eski yöntem)
      // =====================================================
      const monitorInterval = setInterval(async () => {
        if (!this.activeTrades.has(tradeId)) {
          clearInterval(monitorInterval);
          return;
        }
        try {
          const trade = this.activeTrades.get(tradeId);

          if (trade.nativeSLTPActive) {
            // Native mod: MEXC'teki pozisyonu kontrol et
            const positions = await this.exchange.fetchPositions([trade.symbol]);
            const openPos = positions.find(p =>
              p.symbol === trade.symbol && Math.abs(p.contracts || 0) > 0
            );
            if (!openPos) {
              // Pozisyon MEXC tarafından kapatıldı (SL veya TP vurdu)
              console.log(`[RealTrader] ✅ Pozisyon MEXC tarafından kapatıldı: ${trade.symbol}`);
              clearInterval(monitorInterval);
              await this.handleNativeClose(tradeId);
            }
          } else {
            // Fallback mod: Fiyatı izle (wick'e açık ama native çalışmadı)
            const ticker = await this.exchange.fetchTicker(trade.symbol);
            const currentPx = ticker.last;
            let hitLimit = false;
            if (trade.side === 'buy') {
              if (currentPx >= trade.tpPrice || currentPx <= trade.slPrice) hitLimit = true;
            } else {
              if (currentPx <= trade.tpPrice || currentPx >= trade.slPrice) hitLimit = true;
            }
            if (hitLimit) {
              console.log(`[RealTrader] 🛑 SL/TP (Fallback) Tetiklendi: ${trade.symbol} at ${currentPx}`);
              clearInterval(monitorInterval);
              this.closeTrade(tradeId);
            }
          }
        } catch (e) {
          // Geçici API hatası, devam et
        }
      }, 5000);

      // Klima referansını kaydet
      const tradeRef = this.activeTrades.get(tradeId);
      if (tradeRef) tradeRef.monitorInterval = monitorInterval;

    } catch (error) {
      console.error(`❌ [RealTrader] Emir gönderilirken HATA:`, error.message);
      await this.telegram.sendMessage(this.adminChatId, `❌ <b>RealTrader Hata:</b> ${error.message}`);
    }
  }

  // Native SL/TP tarafından kapatılan pozisyonları işle
  async handleNativeClose(tradeId) {
    if (!this.activeTrades.has(tradeId)) return;
    const trade = this.activeTrades.get(tradeId);
    if (trade.isClosing) return;
    trade.isClosing = true;

    try {
      // Kalan SL veya TP emirlerini iptal et (sadece biri tetiklendi)
      for (const orderId of [trade.slOrderId, trade.tpOrderId]) {
        if (orderId) {
          try {
            await this.exchange.cancelOrder(orderId, trade.symbol);
          } catch (e) {
            // Zaten dolmuş olabilir, yoksay
          }
        }
      }

      // Son işlemlerden çıkış fiyatını bul
      let exitPrice = trade.entryPrice; // fallback
      try {
        const myTrades = await this.exchange.fetchMyTrades(trade.symbol, trade.timestamp - 1000, 10);
        const closingTrades = myTrades.filter(t =>
          t.side === (trade.side === 'buy' ? 'sell' : 'buy') &&
          t.timestamp > trade.timestamp
        );
        if (closingTrades.length > 0) {
          exitPrice = closingTrades[closingTrades.length - 1].price;
        }
      } catch (e) {
        console.warn(`[RealTrader] Çıkış fiyatı alınamadı, giriş fiyatı kullanılıyor.`);
      }

      // PnL Hesapla
      let pnlPercentage = 0;
      if (trade.side === 'buy') {
        pnlPercentage = (exitPrice - trade.entryPrice) / trade.entryPrice;
      } else {
        pnlPercentage = (trade.entryPrice - exitPrice) / trade.entryPrice;
      }
      const leveragedPnlPercentage = pnlPercentage * this.leverage;
      const pnlUsd = (this.tradeAmountUsd / this.leverage) * leveragedPnlPercentage;

      this.totalPnl += pnlUsd;
      if (pnlUsd > 0) this.winCount++;
      else this.lossCount++;

      this.saveState();
      this.activeTrades.delete(tradeId);

      const pnlEmoji = pnlUsd >= 0 ? '🟢 GERÇEK KÂR' : '🔴 GERÇEK ZARAR';
      const msg = `
${pnlEmoji} (MEXC Native SL/TP)
=====================
🪙 <b>${trade.symbol}</b>
🎯 Yön: <b>${trade.side.toUpperCase()}</b>
💵 Çıkış Fiyatı: <code>$${exitPrice.toFixed(4)}</code>
💵 Net PnL: <b>$${pnlUsd.toFixed(2)} USD</b>
📈 Kâr Oranı (10x): <b>%${(leveragedPnlPercentage * 100).toFixed(2)}</b>
💰 Toplam Net PnL: <b>$${this.totalPnl.toFixed(2)}</b>
🛡️ <i>Wick korumalı Mark Price ile kapatıldı</i>
=====================
🤖 <i>RealTrader Engine v2</i>
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, msg);
    } catch (error) {
      trade.isClosing = false;
      console.error(`❌ [RealTrader] handleNativeClose Hatası:`, error.message);
    }
  }

  // Manuel/Timeout kapatma (fallback veya 5dk süresi dolunca)
  async closeTrade(tradeId) {
    if (!this.activeTrades.has(tradeId)) return;
    const trade = this.activeTrades.get(tradeId);
    if (trade.isClosing) return;
    trade.isClosing = true;

    // Önce native emirleri iptal et
    for (const orderId of [trade.slOrderId, trade.tpOrderId]) {
      if (orderId) {
        try { await this.exchange.cancelOrder(orderId, trade.symbol); } catch (e) {}
      }
    }

    try {
      const closeSide = trade.side === 'buy' ? 'sell' : 'buy';
      console.log(`[RealTrader] 🔨 İşlem Kapatılıyor (Manuel/Timeout): ${trade.symbol}`);

      let closeOrder = null;
      let attempts = 0;
      const maxAttempts = 15;

      while (attempts < maxAttempts && !closeOrder) {
        try {
          attempts++;
          closeOrder = await this.exchange.createMarketOrder(trade.symbol, closeSide, trade.amount);
        } catch (err) {
          console.error(`[RealTrader] Kapatma Hatası (${attempts}/${maxAttempts}): ${trade.symbol} - ${err.message}`);
          if (attempts >= maxAttempts) {
            await this.telegram.sendMessage(this.adminChatId, `🚨 <b>KRİTİK HATA!</b>\n${trade.symbol} işlemi ${maxAttempts} denemeye rağmen KAPATILAMADI! Lütfen MEXC'ten MANUEL kapatın!`);
            trade.isClosing = false;
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const exitPrice = closeOrder.average || (await this.exchange.fetchTicker(trade.symbol)).last;

      let pnlPercentage = 0;
      if (trade.side === 'buy') {
        pnlPercentage = (exitPrice - trade.entryPrice) / trade.entryPrice;
      } else {
        pnlPercentage = (trade.entryPrice - exitPrice) / trade.entryPrice;
      }
      const leveragedPnlPercentage = pnlPercentage * this.leverage;
      const pnlUsd = (this.tradeAmountUsd / this.leverage) * leveragedPnlPercentage;

      this.totalPnl += pnlUsd;
      if (pnlUsd > 0) this.winCount++;
      else this.lossCount++;

      this.saveState();
      this.activeTrades.delete(tradeId);

      const pnlEmoji = pnlUsd >= 0 ? '🟢 GERÇEK KÂR' : '🔴 GERÇEK ZARAR';
      const msg = `
${pnlEmoji} (Manuel/Timeout Kapatma)
=====================
🪙 <b>${trade.symbol}</b>
🎯 Yön: <b>${trade.side.toUpperCase()}</b>
💵 Çıkış Fiyatı: <code>$${exitPrice.toFixed(4)}</code>
💵 Net PnL: <b>$${pnlUsd.toFixed(2)} USD</b>
📈 Kâr Oranı (10x): <b>%${(leveragedPnlPercentage * 100).toFixed(2)}</b>
💰 Toplam Net PnL: <b>$${this.totalPnl.toFixed(2)}</b>
=====================
🤖 <i>RealTrader Engine v2</i>
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, msg);

    } catch (error) {
      trade.isClosing = false;
      console.error(`❌ [RealTrader] Kapatma Döngüsü Hatası:`, error.message);
      await this.telegram.sendMessage(this.adminChatId, `❌ <b>RealTrader Kapatma Hatası:</b> ${trade.symbol} - ${error.message}`);
    }
  }
}

module.exports = RealTrader;
