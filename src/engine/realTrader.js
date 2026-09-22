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
      if (Object.keys(this.exchange.markets).length === 0) {
        await this.exchange.loadMarkets();
      }
      const market = this.exchange.markets[ccxtSymbol];
      if (!market) {
        console.warn(`[RealTrader] ${ccxtSymbol} için market verisi bulunamadı!`);
        return;
      }

      // Shadow bot mantığı
      const isLongSqueeze = side === 'SELL';
      const orderSide = isLongSqueeze ? 'buy' : 'sell';

      // Coin'in anlık fiyatını alalım
      const ticker = await this.exchange.fetchTicker(ccxtSymbol);
      const currentPrice = ticker.last;

      // 50$ lık pozisyon için kaç adet coin almamız gerekiyor?
      const coinAmount = this.tradeAmountUsd / currentPrice;
      
      // MEXC Futures'da miktar KOİN değil KONTRAT olarak girilir.
      const contractSize = market.contractSize || 1;
      const contractsRaw = coinAmount / contractSize;
      // Küsuratlı kontrat alınamaz (precision=1), aşağı yuvarla, minimum 1 olsun.
      const contracts = Math.max(1, Math.floor(contractsRaw));

      console.log(`[RealTrader] ⚡ İşlem Tetiklendi: ${ccxtSymbol} | Yön: ${orderSide.toUpperCase()} | Coin Miktarı: ${coinAmount.toFixed(4)} | Kontrat: ${contracts}`);

      // GÜVENLİK: Önce kaldıracı 10x olarak ayarla
      try {
        await this.exchange.setMarginMode('isolated', ccxtSymbol);
        await this.exchange.setLeverage(this.leverage, ccxtSymbol);
      } catch (e) {
        console.log(`[RealTrader] Kaldıraç ayarlanırken uyarı: ${e.message}`);
      }

      // GERÇEK EMRİ PİYASAYA GÖNDER (Kontrat sayısı ile)
      const order = await this.exchange.createMarketOrder(ccxtSymbol, orderSide, contracts);
      
      const tradeId = `REAL_${ccxtSymbol}_${Date.now()}`;
      
      // Stop Loss ve Take Profit seviyeleri (Basit %2 Stop, %4 Kar)
      const entryPrice = order.average || currentPrice;
      const stopLossRatio = 0.02; // %2 zarar
      const takeProfitRatio = 0.04; // %4 kâr
      
      let slPrice, tpPrice;
      if (orderSide === 'buy') {
        slPrice = entryPrice * (1 - stopLossRatio);
        tpPrice = entryPrice * (1 + takeProfitRatio);
      } else {
        slPrice = entryPrice * (1 + stopLossRatio);
        tpPrice = entryPrice * (1 - takeProfitRatio);
      }

      this.activeTrades.set(tradeId, {
        symbol: ccxtSymbol,
        side: orderSide,
        entryPrice: entryPrice,
        amount: order.filled || amount,
        slPrice,
        tpPrice,
        orderId: order.id,
        timestamp: Date.now()
      });

      // Telegrama gerçek işleme girildiğini bildir
      const msg = `
⚠️ <b>GERÇEK İŞLEM AÇILDI (TEST)</b> ⚠️
━━━━━━━━━━━━━━━━━━━━━
🪙 <b>${symbol}</b>
⚡ Yön: <b>${orderSide.toUpperCase()}</b>
💰 Büyüklük: <b>$${this.tradeAmountUsd} USD</b> (Teminat: ~$5)
💲 Giriş Fiyatı: <code>$${entryPrice.toFixed(4)}</code>
🛑 SL: <code>$${slPrice.toFixed(4)}</code> | 🎯 TP: <code>$${tpPrice.toFixed(4)}</code>
━━━━━━━━━━━━━━━━━━━━━
🛰 <i>RealTrader Engine v1</i>
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, msg);

      // Bot 3 dakika sonra açık işlemi ne olursa olsun kapatacak (Acil Çıkış Koruması)
      setTimeout(() => this.closeTrade(tradeId), 3 * 60 * 1000);

    } catch (error) {
      console.error(`❌ [RealTrader] Emir gönderilirken HATA:`, error.message);
      await this.telegram.sendMessage(this.adminChatId, `❌ <b>RealTrader Hata:</b> ${error.message}`);
    }
  }

  async closeTrade(tradeId) {
    if (!this.activeTrades.has(tradeId)) return;
    const trade = this.activeTrades.get(tradeId);
    
    try {
      const closeSide = trade.side === 'buy' ? 'sell' : 'buy';
      console.log(`[RealTrader] 🔒 İşlem Kapatılıyor: ${trade.symbol}`);
      
      // Pozisyonu kapat
      const closeOrder = await this.exchange.createMarketOrder(trade.symbol, closeSide, trade.amount);
      const exitPrice = closeOrder.average || (await this.exchange.fetchTicker(trade.symbol)).last;
      
      // PnL Hesapla
      let pnlPercentage = 0;
      if (trade.side === 'buy') {
        pnlPercentage = (exitPrice - trade.entryPrice) / trade.entryPrice;
      } else {
        pnlPercentage = (trade.entryPrice - exitPrice) / trade.entryPrice;
      }

      const leveragedPnlPercentage = pnlPercentage * this.leverage;
      const pnlUsd = (this.tradeAmountUsd / this.leverage) * leveragedPnlPercentage; // Sadece teminat üzerinden kâr/zarar

      this.totalPnl += pnlUsd;
      if (pnlUsd > 0) this.winCount++;
      else this.lossCount++;

      this.saveState();
      this.activeTrades.delete(tradeId);

      const pnlEmoji = pnlUsd >= 0 ? '✅ GERÇEK KÂR' : '❌ GERÇEK ZARAR';
      
      const msg = `
${pnlEmoji}
━━━━━━━━━━━━━━━━━━━━━
🪙 <b>${trade.symbol}</b>
⚡ Yön: <b>${trade.side.toUpperCase()}</b>
💲 Çıkış Fiyatı: <code>$${exitPrice.toFixed(4)}</code>
💵 Net PnL: <b>$${pnlUsd.toFixed(2)} USD</b>
📈 Kâr Oranı (10x): <b>%${(leveragedPnlPercentage * 100).toFixed(2)}</b>
🏦 Toplam Net PnL: <b>$${this.totalPnl.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━
🛰 <i>RealTrader Engine v1</i>
      `.trim();

      await this.telegram.sendMessage(this.adminChatId, msg);

    } catch (error) {
      console.error(`❌ [RealTrader] Kapatma Hatası:`, error.message);
      await this.telegram.sendMessage(this.adminChatId, `❌ <b>RealTrader Kapatma Hatası:</b> ${trade.symbol} - ${error.message}`);
    }
  }
}

module.exports = RealTrader;
