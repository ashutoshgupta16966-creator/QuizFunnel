const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const adminAuth = require('../middleware/adminAuth');
const { Parser } = require('@json2csv/plainjs');

// All routes in this file require admin authentication
router.use(adminAuth);

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
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
    }

    const students = await Student.find(filter)
      // Exclude heavy fields (shuffle maps, full answer arrays)
      .select('-quizSession -levels.answers -__v')
      .sort({ currentLevel: -1, totalScore: -1, createdAt: 1 })
      .lean();

    res.json({ success: true, count: students.length, data: students });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/leaderboard
 * Returns only Level-4 completers, sorted by:
 *   1. totalScore DESC  (highest score wins)
 *   2. totalTimeTaken ASC  (faster time wins on tie)
 *
 * This is the final selection ranking.
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const completers = await Student.find({ status: 'completed' })
      .select('name mobile branch totalScore totalTimeTaken levels completedAt')
      // MongoDB sort: score DESC, time ASC
      .sort({ totalScore: -1, totalTimeTaken: 1 })
      .lean();

    const ranked = completers.map((s, idx) => ({
      rank: idx + 1,
      name: s.name,
      mobile: s.mobile,
      branch: s.branch,
      totalScore: s.totalScore,
      totalTimeTaken: s.totalTimeTaken,
      // Break out individual level scores for display
      l1Score: s.levels.find((l) => l.level === 1)?.score ?? null,
      l2Score: s.levels.find((l) => l.level === 2)?.score ?? null,
      l3Score: s.levels.find((l) => l.level === 3)?.score ?? null,
      l4Score: s.levels.find((l) => l.level === 4)?.score ?? null,
      completedAt: s.completedAt,
    }));

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
    const [total, byStatus] = await Promise.all([
      Student.countDocuments(),
      Student.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const stats = { total, inProgress: 0, eliminated: 0, advanced: 0, completed: 0 };
    byStatus.forEach(({ _id, count }) => {
      if (_id === 'in-progress') stats.inProgress = count;
      else if (_id in stats) stats[_id] = count;
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

    const rows = students.map((s) => ({
      Name:              s.name,
      Mobile:            s.mobile,
      Branch:            s.branch,
      Status:            s.status,
      CurrentLevel:      s.currentLevel,
      TotalScore:        s.totalScore,
      TotalTimeTaken_s:  s.totalTimeTaken,
      Level1_Score:      s.levels.find((l) => l.level === 1)?.score ?? '',
      Level1_Time_s:     s.levels.find((l) => l.level === 1)?.timeTaken ?? '',
      Level2_Score:      s.levels.find((l) => l.level === 2)?.score ?? '',
      Level2_Time_s:     s.levels.find((l) => l.level === 2)?.timeTaken ?? '',
      Level3_Score:      s.levels.find((l) => l.level === 3)?.score ?? '',
      Level3_Time_s:     s.levels.find((l) => l.level === 3)?.timeTaken ?? '',
      Level4_Score:      s.levels.find((l) => l.level === 4)?.score ?? '',
      Level4_Time_s:     s.levels.find((l) => l.level === 4)?.timeTaken ?? '',
      RegisteredAt:      s.startedAt ? new Date(s.startedAt).toISOString() : '',
      CompletedAt:       s.completedAt ? new Date(s.completedAt).toISOString() : '',
    }));

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
