const express = require('express');
const router  = express.Router();
const Student = require('../models/Student');

/**
 * POST /api/students/register
 *
 * Behaviour (multiple-attempt mode):
 *   - Every registration call always creates a FRESH attempt starting at Level 1.
 *   - If a student record already exists for the given mobile number, the old
 *     record is deleted first so the new attempt is completely clean.
 *   - This means candidates can re-take the quiz as many times as needed
 *     without being blocked by a previous eliminated / completed session.
 *
 * NOTE: The old record (including per-level scores) is removed from the DB.
 *       The admin dashboard will only show the latest attempt per mobile number.
 *       If you ever need to preserve history, change deleteOne() to an archive step.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, mobile, branch } = req.body;

    // ── Input validation ───────────────────────────────────────────────────
    if (!name || !mobile || !branch) {
      return res.status(400).json({
        success: false,
        error: 'Name, mobile, and branch are required.',
      });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        error: 'Mobile number must be exactly 10 digits.',
      });
    }
    const validBranches = ['CSE', 'CSE-AIML', 'MBA'];
    if (!validBranches.includes(branch)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid branch selected.',
      });
    }

    // ── Delete any previous attempt for this mobile (fresh-start policy) ───
    // Using deleteOne() is safe here because mobile has a unique index;
    // at most one document will be removed.
    await Student.deleteOne({ mobile });

    // ── Create a brand-new student record starting at Level 1 ──────────────
    const student = await Student.create({ name, mobile, branch });

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Good luck.',
      data: {
        _id:          student._id,
        name:         student.name,
        mobile:       student.mobile,
        branch:       student.branch,
        currentLevel: 1,
        status:       'in-progress',
        isResumed:    false,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/:mobile/status
 * Returns the student's current level, status, and scores.
 * Used on page load to restore state after a mid-quiz browser refresh.
 */
router.get('/:mobile/status', async (req, res, next) => {
  try {
    const student = await Student.findOne({ mobile: req.params.mobile })
      .select('-quizSession -levels.answers -__v')
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    res.json({ success: true, data: student });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
