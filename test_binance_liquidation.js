const WebSocket = require('ws');

console.log('🚀 Connecting to Binance Futures Liquidation Stream (wss://fstream.binance.com/ws/!forceOrder@arr)...');

const ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');

let count = 0;

ws.on('open', () => {
  console.log('✅ Connected to Binance Futures! Listening for real-time liquidations...');
});

ws.on('message', (data) => {
  try {
    const parsed = JSON.parse(data);
    const order = parsed.o;
    if (!order) return;

    const symbol = order.s;
    const side = order.S; // SELL = Long liquidated, BUY = Short liquidated
    const price = parseFloat(order.p);
    const qty = parseFloat(order.q);
    const usdValue = price * qty;

    count++;
    console.log(`\n💥 [LIQUIDATION #${count}] ${symbol}`);
    console.log(`   Type: ${side === 'SELL' ? '🔴 LONG LIQUIDATED' : '🟢 SHORT LIQUIDATED'}`);
    console.log(`   Price: $${price.toLocaleString()} | Qty: ${qty} | Total USD: $${Math.round(usdValue).toLocaleString()}`);

    if (count >= 3) {
      console.log('\n🎉 Successfully captured 3 live liquidations from Binance Futures! Closing test connection.');
      ws.close();
      process.exit(0);
    }
  } catch (err) {
    console.error('Error parsing event:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('Timeout reached (market might be quiet right now). Closing.');
  ws.close();
  process.exit(0);
}, 30000);
