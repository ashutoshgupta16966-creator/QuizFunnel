/**
 * sanitizeScores.js
 * -----------------
 * One-time database migration to clamp all existing Student and Room participant
 * records to valid score/time limits:
 *   - totalScore          ≤ 45 pts
 *   - totalTimeTaken      ≤ 1980 s  (33 minutes)
 *   - level.score         ≤ level-specific max (L1:20, L2:15, L3:10, L4:5)
 *   - attemptHistory.*    same clamping rules
 *
 * Run once from the project root:
 *   node server/scripts/sanitizeScores.js
 */

'use strict';

const path    = require('path');
const dotenv  = require('dotenv');

// Load .env from the server directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');

// ── Constants ──────────────────────────────────────────────────────────────────
const TOTAL_MAX_SCORE  = 45;
const TOTAL_MAX_TIME_S = 1980;  // 33 minutes
const LEVEL_MAX_SCORES = { 1: 20, 2: 15, 3: 10, 4: 5 };

// ── Helpers ────────────────────────────────────────────────────────────────────
function clampScore(val) {
  return Math.min(Math.max(Number(val) || 0, 0), TOTAL_MAX_SCORE);
}

function clampTime(val) {
  let s = Number(val) || 0;
  if (s > 10000) s = Math.round(s / 1000); // ms → seconds
  return Math.min(Math.max(s, 0), TOTAL_MAX_TIME_S);
}

function clampLevelScore(lvlNum, val) {
  const max = LEVEL_MAX_SCORES[lvlNum] ?? 20;
  return Math.min(Math.max(Number(val) || 0, 0), max);
}

function sanitizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  // Deduplicate by level number — keep highest score per level
  const byLevel = new Map();
  for (const lvl of levels) {
    const n = lvl.level;
    const existing = byLevel.get(n);
    if (!existing || (lvl.score || 0) > (existing.score || 0)) {
      byLevel.set(n, lvl);
    }
  }
  return Array.from(byLevel.values()).map((lvl) => ({
    ...lvl,
    score:     clampLevelScore(lvl.level, lvl.score),
    timeTaken: clampTime(lvl.timeTaken),
  }));
}

function sanitizeAttemptHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.map((att) => ({
    ...att,
    totalScore:     clampScore(att.totalScore),
    totalTimeTaken: clampTime(att.totalTimeTaken),
    levelsSummary:  sanitizeLevels(att.levelsSummary),
  }));
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌  MONGO_URI not found in server/.env');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('✅  Connected.\n');

  const db = mongoose.connection.db;

  // ── 1. Sanitize Student collection ──────────────────────────────────────────
  console.log('📋  Sanitizing Student collection…');
  const students = await db.collection('students').find({}).toArray();
  let studentFixed = 0;

  for (const s of students) {
    const newLevels  = sanitizeLevels(s.levels);
    const newHistory = sanitizeAttemptHistory(s.attemptHistory);
    const newScore   = clampScore(s.totalScore);
    const newTime    = clampTime(s.totalTimeTaken);

    const changed =
      newScore !== (s.totalScore || 0) ||
      newTime  !== clampTime(s.totalTimeTaken || 0) ||
      JSON.stringify(newLevels)  !== JSON.stringify(sanitizeLevels(s.levels))  ||
      JSON.stringify(newHistory) !== JSON.stringify(sanitizeAttemptHistory(s.attemptHistory));

    if (changed) {
      await db.collection('students').updateOne(
        { _id: s._id },
        {
          $set: {
            totalScore:     newScore,
            totalTimeTaken: newTime,
            levels:         newLevels,
            attemptHistory: newHistory,
          },
        }
      );
      studentFixed++;
    }
  }
  console.log(`   ✔  ${studentFixed} / ${students.length} student records updated.\n`);

  // ── 2. Sanitize Room.participants ────────────────────────────────────────────
  console.log('🏠  Sanitizing Room.participants…');
  const rooms = await db.collection('rooms').find({}).toArray();
  let roomFixed = 0;

  for (const room of rooms) {
    if (!Array.isArray(room.participants) || room.participants.length === 0) continue;

    let dirty = false;
    const newParticipants = room.participants.map((p) => {
      const newScore  = clampScore(p.score);
      const newTime   = clampTime(p.timeTaken);
      const newLevels = sanitizeLevels(p.levels);

      if (
        newScore !== (p.score || 0) ||
        newTime  !== clampTime(p.timeTaken || 0) ||
        JSON.stringify(newLevels) !== JSON.stringify(sanitizeLevels(p.levels))
      ) {
        dirty = true;
        return { ...p, score: newScore, timeTaken: newTime, levels: newLevels };
      }
      return p;
    });

    if (dirty) {
      await db.collection('rooms').updateOne(
        { _id: room._id },
        { $set: { participants: newParticipants } }
      );
      roomFixed++;
    }
  }
  console.log(`   ✔  ${roomFixed} / ${rooms.length} room records updated.\n`);

  console.log('🎉  Sanitization complete!');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌  Script failed:', err.message);
  process.exit(1);
});
