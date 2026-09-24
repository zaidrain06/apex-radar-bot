const mongoose = require('mongoose');

const MLDatasetSchema = new mongoose.Schema({
  tradeId: { type: String, required: true, unique: true },
  botType: { type: String, required: true, enum: ['PAPER', 'REAL'] },
  symbol: { type: String, required: true },
  side: { type: String, required: true, enum: ['BUY', 'SELL', 'buy', 'sell'] },
  
  // Yapay Zeka Feature'ları (Giriş Anı)
  btcChange5m: { type: Number, required: true }, // Örn: -0.005 (%0.5 düşüş)
  entryPrice: { type: Number, required: true },
  
  // Çıkış Verileri (Etiketler / Labels)
  exitPrice: { type: Number, required: true },
  tradeDurationMs: { type: Number, required: true }, // Ne kadar sürdü?
  closeReason: { type: String, required: true }, // 'TP', 'SL', 'TIMEOUT', 'UNKNOWN'
  pnlPercent: { type: Number, required: true }, // Kâr/Zarar yüzdesi
  isWin: { type: Boolean, required: true }, // 1 (Win) veya 0 (Loss) yapay zeka için temel etiket
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MLDataset', MLDatasetSchema);
