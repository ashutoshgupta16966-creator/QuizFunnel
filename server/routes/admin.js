const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const adminAuth = require('../middleware/adminAuth');
const { Parser } = require('@json2csv/plainjs');

// All routes in this file require admin authentication
router.use(adminAuth);

// ── Score & Time Guards ────────────────────────────────────────────────────────
const TOTAL_MAX_SCORE  = 45;   // max achievable quiz score
const TOTAL_MAX_TIME_S = 1980; // 33 minutes in seconds

/**
 * Formats seconds into "MM:SS". Handles ms values (>10000) and clamps to max 33:00.
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

function clampScore(val) { return Math.min(Math.max(Number(val) || 0, 0), TOTAL_MAX_SCORE); }
function clampTime(val)  {
  let s = Number(val) || 0;
  if (s > 10000) s = Math.round(s / 1000);
  return Math.min(Math.max(s, 0), TOTAL_MAX_TIME_S);
}

/**
 * GET /api/admin/students
 * Returns all students with their current level, status, and per-level scores.
 * Supports optional query filters: branch, status, search (name or mobile).
 * Avoids N+1: single MongoDB query with field projection.
 */
router.get('/students', async (req, res, next) => {
  try {
    const { branch, status, search } = req.query;
    const filter = {};

    if (branch) filter.branch = branch;
    if (status) {
      filter.$or = [
        { status },
        { 'attemptHistory.status': status },
      ];
    }
    if (search) {
      const searchOr = [
        { name:   { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchOr },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const students = await Student.find(filter)
      // Exclude heavy fields (shuffle maps, full answer arrays)
      .select('-quizSession -levels.answers -__v')
      .sort({ currentLevel: -1, totalScore: -1, createdAt: -1 })
      .lean();

    // Map each student to ensure levels, totalScore, and totalTimeTaken reflect their best or latest completed attempt if current attempt is empty
    const mapped = students.map((s) => {
      let levels = Array.isArray(s.levels) && s.levels.length > 0 ? s.levels : [];
      let totalScore = s.totalScore || 0;
      let totalTime = s.totalTimeTaken || 0;
      let statusVal = s.status;
      let currentLevel = s.currentLevel;

      // If active levels are empty but attemptHistory exists, pull latest/best completed attempt
      if (levels.length === 0 && Array.isArray(s.attemptHistory) && s.attemptHistory.length > 0) {
        const latestAttempt = [...s.attemptHistory].reverse()[0];
        if (latestAttempt) {
          totalScore = latestAttempt.totalScore ?? totalScore;
          totalTime = latestAttempt.totalTimeTaken ?? totalTime;
          statusVal = latestAttempt.status || statusVal;
          currentLevel = latestAttempt.levelReached || currentLevel;
          if (Array.isArray(latestAttempt.levelsSummary) && latestAttempt.levelsSummary.length > 0) {
            levels = latestAttempt.levelsSummary.map((lvl) => ({
              level: lvl.level,
              score: lvl.score || 0,
              timeTaken: lvl.timeTaken || 0,
            }));
          }
        }
      }

      const safeScore = clampScore(totalScore);
      const safeTime  = clampTime(totalTime);

      return {
        ...s,
        levels,
        totalScore: safeScore,
        totalTimeTaken: safeTime,
        timeTakenFormatted: formatTimeMMSS(safeTime),
        status: statusVal,
        currentLevel,
      };
    });

    res.json({ success: true, count: mapped.length, data: mapped });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/leaderboard
 * Returns Level-4 completers (from current run or attemptHistory), sorted by:
 *   1. totalScore DESC  (highest score wins)
 *   2. totalTimeTaken ASC  (faster time wins on tie)
 *
 * This is the final selection ranking.
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const completers = await Student.find({
      $or: [
        { status: 'completed' },
        { 'attemptHistory.status': 'completed' },
        { 'attemptHistory.levelReached': { $gte: 4 } },
        { currentLevel: { $gte: 4 }, 'levels.level': 4 },
      ],
    })
      .select('name mobile branch totalScore totalTimeTaken levels attemptHistory status completedAt')
      .lean();

    const ranked = completers.map((s) => {
      const completedHistory = (s.attemptHistory || []).filter(
        (a) => a.status === 'completed' || (a.levelReached && a.levelReached >= 4)
      );
      let bestScore = s.totalScore || 0;
      let bestTime = s.totalTimeTaken || 0;
      let levels = Array.isArray(s.levels) ? s.levels : [];
      let completedAt = s.completedAt;

      for (const att of completedHistory) {
        if (att.totalScore > bestScore || (att.totalScore === bestScore && att.totalTimeTaken < bestTime)) {
          bestScore = att.totalScore;
          bestTime = att.totalTimeTaken;
          if (Array.isArray(att.levelsSummary) && att.levelsSummary.length > 0) {
            levels = att.levelsSummary;
          }
          if (att.attemptDate) completedAt = att.attemptDate;
        }
      }

      const safeScore = clampScore(bestScore);
      const safeTime  = clampTime(bestTime);

      return {
        name: s.name,
        mobile: s.mobile,
        branch: s.branch,
        totalScore: safeScore,
        totalTimeTaken: safeTime,
        timeTakenFormatted: formatTimeMMSS(safeTime),
        l1Score: levels.find((l) => l.level === 1)?.score ?? null,
        l2Score: levels.find((l) => l.level === 2)?.score ?? null,
        l3Score: levels.find((l) => l.level === 3)?.score ?? null,
        l4Score: levels.find((l) => l.level === 4)?.score ?? null,
        completedAt,
      };
    })
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.totalTimeTaken - b.totalTimeTaken;
    })
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

    res.json({ success: true, data: ranked });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/stats
 * Quick summary stats for the admin dashboard header.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [total, byStatus, completedCount] = await Promise.all([
      Student.countDocuments(),
      Student.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Student.countDocuments({
        $or: [
          { status: 'completed' },
          { 'attemptHistory.status': 'completed' },
          { 'attemptHistory.levelReached': { $gte: 4 } },
        ],
      }),
    ]);

    const stats = { total, inProgress: 0, eliminated: 0, advanced: 0, completed: completedCount };
    byStatus.forEach(({ _id, count }) => {
      if (_id === 'in-progress') stats.inProgress = count;
      else if (_id === 'eliminated') stats.eliminated = count;
      else if (_id === 'advanced') stats.advanced = count;
      else if (_id in stats && _id !== 'completed') stats[_id] = count;
    });

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/export
 * Streams a CSV file containing all student data.
 * Columns: Name, Mobile, Branch, Status, CurrentLevel, L1-L4 scores, totals.
 */
router.get('/export', async (req, res, next) => {
  try {
    const students = await Student.find()
      .select('-quizSession -levels.answers -__v')
      .lean();

    const rows = students.map((s) => {
      let levels = Array.isArray(s.levels) && s.levels.length > 0 ? s.levels : [];
      let totalScore = s.totalScore || 0;
      let totalTime = s.totalTimeTaken || 0;
      let statusVal = s.status;
      let currentLevel = s.currentLevel;

      if (levels.length === 0 && Array.isArray(s.attemptHistory) && s.attemptHistory.length > 0) {
        const latestAttempt = [...s.attemptHistory].reverse()[0];
        if (latestAttempt) {
          totalScore = latestAttempt.totalScore ?? totalScore;
          totalTime = latestAttempt.totalTimeTaken ?? totalTime;
          statusVal = latestAttempt.status || statusVal;
          currentLevel = latestAttempt.levelReached || currentLevel;
          if (Array.isArray(latestAttempt.levelsSummary) && latestAttempt.levelsSummary.length > 0) {
            levels = latestAttempt.levelsSummary;
          }
        }
      }

      const safeScore = clampScore(totalScore);
      const safeTime  = clampTime(totalTime);

      return {
        Name:                 s.name,
        Mobile:               s.mobile,
        Branch:               s.branch,
        Status:               statusVal,
        CurrentLevel:         currentLevel,
        TotalScore:           safeScore,
        TotalTimeTaken_s:     safeTime,
        TotalTimeTaken_MMSS:  formatTimeMMSS(safeTime),
        Level1_Score:         levels.find((l) => l.level === 1)?.score ?? '',
        Level1_Time_s:        levels.find((l) => l.level === 1)?.timeTaken ?? '',
        Level2_Score:         levels.find((l) => l.level === 2)?.score ?? '',
        Level2_Time_s:        levels.find((l) => l.level === 2)?.timeTaken ?? '',
        Level3_Score:         levels.find((l) => l.level === 3)?.score ?? '',
        Level3_Time_s:        levels.find((l) => l.level === 3)?.timeTaken ?? '',
        Level4_Score:         levels.find((l) => l.level === 4)?.score ?? '',
        Level4_Time_s:        levels.find((l) => l.level === 4)?.timeTaken ?? '',
        RegisteredAt:         s.startedAt ? new Date(s.startedAt).toISOString() : '',
        CompletedAt:          s.completedAt ? new Date(s.completedAt).toISOString() : '',
      };
    });

    const parser = new Parser();
    const csv = parser.parse(rows);

    const filename = `quiz-results-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
