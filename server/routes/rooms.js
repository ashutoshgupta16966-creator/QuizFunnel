const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const Student = require('../models/Student');

/**
 * POST /api/rooms/create
 * Admin creates a new live quiz room.
 */
router.post('/create', async (req, res, next) => {
  try {
    const { adminName, adminPhone, roomCode, roomPassword } = req.body;

    if (!adminName?.trim() || !adminPhone?.trim() || !roomCode?.trim() || !roomPassword?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Admin Name, Phone Number, Room Code, and Room Password are required.',
      });
    }

    const normalizedCode = roomCode.trim().toUpperCase();

    // Check if an active room already exists with this code
    const existing = await Room.findOne({ roomCode: normalizedCode, status: 'active' });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `Room Code "${normalizedCode}" is currently active. Please choose a different code or click Auto-Generate.`,
      });
    }

    const room = await Room.create({
      roomCode: normalizedCode,
      adminName: adminName.trim(),
      adminPhone: adminPhone.trim(),
      roomPassword: roomPassword.trim(),
      maxCapacity: 60,
      status: 'active',
      participants: [],
    });

    res.status(201).json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        maxCapacity: room.maxCapacity,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A room with this code already exists. Please choose a different code.',
      });
    }
    next(err);
  }
});

/**
 * POST /api/rooms/verify
 * Checks whether room exists, password matches, and capacity is available.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { roomCode, roomPassword } = req.body;

    if (!roomCode?.trim() || !roomPassword?.trim()) {
      return res.status(400).json({ success: false, error: 'Room Code and Password are required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode });

    if (!room || room.status !== 'active') {
      return res.status(404).json({ success: false, error: 'Room not found or is no longer active.' });
    }

    if (room.roomPassword !== roomPassword.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect Room Password.' });
    }

    const currentCount = (room.participants || []).length;
    const isFull = currentCount >= (room.maxCapacity || 60);

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        currentCount,
        maxCapacity: room.maxCapacity || 60,
        isFull,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/join
 * Student joins room session: validates credentials, checks capacity (max 60),
 * registers student, and broadcasts to admin dashboard.
 */
