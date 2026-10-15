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
  previousAttempt: { type: mongoose.Schema.Types.Mixed, default: null },
  attempts:       { type: [mongoose.Schema.Types.Mixed], default: [] },
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

const RoomQuestionSchema = new mongoose.Schema({
  questionText:       { type: String, required: true, trim: true },
  questionType:       { type: String, enum: ['mcq', 'direct'], default: 'mcq' },
  options:            { type: [String], default: [] },
  correctAnswerIndex: { type: Number, default: 0 },
  directAnswer:       { type: String, trim: true, default: '' },
  level:              { type: Number, default: 1, min: 1 },
  section:            { type: String, default: 'Technical', trim: true },
  difficulty:         { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  explanation:        { type: String, trim: true, default: '' },
}, { _id: true });

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
  isAiGenerated: { type: Boolean, default: false },
  subject:      { type: String, trim: true, default: '' },
  unit:         { type: String, trim: true, default: '' },
  progressionMode: { type: String, enum: ['level_gated', 'open_attempt'], default: 'level_gated' },
  maxLevel:     { type: Number, default: 4, min: 1 },
  customTimeSeconds: { type: Number, default: 0 },
  // Admin-controlled quiz start: flips to true when admin broadcasts "START QUIZ FOR ALL"
  quizStarted:  { type: Boolean, default: false },
  // Per-level timer overrides: [{ level: 1, seconds: 600 }, { level: 2, seconds: 480 }, ...]
  levelTimers:  {
    type: [{ level: Number, seconds: Number, _id: false }],
    default: [],
  },
  questions:    [RoomQuestionSchema],
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
    // ── Deduplicate participants by unique normalized 10-digit mobile number ──
    const mobileMap = new Map();
    for (const p of participants) {
      const cleanM = String(p.mobile || '').replace(/\D/g, '').slice(-10);
      if (!cleanM) continue;
      if (!mobileMap.has(cleanM)) {
        mobileMap.set(cleanM, p);
      } else {
        const existing = mobileMap.get(cleanM);
        const bestLevel = Math.max(existing.level || 1, p.level || 1);
        const bestScore = Math.max(existing.score || 0, p.score || 0);
        const bestTime = Math.max(existing.timeTaken || 0, p.timeTaken || 0);
        const bestLevels = (Array.isArray(p.levels) && p.levels.length > 0) ? p.levels : (existing.levels || []);
        mobileMap.set(cleanM, {
          ...existing,
          ...p,
          level: bestLevel,
          score: bestScore,
          timeTaken: bestTime,
          levels: bestLevels,
          status: (p.status === 'completed' || p.status === 'eliminated' || p.isDisqualified) ? p.status : (existing.status || p.status),
          isDisqualified: Boolean(existing.isDisqualified || p.isDisqualified),
        });
      }
    }
    participants = Array.from(mobileMap.values());

    const Student = require('./Student');
    const mobiles = participants.map((p) => p.mobile).filter(Boolean);
    const cleanMobiles = participants
      .map((p) => String(p.mobile || '').replace(/\D/g, '').slice(-10))
      .filter((m) => m && m.length === 10);

    if (mobiles.length === 0 && cleanMobiles.length === 0) return participants;

    const students = await Student.find({
      $or: [
        { mobile: { $in: cleanMobiles } },
        { mobile: { $in: mobiles } },
      ],
    })
      .select('name branch mobile levels attemptHistory totalScore totalTimeTaken status isDisqualified')
      .lean();

    const studentMap = new Map();
    for (const s of students) {
      const cleanM = String(s.mobile || '').replace(/\D/g, '').slice(-10);
      studentMap.set(cleanM, s);
      studentMap.set(s.mobile, s);
    }

    return participants.map((p) => {
      const cleanM = String(p.mobile || '').replace(/\D/g, '').slice(-10);
      const student = studentMap.get(cleanM) || studentMap.get(p.mobile);

      let levels = Array.isArray(p.levels) && p.levels.length > 0 ? [...p.levels] : [];

      let candidateLevels = [];
      let candidateStatus = p.status;
      let candidateLevel = p.level || 1;

      if (student) {
        // 1. Check attemptHistory for a completed/final attempt matching this roomCode
        const matchedAttempt = Array.isArray(student.attemptHistory)
          ? [...student.attemptHistory].reverse().find((a) => !roomCode || a.roomCode === roomCode)
          : null;

        if (matchedAttempt && Array.isArray(matchedAttempt.levelsSummary) && matchedAttempt.levelsSummary.length > 0) {
          candidateLevels = matchedAttempt.levelsSummary.map((lvl) => ({
            level: lvl.level,
            score: lvl.score || 0,
            timeTaken: lvl.timeTaken || 0,
          }));
          if (matchedAttempt.status) candidateStatus = matchedAttempt.status;
          if (matchedAttempt.levelReached) candidateLevel = Math.max(candidateLevel, matchedAttempt.levelReached);
        }

        // 2. Check active student.levels
        if (Array.isArray(student.levels) && student.levels.length > candidateLevels.length) {
          candidateLevels = student.levels.map((lvl) => ({
            level: lvl.level,
            score: lvl.score || 0,
            timeTaken: lvl.timeTaken || 0,
          }));
          if (student.status) candidateStatus = student.status;
          if (student.currentLevel) candidateLevel = Math.max(candidateLevel, student.currentLevel);
        }
      }

      // If candidateLevels has more (or more comprehensive) data than p.levels, take it
      if (candidateLevels.length >= levels.length && candidateLevels.length > 0) {
        levels = candidateLevels;
      }

      const computedTotalScore = levels.length > 0
        ? levels.reduce((acc, curr) => acc + (curr.score || 0), 0)
        : Math.max(p.score || 0, student?.totalScore || 0);

      const computedTotalTime = levels.length > 0
        ? levels.reduce((acc, curr) => acc + (curr.timeTaken || 0), 0)
        : Math.max(p.timeTaken || 0, student?.totalTimeTaken || 0);

      const finalStatus = (candidateStatus === 'completed' || candidateStatus === 'eliminated' || candidateStatus === 'disqualified')
        ? candidateStatus
        : (p.status || candidateStatus || 'in-progress');

      const highestLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) : 1;
      const finalLevel = Math.max(p.level || 1, candidateLevel, highestLevel);

      // Extract prior attempt data if reattempt or history exists
      let previousAttempt = p.previousAttempt || null;
      let allAttempts = Array.isArray(p.attempts) && p.attempts.length > 0 ? [...p.attempts] : [];
      const studentObj = student;

      if (studentObj && Array.isArray(studentObj.attemptHistory) && studentObj.attemptHistory.length > 0) {
        const roomAttempts = studentObj.attemptHistory.filter((a) => !roomCode || a.roomCode === roomCode);
        const mappedRoomAttempts = roomAttempts.map((att, idx) => ({
          attemptNumber: att.attemptNumber || idx + 1,
          score: att.totalScore ?? 0,
          timeTaken: att.totalTimeTaken ?? 0,
          level: att.levelReached ?? 1,
          status: att.status ?? 'completed',
          isDisqualified: Boolean(att.isDisqualified),
          levels: Array.isArray(att.levelsSummary) ? att.levelsSummary.map((lvl) => ({
            level: lvl.level,
            score: lvl.score || 0,
            timeTaken: lvl.timeTaken || 0,
          })) : [],
          attemptDate: att.attemptDate,
        }));

        if (allAttempts.length === 0 && mappedRoomAttempts.length > 0) {
          allAttempts = mappedRoomAttempts;
        }

        if (!previousAttempt) {
          const prior = roomAttempts.length > 0 ? roomAttempts[0] : studentObj.attemptHistory[0];
          if (prior && (p.isReattempt || roomAttempts.length > 1 || allAttempts.length > 0)) {
            previousAttempt = {
              score: prior.totalScore ?? 0,
              timeTaken: prior.totalTimeTaken ?? 0,
              level: prior.levelReached ?? 1,
              status: prior.status ?? 'completed',
              isDisqualified: Boolean(prior.isDisqualified),
              levels: Array.isArray(prior.levelsSummary) ? prior.levelsSummary.map((lvl) => ({
                level: lvl.level,
                score: lvl.score || 0,
                timeTaken: lvl.timeTaken || 0,
              })) : [],
              attemptDate: prior.attemptDate,
            };
          }
        }
      }

      if (previousAttempt && allAttempts.length === 0) {
        allAttempts = [previousAttempt];
      }

      return {
        ...p,
        mobile: cleanM || p.mobile,
        name: p.name || student?.name || 'Student',
        branch: p.branch || student?.branch || 'CSE',
        level: finalLevel,
        score: computedTotalScore,
        timeTaken: computedTotalTime,
        status: finalStatus,
        isDisqualified: Boolean(p.isDisqualified || (student && student.isDisqualified)),
        levels: levels || [],
        computedTotalScore,
        computedTotalTime,
        previousAttempt,
        attempts: allAttempts,
      };
    });
  } catch (err) {
    console.error('Error enriching participants with levels:', err.message);
    return participants;
  }
};

/**
 * One-time / on-startup migration to sanitize duplicate participants in active rooms
 * from past test sessions.
 */
RoomSchema.statics.cleanupDuplicateParticipants = async function () {
  try {
    const rooms = await this.find({ status: 'active' });
    let totalCleaned = 0;
    for (const room of rooms) {
      if (!Array.isArray(room.participants) || room.participants.length === 0) continue;
      const seen = new Set();
      const unique = [];
      let hasDups = false;
      for (const p of room.participants) {
        const m = String(p.mobile || '').replace(/\D/g, '').slice(-10);
        if (!m || seen.has(m)) {
          hasDups = true;
          continue;
        }
        seen.add(m);
        unique.push(p);
      }
      if (hasDups) {
        await this.updateOne({ _id: room._id }, { $set: { participants: unique } });
        totalCleaned++;
      }
    }
    if (totalCleaned > 0) {
      console.log(`[Database Migration] Cleaned duplicate participants in ${totalCleaned} active room(s).`);
    }
  } catch (err) {
    console.warn('[Database Migration Warning]:', err.message);
  }
};

module.exports = mongoose.model('Room', RoomSchema);

