const mongoose = require('mongoose');

/**
 * Question schema.
 * correctAnswerIndex refers to the ORIGINAL options array (before any shuffling).
 * Shuffling happens at query time in the quiz route; the shuffle map is stored
 * in the student's quizSession so scoring is always based on original indices.
 */
const QuestionSchema = new mongoose.Schema({
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 4,
  },
  section: {
    type: String,
    required: true,
    enum: ['GK', 'Technical', 'Reasoning', 'Aptitude', 'Mixed'],
    trim: true,
  },
  questionText: {
    type: String,
    required: true,
    trim: true,
  },
  options: {
    type: [String],
    validate: {
      validator: (arr) => arr.length === 4,
      message: 'Exactly 4 options are required per question.',
    },
  },
  // Index into the original `options` array (0–3)
  correctAnswerIndex: {
    type: Number,
    required: true,
    min: 0,
    max: 3,
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium',
  },
  explanation: {
    type: String,
    trim: true,
  },
}, { timestamps: true });

// Compound index for fast level+section queries
QuestionSchema.index({ level: 1, section: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
