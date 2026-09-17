const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Student = require('../models/Student');
const Room = require('../models/Room');
const LEVELS = require('../config/levels');
const { sanitizeMcqOptions, isGenericPlaceholderOption } = require('../controllers/aiVisionController');

/**
 * Fisher-Yates shuffle for 4 option indices.
 * Returns:
 *   shuffleMap[newPosition] = originalPosition
 *   shuffledOptions[newPosition] = original option at originalPosition
 *
 * Scoring logic (in /submit):
 *   student picks newPosition → originalPosition = shuffleMap[newPosition]
 *   isCorrect = (originalPosition === question.correctAnswerIndex)
 */
function shuffleOptions(options, questionText = '', section = 'Technical') {
  let cleanOpts = Array.isArray(options) ? options : [];
  if (cleanOpts.length < 4 || cleanOpts.some(isGenericPlaceholderOption)) {
    const sanitized = sanitizeMcqOptions(questionText, cleanOpts, '', 0, section);
    cleanOpts = sanitized.options;
  }
  const indices = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    shuffledOptions: indices.map((i) => cleanOpts[i]),
    shuffleMap: indices,
  };
}

/**
 * GET /api/quiz/questions/:level
 * Fetches and shuffles questions for the requested level.
 * Requires X-Student-Mobile header.
 *
 * On page refresh: detects an existing active session and returns the SAME
 * shuffled questions (consistent with stored shuffleMap for scoring).
 */
