const express = require('express');
const router = express.Router();
const db2 = require('../db2');

/**
 * GET /api/db2/health
 * Returns status of Db2 connection (enabled, connected).
 */
router.get('/health', (req, res) => {
  const connected = db2.isReady();
  res.json({
    success: true,
    enabled: db2.DB2_ENABLED,
    connected,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/db2/leaderboard/:roomId
 * Returns top scores from Db2 for the given room.
 */
router.get('/leaderboard/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ success: false, error: 'roomId parameter is required' });
    }
    const data = await db2.getLeaderboard(roomId);
    res.json({
      success: true,
      connected: db2.isReady(),
      data,
    });
  } catch (err) {
    res.json({
      success: true,
      connected: false,
      data: [],
      error: err.message,
    });
  }
});

/**
 * GET /api/db2/stats/:roomId
 * Returns participants count, answers count, and average score from Db2.
 */
router.get('/stats/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ success: false, error: 'roomId parameter is required' });
    }
    const data = await db2.getStats(roomId);
    res.json({
      success: true,
      connected: db2.isReady(),
      data,
    });
  } catch (err) {
    res.json({
      success: true,
      connected: false,
      data: {
        roomId: req.params.roomId,
        participantsCount: 0,
        answersCount: 0,
        averageScore: 0,
      },
      error: err.message,
    });
  }
});

module.exports = router;
