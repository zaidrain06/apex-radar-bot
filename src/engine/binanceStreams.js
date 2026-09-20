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
    const windowMs = config.binance.cascadeWindowMs || 15000; // 15 seconds
    const minCascadeUsd = 100000; // Total cascade volume must be > $100k
    
    // Initialize state if missing
    if (!this.cascadeWindows.has(symbol)) {
      this.cascadeWindows.set(symbol, { events: [], lastCascadeTime: 0 });
    }

    const state = this.cascadeWindows.get(symbol);
    const now = timestamp || Date.now();

    // 60-second Cooldown: Do not alert multiple cascades for the same coin in a single drop
    if (now - state.lastCascadeTime < 60000) {
      return;
    }

    // Remove expired events outside the 15-second window
    state.events = state.events.filter(e => (now - e.timestamp) <= windowMs);
    state.events.push({ side, price, usdValue, timestamp: now });

    // Filter events by the same side (Long squeeze or Short squeeze)
    const sameSideEvents = state.events.filter(e => e.side === side);
    
    // Core Aggressive Squeeze Logic: 
    // Minimum 5 liquidations AND Total cumulative volume over $100k
    if (sameSideEvents.length >= 5) {
      const totalUsd = sameSideEvents.reduce((acc, e) => acc + e.usdValue, 0);
      
      if (totalUsd >= minCascadeUsd) {
        // Trigger condition met!
        const avgPrice = sameSideEvents.reduce((acc, e) => acc + e.price, 0) / sameSideEvents.length;

        // Set Cooldown
        state.lastCascadeTime = now;
        this.cascadeWindows.set(symbol, state);

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
    } else {
      this.cascadeWindows.set(symbol, state);
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
