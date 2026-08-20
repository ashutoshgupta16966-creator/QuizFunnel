const mongoose = require('mongoose');

/**
 * Stores one answer as submitted by the student.
 * selectedIndex  → the shuffled position the student tapped
 * shuffleMap     → maps shuffled position → original position
 * isCorrect      → computed at submission time
 */
const AnswerSchema = new mongoose.Schema({
  questionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
  selectedIndex: Number,
  shuffleMap:    [Number],
  isCorrect:     Boolean,
}, { _id: false });

/**
 * One entry per submitted level within an attempt.
 */
const LevelAttemptSchema = new mongoose.Schema({
  level:       { type: Number, required: true },
  score:       { type: Number, default: 0 },
  timeTaken:   { type: Number, default: 0 }, // seconds
  submittedAt: Date,
  answers:     [AnswerSchema],
}, { _id: false });

/**
 * Complete attempt history record saved across multiple quiz sessions.
 * Preserves past quiz attempts without overwriting.
 */
const AttemptHistorySchema = new mongoose.Schema({
  attemptId:      { type: String, required: true },
  attemptNumber:  { type: Number, required: true },
  attemptDate:    { type: Date, default: Date.now },
  levelReached:   { type: Number, default: 1 },
  totalScore:     { type: Number, default: 0 },
  maxPossible:    { type: Number, default: 50 },
  accuracyPct:    { type: Number, default: 0 },
  totalTimeTaken: { type: Number, default: 0 }, // seconds
  status:         { type: String, enum: ['completed', 'eliminated', 'in-progress'], default: 'in-progress' },
  levelsSummary:  [LevelAttemptSchema],
}, { timestamps: true });

/**
 * Active quiz session — created when GET /questions/:level is called,
 * cleared on submit. Stores which questions were served and in what
 * shuffle order so scoring can be done server-side.
 */
const SessionQuestionSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
  shuffleMap: [Number],
}, { _id: false });

const QuizSessionSchema = new mongoose.Schema({
  level:      Number,
  startedAt:  { type: Date, default: Date.now },
  questions:  [SessionQuestionSchema],
}, { _id: false });

const StudentSchema = new mongoose.Schema({
  name:   { type: String, required: true, trim: true },

  // Mobile is the unique identifier
  mobile: {
    type: String,
    required: true,
    unique: true,
    index: true,
    match: [/^\d{10}$/, 'Mobile must be exactly 10 digits'],
  },

  branch: {
    type: String,
    required: true,
    enum: ['CSE', 'CSE-AIML', 'MBA'],
  },

  password: {
    type: String,
    required: true,
    minlength: [4, 'Password must be at least 4 characters/digits'],
  },

  currentLevel: { type: Number, default: 1, min: 1, max: 4 },

  status: {
    type: String,
    enum: ['in-progress', 'eliminated', 'advanced', 'completed'],
    default: 'in-progress',
  },

  levels:         [LevelAttemptSchema],   // active level attempts
  attemptHistory: [AttemptHistorySchema], // persistent list of all completed/past attempts
  quizSession:    QuizSessionSchema,      // active session (null when not in quiz)

  // Running totals used for tie-break sorting in the final leaderboard
  totalScore:     { type: Number, default: 0 },
  totalTimeTaken: { type: Number, default: 0 }, // seconds

  startedAt:   { type: Date, default: Date.now },
  completedAt: Date,
}, { timestamps: true });

// Compound index for leaderboard: score DESC, time ASC (tie-breaker)
StudentSchema.index({ totalScore: -1, totalTimeTaken: 1 });

module.exports = mongoose.model('Student', StudentSchema);
