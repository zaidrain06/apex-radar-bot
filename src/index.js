const http = require('http');
const config = require('./config');
const BinanceStreamEngine = require('./engine/binanceStreams');
const TelegramManager = require('./bot/telegramManager');
const WhopGate = require('./whop/whopGate');
const PaperTrader = require('./engine/paperTrader');
const { formatLiquidationSignal, formatCascadeSignal, formatFreeSignal } = require('./formatters/signalFormatter');

console.log('====================================================');
console.log('⚡ APEXRADAR: CRYPTO WHALE & LIQUIDATION BOT        ');
console.log('💰 Recurring Revenue Engine (VNT-003)              ');
console.log('====================================================');

// 1. Initialize Subsystems
const binanceEngine = new BinanceStreamEngine();
const telegram = new TelegramManager();
const whopGate = new WhopGate();
const paperTrader = new PaperTrader(telegram, process.env.TELEGRAM_ADMIN_CHAT_ID || '1339587201');

telegram.init(whopGate);

// 2. Wire Up Events: Liquidation Signals → VIP ONLY (Standard >25k & Mega >150k)
binanceEngine.on('liquidation', async (signalData) => {
  const vipMsg = formatLiquidationSignal(signalData);
  await telegram.sendAlert(vipMsg);
});

// 3. Wire Up Events: Cascade Alerts → VIP & Free Channel
binanceEngine.on('cascade', async (cascadeData) => {
  const formattedMsg = formatCascadeSignal(cascadeData);
  await telegram.sendAlert(formattedMsg);

  // Send marketing tease to Free Channel
  const freeMsg = formatFreeSignal(cascadeData);
  await telegram.sendFreeAlert(freeMsg);

  // Silently trigger the shadow bot for Admin only
  paperTrader.executeTrade(cascadeData);
});

// Handle Admin Shadow Requests
telegram.on('admin_shadow_request', async (chatId) => {
  await paperTrader.sendStats(chatId);
});

// 4. Start WebSocket Listener
binanceEngine.start();

// 5. Lightweight HTTP Server (Healthcheck & Whop Webhooks)
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    const isBrowser = (req.headers.accept || '').includes('text/html');
    if (isBrowser && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>ApexRadar Cloud Terminal</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #0b0e14; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .card { background: #151922; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
            .badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 14px; margin-bottom: 20px; }
            .dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; animation: pulse 2s infinite; }
            h1 { margin: 0 0 10px; font-size: 24px; color: #fff; }
            p { margin: 0 0 24px; color: #94a3b8; font-size: 14px; line-height: 1.6; }
            .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
            .metric-label { color: #64748b; }
            .metric-val { color: #38bdf8; font-weight: 600; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge"><div class="dot"></div> SYSTEMS LIVE 7/24</div>
            <h1>ApexRadar Intelligence</h1>
            <p>Real-time institutional Binance Futures liquidation radar and whale order flow streaming engine.</p>
            <div class="metric"><span class="metric-label">WebSocket Status</span><span class="metric-val" style="color:#10b981;">CONNECTED</span></div>
            <div class="metric"><span class="metric-label">Engine Feed</span><span class="metric-val">Binance Futures (!forceOrder)</span></div>
            <div class="metric"><span class="metric-label">Min Alert Filter</span><span class="metric-val">$${config.binance.minLiquidationUsd.toLocaleString()} USD</span></div>
            <div class="metric"><span class="metric-label">Uptime</span><span class="metric-val">${Math.round(process.uptime())}s</span></div>
          </div>
        </body>
        </html>
      `);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'UP',
      service: 'ApexRadar Crypto Intelligence',
      version: '1.2.0-ffb49a4',
      targetChannelId: config.telegram.channelId,
      wsConnected: binanceEngine.isConnected,
      stats: binanceEngine.stats,
      uptimeSec: Math.round(process.uptime())
    }, null, 2));
  }

  if (req.method === 'POST' && req.url === '/webhooks/whop') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const sig = req.headers['x-whop-signature'];
      if (!whopGate.verifyWebhook(body, sig)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid signature' }));
      }

      try {
        const event = JSON.parse(body);
        const result = whopGate.handleEvent(event);
        
        // KICK LOGIC
        if (result.status === 'revoked_kick' && result.telegramId) {
           await telegram.kickMember(result.telegramId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Malformed payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = config.server.port;
server.listen(PORT, () => {
  console.log(`🌐 [ApexRadar Server] Listening for healthchecks & webhooks on port ${PORT}`);
  console.log(`📡 Stream: Monitoring Binance Futures Liquidation Order Flow`);
  console.log(`💵 Min Alert: $${config.binance.minLiquidationUsd.toLocaleString()} USD | Mega: $${config.binance.megaLiquidationUsd.toLocaleString()} USD`);
  console.log('====================================================\n');
});
