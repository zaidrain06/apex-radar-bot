const { formatLiquidationSignal, formatCascadeSignal } = require('./src/formatters/signalFormatter');
const TelegramManager = require('./src/bot/telegramManager');

console.log('🧪 RUNNING APEXRADAR SIGNAL SIMULATION & VERIFICATION...\n');

const telegram = new TelegramManager();
telegram.init();

// Simulated Real-World Scenarios
const testSignals = [
  {
    type: 'single',
    data: {
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: 76420.50,
      qty: 1.85,
      usdValue: 141377.92,
      isMega: false,
      timestamp: Date.now()
    }
  },
  {
    type: 'mega',
    data: {
      symbol: 'ETHUSDT',
      side: 'BUY',
      price: 2980.20,
      qty: 120.5,
      usdValue: 359114.10,
      isMega: true,
      timestamp: Date.now()
    }
  },
  {
    type: 'cascade',
    data: {
      symbol: 'SOLUSDT',
      count: 4,
      side: 'SELL',
      totalUsd: 185420.00,
      avgPrice: 154.30,
      timestamp: Date.now()
    }
  }
];

async function runTest() {
  for (const item of testSignals) {
    let msg = '';
    if (item.type === 'cascade') {
      msg = formatCascadeSignal(item.data);
    } else {
      msg = formatLiquidationSignal(item.data);
    }

    await telegram.sendAlert(msg);
    await new Promise(r => setTimeout(r, 600));
  }

  console.log('✅ ALL SIMULATED SIGNALS FORMATTED & DISPATCHED CLEANLY!');
}

runTest();
