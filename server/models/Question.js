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
  questionType: {
    type: String,
    enum: ['mcq', 'direct'],
    default: 'mcq',
  },
  options: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        if (this.questionType === 'direct') return true;
        return Array.isArray(arr) && arr.length === 4;
      },
      message: 'Exactly 4 options are required for multiple-choice questions.',
    },
  },
  // Index into the original `options` array (0–3) for MCQ questions.
  // -1 is the sentinel value for direct-answer questions (no MCQ selection).
  correctAnswerIndex: {
    type: Number,
    required: function () {
      return this.questionType !== 'direct';
    },
    min: -1,
    max: 3,
    default: 0,
  },
  // Direct text/integer answer for direct-answer questions
  directAnswer: {
    type: String,
    trim: true,
    default: '',
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
  // If set, this question belongs exclusively to an AI-generated room session.
  // Standard quizzes and manual rooms only query questions where roomCode is null.
  roomCode: {
    type: String,
    uppercase: true,
    trim: true,
    default: null,
    index: true,
  },
}, { timestamps: true });

// Compound index for fast level+section queries (standard quiz)
QuestionSchema.index({ level: 1, section: 1, roomCode: 1 });
// Compound index for room-scoped question queries
QuestionSchema.index({ roomCode: 1, level: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
