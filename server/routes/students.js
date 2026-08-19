const express = require('express');
const router  = express.Router();
const Student = require('../models/Student');

// In-memory store for SMS OTPs: mobile -> { otp, expiresAt }
const otpStore = new Map();

/**
 * POST /api/students/register
 * Accepts { name, mobile, branch, password }.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, mobile, branch, password } = req.body;

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

    // Delete any previous attempt for this mobile
    await Student.deleteOne({ mobile });

    // Create fresh student record
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
 * Private results authentication endpoint. Accepts { mobile, password }.
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
 * POST /api/students/send-otp
 * Triggers a 4-digit SMS OTP to the user's mobile number.
 */
router.post('/send-otp', async (req, res, next) => {
  try {
    const { mobile } = req.body;

    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid 10-digit mobile number.',
      });
    }

    const student = await Student.findOne({ mobile });
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'No registered student found with this mobile number.',
      });
    }

    // Generate random 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins validity

    otpStore.set(mobile, { otp, expiresAt });

    console.log(`[SMS OTP] Mobile: ${mobile} -> Generated OTP: ${otp}`);

    res.json({
      success: true,
      message: `4-digit OTP sent successfully to +91 ${mobile}`,
      demoOtp: otp, // Returned for instant dev/demo testing
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/students/verify-otp
 * Verifies the 4-digit SMS OTP code.
 */
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Mobile number and OTP are required.',
      });
    }

    const record = otpStore.get(mobile);
    if (!record || Date.now() > record.expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired or is invalid. Please request a new one.',
      });
    }

    if (record.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid 4-digit OTP code. Please check and try again.',
      });
    }

    res.json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/students/reset-password-otp
 * Updates the candidate's password after verifying SMS OTP.
 */
router.post('/reset-password-otp', async (req, res, next) => {
  try {
    const { mobile, otp, newPassword } = req.body;

    if (!mobile || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Mobile number, OTP, and new password are required.',
      });
    }

    if (newPassword.trim().length < 4) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 4 characters or digits.',
      });
    }

    const record = otpStore.get(mobile);
    if (!record || record.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        error: 'OTP verification failed or expired. Please restart password reset.',
      });
    }

    const student = await Student.findOne({ mobile });
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Candidate record not found.',
      });
    }

    student.password = newPassword.trim();
    await student.save();

    // Clear OTP after successful reset
    otpStore.delete(mobile);

    res.json({
      success: true,
      message: 'Password updated successfully! Logging you in...',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/students/:mobile/status
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
