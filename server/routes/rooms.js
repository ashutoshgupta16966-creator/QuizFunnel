const express = require('express');
const router = express.Router();
const multer = require('multer');
const Room = require('../models/Room');
const Student = require('../models/Student');
const Question = require('../models/Question');
const { parseQuizDocumentWithGemini } = require('../controllers/aiVisionController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
    files: 10,
  },
});

function enrichParticipantsWithLevels(participants, roomCode) {
  return Room.enrichParticipantsWithLevels(participants, roomCode);
}

// In-memory store for Admin Demo OTPs: adminPhone -> { otp, expiresAt }
const adminOtpStore = new Map();

/**
 * POST /api/rooms/create
 * Admin creates a new live quiz room.
 * Room Code uniqueness is scoped to (adminPhone + roomCode) for ACTIVE rooms.
 * Different hosts can reuse the same Room Code.
 */
router.post('/create', async (req, res, next) => {
  try {
    const { adminName, adminPhone, roomCode, roomPassword, quizTitle } = req.body;

    if (!adminName?.trim() || !adminPhone?.trim() || !roomCode?.trim() || !roomPassword?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Admin Name, Phone Number, Room Code, and Room Password are required.',
      });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);

    // Phone-scoped uniqueness: same host cannot have two ACTIVE rooms with same code
    const existing = await Room.findOne({ roomCode: normalizedCode, adminPhone: cleanPhone, status: 'active' });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `You already have an active room with code "${normalizedCode}". Close it first or choose a different code.`,
      });
    }

    const room = await Room.create({
      roomCode: normalizedCode,
      quizTitle: quizTitle?.trim() || '',
      adminName: adminName.trim(),
      adminPhone: cleanPhone,
      roomPassword: roomPassword.trim(),
      maxCapacity: 60,
      status: 'active',
      progressionMode: req.body.progressionMode === 'open_attempt' ? 'open_attempt' : 'level_gated',
      participants: [],
    });

    res.status(201).json({
      success: true,
      data: {
        roomCode: room.roomCode,
        quizTitle: room.quizTitle,
        adminName: room.adminName,
        maxCapacity: room.maxCapacity,
        progressionMode: room.progressionMode,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Middleware wrapper for multer upload handling friendly errors
 */
function handleFileUpload(req, res, next) {
  upload.array('files', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Total upload size exceeds 15 MB limit. Please upload fewer or smaller files.',
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: 'Maximum 10 files allowed per upload.',
        });
      }
      return res.status(400).json({ success: false, error: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
}

/**
 * POST /api/rooms/ai/parse
 * Uploads images/PDFs and parses them with Gemini Vision into structured questions, subject, and unit.
 */
router.post('/ai/parse', handleFileUpload, async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded. Please take a photo or select an image/PDF.',
      });
    }

    const result = await parseQuizDocumentWithGemini(files);
    res.json(result);
  } catch (err) {
    console.error('[AI Parse Error]:', err.message);
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to parse document with AI.',
    });
  }
});

/**
 * POST /api/rooms/create-ai
 * Confirms reviewed AI-generated questions and creates an isolated live room.
 * Stores questions in Question collection tagged with roomCode.
 */
