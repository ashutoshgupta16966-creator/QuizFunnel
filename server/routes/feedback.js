const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');

/**
 * POST /api/feedback
 * Submit immutable feedback / experience review for a quiz attempt.
 */
router.post('/', async (req, res, next) => {
  try {
    const { mobile, attemptId, rating, comment } = req.body;

    if (!mobile || !attemptId || !rating) {
      return res.status(400).json({
        success: false,
        error: 'Mobile, attemptId, and rating (1-5) are required.',
      });
    }

    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be an integer between 1 and 5.',
      });
    }

    // Immutability Check: If feedback already exists for this attempt, do not overwrite!
    const existing = await Feedback.findOne({
      mobile: String(mobile).trim(),
      attemptId: String(attemptId).trim(),
    }).lean();

    if (existing) {
      return res.json({
        success: true,
        message: 'Feedback already submitted for this attempt.',
        isExisting: true,
        data: existing,
      });
    }

    const feedback = await Feedback.create({
      mobile: String(mobile).trim(),
      attemptId: String(attemptId).trim(),
      rating: numRating,
      comment: typeof comment === 'string' ? comment.trim() : '',
      submittedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Feedback recorded successfully.',
      isExisting: false,
      data: feedback,
    });
  } catch (err) {
    // Catch duplicate key race conditions gracefully
    if (err.code === 11000) {
      const existing = await Feedback.findOne({
        mobile: String(req.body.mobile).trim(),
        attemptId: String(req.body.attemptId).trim(),
      }).lean();
      return res.json({
        success: true,
        message: 'Feedback already submitted for this attempt.',
        isExisting: true,
        data: existing,
      });
    }
    next(err);
  }
});

/**
 * GET /api/feedback/:attemptId
 * Retrieve feedback for a specific attempt.
 */
router.get('/:attemptId', async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { mobile } = req.query;

    const query = { attemptId: String(attemptId).trim() };
    if (mobile) query.mobile = String(mobile).trim();

    const feedback = await Feedback.findOne(query).lean();
    if (!feedback) {
      return res.json({ success: true, data: null });
    }

    res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
