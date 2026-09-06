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
    const participantDoc = {
      mobile: cleanMobile,
      name: name.trim(),
      branch: branch.trim(),
      level: 1,
      score: 0,
      timeTaken: 0,
      status: 'in-progress',
      isDisqualified: false,
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
      io.to(`room:${normalizedCode}`).emit('room:closed', {
        message: 'The room has been closed by the host admin.',
      });
    }

    res.json({ success: true, message: 'Room closed successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
