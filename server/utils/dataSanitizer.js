/**
 * dataSanitizer.js
 * ----------------
 * Universal permanent data sanitization & validation module for all quizzes.
 *
 * Enforces:
 *   - Universal Max Score Cap: 45 pts total
 *   - Per-Level Max Limits: Level 1 (20 pts), Level 2 (15 pts), Level 3 (10 pts), Level 4 (5 pts)
 *   - Standardized Completion Time: clamped within 33:00 (1980s) and formatted as "MM:SS"
 *
 * Runs automatically on startup / DB connect and can be invoked as a migration script.
 */

'use strict';

const mongoose = require('mongoose');

// ── Constants ──────────────────────────────────────────────────────────────────
const TOTAL_MAX_SCORE  = 45;
const TOTAL_MAX_TIME_S = 1980; // 33 minutes in seconds
const LEVEL_MAX_SCORES = { 1: 20, 2: 15, 3: 10, 4: 5 };

// ── Formatting & Clamping Helpers ─────────────────────────────────────────────
/**
 * Formats seconds into "MM:SS". Handles millisecond values (>10000) and clamps to 33:00.
 */
function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  let s = Number(seconds) || 0;
  if (s > 10000) s = Math.round(s / 1000); // ms → seconds
  s = Math.min(Math.max(s, 0), TOTAL_MAX_TIME_S);
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Normalizes seconds value, converting milliseconds if needed and clamping to [0, 1980].
 */
function normalizeSeconds(val) {
  if (!val && val !== 0) return 0;
  let s = Number(val) || 0;
  if (s > 10000) s = Math.round(s / 1000);
  return Math.min(Math.max(s, 0), TOTAL_MAX_TIME_S);
}

/**
 * Clamps total score to [0, TOTAL_MAX_SCORE].
 */
function clampScore(val, max = TOTAL_MAX_SCORE) {
  return Math.min(Math.max(Number(val) || 0, 0), max);
}

/**
 * Clamps level score to [0, max for that level].
 */
function clampLevelScore(level, val) {
  const max = LEVEL_MAX_SCORES[level] ?? 20;
  return Math.min(Math.max(Number(val) || 0, 0), max);
}

/**
 * Recalculates or clamps a single level attempt record.
 * If answers are present with isCorrect flags, validates against actual correct count.
 */
function sanitizeLevelRecord(lvl) {
  if (!lvl || typeof lvl !== 'object') return null;

  const lvlNum = Number(lvl.level) || 1;
  const maxLvlScore = LEVEL_MAX_SCORES[lvlNum] ?? 20;

  let score = Number(lvl.score) || 0;

  // If answer breakdown is preserved with isCorrect flags, compute actual verified correct count
  if (Array.isArray(lvl.answers) && lvl.answers.length > 0) {
    const verifiedCorrect = lvl.answers.filter((a) => a && (a.isCorrect === true || a.isCorrect === 1)).length;
    if (verifiedCorrect >= 0 && verifiedCorrect <= maxLvlScore) {
      score = verifiedCorrect;
    } else {
      score = Math.min(score, maxLvlScore);
    }
  } else {
    score = Math.min(Math.max(score, 0), maxLvlScore);
  }

  const timeTaken = normalizeSeconds(lvl.timeTaken);
  const timeTakenFormatted = formatTimeMMSS(timeTaken);

  return {
    ...lvl,
    level: lvlNum,
    score,
    timeTaken,
    timeTakenFormatted,
  };
}

/**
 * Deduplicates and sanitizes an array of level records.
 */
function sanitizeLevelsArray(levels) {
  if (!Array.isArray(levels)) return [];

  // Deduplicate by level number keeping best score
  const byLevel = new Map();
  for (const raw of levels) {
    const sanitized = sanitizeLevelRecord(raw);
    if (!sanitized) continue;
    const existing = byLevel.get(sanitized.level);
    if (!existing || sanitized.score > existing.score) {
      byLevel.set(sanitized.level, sanitized);
    }
  }

  return Array.from(byLevel.values()).sort((a, b) => a.level - b.level);
}

