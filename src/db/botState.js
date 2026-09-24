const mongoose = require('mongoose');

const botStateSchema = new mongoose.Schema({
  type: { type: String, required: true, unique: true }, // 'PAPER' or 'REAL'
  balance: { type: Number, default: 0 },
  totalPnl: { type: Number, default: 0 },
  winCount: { type: Number, default: 0 },
  lossCount: { type: Number, default: 0 },
  consecutiveLosses: { type: Number, default: 0 },
  lastResetDay: { type: String, default: '' }
});

module.exports = mongoose.model('BotState', botStateSchema);
