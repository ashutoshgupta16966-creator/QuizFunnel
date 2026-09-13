const mongoose = require('mongoose');

const ParticipantLevelSchema = new mongoose.Schema({
  level:          { type: Number, required: true },
  score:          { type: Number, default: 0 },
  timeTaken:      { type: Number, default: 0 },
}, { _id: false });

const ParticipantSchema = new mongoose.Schema({
  mobile:         { type: String, required: true },
  name:           { type: String, required: true },
  branch:         { type: String, default: 'CSE' },
  level:          { type: Number, default: 1 },
  score:          { type: Number, default: 0 },
  timeTaken:      { type: Number, default: 0 },
  status:         {
    type: String,
    enum: ['in-progress', 'advanced', 'completed', 'eliminated', 'disqualified'],
    default: 'in-progress',
  },
  isDisqualified: { type: Boolean, default: false },
  isReattempt:    { type: Boolean, default: false },
  levels:         [ParticipantLevelSchema],
  joinedAt:       { type: Date, default: Date.now },
  lastActive:     { type: Date, default: Date.now },
}, { _id: false });

const ReattemptRequestSchema = new mongoose.Schema({
  mobile:         { type: String, required: true },
  name:           { type: String, required: true },
  branch:         { type: String, default: 'CSE' },
  status:         { type: String, enum: ['pending', 'approved', 'denied', 'consumed'], default: 'pending' },
  requestedAt:    { type: Date, default: Date.now },
  previousStatus: { type: String, default: 'completed' },
  previousScore:  { type: Number, default: 0 },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  // roomCode is NOT globally unique — uniqueness is scoped to (adminPhone + roomCode) for ACTIVE rooms only.
  // Different hosts can reuse the same room code. Enforced at application layer below.
  roomCode:     { type: String, required: true, uppercase: true, trim: true, index: true },
  quizTitle:    { type: String, trim: true, default: '' },
  adminName:    { type: String, required: true, trim: true },
  adminPhone:   { type: String, required: true, trim: true, index: true },
  roomPassword: { type: String, required: true },
  maxCapacity:  { type: Number, default: 60 },
  status:       { type: String, enum: ['active', 'closed'], default: 'active' },
  participants: [ParticipantSchema],
  reattemptRequests: [ReattemptRequestSchema],
}, { timestamps: true });

// Compound index: quick lookups per phone + code + status
RoomSchema.index({ adminPhone: 1, roomCode: 1, status: 1 });
// Index for "My Live Rooms" — fetch all rooms by phone sorted by creation date
RoomSchema.index({ adminPhone: 1, createdAt: -1 });

/**
 * Enriches participant objects with their level-wise breakdown (level, score, timeTaken)
 * and computed total score and time from active Student.levels or Student.attemptHistory.
 */
RoomSchema.statics.enrichParticipantsWithLevels = async function (participants, roomCode) {
  if (!participants || participants.length === 0) return [];
  try {
    const Student = require('./Student');
    const mobiles = participants.map((p) => p.mobile).filter(Boolean);
    if (mobiles.length === 0) return participants;

    const students = await Student.find({ mobile: { $in: mobiles } })
      .select('mobile levels attemptHistory')
      .lean();
    const studentMap = new Map(students.map((s) => [s.mobile, s]));

    return participants.map((p) => {
      let levels = Array.isArray(p.levels) && p.levels.length > 0 ? p.levels : [];
      if (levels.length === 0) {
        const student = studentMap.get(p.mobile);
        if (student) {
          if (Array.isArray(student.levels) && student.levels.length > 0) {
            levels = student.levels.map((lvl) => ({
              level: lvl.level,
              score: lvl.score || 0,
              timeTaken: lvl.timeTaken || 0,
            }));
          } else if (Array.isArray(student.attemptHistory) && student.attemptHistory.length > 0) {
            const matchedAttempt = [...student.attemptHistory]
              .reverse()
              .find((a) => a.roomCode === roomCode);
            if (matchedAttempt && Array.isArray(matchedAttempt.levelsSummary)) {
              levels = matchedAttempt.levelsSummary.map((lvl) => ({
                level: lvl.level,
                score: lvl.score || 0,
                timeTaken: lvl.timeTaken || 0,
              }));
            }
          }
        }
      }

      const computedTotalScore = levels.length > 0
        ? levels.reduce((acc, curr) => acc + (curr.score || 0), 0)
        : (p.score || 0);

      const computedTotalTime = levels.length > 0
        ? levels.reduce((acc, curr) => acc + (curr.timeTaken || 0), 0)
        : (p.timeTaken || 0);

      return {
        ...p,
        levels: levels || [],
        computedTotalScore,
        computedTotalTime,
      };
    });
  } catch (err) {
    console.error('Error enriching participants with levels:', err.message);
    return participants;
  }
};

module.exports = mongoose.model('Room', RoomSchema);

