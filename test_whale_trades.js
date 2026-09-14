const WebSocket = require('ws');

console.log('🚀 Connecting to Binance Futures AggTrade Stream...');
const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@aggTrade/ethusdt@aggTrade/solusdt@aggTrade');

let captured = 0;

ws.on('open', () => {
  console.log('✅ Connected! Listening for large trades (> $10,000 USD)...');
});

ws.on('message', (data) => {
  try {
    const trade = JSON.parse(data);
    const symbol = trade.s;
    const price = parseFloat(trade.p);
    const qty = parseFloat(trade.q);
    const usd = price * qty;
    const isBuyerMaker = trade.m; // true = Sell order filled market buyer; false = Market Buy

    if (usd >= 10000) {
      captured++;
      const side = isBuyerMaker ? '🔴 MARKET SELL' : '🟢 MARKET BUY';
      console.log(`\n🐋 [WHALE TRADE #${captured}] ${symbol} | ${side}`);
      console.log(`   Size: $${Math.round(usd).toLocaleString()} USD | Price: $${price.toLocaleString()} | Qty: ${qty}`);

      if (captured >= 3) {
        console.log('\n🎉 Captured 3 live whale trades! Proof of real-time market stream complete.');
        ws.close();
        process.exit(0);
      }
    }
  } catch(e) {}
});

setTimeout(() => {
  console.log('Timeout. Exiting.');
  ws.close();
  process.exit(0);
}, 20000);
