const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
    index: true,
  },
  attemptId: {
    type: String,
    required: true,
    index: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    trim: true,
    default: '',
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Ensure unique feedback per mobile + attemptId for immutability
FeedbackSchema.index({ mobile: 1, attemptId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', FeedbackSchema);
