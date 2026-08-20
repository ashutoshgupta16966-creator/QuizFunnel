const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Student = require('../models/Student');
const LEVELS = require('../config/levels');

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
function shuffleOptions(options) {
  const indices = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    shuffledOptions: indices.map((i) => options[i]),
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

    // ── RESUME: return same shuffled questions if session exists ──────────
    if (student.quizSession && student.quizSession.level === level) {
      const qIds = student.quizSession.questions.map((q) => q.questionId);
      const dbQuestions = await Question.find({ _id: { $in: qIds } }).lean();
      const qMap = Object.fromEntries(dbQuestions.map((q) => [q._id.toString(), q]));

      const clientQuestions = student.quizSession.questions.map((sq) => {
        const q = qMap[sq.questionId.toString()];
        if (!q) return null;
        return {
          _id: q._id,
          questionText: q.questionText,
          section: q.section,
          // Rebuild shuffled options from stored shuffleMap
          options: sq.shuffleMap.map((i) => q.options[i]),
        };
      }).filter(Boolean);

      return res.json({
        success: true,
        data: {
          questions: clientQuestions,
          level,
          timeSeconds: LEVELS[level].timeSeconds,
          cutoff: LEVELS[level].cutoff,
          startedAt: student.quizSession.startedAt,
          isResumed: true,
        },
      });
    }

    // ── NEW SESSION: fetch questions, shuffle, store session ──────────────
    const levelConfig = LEVELS[level];
    let allQuestions = [];

    // Attempt section-wise fetching first
    for (const section of levelConfig.sections) {
      const qs = await Question.find({ level, section }).lean();
      const picked = qs.sort(() => Math.random() - 0.5).slice(0, levelConfig.questionsPerSection);
      allQuestions.push(...picked);
    }

    // Fallback: If section breakdown didn't yield exact required count (e.g. 20 for L1),
    // fetch all questions for this level directly from DB to guarantee exact count
    if (allQuestions.length < levelConfig.questions) {
      const allLevelQuestions = await Question.find({ level }).lean();
      allQuestions = allLevelQuestions
        .sort(() => Math.random() - 0.5)
        .slice(0, levelConfig.questions);
    }

    if (allQuestions.length === 0) {
      return res.status(500).json({
        success: false,
        error: `No questions found for level ${level}. Run the seed script first.`,
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
      const { shuffledOptions, shuffleMap } = shuffleOptions(q.options);
      sessionQuestions.push({ questionId: q._id, shuffleMap });
      clientQuestions.push({
        _id: q._id,
        questionText: q.questionText,
        section: q.section,
        options: shuffledOptions, // correctAnswerIndex intentionally NOT sent
      });
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

    res.json({
      success: true,
      data: {
        questions: clientQuestions,
        level,
        timeSeconds: levelConfig.timeSeconds,
        cutoff: levelConfig.cutoff,
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
    const { mobile, level: rawLevel, answers, timeTaken } = req.body;
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
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'This level has already been submitted.',
        data: { score: existing.score },
      });
    }

    // Validate active session
    if (!student.quizSession || student.quizSession.level !== level) {
      return res.status(400).json({
        success: false,
        error: 'No active session for this level. Please load the questions first.',
      });
    }

    const session = student.quizSession;
    const levelConfig = LEVELS[level];

    // Fetch questions to access correctAnswerIndex
    const questionIds = session.questions.map((q) => q.questionId);
    const dbQuestions = await Question.find({ _id: { $in: questionIds } }).lean();
    const qMap = Object.fromEntries(dbQuestions.map((q) => [q._id.toString(), q]));

    // ── SCORING ──────────────────────────────────────────────────────────
    let score = 0;
    const scoredAnswers = [];

    for (const answer of answers) {
      const sessionQ = session.questions.find(
        (sq) => sq.questionId.toString() === answer.questionId.toString()
      );
      const dbQ = qMap[answer.questionId.toString()];
      if (!sessionQ || !dbQ) continue;

      // selectedIndex is the SHUFFLED index → map back to original
      // shuffleMap[shuffledPos] = originalPos
      const originalIndex = sessionQ.shuffleMap[answer.selectedIndex];
      const isCorrect = Number.isInteger(originalIndex) &&
                        originalIndex === dbQ.correctAnswerIndex;

      if (isCorrect) score++;

      scoredAnswers.push({
        questionId: answer.questionId,
        selectedIndex: answer.selectedIndex,
        shuffleMap: sessionQ.shuffleMap,
        isCorrect,
      });
    }

    // ── CUTOFF CHECK ─────────────────────────────────────────────────────
    const isLastLevel = level === 4;
    // Level 4 has no cutoff — everyone who reaches it gets ranked
    const passed = isLastLevel ? true : score >= levelConfig.cutoff;

    let newStatus, newCurrentLevel;
    let completedAt;

    if (isLastLevel) {
      newStatus = 'completed';
      newCurrentLevel = student.currentLevel; // stays at 4
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
    if (newStatus === 'completed' || newStatus === 'eliminated') {
      const CUMULATIVE_MAX = { 1: 20, 2: 35, 3: 45, 4: 50 };
      const clearedLevel = newStatus === 'completed' ? 4 : level;
      const maxPossible = CUMULATIVE_MAX[clearedLevel] || 50;
      const cumScore = (student.totalScore || 0) + score;
      const cumTime = (student.totalTimeTaken || 0) + elapsed;
      const accuracyPct = maxPossible > 0 ? Math.min(100, Math.round((cumScore / maxPossible) * 100)) : 0;

      const historyRecord = {
        attemptId: `${mobile}_${Date.now()}`,
        attemptNumber: (student.attemptHistory?.length || 0) + 1,
        attemptDate: new Date(),
        levelReached: clearedLevel,
        totalScore: cumScore,
        maxPossible,
        accuracyPct,
        totalTimeTaken: cumTime,
        status: newStatus,
        levelsSummary: [...(student.levels || []), levelAttempt],
      };

      updateDoc.$push.attemptHistory = historyRecord;
    }

    await Student.updateOne({ mobile }, updateDoc);

    // Fetch updated totals after calculation
    const updatedStudent = await Student.findOne({ mobile }).lean();

    res.json({
      success: true,
      data: {
        score,
        total: levelConfig.questions,
        cutoff: levelConfig.cutoff,
        passed,
        status: newStatus,
        nextLevel: passed && !isLastLevel ? level + 1 : null,
        isLastLevel,
        totalScore: updatedStudent ? updatedStudent.totalScore : score,
        totalTimeTaken: updatedStudent ? updatedStudent.totalTimeTaken : elapsed,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