router.post('/join', async (req, res, next) => {
  try {
    const { roomCode, roomPassword, name, mobile, branch, password } = req.body;

    if (!roomCode?.trim() || !roomPassword?.trim()) {
      return res.status(400).json({ success: false, error: 'Room Code and Room Password are required.' });
    }

    if (!name?.trim() || !mobile?.trim() || !branch?.trim() || !password?.trim()) {
      return res.status(400).json({ success: false, error: 'Name, Mobile, Branch, and Password are required.' });
    }

    const cleanMobile = mobile.trim();
    if (!/^\d{10}$/.test(cleanMobile)) {
      return res.status(400).json({ success: false, error: 'Mobile number must be exactly 10 digits.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode });

    if (!room || room.status !== 'active') {
      return res.status(404).json({ success: false, error: 'Room not found or has been closed by the host.' });
    }

    if (room.roomPassword !== roomPassword.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect Room Password.' });
    }

    // ── Capacity Validation: Max 60 students ─────────────────────────────
    const existingParticipant = (room.participants || []).find((p) => p.mobile === cleanMobile);
    if (!existingParticipant && (room.participants || []).length >= (room.maxCapacity || 60)) {
      return res.status(403).json({
        success: false,
        error: 'Room Full (Max 60 students allowed)',
      });
    }

    // ── STRICT HOST-APPROVED RE-ATTEMPT GUARD ──────────────────────────
    // Completed, failed, or disqualified students CANNOT directly log back into roomId.
    const isCompletedOrFailed = Boolean(
      existingParticipant && (
        existingParticipant.status === 'completed' ||
        existingParticipant.status === 'eliminated' ||
        existingParticipant.isDisqualified ||
        existingParticipant.level > 1 ||
        existingParticipant.score > 0
      )
    );

    if (isCompletedOrFailed) {
      // Check if an approval has been granted by host
      const approvedReq = (room.reattemptRequests || []).find(
        (r) => r.mobile === cleanMobile && r.status === 'approved'
      );

      if (!approvedReq) {
        // Enforce pending queue
        const existingReq = (room.reattemptRequests || []).find(
          (r) => r.mobile === cleanMobile && r.status === 'pending'
        );

        if (!existingReq) {
          const newRequest = {
            mobile: cleanMobile,
            name: name.trim(),
            branch: branch.trim(),
            status: 'pending',
            requestedAt: new Date(),
            previousStatus: existingParticipant.status,
            previousScore: existingParticipant.score || 0,
          };
          await Room.updateOne(
            { roomCode: normalizedCode },
            { $push: { reattemptRequests: newRequest } }
          );

          // Broadcast live alert to admin if active on Live Dashboard
          const io = req.app.get('io');
          if (io) {
            io.to(`room:${normalizedCode}`).emit('admin:reattempt-request', newRequest);
          }
        }

        return res.json({
          success: true,
          status: 'PENDING_HOST_APPROVAL',
          pendingApproval: true,
          roomCode: room.roomCode,
          mobile: cleanMobile,
          name: name.trim(),
          message: 'Waiting for Host Approval... Please ask your Admin to approve your request.',
        });
      }

      // If approved, mark request as consumed
      await Room.updateOne(
        { roomCode: normalizedCode, 'reattemptRequests.mobile': cleanMobile },
        { $set: { 'reattemptRequests.$.status': 'consumed' } }
      );
    }

    // Register / update student in main Student collection
    let student = await Student.findOne({ mobile: cleanMobile });
    if (!student) {
      student = await Student.create({
        name: name.trim(),
        mobile: cleanMobile,
        branch: branch.trim(),
        password: password.trim(),
        status: 'in-progress',
        currentLevel: 1,
        levels: [],
      });
    } else {
      // If student already exists, update their active round state
      student.name = name.trim();
      student.branch = branch.trim();
      student.status = 'in-progress';
      student.currentLevel = 1;
      student.levels = [];
      student.quizSession = null;
      await student.save();
    }

    // Add or update participant entry in room
    const isReattemptStudent = Boolean(existingParticipant && (isCompletedOrFailed || existingParticipant.isReattempt));
    const participantDoc = {
      mobile: cleanMobile,
      name: name.trim(),
      branch: branch.trim(),
      level: 1,
      score: 0,
      timeTaken: 0,
      status: 'in-progress',
      isDisqualified: false,
      isReattempt: isReattemptStudent,
      joinedAt: new Date(),
      lastActive: new Date(),
    };

    if (existingParticipant) {
      await Room.updateOne(
        { roomCode: normalizedCode, 'participants.mobile': cleanMobile },
        {
          $set: {
            'participants.$.status': 'in-progress',
            'participants.$.level': 1,
            'participants.$.score': 0,
            'participants.$.isDisqualified': false,
            'participants.$.isReattempt': isReattemptStudent,
            'participants.$.lastActive': new Date(),
          },
        }
      );
    } else {
      await Room.updateOne(
        { roomCode: normalizedCode },
        { $push: { participants: participantDoc } }
      );
    }

    // Broadcast live event to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`room:${normalizedCode}`).emit('student:joined', participantDoc);
    }

    res.json({
      success: true,
      data: {
        student: {
          name: student.name,
          mobile: student.mobile,
          branch: student.branch,
          status: student.status,
          currentLevel: student.currentLevel,
        },
        room: {
          roomCode: room.roomCode,
          adminName: room.adminName,
          maxCapacity: room.maxCapacity,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/admin/rejoin
 * Allows an admin to re-connect to a room they created by verifying
 * adminPhone + roomCode + roomPassword.
 * Works regardless of room.status (active OR closed) so admins can view final stats.
 */
router.post('/admin/rejoin', async (req, res, next) => {
  try {
    const { adminPhone, roomCode, roomPassword } = req.body;

    if (!adminPhone || !roomCode || !roomPassword) {
      return res
        .status(400)
        .json({ success: false, error: 'adminPhone, roomCode, and roomPassword are all required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanPhone = adminPhone.toString().replace(/\D/g, '').slice(-10);

    const room = await Room.findOne({ roomCode: normalizedCode }).lean();

    if (!room) {
      return res.status(404).json({ success: false, error: 'No room found with that Room Code.' });
    }

    // Verify admin phone
    const storedPhone = room.adminPhone?.toString().replace(/\D/g, '').slice(-10) || '';
    if (storedPhone !== cleanPhone) {
      return res.status(401).json({ success: false, error: 'Admin Phone Number does not match.' });
    }

    // Verify room password
    if (room.roomPassword !== roomPassword.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect Room Password.' });
    }

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        adminPhone: room.adminPhone,
        maxCapacity: room.maxCapacity,
        status: room.status,
        participants: room.participants || [],
        participantCount: (room.participants || []).length,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode/analytics
 * Aggregates per-question performance stats across all students who participated
 * in this room. Returns question text, correct %, wrong %, and most-common
 * wrong answer for each question grouped by level.
 *
 * Requires ?password= query param for admin auth.
 */
router.get('/:roomCode/analytics', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { password } = req.query;
    const normalizedCode = roomCode.trim().toUpperCase();

    // Auth: verify room + password
    const room = await Room.findOne({ roomCode: normalizedCode }).lean();
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }
    if (!password || room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Invalid room credentials.' });
    }

    // Pull in models needed here
    const Student  = require('../models/Student');
    const Question = require('../models/Question');

    // Find all students who have a room attempt for this roomCode
    const students = await Student.find({
      'attemptHistory.roomCode': normalizedCode,
    }).lean();

    // Collect all questionIds seen across all students & levels
    const allQuestionIds = new Set();
    // Map: questionId → { level, correctCount, totalCount, wrongOptionCounts: {origIdx: n} }
    const qStats = {};

    for (const student of students) {
      const roomAttempts = (student.attemptHistory || []).filter(
        (h) => h.roomCode === normalizedCode
      );

      for (const attempt of roomAttempts) {
        const levelsSummary = attempt.levelsSummary || [];

        for (const lvl of levelsSummary) {
          const lvlNum = lvl.level;
          for (const ans of (lvl.answers || [])) {
            const qId = ans.questionId?.toString();
            if (!qId) continue;
            allQuestionIds.add(qId);

            if (!qStats[qId]) {
              qStats[qId] = { level: lvlNum, correctCount: 0, totalCount: 0, wrongOptionCounts: {} };
            }
            qStats[qId].totalCount++;

            if (ans.isCorrect) {
              qStats[qId].correctCount++;
            } else {
              // Map shuffled selectedIndex back to original index
              const origIdx = Array.isArray(ans.shuffleMap) && Number.isInteger(ans.selectedIndex) && ans.selectedIndex >= 0
                ? ans.shuffleMap[ans.selectedIndex]
                : null;
              if (origIdx !== null && origIdx !== undefined) {
                qStats[qId].wrongOptionCounts[origIdx] = (qStats[qId].wrongOptionCounts[origIdx] || 0) + 1;
              }
            }
          }
        }
      }
    }

    // Fetch question texts for all seen question IDs
    const qIdArray = Array.from(allQuestionIds);
    const dbQuestions = await Question.find({ _id: { $in: qIdArray } }).lean();
    const qMap = Object.fromEntries(dbQuestions.map((q) => [q._id.toString(), q]));

    // Build per-level analytics structure
    const byLevel = {};
    for (const [qId, stat] of Object.entries(qStats)) {
      const q = qMap[qId];
      if (!q) continue;

      const lvl = stat.level;
      if (!byLevel[lvl]) byLevel[lvl] = [];

      const correctPct = stat.totalCount > 0
        ? Math.round((stat.correctCount / stat.totalCount) * 100)
        : 0;
      const wrongPct = 100 - correctPct;

      // Find most common wrong answer
      let mostCommonWrongIndex = null;
      let mostCommonWrongCount = 0;
      for (const [idx, count] of Object.entries(stat.wrongOptionCounts)) {
        if (count > mostCommonWrongCount) {
          mostCommonWrongCount = count;
          mostCommonWrongIndex = parseInt(idx, 10);
        }
      }

      byLevel[lvl].push({
        questionId: qId,
        questionText: q.questionText,
        options: q.options,
        correctAnswerIndex: q.correctAnswerIndex,
        section: q.section,
        difficulty: q.difficulty || 'medium',
        totalAttempts: stat.totalCount,
        correctCount: stat.correctCount,
        wrongCount: stat.totalCount - stat.correctCount,
        correctPct,
        wrongPct,
        mostCommonWrongIndex,
        mostCommonWrongText:
          mostCommonWrongIndex !== null && q.options[mostCommonWrongIndex]
            ? q.options[mostCommonWrongIndex]
            : null,
        mostCommonWrongCount,
      });
    }

    // Sort each level's questions by correctPct ascending (hardest first)
    for (const lvl of Object.keys(byLevel)) {
      byLevel[lvl].sort((a, b) => a.correctPct - b.correctPct);
    }

    res.json({
      success: true,
      data: {
        roomCode: normalizedCode,
        totalStudents: students.length,
        byLevel,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode/reattempt-status
 * Student polls for their re-attempt request status.
 */
router.get('/:roomCode/reattempt-status', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { mobile } = req.query;

    if (!roomCode || !mobile) {
      return res.status(400).json({ success: false, error: 'roomCode and mobile are required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanMobile = mobile.trim();
    const room = await Room.findOne({ roomCode: normalizedCode }).lean();

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    const reqEntry = (room.reattemptRequests || [])
      .filter((r) => r.mobile === cleanMobile)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0];

    const student = await Student.findOne({ mobile: cleanMobile }).lean();

    res.json({
      success: true,
      data: {
        status: reqEntry ? reqEntry.status : 'none',
        mobile: cleanMobile,
        student: student ? {
          name: student.name,
          mobile: student.mobile,
          branch: student.branch,
          status: student.status,
          currentLevel: student.currentLevel,
        } : null,
        room: {
          roomCode: room.roomCode,
          adminName: room.adminName,
          maxCapacity: room.maxCapacity,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/approve-reattempt
 * Host admin approves a pending re-attempt request.
 */
router.post('/:roomCode/approve-reattempt', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { mobile, password } = req.body;

    if (!roomCode || !mobile || !password) {
      return res.status(400).json({ success: false, error: 'roomCode, mobile, and password are required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanMobile = mobile.trim();
    const room = await Room.findOne({ roomCode: normalizedCode });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    if (room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect room password.' });
    }

    // Update request status to 'approved'
    await Room.updateOne(
      { roomCode: normalizedCode, 'reattemptRequests.mobile': cleanMobile },
      { $set: { 'reattemptRequests.$.status': 'approved' } }
    );

    // Reset student participant record in room
    await Room.updateOne(
      { roomCode: normalizedCode, 'participants.mobile': cleanMobile },
      {
        $set: {
          'participants.$.level': 1,
          'participants.$.score': 0,
          'participants.$.timeTaken': 0,
          'participants.$.status': 'in-progress',
          'participants.$.isDisqualified': false,
          'participants.$.isReattempt': true,
          'participants.$.lastActive': new Date(),
        },
      }
    );

    // Reset student active session in main Student collection
    const student = await Student.findOne({ mobile: cleanMobile });
    if (student) {
      student.status = 'in-progress';
      student.currentLevel = 1;
      student.levels = [];
      student.quizSession = null;
      await student.save();
    }

    // Broadcast socket event to student and dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`room:${normalizedCode}`).emit('reattempt:approved', {
        mobile: cleanMobile,
        student: student ? {
          name: student.name,
          mobile: student.mobile,
          branch: student.branch,
          status: student.status,
          currentLevel: student.currentLevel,
        } : null,
        room: {
          roomCode: room.roomCode,
          adminName: room.adminName,
          maxCapacity: room.maxCapacity,
        },
      });

      io.to(`room:${normalizedCode}`).emit('student:updated', {
        mobile: cleanMobile,
        level: 1,
        score: 0,
        timeTaken: 0,
        status: 'in-progress',
        isDisqualified: false,
        isReattempt: true,
        lastActive: new Date(),
      });
    }

    res.json({ success: true, message: 'Re-attempt approved successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/deny-reattempt
 * Host admin denies a pending re-attempt request.
 */
router.post('/:roomCode/deny-reattempt', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { mobile, password } = req.body;

    if (!roomCode || !mobile || !password) {
      return res.status(400).json({ success: false, error: 'roomCode, mobile, and password are required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanMobile = mobile.trim();
    const room = await Room.findOne({ roomCode: normalizedCode });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    if (room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect room password.' });
    }

    // Update request status to 'denied'
    await Room.updateOne(
      { roomCode: normalizedCode, 'reattemptRequests.mobile': cleanMobile },
      { $set: { 'reattemptRequests.$.status': 'denied' } }
    );

    // Broadcast socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`room:${normalizedCode}`).emit('reattempt:denied', {
        mobile: cleanMobile,
        message: 'Re-attempt denied by Host',
      });
    }

    res.json({ success: true, message: 'Re-attempt denied.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode
 * Fetches room details, status, and participant list for the Live Room Dashboard.
 */
router.get('/:roomCode', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { password } = req.query;

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode }).lean();

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    // Check optional admin authorization
    if (password && room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Invalid room credentials.' });
    }

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        adminPhone: room.adminPhone,
        maxCapacity: room.maxCapacity,
        status: room.status,
        participants: room.participants || [],
        participantCount: (room.participants || []).length,
        reattemptRequests: (room.reattemptRequests || []).filter((r) => r.status === 'pending'),
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/close
 * Admin closes the room.
 */
router.post('/:roomCode/close', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { password } = req.body;

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode });

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    if (room.roomPassword !== password?.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect room password.' });
    }

    room.status = 'closed';
    await room.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`room:${normalizedCode}`).emit('room_closed', {
        message: 'The Host has ended this room session. 🚪',
      });
      io.to(`room:${normalizedCode}`).emit('room:closed', {
        message: 'The Host has ended this room session. 🚪',
      });
    }

    res.json({ success: true, message: 'Room closed successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