router.post('/create-ai', async (req, res, next) => {
  try {
    const { adminName, adminPhone, roomCode, roomPassword, quizTitle, subject, unit, questions } = req.body;

    if (!adminName?.trim() || !adminPhone?.trim() || !roomCode?.trim() || !roomPassword?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Admin Name, Phone Number, Room Code, and Room Password are required.',
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one valid question is required to create an AI quiz room.',
      });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);

    // Phone-scoped uniqueness: same host cannot have two ACTIVE rooms with same code
    const existing = await Room.findOne({ roomCode: normalizedCode, adminPhone: cleanPhone, status: 'active' });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `You already have an active room with code "${normalizedCode}". Close it first or choose a different code.`,
      });
    }

    // Clean up any stale questions previously assigned to this room code
    await Question.deleteMany({ roomCode: normalizedCode });

    // Validate and sanitize questions to match QuestionSchema
    const questionDocs = [];
    for (const q of questions) {
      const qText = String(q.questionText || '').trim();
      if (!qText) continue;

      const isDirect = q.questionType === 'direct' ||
        ((!Array.isArray(q.options) || q.options.length === 0) && Boolean(q.directAnswer || q.correctAnswer));

      let lvl = parseInt(q.level, 10);
      if (isNaN(lvl) || lvl < 1 || lvl > 4) lvl = 1;

      const sec = ['GK', 'Technical', 'Reasoning', 'Aptitude', 'Mixed'].includes(q.section)
        ? q.section
        : 'Technical';

      const diff = ['easy', 'medium', 'hard'].includes(q.difficulty)
        ? q.difficulty
        : 'medium';

      const exp = String(q.explanation || '').trim();

      if (isDirect) {
        const directAns = String(q.directAnswer || q.correctAnswer || '').trim();
        if (!directAns) continue;

        questionDocs.push({
          roomCode: normalizedCode,
          questionType: 'direct',
          level: lvl,
          section: sec,
          questionText: qText,
          options: [],
          correctAnswerIndex: -1,
          directAnswer: directAns,
          difficulty: diff,
          explanation: exp,
        });
      } else {
        const opts = Array.isArray(q.options)
          ? q.options.map((o) => String(o).trim()).filter(Boolean)
          : [];
        if (opts.length !== 4) continue;

        let cIdx = parseInt(q.correctAnswerIndex, 10);
        if (isNaN(cIdx) || cIdx < 0 || cIdx > 3) cIdx = 0;

        questionDocs.push({
          roomCode: normalizedCode,
          questionType: 'mcq',
          level: lvl,
          section: sec,
          questionText: qText,
          options: opts,
          correctAnswerIndex: cIdx,
          directAnswer: opts[cIdx] || '',
          difficulty: diff,
          explanation: exp,
        });
      }
    }

    if (questionDocs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid questions found. MCQ questions require 4 options, while Direct questions require a correct answer.',
      });
    }

    // Insert questions strictly isolated to this room
    const inserted = await Question.insertMany(questionDocs);

    const room = await Room.create({
      roomCode: normalizedCode,
      quizTitle: quizTitle?.trim() || (subject ? `${subject} Quiz` : 'AI Generated Quiz'),
      adminName: adminName.trim(),
      adminPhone: cleanPhone,
      roomPassword: roomPassword.trim(),
      maxCapacity: 60,
      status: 'active',
      isAiGenerated: true,
      subject: subject?.trim() || '',
      unit: unit?.trim() || '',
      progressionMode: req.body.progressionMode === 'open_attempt' ? 'open_attempt' : 'level_gated',
      questions: inserted,
      participants: [],
    });

    res.status(201).json({
      success: true,
      data: {
        roomCode: room.roomCode,
        quizTitle: room.quizTitle,
        subject: room.subject,
        unit: room.unit,
        adminName: room.adminName,
        maxCapacity: room.maxCapacity,
        isAiGenerated: room.isAiGenerated,
        progressionMode: room.progressionMode,
        questionCount: inserted.length,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
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

    // ── Phone + Password Binding: prevent session/socket collisions ───────
    const existingStudentInDB = await Student.findOne({ mobile: cleanMobile }).lean();
    if (existingStudentInDB && existingStudentInDB.password !== password.trim()) {
      return res.status(401).json({
        success: false,
        error: 'You have already attempted this quiz using this mobile number. Please enter your secret PIN to authenticate or request a re-attempt.',
      });
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
      levels: [],
      joinedAt: new Date(),
      lastActive: new Date(),
    };

    if (existingParticipant) {
      const prevAttemptData = existingParticipant.previousAttempt || {
        score: existingParticipant.score || 0,
        timeTaken: existingParticipant.timeTaken || 0,
        level: existingParticipant.level || 1,
        status: existingParticipant.status || 'eliminated',
        isDisqualified: Boolean(existingParticipant.isDisqualified),
        levels: existingParticipant.levels || [],
        joinedAt: existingParticipant.joinedAt,
      };

      await Room.updateOne(
        { roomCode: normalizedCode, 'participants.mobile': cleanMobile },
        {
          $set: {
            'participants.$.status': 'in-progress',
            'participants.$.level': 1,
            'participants.$.score': 0,
            'participants.$.timeTaken': 0,
            'participants.$.levels': [],
            'participants.$.isDisqualified': false,
            'participants.$.isReattempt': isReattemptStudent,
            'participants.$.previousAttempt': prevAttemptData,
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
          quizTitle: room.quizTitle || '',
          adminName: room.adminName,
          maxCapacity: room.maxCapacity,
          isAiGenerated: Boolean(room.isAiGenerated),
          subject: room.subject || '',
          unit: room.unit || '',
          progressionMode: room.progressionMode || 'level_gated',
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

    const enrichedParticipants = await enrichParticipantsWithLevels(room.participants || [], normalizedCode);

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        adminPhone: room.adminPhone,
        maxCapacity: room.maxCapacity,
        status: room.status,
        participants: enrichedParticipants,
        participantCount: enrichedParticipants.length,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/admin/my-rooms
 * Returns all rooms (active and closed) created by a specific admin phone number.
 * Requires Admin Phone Number + PIN for host verification.
 * Used for the "My Live Rooms" history hub in the admin role modal.
 */
router.get('/admin/my-rooms', async (req, res, next) => {
  try {
    const { adminPhone, adminPIN } = req.query;

    if (!adminPhone?.trim()) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit phone number.' });
    }

    const rooms = await Room.find({ adminPhone: cleanPhone })
      .sort({ createdAt: -1 })
      .select('roomCode quizTitle adminName adminPhone roomPassword status maxCapacity participants createdAt updatedAt')
      .lean();

    if (rooms.length === 0) {
      return res.json({
        success: true,
        data: {
          adminPhone: cleanPhone,
          totalRooms: 0,
          rooms: [],
        },
      });
    }

    // If PIN is provided, verify it matches the host's room password
    if (adminPIN && adminPIN.trim()) {
      const pinMatches = rooms.some((r) => r.roomPassword === adminPIN.trim());
      if (!pinMatches) {
        return res.status(401).json({
          success: false,
          error: 'Incorrect Host PIN for this phone number.',
        });
      }
    }

    const roomList = rooms.map((r) => ({
      roomCode: r.roomCode,
      quizTitle: r.quizTitle || '',
      adminName: r.adminName,
      status: r.status,
      roomPassword: r.roomPassword,
      maxCapacity: r.maxCapacity || 60,
      participantCount: (r.participants || []).length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    res.json({
      success: true,
      data: {
        adminPhone: cleanPhone,
        totalRooms: roomList.length,
        rooms: roomList,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/admin/send-otp
 * Generates and stores a 4-digit Demo OTP for Host PIN recovery.
 */
router.post('/admin/send-otp', async (req, res, next) => {
  try {
    const { adminPhone } = req.body;
    if (!adminPhone?.trim()) {
      return res.status(400).json({ success: false, error: 'Admin Phone Number is required.' });
    }

    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit phone number.' });
    }

    const roomCount = await Room.countDocuments({ adminPhone: cleanPhone });
    if (roomCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'No rooms found associated with this phone number. Please create a room first.',
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    adminOtpStore.set(cleanPhone, { otp, expiresAt });

    console.log(`[Admin Host OTP] Phone: ${cleanPhone} -> Generated Demo OTP: ${otp}`);

    res.json({
      success: true,
      message: `4-digit OTP sent successfully to registered phone number.`,
      demoOtp: otp,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/admin/verify-otp
 * Verifies the 4-digit Demo OTP for Admin PIN recovery.
 */
router.post('/admin/verify-otp', async (req, res, next) => {
  try {
    const { adminPhone, otp } = req.body;
    if (!adminPhone || !otp) {
      return res.status(400).json({ success: false, error: 'Phone number and OTP are required.' });
    }

    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    const record = adminOtpStore.get(cleanPhone);

    if (!record || record.expiresAt < Date.now()) {
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
 * POST /api/rooms/admin/reset-pin
 * Updates the Room PIN / Host Password for all rooms created by this admin phone number.
 */
router.post('/admin/reset-pin', async (req, res, next) => {
  try {
    const { adminPhone, otp, newPIN } = req.body;
    if (!adminPhone || !otp || !newPIN) {
      return res.status(400).json({
        success: false,
        error: 'Admin Phone number, OTP, and new PIN are required.',
      });
    }

    const cleanPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    const pin = newPIN.trim();
    if (pin.length < 4) {
      return res.status(400).json({
        success: false,
        error: 'New PIN / Password must be at least 4 characters or digits.',
      });
    }

    const record = adminOtpStore.get(cleanPhone);
    if (!record || record.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        error: 'OTP verification failed or expired. Please restart password reset.',
      });
    }

    // Update roomPassword for all rooms created by this admin
    const updateResult = await Room.updateMany(
      { adminPhone: cleanPhone },
      { $set: { roomPassword: pin } }
    );

    adminOtpStore.delete(cleanPhone);

    res.json({
      success: true,
      message: 'Host PIN / Room Password updated successfully.',
      modifiedCount: updateResult.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/ai/generate-options
 * Uses Gemini to auto-generate 4 plausible MCQ options + correct answer index
 * for a given question text. Used by the admin in the AI Quiz Review editor.
 */
router.post('/ai/generate-options', async (req, res, next) => {
  try {
    const { questionText } = req.body;
    if (!questionText?.trim()) {
      return res.status(400).json({ success: false, error: 'questionText is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'Gemini API key not configured.' });
    }

    let GoogleGenAI;
    try {
      const genaiPkg = require('@google/genai');
      GoogleGenAI = genaiPkg.GoogleGenAI;
    } catch (e) {
      console.warn('[generate-options]: @google/genai SDK not available:', e.message);
    }

    if (!GoogleGenAI) {
      return res.status(500).json({ success: false, error: '@google/genai SDK not available on server.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const FALLBACK_MODELS = [
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.6-flash-lite',
      'gemini-3.5-flash',
    ];
    let result = null;

    const prompt = `You are an expert quiz question generator.

Given this quiz question:
"${questionText.trim()}"

Generate exactly 4 plausible multiple-choice options (A, B, C, D).
- One option MUST be the correct answer.
- The other 3 should be convincing distractors — plausible but wrong.
- Keep each option concise (under 15 words).

Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):
{"options":["Option A text","Option B text","Option C text","Option D text"],"correctIndex":0}

Where correctIndex is 0-based (0=A, 1=B, 2=C, 3=D).`;

    for (const modelName of FALLBACK_MODELS) {
      try {
        let response;
        try {
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: { responseMimeType: 'application/json' },
          });
        } catch {
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
          });
        }

        const raw = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleaned);

        if (
          Array.isArray(parsed.options) &&
          parsed.options.length === 4 &&
          typeof parsed.correctIndex === 'number' &&
          parsed.correctIndex >= 0 &&
          parsed.correctIndex <= 3
        ) {
          result = parsed;
          break;
        }
      } catch (modelErr) {
        console.warn(`[generate-options] Model ${modelName} failed:`, modelErr.message);
        continue;
      }
    }

    if (!result) {
      return res.status(500).json({ success: false, error: 'Failed to generate options. Please try again or enter manually.' });
    }

    res.json({ success: true, data: result });
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

    // Mark request status as 'approved' — participant stats are NOT reset here.
    // Stats reset is deferred: happens when the student actually re-joins via POST /join.
    // This preserves the student's previous score/status on Admin Dashboard until
    // the student clicks through and submits their first answer in the new attempt.
    await Room.updateOne(
      { roomCode: normalizedCode, 'reattemptRequests.mobile': cleanMobile },
      { $set: { 'reattemptRequests.$.status': 'approved' } }
    );

    const student = await Student.findOne({ mobile: cleanMobile }).lean();

    // Broadcast socket event ONLY to trigger student auto-redirect from waiting screen.
    // The student will then call POST /join which performs the actual reset.
    const io = req.app.get('io');
    if (io) {
      const payload = {
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
      };
      io.to(`room:${normalizedCode}`).emit('reattempt:approved', payload);
      io.to(`room:${normalizedCode}`).emit('reattempt_approved', payload);
    }

    res.json({ success: true, message: 'Re-attempt approved. Student will be redirected to re-join.' });
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
      const denyPayload = {
        mobile: cleanMobile,
        message: 'Re-attempt denied by Host',
      };
      io.to(`room:${normalizedCode}`).emit('reattempt:denied', denyPayload);
      io.to(`room:${normalizedCode}`).emit('reattempt_denied', denyPayload);
    }

    res.json({ success: true, message: 'Re-attempt denied.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode/export
 * Generates and downloads styled Excel (.xlsx) file of room results using exceljs.
 */
router.get('/:roomCode/export', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { password } = req.query;

    if (!roomCode) {
      return res.status(400).json({ success: false, error: 'Room code is required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode }).lean();

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    if (password && room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Invalid room credentials.' });
    }

    const ExcelJS = require('exceljs');
    const enrichedParticipants = await Room.enrichParticipantsWithLevels(room.participants || [], normalizedCode);

    // Sort by score desc, time taken asc (same as table)
    const sorted = [...enrichedParticipants].sort((a, b) => {
      const scoreA = a.computedTotalScore ?? a.score ?? 0;
      const scoreB = b.computedTotalScore ?? b.score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const timeA = a.computedTotalTime ?? a.timeTaken ?? 0;
      const timeB = b.computedTotalTime ?? b.timeTaken ?? 0;
      return timeA - timeB;
    });

    const formatTimeMMSS = (seconds) => {
      if (!seconds && seconds !== 0) return '00:00';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const getStatusLabel = (p) => {
      if (p.isDisqualified) return 'Disqualified';
      if (p.status === 'completed' || p.status === 'advanced') return 'Passed';
      if (p.status === 'eliminated') return 'Failed';
      return 'In Progress';
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QuizFunnel';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Results');

    // 1. Remove Excel default gridline clutter
    worksheet.views = [{ showGridLines: false }];

    // 2. Define columns
    worksheet.columns = [
      { header: 'Rank', key: 'rank', width: 10 },
      { header: 'Student Name', key: 'name', width: 24 },
      { header: 'Phone Number', key: 'phone', width: 18 },
      { header: 'Branch', key: 'branch', width: 14 },
      { header: 'Level Reached', key: 'level', width: 16 },
      { header: 'Total Score', key: 'score', width: 14 },
      { header: 'Completion Time', key: 'time', width: 18 },
      { header: 'Status', key: 'status', width: 16 },
    ];

    // 3. Format header row
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF111827' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'medium', color: { argb: 'FF9CA3AF' } },
        left: colNumber === 1 ? { style: 'thin', color: { argb: 'FFD1D5DB' } } : undefined,
        right: colNumber === worksheet.columns.length ? { style: 'thin', color: { argb: 'FFD1D5DB' } } : undefined,
      };
    });

    // 4. Populate data rows
    sorted.forEach((p, idx) => {
      const row = worksheet.addRow({
        rank: idx + 1,
        name: p.name || '—',
        phone: p.mobile || '—',
        branch: p.branch || '—',
        level: p.level || 1,
        score: p.computedTotalScore ?? p.score ?? 0,
        time: formatTimeMMSS(p.computedTotalTime ?? p.timeTaken ?? 0),
        status: getStatusLabel(p),
      });

      row.height = 24;
      row.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF1F2937' } };

      // Center-align all cells and add light row divider border
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });
    });

    // 5. Auto-fit column widths based on content length with sensible minimums
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const str = cell.value != null ? cell.value.toString() : '';
        if (str.length > maxLength) {
          maxLength = str.length;
        }
      });
      column.width = Math.max(maxLength + 5, 12);
    });

    const filename = `QuizFunnel_Room_${normalizedCode}_Results.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms/:roomCode/questions
 * Returns dynamic questions for the room, checking both Room.questions array
 * and Question collection, guaranteeing students can load questions reliably.
 */
router.get('/:roomCode/questions', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { level } = req.query;

    if (!roomCode) {
      return res.status(400).json({ success: false, error: 'Room code is required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ roomCode: normalizedCode }).lean();

    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found.' });
    }

    let roomQuestions = [];
    if (Array.isArray(room.questions) && room.questions.length > 0) {
      roomQuestions = room.questions;
    } else {
      roomQuestions = await Question.find({ roomCode: normalizedCode }).lean();
    }

    const targetLevel = parseInt(level, 10) || 1;

    // Fallback for manual rooms: load default questions for this level
    if (roomQuestions.length === 0) {
      const defaultFilter = { $or: [{ roomCode: null }, { roomCode: { $exists: false } }, { roomCode: '' }] };
      roomQuestions = await Question.find({ level: targetLevel, ...defaultFilter }).lean();
    }

    // If level filter provided and matching questions exist, filter by level
    let filteredQuestions = roomQuestions;
    if (!isNaN(targetLevel) && targetLevel >= 1 && targetLevel <= 4) {
      const levelMatches = roomQuestions.filter((q) => q.level === targetLevel);
      if (levelMatches.length > 0) {
        filteredQuestions = levelMatches;
      }
    }

    // Sanitize questions for student: strip correctAnswerIndex and directAnswer
    const clientQuestions = filteredQuestions.map((q) => ({
      _id: q._id,
      questionText: q.questionText,
      questionType: q.questionType || (q.options && q.options.length > 0 ? 'mcq' : 'direct'),
      options: q.options || [],
      level: q.level || targetLevel,
      section: q.section || 'Technical',
      difficulty: q.difficulty || 'medium',
    }));

    // Auto-sync session for student if mobile is provided
    const mobile = (req.headers['x-student-mobile'] || req.query.mobile || '').trim();
    if (mobile && clientQuestions.length > 0) {
      const sessionQuestions = clientQuestions.map((q) => ({
        questionId: q._id,
        questionType: q.questionType,
        shuffleMap: [0, 1, 2, 3],
      }));
      const Student = require('../models/Student');
      await Student.updateOne(
        { mobile },
        {
          $set: {
            quizSession: {
              level: targetLevel,
              startedAt: new Date(),
              questions: sessionQuestions,
            },
          },
        }
      ).catch((e) => console.warn('[syncSession Error]:', e.message));
    }

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        quizTitle: room.quizTitle || '',
        subject: room.subject || '',
        unit: room.unit || '',
        isAiGenerated: Boolean(room.isAiGenerated),
        questions: clientQuestions,
        total: clientQuestions.length,
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

    const enrichedParticipants = await enrichParticipantsWithLevels(room.participants || [], normalizedCode);

    res.json({
      success: true,
      data: {
        roomCode: room.roomCode,
        adminName: room.adminName,
        adminPhone: room.adminPhone,
        maxCapacity: room.maxCapacity,
        status: room.status,
        participants: enrichedParticipants,
        participantCount: enrichedParticipants.length,
        reattemptRequests: (room.reattemptRequests || []).filter((r) => r.status === 'pending'),
        quizTitle: room.quizTitle || '',
        isAiGenerated: Boolean(room.isAiGenerated),
        subject: room.subject || '',
        unit: room.unit || '',
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

/**
 * POST /api/rooms/:roomCode/rename
 * Host renames a room session.
 */
router.post('/:roomCode/rename', async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const { quizTitle, adminPhone, password } = req.body;

    if (!roomCode) {
      return res.status(400).json({ success: false, error: 'Room code is required.' });
    }
    if (!quizTitle || !quizTitle.trim()) {
      return res.status(400).json({ success: false, error: 'Quiz title cannot be empty.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const query = { roomCode: normalizedCode };
    if (adminPhone) {
      query.adminPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    }

    const room = await Room.findOne(query);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room session not found.' });
    }

    if (password && room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect room password / PIN.' });
    }

    room.quizTitle = quizTitle.trim();
    await room.save();

    res.json({
      success: true,
      message: 'Room session renamed successfully.',
      data: {
        roomCode: room.roomCode,
        quizTitle: room.quizTitle,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms/:roomCode/delete or DELETE /api/rooms/:roomCode
 * Permanently deletes room session and student logs, releasing roomCode.
 */
const deleteRoomHandler = async (req, res, next) => {
  try {
    const { roomCode } = req.params;
    const adminPhone = req.body?.adminPhone || req.query?.adminPhone;
    const password = req.body?.password || req.query?.password;

    if (!roomCode) {
      return res.status(400).json({ success: false, error: 'Room code is required.' });
    }

    const normalizedCode = roomCode.trim().toUpperCase();
    const query = { roomCode: normalizedCode };
    if (adminPhone) {
      query.adminPhone = adminPhone.trim().replace(/\D/g, '').slice(-10);
    }

    const room = await Room.findOne(query);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room session not found.' });
    }

    if (password && room.roomPassword !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Incorrect room password / PIN.' });
    }

    // 1. Delete Room record from MongoDB
    await Room.deleteOne({ _id: room._id });

    // 2. Clean up student attempt records associated with this room code
    await Student.updateMany(
      { 'attemptHistory.roomCode': normalizedCode },
      { $pull: { attemptHistory: { roomCode: normalizedCode } } }
    );

    // 3. Clean up any AI-generated questions associated with this room code
    await Question.deleteMany({ roomCode: normalizedCode });

    res.json({
      success: true,
      message: `Room "${normalizedCode}" deleted successfully. The code is now released for new sessions.`,
    });
  } catch (err) {
    next(err);
  }
};

router.post('/:roomCode/delete', deleteRoomHandler);
router.delete('/:roomCode', deleteRoomHandler);

module.exports = router;