router.get('/questions/:level', async (req, res, next) => {
  try {
    const level = parseInt(req.params.level, 10);
    const mobile = req.headers['x-student-mobile'];

    if (!mobile) {
      return res.status(400).json({ success: false, error: 'X-Student-Mobile header is required.' });
    }
    if (!LEVELS[level]) {
      return res.status(400).json({ success: false, error: `Invalid level: ${level}.` });
    }

    const student = await Student.findOne({ mobile });
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found. Please register first.' });
    }

    // Guard: student must be at this level
    if (student.currentLevel !== level) {
      return res.status(403).json({
        success: false,
        error: `You are on level ${student.currentLevel}, not level ${level}.`,
      });
    }

    // Guard: level must not have been submitted already
    const alreadySubmitted = student.levels.some(
      (l) => l.level === level && l.submittedAt
    );
    if (alreadySubmitted) {
      return res.status(403).json({ success: false, error: 'This level has already been submitted.' });
    }

    // ── Check if student is in an active Room (AI or Manual) ───────────
    const roomCodeHeader = (req.headers['x-room-code'] || req.query.roomCode || '').trim().toUpperCase();
    let activeRoom = null;
    if (roomCodeHeader) {
      activeRoom = await Room.findOne({ roomCode: roomCodeHeader }).lean();
    } else {
      // Fallback: check if student is an active participant in an active room
      activeRoom = await Room.findOne({ 'participants.mobile': mobile, status: 'active' }).lean();
    }

    const roomSubject = activeRoom?.subject || '';
    const roomUnit = activeRoom?.unit || '';

    // ── RESUME: return same shuffled questions if session exists ──────────
    if (student.quizSession && student.quizSession.level === level) {
      const qIds = student.quizSession.questions.map((q) => q.questionId);
      let dbQuestions = await Question.find({ _id: { $in: qIds } }).lean();

      // Fallback to room.questions if some questions were embedded on the room
      if (dbQuestions.length < qIds.length && Array.isArray(activeRoom?.questions)) {
        const embeddedMap = Object.fromEntries(activeRoom.questions.map((q) => [q._id.toString(), q]));
        const existingIds = new Set(dbQuestions.map((q) => q._id.toString()));
        for (const qId of qIds) {
          if (!existingIds.has(qId.toString()) && embeddedMap[qId.toString()]) {
            dbQuestions.push(embeddedMap[qId.toString()]);
          }
        }
      }

      const qMap = Object.fromEntries(dbQuestions.map((q) => [q._id.toString(), q]));

      const clientQuestions = student.quizSession.questions.map((sq) => {
        const q = qMap[sq.questionId.toString()];
        if (!q) return null;
        const isDirect = q.questionType === 'direct' || (!q.options || q.options.length === 0);
        if (isDirect) {
          return {
            _id: q._id,
            questionText: q.questionText,
            questionType: 'direct',
            section: q.section,
            options: [],
          };
        }
          // Rebuild shuffled options from stored shuffleMap using active context-aware sanitizer
          const rawRebuilt = Array.isArray(sq.shuffleMap) ? sq.shuffleMap.map((i) => q.options[i]) : q.options;
          const sanitized = sanitizeMcqOptions(q.questionText, rawRebuilt, q.directAnswer || '', q.correctAnswerIndex, q.section);
          return {
            _id: q._id,
            questionText: q.questionText,
            questionType: 'mcq',
            section: q.section,
            options: sanitized.options,
          };
        };
      }).filter(Boolean);

      const qCount = clientQuestions.length;
      const resumedCutoff = qCount < LEVELS[level].cutoff
        ? Math.max(1, Math.ceil(qCount * 0.7))
        : LEVELS[level].cutoff;

      return res.json({
        success: true,
        data: {
          questions: clientQuestions,
          level,
          timeSeconds: LEVELS[level].timeSeconds,
          cutoff: resumedCutoff,
          subject: roomSubject,
          unit: roomUnit,
          startedAt: student.quizSession.startedAt,
          isResumed: true,
        },
      });
    }

    // ── NEW SESSION: fetch questions, shuffle, store session ──────────────
    const levelConfig = LEVELS[level];
    let allQuestions = [];

    // STRICT UNIQUE QUESTION GUARANTEE:
    // Gather all question IDs already attempted in earlier levels of this attempt
    const alreadyAttemptedQIds = new Set(
      (student.levels || []).flatMap((lvl) => (lvl.answers || []).map((a) => String(a.questionId)))
    );

    // STRICT ISOLATION:
    // If student is in an AI-generated room with custom questions, ONLY fetch questions tagged with this roomCode for this level.
    if (activeRoom && activeRoom.isAiGenerated && activeRoom.roomCode) {
      let roomQs = await Question.find({ roomCode: activeRoom.roomCode, level }).lean();
      // Fallback to embedded activeRoom.questions array if Question collection has not synced yet
      if (roomQs.length === 0 && Array.isArray(activeRoom.questions) && activeRoom.questions.length > 0) {
        roomQs = activeRoom.questions.filter((q) => (q.level || 1) === level);
      }
      // Strict filter: Never serve questions already attempted in previous levels
      allQuestions = roomQs.filter((q) => !alreadyAttemptedQIds.has(String(q._id)));
    } else {
      // Standard Solo Quiz or Manual Room:
      // STRICT ISOLATION: Only fetch questions where roomCode is null or does not exist.
      const defaultFilter = { $or: [{ roomCode: null }, { roomCode: { $exists: false } }] };

      // Attempt section-wise fetching first
      for (const section of levelConfig.sections) {
        const qs = await Question.find({ level, section, ...defaultFilter }).lean();
        const picked = qs
          .filter((q) => !alreadyAttemptedQIds.has(String(q._id)))
          .sort(() => Math.random() - 0.5)
          .slice(0, levelConfig.questionsPerSection);
        allQuestions.push(...picked);
      }

      // Fallback: If section breakdown didn't yield exact required count (e.g. 20 for L1),
      // fetch all questions for this level directly from DB to guarantee exact count
      if (allQuestions.length < levelConfig.questions) {
        const allLevelQuestions = await Question.find({ level, ...defaultFilter }).lean();
        const available = allLevelQuestions.filter((q) => !alreadyAttemptedQIds.has(String(q._id)));
        allQuestions = available
          .sort(() => Math.random() - 0.5)
          .slice(0, levelConfig.questions);
      }
    }

    if (allQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No questions found for level ${level}.`,
      });
    }

    // ── ANTI-CHEAT: Shuffle question ORDER (Fisher-Yates) ─────────────────
    // Each student now sees questions in a unique random sequence.
    for (let i = allQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
    }

    const sessionQuestions = [];
    const clientQuestions = [];

    for (const q of allQuestions) {
      const isDirect = q.questionType === 'direct' || (!q.options || q.options.length === 0);
      if (isDirect) {
        sessionQuestions.push({ questionId: q._id, questionType: 'direct', shuffleMap: [] });
        clientQuestions.push({
          _id: q._id,
          questionText: q.questionText,
          questionType: 'direct',
          section: q.section,
          options: [],
        });
      } else {
        const { shuffledOptions, shuffleMap } = shuffleOptions(q.options, q.questionText, q.section);
        sessionQuestions.push({ questionId: q._id, questionType: 'mcq', shuffleMap });
        clientQuestions.push({
          _id: q._id,
          questionText: q.questionText,
          questionType: 'mcq',
          section: q.section,
          options: shuffledOptions, // correctAnswerIndex intentionally NOT sent
        });
      }
    }

    // Persist session so scoring can be done server-side
    const startedAt = new Date();
    await Student.updateOne(
      { mobile },
      {
        $set: {
          quizSession: { level, startedAt, questions: sessionQuestions },
        },
      }
    );

    const actualCount = clientQuestions.length;
    const effectiveCutoff = actualCount < levelConfig.cutoff
      ? Math.max(1, Math.ceil(actualCount * 0.7))
      : levelConfig.cutoff;

    res.json({
      success: true,
      data: {
        questions: clientQuestions,
        level,
        timeSeconds: levelConfig.timeSeconds,
        cutoff: effectiveCutoff,
        subject: roomSubject,
        unit: roomUnit,
        startedAt,
        isResumed: false,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/quiz/submit
 * Scores the student's answers, checks the cutoff, and either advances
 * them to the next level or eliminates them.
 *
 * Body: { mobile, level, answers: [{ questionId, selectedIndex }], timeTaken }
 *
 * Cutoff check:
 *   If score >= levelConfig.cutoff → advance (or complete if level 4)
 *   Otherwise → eliminate
 *
 * Tie-break data:
 *   totalScore and totalTimeTaken are accumulated across levels for the
 *   final leaderboard sort: score DESC, timeTaken ASC.
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { mobile, level: rawLevel, answers, timeTaken, isDisqualified, isRoom, roomCode, activeAttemptId } = req.body;
    const level = parseInt(rawLevel, 10);

    if (!mobile || !level || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, error: 'mobile, level, and answers are required.' });
    }

    const student = await Student.findOne({ mobile });
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found.' });
    }

    // Idempotency: if already submitted, return the stored result
    const existing = student.levels.find((l) => l.level === level && l.submittedAt);
    const existingAttempt = activeAttemptId
      ? (student.attemptHistory || []).find((a) => a.attemptId === activeAttemptId)
      : null;

    if (existing || existingAttempt) {
      return res.status(409).json({
        success: false,
        error: 'This level or attempt has already been submitted.',
        data: {
          score: existing ? existing.score : (existingAttempt ? existingAttempt.totalScore : 0),
          isDisqualified: existingAttempt ? existingAttempt.isDisqualified : false,
        },
      });
    }

    // Validate or auto-recover active session
    let session = student.quizSession;
    const levelConfig = LEVELS[level] || { questions: answers.length, cutoff: Math.ceil(answers.length * 0.7), timeSeconds: 300 };

    if (!session || session.level !== level) {
      console.warn(`[POST /submit] Reconstructing missing/mismatched quizSession for student ${mobile} at level ${level}...`);
      session = {
        level,
        startedAt: new Date(Date.now() - (Number(timeTaken) || 30) * 1000),
        questions: answers.map((a) => ({
          questionId: a.questionId,
          questionType: a.questionType || 'mcq',
          shuffleMap: [0, 1, 2, 3],
        })),
      };
    }

    // Fetch questions to access correctAnswerIndex and directAnswer
    const questionIds = session.questions.map((q) => q.questionId).filter(Boolean);
    let dbQuestions = await Question.find({ _id: { $in: questionIds } }).lean();

    // Fallback: check room.questions if some questions were embedded directly on the room
    if (dbQuestions.length < questionIds.length && (isRoom || roomCode)) {
      const normalizedRoomCode = (roomCode || '').trim().toUpperCase();
      const room = await Room.findOne({ roomCode: normalizedRoomCode }).lean();
      if (room && Array.isArray(room.questions)) {
        const embeddedMap = Object.fromEntries(room.questions.map((q) => [String(q._id), q]));
        const existingIds = new Set(dbQuestions.map((q) => String(q._id)));
        for (const qId of questionIds) {
          const strId = String(qId);
          if (!existingIds.has(strId) && embeddedMap[strId]) {
            dbQuestions.push(embeddedMap[strId]);
          }
        }
      }
    }

    const qMap = Object.fromEntries(dbQuestions.map((q) => [String(q._id), q]));

    // ── SCORING ──────────────────────────────────────────────────────────
    let score = 0;
    const scoredAnswers = [];

    for (const answer of answers) {
      const ansIdStr = String(answer.questionId || '');
      const sessionQ = session.questions.find(
        (sq) => String(sq.questionId || '') === ansIdStr
      );
      const dbQ = qMap[ansIdStr];
      if (!sessionQ || !dbQ) continue;

      const isDirect = dbQ.questionType === 'direct' || sessionQ.questionType === 'direct' || (!dbQ.options || dbQ.options.length === 0);

      if (isDirect) {
        // Direct text/integer answer evaluation:
        // Strict normalization: studentInput.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
        const rawStudentAnswer = answer.directAnswer !== undefined
          ? answer.directAnswer
          : (answer.selectedAnswer !== undefined ? answer.selectedAnswer : (answer.textAnswer !== undefined ? answer.textAnswer : ''));
        const studentNormalized = String(rawStudentAnswer || '').trim().toLowerCase();
        const correctNormalized = String(dbQ.directAnswer || '').trim().toLowerCase();
        const isCorrect = studentNormalized !== '' && studentNormalized === correctNormalized;

        if (isCorrect) score++;

        scoredAnswers.push({
          questionId: answer.questionId,
          questionType: 'direct',
          directAnswer: String(rawStudentAnswer || '').trim(),
          selectedIndex: -1,
          isCorrect,
        });
      } else {
        // selectedIndex is the SHUFFLED index → map back to original
        // shuffleMap[shuffledPos] = originalPos
        const originalIndex = Array.isArray(sessionQ.shuffleMap)
          ? sessionQ.shuffleMap[answer.selectedIndex]
          : answer.selectedIndex;
        const isCorrect = Number.isInteger(originalIndex) &&
                          originalIndex === dbQ.correctAnswerIndex;

        if (isCorrect) score++;

        scoredAnswers.push({
          questionId: answer.questionId,
          questionType: 'mcq',
          selectedIndex: answer.selectedIndex,
          shuffleMap: sessionQ.shuffleMap,
          isCorrect,
        });
      }
    }

    // ── DYNAMIC LEVEL TERMINATION & CUTOFF CHECK ─────────────────────────
    let isLastLevel = level >= 4;
    let effectiveMaxLevel = 4;
    let roomDoc = null;

    if (isRoom && roomCode) {
      try {
        const normalizedRoomCode = roomCode.trim().toUpperCase();
        roomDoc = await Room.findOne({ roomCode: normalizedRoomCode }).select('maxLevel questions progressionMode').lean();
        if (roomDoc) {
          const embeddedQs = Array.isArray(roomDoc.questions) ? roomDoc.questions : [];
          if (roomDoc.maxLevel && roomDoc.maxLevel >= 1 && roomDoc.maxLevel <= 4) {
            effectiveMaxLevel = roomDoc.maxLevel;
          } else if (embeddedQs.length > 0) {
            effectiveMaxLevel = Math.min(4, Math.max(...embeddedQs.map((q) => q.level || 1), 1));
          }

          // Check if there are any unattempted questions available for level + 1
          const attemptedIds = new Set([
            ...(student.levels || []).flatMap((lvl) => (lvl.answers || []).map((a) => String(a.questionId))),
            ...scoredAnswers.map((a) => String(a.questionId)),
          ]);

          const nextLevelQs = await Question.find({ roomCode: normalizedRoomCode, level: level + 1 }).lean();
          const unattemptedNextQs = nextLevelQs.filter((q) => !attemptedIds.has(String(q._id)));
          const embeddedNextQs = embeddedQs.filter((q) => (q.level || 1) === level + 1 && !attemptedIds.has(String(q._id)));

          // Dynamically terminate quiz if reached maximum level or no more unique questions remain
          if (level >= effectiveMaxLevel || (unattemptedNextQs.length === 0 && embeddedNextQs.length === 0)) {
            isLastLevel = true;
          }
        }
      } catch (rErr) {
        console.warn('[Room MaxLevel Check Error]:', rErr.message);
      }
    }

    const sessionCount = session.questions?.length || levelConfig.questions;
    const dynamicCutoff = sessionCount < levelConfig.cutoff
      ? Math.max(1, Math.ceil(sessionCount * 0.7))
      : levelConfig.cutoff;

    // Cutoff check: Level 4 has no cutoff. Levels 1-3 require meeting cutoff unless open_attempt mode is active.
    let passed = isDisqualified ? false : (level === 4 ? true : score >= dynamicCutoff);

    // Open Attempt Mode: Unconditionally allow progression/completion across all levels
    if (roomDoc?.progressionMode === 'open_attempt' && !isDisqualified) {
      passed = true;
    }

    let newStatus, newCurrentLevel;
    let completedAt;

    if (isDisqualified) {
      newStatus = 'disqualified';
      newCurrentLevel = student.currentLevel;
    } else if (isLastLevel && passed) {
      newStatus = 'completed';
      newCurrentLevel = level;
      completedAt = new Date();
    } else if (passed) {
      newStatus = 'advanced';
      newCurrentLevel = level + 1;
    } else {
      newStatus = 'eliminated';
      newCurrentLevel = student.currentLevel;
    }

    const elapsed = Number.isFinite(timeTaken) ? timeTaken : levelConfig.timeSeconds;

    const levelAttempt = {
      level,
      score,
      timeTaken: elapsed,
      submittedAt: new Date(),
      answers: scoredAnswers,
    };

    // Atomic update: push attempt, clear session, accumulate totals
    const updateDoc = {
      $push:  { levels: levelAttempt },
      $set:   { status: newStatus, currentLevel: newCurrentLevel, quizSession: null },
      $inc:   { totalScore: score, totalTimeTaken: elapsed },
    };
    if (completedAt) updateDoc.$set.completedAt = completedAt;

    // ── MULTI-ATTEMPT PERSISTENCE: Save finished attempt into history array ──
    if (newStatus === 'completed' || newStatus === 'eliminated' || newStatus === 'disqualified' || isDisqualified) {
      const CUMULATIVE_MAX = { 1: 20, 2: 35, 3: 45, 4: 50 };
      const clearedLevel = level;
      const cumScore = (student.totalScore || 0) + score;
      const cumTime = (student.totalTimeTaken || 0) + elapsed;

      let maxPossible = 50;
      if (isRoom && roomCode) {
        try {
          const rDoc = roomDoc || await Room.findOne({ roomCode: roomCode.trim().toUpperCase() }).select('questions').lean();
          if (rDoc && Array.isArray(rDoc.questions) && rDoc.questions.length > 0) {
            maxPossible = newStatus === 'completed'
              ? rDoc.questions.length
              : (rDoc.questions.filter((q) => q.level <= clearedLevel).length || rDoc.questions.length);
          }
        } catch (rErr) {
          console.warn('[Room questions count error]:', rErr.message);
        }
      } else {
        const attemptedTotal = [...(student.levels || []), levelAttempt].reduce(
          (acc, curr) => acc + (curr.answers?.length || curr.score || 0),
          0
        );
        maxPossible = newStatus === 'completed' ? 50 : (attemptedTotal || CUMULATIVE_MAX[clearedLevel] || 50);
      }
      const accuracyPct = maxPossible > 0 ? Math.min(100, Math.round((cumScore / maxPossible) * 100)) : 0;

      const isRoomQuiz = Boolean(isRoom);
      const normalizedRoomCode = isRoomQuiz && roomCode ? roomCode.trim().toUpperCase() : null;

      const finalAttemptId = activeAttemptId || `${mobile}_${Date.now()}`;
      const existingHistoryIndex = (student.attemptHistory || []).findIndex(
        (a) => a.attemptId === finalAttemptId
      );

      const historyRecord = {
        attemptId: finalAttemptId,
        attemptNumber: existingHistoryIndex >= 0
          ? student.attemptHistory[existingHistoryIndex].attemptNumber
          : (student.attemptHistory?.length || 0) + 1,
        attemptDate: new Date(),
        levelReached: clearedLevel,
        totalScore: cumScore,
        maxPossible,
        accuracyPct,
        totalTimeTaken: cumTime,
        status: newStatus,
        isDisqualified: Boolean(isDisqualified),
        quizType: isRoomQuiz ? 'room' : 'normal',
        isRoom: isRoomQuiz,
        roomCode: normalizedRoomCode,
        levelsSummary: [...(student.levels || []), levelAttempt],
      };

      if (existingHistoryIndex >= 0) {
        updateDoc.$set[`attemptHistory.${existingHistoryIndex}`] = historyRecord;
      } else {
        updateDoc.$push.attemptHistory = historyRecord;
      }
    }

    // Atomic update with idempotency protection against concurrent double-submits
    if (updateDoc.$push?.attemptHistory) {
      const historyToPush = updateDoc.$push.attemptHistory;
      delete updateDoc.$push.attemptHistory;
      await Student.updateOne({ mobile }, updateDoc);
      await Student.updateOne(
        { mobile, 'attemptHistory.attemptId': { $ne: historyToPush.attemptId } },
        { $push: { attemptHistory: historyToPush } }
      );
    } else {
      await Student.updateOne({ mobile }, updateDoc);
    }

    // Fetch updated totals after calculation
    const updatedStudent = await Student.findOne({ mobile }).lean();

    // ── If this is a live Room Quiz session, update Room participant & broadcast ──
    if (isRoom && roomCode) {
      const normalizedRoomCode = roomCode.trim().toUpperCase();
      try {
        const nextLvlNum = passed && !isLastLevel ? level + 1 : level;
        const finalScore = updatedStudent ? updatedStudent.totalScore : score;
        const finalTime  = updatedStudent ? updatedStudent.totalTimeTaken : elapsed;
        const currentLevels = (updatedStudent?.levels || []).map((lvl) => ({
          level: lvl.level,
          score: lvl.score || 0,
          timeTaken: lvl.timeTaken || 0,
        }));

        await Room.updateOne(
          { roomCode: normalizedRoomCode, 'participants.mobile': mobile },
          {
            $set: {
              'participants.$.level': nextLvlNum,
              'participants.$.score': finalScore,
              'participants.$.timeTaken': finalTime,
              'participants.$.status': newStatus,
              'participants.$.isDisqualified': Boolean(isDisqualified),
              'participants.$.levels': currentLevels,
              'participants.$.lastActive': new Date(),
            },
          }
        );

        const io = req.app.get('io');
        if (io) {
          io.to(`room:${normalizedRoomCode}`).emit('student:updated', {
            mobile,
            name: student.name,
            branch: student.branch,
            level: nextLvlNum,
            score: finalScore,
            timeTaken: finalTime,
            status: newStatus,
            isDisqualified: Boolean(isDisqualified),
            levels: currentLevels,
            lastActive: new Date(),
          });
        }
      } catch (e) {
        console.error('Error updating room participant on quiz submit:', e.message);
      }
    }

    let quizTotalQuestions = 50;
    let nextLevelQuestions = null;
    if (isRoom && roomCode) {
      try {
        const rDoc = roomDoc || await Room.findOne({ roomCode: roomCode.trim().toUpperCase() }).select('questions').lean();
        if (rDoc && Array.isArray(rDoc.questions) && rDoc.questions.length > 0) {
          quizTotalQuestions = rDoc.questions.length;
          if (passed && !isLastLevel) {
            const nextLevelQs = rDoc.questions.filter((q) => q.level === level + 1);
            nextLevelQuestions = nextLevelQs.length > 0 ? nextLevelQs.length : null;
          }
        }
      } catch (err) {
        console.warn('Failed to calculate room question totals:', err.message);
      }
    }

    res.json({
      success: true,
      data: {
        score,
        total: sessionCount,
        cutoff: dynamicCutoff,
        passed,
        status: newStatus,
        nextLevel: passed && !isLastLevel ? level + 1 : null,
        nextLevelQuestions,
        quizTotalQuestions,
        isLastLevel,
        isDisqualified: Boolean(isDisqualified),
        isRoom: Boolean(isRoom),
        roomCode: isRoom && roomCode ? roomCode.trim().toUpperCase() : null,
        totalScore: updatedStudent ? updatedStudent.totalScore : score,
        totalTimeTaken: updatedStudent ? updatedStudent.totalTimeTaken : elapsed,
      },
    });
  } catch (err) {
    console.error('[POST /api/quiz/submit Error]:', err);
    next(err);
  }
});

/**
 * POST /api/quiz/generate-questions (and /api/generate-questions)
 * Generates new questions via Gemini AI and auto-populates MongoDB.
 * Accepts { topic, difficultyLevel, count }.
 * Fallback: If AI fails or no API key, fetches existing questions from MongoDB.
 */
const { generateAndPopulateQuestions } = require('../controllers/aiQuestionController');

router.post('/generate-questions', async (req, res, next) => {
  try {
    const { topic, difficultyLevel, level, count } = req.body;
    const targetLevel = difficultyLevel || level || 1;

    const result = await generateAndPopulateQuestions({
      topic,
      difficultyLevel: targetLevel,
      count: count || 5,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/quiz/review/:mobile
 * Returns detailed question review for all attempted levels of the candidate.
 */
router.get('/review/:mobile', async (req, res, next) => {
  try {
    const { mobile } = req.params;
    if (!mobile) {
      return res.status(400).json({ success: false, error: 'Mobile number is required.' });
    }

    const student = await Student.findOne({ mobile }).lean();
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student record not found.' });
    }

    let levelsToReview = student.levels && student.levels.length > 0
      ? student.levels
      : (student.attemptHistory && student.attemptHistory.length > 0
          ? student.attemptHistory[student.attemptHistory.length - 1].levelsSummary
          : []);

    if (!levelsToReview || levelsToReview.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Collect all question IDs
    const allQIds = [];
    levelsToReview.forEach((lvl) => {
      if (Array.isArray(lvl.answers)) {
        lvl.answers.forEach((ans) => {
          if (ans.questionId) allQIds.push(ans.questionId);
        });
      }
    });

    const dbQuestions = await Question.find({ _id: { $in: allQIds } }).lean();
    const qMap = Object.fromEntries(dbQuestions.map((q) => [q._id.toString(), q]));

    const reviewData = levelsToReview.map((lvl) => {
      const reviewedQuestions = (lvl.answers || []).map((ans, idx) => {
        const q = qMap[ans.questionId ? ans.questionId.toString() : ''];
        if (!q) return null;

        const isDirect = q.questionType === 'direct' || ans.questionType === 'direct' || (!q.options || q.options.length === 0);

        let originalSelected = null;
        let isCorrect = false;
        let isUnattempted = true;
        let selectedOptionText = null;
        let correctAnswerText = '';

        if (isDirect) {
          const studentAns = String(ans.directAnswer !== undefined ? ans.directAnswer : '').trim();
          const targetAns = String(q.directAnswer || '').trim();
          isUnattempted = !studentAns;
          isCorrect = !isUnattempted && studentAns.toLowerCase() === targetAns.toLowerCase();
          selectedOptionText = studentAns || null;
          correctAnswerText = targetAns;
        } else {
          // Map student's chosen shuffled index back to original index
          if (Number.isInteger(ans.selectedIndex) && ans.selectedIndex >= 0 && Array.isArray(ans.shuffleMap)) {
            originalSelected = ans.shuffleMap[ans.selectedIndex];
          } else if (Number.isInteger(ans.selectedIndex) && ans.selectedIndex >= 0) {
            originalSelected = ans.selectedIndex;
          }

          isUnattempted = originalSelected === null || originalSelected === undefined || originalSelected === -1;
          isCorrect = !isUnattempted && originalSelected === q.correctAnswerIndex;
          selectedOptionText = !isUnattempted && q.options && q.options[originalSelected] ? q.options[originalSelected] : null;
          correctAnswerText = q.options && q.options[q.correctAnswerIndex] ? q.options[q.correctAnswerIndex] : '';
        }

        const explanation = q.explanation ||
          `The correct answer is "${correctAnswerText}". This is the accurate choice for this ${q.section} problem based on core logical principles and standardized subject facts.`;

        return {
          questionId: q._id,
          questionNumber: idx + 1,
          questionType: isDirect ? 'direct' : 'mcq',
          section: q.section,
          difficulty: q.difficulty,
          questionText: q.questionText,
          options: q.options || [],
          correctAnswerIndex: q.correctAnswerIndex,
          correctAnswerText,
          selectedOptionIndex: originalSelected,
          selectedOptionText,
          isCorrect,
          isUnattempted,
          explanation,
        };
      }).filter(Boolean);

      return {
        level: lvl.level,
        score: lvl.score,
        timeTaken: lvl.timeTaken,
        submittedAt: lvl.submittedAt,
        questions: reviewedQuestions,
      };
    });

    res.json({ success: true, data: reviewData });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
