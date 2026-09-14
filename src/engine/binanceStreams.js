const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../config');

class BinanceStreamEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.minUsd = options.minUsd || config.binance.minLiquidationUsd;
    this.megaUsd = options.megaUsd || config.binance.megaLiquidationUsd;
    this.ws = null;
    this.reconnectTimeout = null;
    this.cascadeWindows = new Map(); // symbol -> [events]
    this.isConnected = false;
    this.stats = {
      connectedAt: null,
      totalEventsReceived: 0,
      signalsEmitted: 0,
      cascadesEmitted: 0
    };
  }

  start() {
    this.connect();
  }

  connect() {
    const url = `${config.binance.wsBaseUrl}${config.binance.liquidationStream}`;
    console.log(`[BinanceEngine] Connecting to ${url}...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.isConnected = true;
      this.stats.connectedAt = new Date().toISOString();
      console.log('✅ [BinanceEngine] WebSocket connection established successfully.');
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      console.warn(`⚠️ [BinanceEngine] Disconnected (code: ${code}). Reconnecting in 3s...`);
      this.emit('disconnected');
      this.scheduleReconnect(3000);
    });

    this.ws.on('error', (err) => {
      console.error('❌ [BinanceEngine] WebSocket Error:', err.message);
      this.ws.close();
    });
  }

  scheduleReconnect(delayMs) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  handleMessage(data) {
    try {
      const parsed = JSON.parse(data);
      const order = parsed.o;
      if (!order) return;

      this.stats.totalEventsReceived++;

      const symbol = order.s;
      const side = order.S; // SELL = Long liquidated, BUY = Short liquidated
      const price = parseFloat(order.p);
      const qty = parseFloat(order.q);
      const usdValue = price * qty;
      const timestamp = order.T || Date.now();

      // Check Cascade Window
      this.trackCascade(symbol, side, price, usdValue, timestamp);

      // Filter by Minimum USD threshold
      if (usdValue >= this.minUsd) {
        const isMega = usdValue >= this.megaUsd;
        this.stats.signalsEmitted++;

        const signalData = {
          symbol,
          side,
          price,
          qty,
          usdValue,
          isMega,
          timestamp
        };

        this.emit('liquidation', signalData);
      }
    } catch (err) {
      console.error('[BinanceEngine] Parse error:', err.message);
    }
  }

  trackCascade(symbol, side, price, usdValue, timestamp) {
    const windowMs = config.binance.cascadeWindowMs;
    const thresholdCount = config.binance.cascadeCountThreshold;

    if (!this.cascadeWindows.has(symbol)) {
      this.cascadeWindows.set(symbol, []);
    }

    const events = this.cascadeWindows.get(symbol);
    const now = timestamp || Date.now();

    // Remove expired events outside the window
    const activeEvents = events.filter(e => (now - e.timestamp) <= windowMs);
    activeEvents.push({ side, price, usdValue, timestamp: now });
    this.cascadeWindows.set(symbol, activeEvents);

    // If threshold met on same side (all long or all short cascade)
    const sameSideEvents = activeEvents.filter(e => e.side === side);
    if (sameSideEvents.length === thresholdCount) {
      // Trigger cascade once per burst
      const totalUsd = sameSideEvents.reduce((acc, e) => acc + e.usdValue, 0);
      const avgPrice = sameSideEvents.reduce((acc, e) => acc + e.price, 0) / sameSideEvents.length;

      this.stats.cascadesEmitted++;
      this.emit('cascade', {
        symbol,
        count: sameSideEvents.length,
        side,
        totalUsd,
        avgPrice,
        timestamp: now
      });
    }
  }

  stop() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
    this.isConnected = false;
  }
}

module.exports = BinanceStreamEngine;
