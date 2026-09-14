const http = require('http');
const config = require('./config');
const BinanceStreamEngine = require('./engine/binanceStreams');
const TelegramManager = require('./bot/telegramManager');
const WhopGate = require('./whop/whopGate');
const { formatLiquidationSignal, formatCascadeSignal } = require('./formatters/signalFormatter');

console.log('====================================================');
console.log('⚡ APEXRADAR: CRYPTO WHALE & LIQUIDATION BOT        ');
console.log('💰 Recurring Revenue Engine (VNT-003)              ');
console.log('====================================================');

// 1. Initialize Subsystems
const binanceEngine = new BinanceStreamEngine();
const telegram = new TelegramManager();
const whopGate = new WhopGate();

telegram.init();

// 2. Wire Up Events: Liquidation Signals -> Telegram Broadcast
binanceEngine.on('liquidation', async (signalData) => {
  const formattedMsg = formatLiquidationSignal(signalData);
  await telegram.sendAlert(formattedMsg);
});

// 3. Wire Up Events: Cascade Alerts -> Telegram Broadcast
binanceEngine.on('cascade', async (cascadeData) => {
  const formattedMsg = formatCascadeSignal(cascadeData);
  await telegram.sendAlert(formattedMsg);
});

// 4. Start WebSocket Listener
binanceEngine.start();

// 5. Lightweight HTTP Server (Healthcheck & Whop Webhooks)
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'UP',
      service: 'ApexRadar Crypto Intelligence',
      wsConnected: binanceEngine.isConnected,
      stats: binanceEngine.stats,
      uptimeSec: Math.round(process.uptime())
    }));
  }

  if (req.method === 'POST' && req.url === '/webhooks/whop') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const sig = req.headers['x-whop-signature'];
      if (!whopGate.verifyWebhook(body, sig)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid signature' }));
      }

      try {
        const event = JSON.parse(body);
        const result = whopGate.handleEvent(event);
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
