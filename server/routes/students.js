const express = require('express');
const router  = express.Router();
const Student = require('../models/Student');

/**
 * POST /api/students/register
 *
 * Behaviour (multiple-attempt mode with Password protection):
 *   - Accepts { name, mobile, branch, password }.
 *   - Every registration call creates a FRESH attempt starting at Level 1.
 *   - If a student record already exists for the given mobile number, the old
 *     record is deleted first so the new attempt is clean.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, mobile, branch, password } = req.body;

    // ── Input validation ───────────────────────────────────────────────────
    if (!name || !mobile || !branch || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, mobile, branch, and password/PIN are required.',
      });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        error: 'Mobile number must be exactly 10 digits.',
      });
    }
    if (password.trim().length < 4) {
      return res.status(400).json({
        success: false,
        error: 'Password/PIN must be at least 4 characters or digits.',
      });
    }
    const validBranches = ['CSE', 'CSE-AIML', 'MBA'];
    if (!validBranches.includes(branch)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid branch selected.',
      });
    }

    // ── Delete any previous attempt for this mobile ───
    await Student.deleteOne({ mobile });

    // ── Create a brand-new student record starting at Level 1 ──────────────
    const student = await Student.create({
      name,
      mobile,
      branch,
      password: password.trim(),
    });

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
 * POST /api/students/verify-results-auth
 * Private results authentication endpoint.
 * Accepts { mobile, password }.
 * Returns student performance details if credentials match.
 */
router.post('/verify-results-auth', async (req, res, next) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({
        success: false,
        error: 'Mobile number and password/PIN are required.',
      });
    }

    const student = await Student.findOne({ mobile }).lean();
    if (!student || student.password !== password.trim()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Mobile Number or Password/PIN.',
      });
    }

    res.json({
      success: true,
      data: {
        _id:            student._id,
        name:           student.name,
        mobile:         student.mobile,
        branch:         student.branch,
        currentLevel:   student.currentLevel,
        status:         student.status,
        totalScore:     student.totalScore,
        totalTimeTaken: student.totalTimeTaken,
        levels:         student.levels,
        updatedAt:      student.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/students/reset-password
 * Password Reset / Edit endpoint.
 * Accepts { name, mobile, newPassword }.
 * Verifies mobile & registered name before updating password.
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { name, mobile, newPassword } = req.body;

    if (!name || !mobile || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Name, mobile number, and new password are required for reset.',
      });
    }

    if (newPassword.trim().length < 4) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 4 characters or digits.',
      });
    }

    const student = await Student.findOne({ mobile });
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'No registered student found with this mobile number.',
      });
    }

    // Verify name match (case-insensitive)
    if (student.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: 'Verification failed. Provided name does not match the registered record.',
      });
    }

    student.password = newPassword.trim();
    await student.save();

    res.json({
      success: true,
      message: 'Password updated successfully! You can now log in to view your results.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/:mobile/status
 * Returns the student's current level, status, and scores.
 */
router.get('/:mobile/status', async (req, res, next) => {
  try {
    const student = await Student.findOne({ mobile: req.params.mobile })
      .select('-quizSession -levels.answers -__v -password')
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
