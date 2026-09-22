const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');

class RealTrader {
  constructor(telegramManager, adminChatId) {
    this.telegram = telegramManager;
    this.adminChatId = adminChatId;
    
    // RİSK YÖNETİMİ - 50 DOLARLIK TEST
    this.tradeAmountUsd = 50; // Sadece 50$ büyüklüğünde pozisyon açar (10x kaldıraçta sadece 5$ teminat kullanır!)
    this.leverage = 10;
    
    this.activeTrades = new Map();
    this.dbPath = path.join(__dirname, '../../real_state.json');

    // Default Stats
    this.totalPnl = 0;
    this.winCount = 0;
    this.lossCount = 0;

    this.loadState();

    // MEXC API Bağlantısı
    const apiKey = process.env.MEXC_API_KEY;
    const secret = process.env.MEXC_API_SECRET;

    if (apiKey && secret) {
      this.exchange = new ccxt.mexc({
        apiKey: apiKey,
        secret: secret,
        enableRateLimit: true,
        options: {
          defaultType: 'swap' // Vadeli işlemler (Futures) için swap seçilmeli
        }
      });
      console.log('✅ [RealTrader] MEXC API Anahtarları yüklendi. GERÇEK İŞLEM MOTORU AKTİF.');
    } else {
      console.warn('⚠️ [RealTrader] MEXC API anahtarları bulunamadı. Gerçek işlemler kapalı.');
      this.exchange = null;
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const data = JSON.parse(raw);
        this.totalPnl = data.totalPnl ?? 0;
        this.winCount = data.winCount ?? 0;
        this.lossCount = data.lossCount ?? 0;
      }
    } catch (e) {
      console.error('❌ [RealTrader] loadState hatası:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify({
        totalPnl: this.totalPnl,
        winCount: this.winCount,
        lossCount: this.lossCount
      }, null, 2));
    } catch (e) {
      console.error('❌ [RealTrader] saveState hatası:', e.message);
    }
  }

  async executeTrade(cascadeData) {
    if (!this.exchange) return;

    try {
      const { symbol, side, avgPrice } = cascadeData;
      // Shadow bot mantığı: Long'lar patlıyorsa piyasa düşüyordur -> Biz LONG (Buy) açarız.
      const isLongSqueeze = side === 'SELL';
      const orderSide = isLongSqueeze ? 'buy' : 'sell';

      // Coin'in anlık fiyatını alalım
      const ticker = await this.exchange.fetchTicker(symbol);
      const currentPrice = ticker.last;

      // 50$ lık pozisyon için kaç adet coin almamız gerekiyor?
      const amount = this.tradeAmountUsd / currentPrice;

      console.log(`[RealTrader] ⚡ İşlem Tetiklendi: ${symbol} | Yön: ${orderSide.toUpperCase()} | Adet: ${amount}`);

      // GÜVENLİK: Önce kaldıracı 10x olarak ayarla (MEXC destekliyorsa)
      try {
        await this.exchange.setMarginMode('isolated', symbol);
        await this.exchange.setLeverage(this.leverage, symbol);
      } catch (e) {
        console.log(`[RealTrader] Kaldıraç ayarlanırken uyarı (Borsa otomatik yönetiyor olabilir): ${e.message}`);
      }

      // GERÇEK EMRİ PİYASAYA GÖNDER (Market Order)
      const order = await this.exchange.createMarketOrder(symbol, orderSide, amount);
      
      const tradeId = `REAL_${symbol}_${Date.now()}`;
      
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
        symbol,
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
