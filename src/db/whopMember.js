const mongoose = require('mongoose');

const whopMemberSchema = new mongoose.Schema({
  whopId: { type: String, required: true, unique: true },
  email: { type: String, default: 'unknown' },
  status: { type: String, default: 'active' }, // 'active' | 'revoked'
  telegramId: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('WhopMember', whopMemberSchema);