/**
 * Sanitizes an attemptHistory array.
 */
function sanitizeAttemptHistoryArray(history) {
  if (!Array.isArray(history)) return [];

  return history.map((att) => {
    if (!att || typeof att !== 'object') return att;

    const sanitizedSummary = sanitizeLevelsArray(att.levelsSummary);
    let totalScore = Number(att.totalScore) || 0;

    if (sanitizedSummary.length > 0) {
      const sumOfLevels = sanitizedSummary.reduce((sum, l) => sum + (l.score || 0), 0);
      totalScore = Math.min(sumOfLevels, TOTAL_MAX_SCORE);
    } else {
      totalScore = clampScore(totalScore);
    }

    const totalTimeTaken = normalizeSeconds(att.totalTimeTaken);
    const timeTakenFormatted = formatTimeMMSS(totalTimeTaken);

    return {
      ...att,
      totalScore,
      totalTimeTaken,
      timeTakenFormatted,
      levelsSummary: sanitizedSummary,
    };
  });
}

/**
 * Scans all collections (Student and Room) and repairs any score overflows or unformatted times.
 * Idempotent: Can be run on every server startup without duplicate work.
 */
async function runUniversalSanitization(options = {}) {
  const isSilent = Boolean(options.silent);
  const startTime = Date.now();

  try {
    const db = mongoose.connection.db;
    if (!db) {
      if (!isSilent) console.warn('[Universal Sanitization] Database connection not ready yet.');
      return { skipped: true, reason: 'db_not_connected' };
    }

    let studentsChecked = 0;
    let studentsUpdated = 0;
    let roomsChecked = 0;
    let roomsUpdated = 0;

    // ── 1. Sanitize Student Collection ─────────────────────────────────────────
    const students = await db.collection('students').find({}).toArray();
    studentsChecked = students.length;

    for (const s of students) {
      const sanitizedLevels  = sanitizeLevelsArray(s.levels);
      const sanitizedHistory = sanitizeAttemptHistoryArray(s.attemptHistory);

      let targetScore = Number(s.totalScore) || 0;
      if (sanitizedLevels.length > 0) {
        const sumLevels = sanitizedLevels.reduce((acc, l) => acc + (l.score || 0), 0);
        targetScore = Math.min(sumLevels, TOTAL_MAX_SCORE);
      } else {
        targetScore = clampScore(targetScore);
      }

      const targetTime = normalizeSeconds(s.totalTimeTaken);
      const targetTimeFormatted = formatTimeMMSS(targetTime);

      const hasLevelChanges = JSON.stringify(sanitizedLevels) !== JSON.stringify(s.levels || []);
      const hasHistoryChanges = JSON.stringify(sanitizedHistory) !== JSON.stringify(s.attemptHistory || []);
      const hasScoreChange = targetScore !== (s.totalScore ?? 0);
      const hasTimeChange  = targetTime  !== (s.totalTimeTaken ?? 0);
      const hasFormattedTimeChange = targetTimeFormatted !== (s.timeTakenFormatted ?? '');

      if (hasLevelChanges || hasHistoryChanges || hasScoreChange || hasTimeChange || hasFormattedTimeChange) {
        await db.collection('students').updateOne(
          { _id: s._id },
          {
            $set: {
              totalScore:         targetScore,
              totalTimeTaken:     targetTime,
              timeTakenFormatted: targetTimeFormatted,
              levels:             sanitizedLevels,
              attemptHistory:     sanitizedHistory,
            },
          }
        );
        studentsUpdated++;
      }
    }

    // ── 2. Sanitize Room Collection ───────────────────────────────────────────
    const rooms = await db.collection('rooms').find({}).toArray();
    roomsChecked = rooms.length;

    for (const room of rooms) {
      let roomDirty = false;
      const rawParticipants = Array.isArray(room.participants) ? room.participants : [];

      const updatedParticipants = rawParticipants.map((p) => {
        const sanitizedLevels = sanitizeLevelsArray(p.levels);
        let pScore = Number(p.score) || 0;
        if (sanitizedLevels.length > 0) {
          const sumLvl = sanitizedLevels.reduce((acc, l) => acc + (l.score || 0), 0);
          pScore = Math.min(sumLvl, TOTAL_MAX_SCORE);
        } else {
          pScore = clampScore(pScore);
        }

        const pTime = normalizeSeconds(p.timeTaken);
        const pTimeFormatted = formatTimeMMSS(pTime);

        // Sanitize attempts if present
        let updatedAttempts = p.attempts;
        if (Array.isArray(p.attempts) && p.attempts.length > 0) {
          updatedAttempts = p.attempts.map((att) => ({
            ...att,
            score: clampScore(att.score),
            timeTaken: normalizeSeconds(att.timeTaken),
            timeTakenFormatted: formatTimeMMSS(normalizeSeconds(att.timeTaken)),
          }));
        }

        let updatedPrev = p.previousAttempt;
        if (p.previousAttempt && typeof p.previousAttempt === 'object') {
          updatedPrev = {
            ...p.previousAttempt,
            score: clampScore(p.previousAttempt.score),
            timeTaken: normalizeSeconds(p.previousAttempt.timeTaken),
            timeTakenFormatted: formatTimeMMSS(normalizeSeconds(p.previousAttempt.timeTaken)),
          };
        }

        const isChanged =
          pScore !== (p.score ?? 0) ||
          pTime  !== (p.timeTaken ?? 0) ||
          pTimeFormatted !== (p.timeTakenFormatted ?? '') ||
          JSON.stringify(sanitizedLevels) !== JSON.stringify(p.levels || []) ||
          JSON.stringify(updatedAttempts) !== JSON.stringify(p.attempts || []) ||
          JSON.stringify(updatedPrev) !== JSON.stringify(p.previousAttempt || null);

        if (isChanged) {
          roomDirty = true;
          return {
            ...p,
            score: pScore,
            timeTaken: pTime,
            timeTakenFormatted: pTimeFormatted,
            levels: sanitizedLevels,
            attempts: updatedAttempts,
            previousAttempt: updatedPrev,
          };
        }

        return p;
      });

      // Sanitize reattemptRequests
      let updatedRequests = room.reattemptRequests;
      if (Array.isArray(room.reattemptRequests)) {
        updatedRequests = room.reattemptRequests.map((r) => {
          const clampedPrevScore = clampScore(r.previousScore);
          if (clampedPrevScore !== (r.previousScore ?? 0)) {
            roomDirty = true;
            return { ...r, previousScore: clampedPrevScore };
          }
          return r;
        });
      }

      if (roomDirty) {
        await db.collection('rooms').updateOne(
          { _id: room._id },
          {
            $set: {
              participants: updatedParticipants,
              reattemptRequests: updatedRequests,
            },
          }
        );
        roomsUpdated++;
      }
    }

    const elapsedMs = Date.now() - startTime;
    if (!isSilent) {
      console.log(
        `🛡️  [Universal Sanitization] Complete (${elapsedMs}ms): ` +
        `${studentsUpdated}/${studentsChecked} students updated, ` +
        `${roomsUpdated}/${roomsChecked} rooms updated.`
      );
    }

    return {
      success: true,
      studentsChecked,
      studentsUpdated,
      roomsChecked,
      roomsUpdated,
      elapsedMs,
    };
  } catch (err) {
    console.error('❌ [Universal Sanitization Error]:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  TOTAL_MAX_SCORE,
  TOTAL_MAX_TIME_S,
  LEVEL_MAX_SCORES,
  formatTimeMMSS,
  normalizeSeconds,
  clampScore,
  clampLevelScore,
  sanitizeLevelRecord,
  sanitizeLevelsArray,
  sanitizeAttemptHistoryArray,
  runUniversalSanitization,
};
