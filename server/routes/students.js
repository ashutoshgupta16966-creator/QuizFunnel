const express = require('express');
const router = express.Router();
const Student = require('../models/Student');

/**
 * POST /api/students/register
 * Creates a new student or resumes an existing attempt for the same mobile.
 * Mobile is used as the unique identifier since freshers have no roll numbers.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, mobile, branch } = req.body;

    // Basic validation
    if (!name || !mobile || !branch) {
      return res.status(400).json({ success: false, error: 'Name, mobile, and branch are required.' });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, error: 'Mobile number must be exactly 10 digits.' });
    }
    const validBranches = ['CSE', 'CSE-AIML', 'MBA'];
    if (!validBranches.includes(branch)) {
      return res.status(400).json({ success: false, error: 'Invalid branch selected.' });
    }

    // Check if student already exists (same mobile)
    const existing = await Student.findOne({ mobile }).lean();
    if (existing) {
      return res.json({
        success: true,
        message: 'Resuming your existing attempt.',
        data: {
          _id: existing._id,
          name: existing.name,
          mobile: existing.mobile,
          branch: existing.branch,
          currentLevel: existing.currentLevel,
          status: existing.status,
          isResumed: true,
        },
      });
    }

    // Create new student
    const student = await Student.create({ name, mobile, branch });
    return res.status(201).json({
      success: true,
      message: 'Registration successful! Good luck.',
      data: {
        _id: student._id,
        name: student.name,
        mobile: student.mobile,
        branch: student.branch,
        currentLevel: 1,
        status: 'in-progress',
        isResumed: false,
      },
    });
  } catch (err) {
    // Handle race condition: two concurrent requests with same mobile
    if (err.code === 11000) {
      try {
        const student = await Student.findOne({ mobile: req.body.mobile }).lean();
        return res.json({
          success: true,
          message: 'Resuming your existing attempt.',
          data: {
            _id: student._id,
            name: student.name,
            mobile: student.mobile,
            branch: student.branch,
            currentLevel: student.currentLevel,
            status: student.status,
            isResumed: true,
          },
        });
      } catch (innerErr) {
        return next(innerErr);
      }
    }
    next(err);
  }
});

/**
 * GET /api/students/:mobile/status
 * Returns the student's current level, status, and scores.
 * Used on page load to restore state after a browser refresh.
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
