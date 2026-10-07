import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { getQuestions, getRoomQuestions, submitQuiz } from '../api';
import { joinStudentRoomSocket, emitStudentProgress, emitStudentDisqualified } from '../utils/socket';
import { LEVELS, TOTAL_LEVELS } from '../config';
import QuestionCard from '../components/QuestionCard';
import TimerBar from '../components/TimerBar';
import ProgressBar from '../components/ProgressBar';
import Toast from '../components/Toast';
import ExitConfirmModal from '../components/ExitConfirmModal';
import ThemeToggle from '../components/ThemeToggle';
import AntiCheatModal from '../components/AntiCheatModal';
import QuestionPalette from '../components/QuestionPalette';
import UnattemptedWarningModal from '../components/UnattemptedWarningModal';
import GuidanceDrawer, { GUIDES } from '../components/GuidanceDrawer';

const MAX_TAB_SWITCH_ALLOWED = 4;

export default function Quiz() {
  const { level: levelParam } = useParams();
  const isPlayRoute = !levelParam || levelParam === 'play';
  const { student, updateStudent, setLastResult, clearStudent, isRoomQuiz, roomSession, clearRoomSession } = useQuiz();
  const levelNum = isPlayRoute ? (student?.currentLevel || 1) : parseInt(levelParam, 10);
  const levelConfig = LEVELS[levelNum] || LEVELS[1];
  const navigate = useNavigate();

  const [questions, setQuestions]       = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers]           = useState({});   // { questionId: selectedIndex }
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [toast, setToast]               = useState(null);
  const [startedAt, setStartedAt]       = useState(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showUnattemptedModal, setShowUnattemptedModal] = useState(false);
  const [isRoomClosed, setIsRoomClosed] = useState(false);
  const [quizSubject, setQuizSubject]   = useState('');
  const [quizUnit, setQuizUnit]         = useState('');
  const [showGuide, setShowGuide]       = useState(false);
  // Dynamic total level count — set from API response, falls back to config default
  const [totalLevels, setTotalLevels]   = useState(TOTAL_LEVELS);

  const displaySubject = quizSubject || roomSession?.subject || '';
  const displayUnit    = quizUnit || roomSession?.unit || '';

  // ── Custom Level Countdown Timer State ─────────────────────────────────────
  // FIX 1: Students in live Quiz Rooms must NEVER see or set the timer.
  // The Admin sets the room timer, which applies uniformly to all students.
  const defaultLevelTime = levelConfig?.timeSeconds || 900;
  const [customTimeSeconds, setCustomTimeSeconds] = useState(defaultLevelTime);
  const [showTimerSetup, setShowTimerSetup] = useState(!isRoomQuiz);
  const [timerSetupMins, setTimerSetupMins] = useState(Math.floor(defaultLevelTime / 60));
  const [timerSetupSecs, setTimerSetupSecs] = useState(defaultLevelTime % 60);

  // ── Room Quiz Synchronized Start State ────────────────────────────────────
  // Students wait in a lobby until admin broadcasts ROOM_QUIZ_STARTED.
  // A 3-second countdown fires on all screens before questions unlock.
  // Persisted in sessionStorage so it survives level transitions (component remounts).
  const roomStartedKey = isRoomQuiz && roomSession?.roomCode
    ? `room_quiz_started_${roomSession.roomCode}`
    : null;
  const [roomQuizStarted, setRoomQuizStarted] = useState(() => {
    if (!isRoomQuiz) return true; // Self-practice: always "started"
    try {
      return roomStartedKey ? Boolean(sessionStorage.getItem(roomStartedKey)) : false;
    } catch { return false; }
  });
  const [startCountdown, setStartCountdown] = useState(0); // 3 → 2 → 1 → 0 = live

  // Storage keys for auto-saving progress & bookmarks
  const progressKey = student?.mobile ? `quiz_progress_${student.mobile}_${levelNum}` : null;
  const bookmarkKey = student?.mobile ? `quiz_bookmarks_${student.mobile}_${levelNum}` : null;

  // ── Question Bookmarks State ─────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      if (bookmarkKey) {
        return JSON.parse(localStorage.getItem(bookmarkKey) || '{}');
      }
    } catch { /* noop */ }
    return {};
  });

  const handleToggleBookmark = useCallback((qId) => {
    setBookmarks((prev) => {
      const next = { ...prev };
      if (next[qId]) {
        delete next[qId];
      } else {
        next[qId] = true;
      }
      if (bookmarkKey) {
        try { localStorage.setItem(bookmarkKey, JSON.stringify(next)); } catch { /* noop */ }
      }
      return next;
    });
  }, [bookmarkKey]);

  // ── Anti-Cheating & Tab Switching State ──────────────────────────────────
  const [tabSwitchCount, setTabSwitchCount] = useState(() => {
    try {
      if (student?.mobile) {
        const stored = parseInt(localStorage.getItem(`quiz_tab_switches_${student.mobile}`) || '0', 10);
        return Math.min(Math.max(stored, 0), MAX_TAB_SWITCH_ALLOWED);
      }
    } catch { /* noop */ }
    return 0;
  });
  const [showAntiCheatModal, setShowAntiCheatModal] = useState(false);
  const [isAntiCheatTerminal, setIsAntiCheatTerminal] = useState(false);

  // ── Unique Idempotent Attempt ID for current quiz run ─────────────────────
  const activeAttemptId = useRef(
    (() => {
      try {
        const storageKey = student?.mobile ? `quiz_active_attempt_${student.mobile}_lvl${levelNum}` : null;
        let existingId = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (!existingId) {
          existingId = `att_${student?.mobile || 'cand'}_lvl${levelNum}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          if (storageKey) sessionStorage.setItem(storageKey, existingId);
        }
        return existingId;
      } catch {
        return `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    })()
  );

  // Intercept browser back button & mobile swipe-back gesture to trigger Exit Confirmation modal
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      setShowExitModal(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Prevent double-submit (timer + manual button race + tab switch)
  const hasSubmitted = useRef(false);

  // ── Guard: redirect if student isn't supposed to be here ─────────────────
  useEffect(() => {
    if (!student) { navigate('/'); return; }
    if (!levelConfig) { navigate('/'); return; }
    if (student.status === 'eliminated' || student.status === 'completed') {
      navigate('/results'); return;
    }
    if (!isPlayRoute && student.currentLevel !== levelNum) {
      navigate(`/quiz/${student.currentLevel}`); return;
    }
    loadQuestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelNum, isPlayRoute]);

  // ── Sync with Live Room Socket (Only if isRoomQuiz === true) ─────────────
  useEffect(() => {
    if (isRoomQuiz && roomSession?.roomCode && student?.mobile) {
      const cleanup = joinStudentRoomSocket(roomSession.roomCode, student, {
        onRoomClosed: () => {
          setIsRoomClosed(true);
        },
        onQuizStarted: (data) => {
          // Persist quiz-started flag across level transitions (component remounts)
          if (roomStartedKey) {
            try { sessionStorage.setItem(roomStartedKey, '1'); } catch { /* noop */ }
          }
          // Apply per-level timer override from admin's levelTimers config
          if (Array.isArray(data?.levelTimers) && data.levelTimers.length > 0) {
            const lt = data.levelTimers.find((t) => t.level === levelNum);
            if (lt && lt.seconds > 0) {
              setCustomTimeSeconds(lt.seconds);
              setTimerSetupMins(Math.floor(lt.seconds / 60));
              setTimerSetupSecs(lt.seconds % 60);
            }
          }
          // Fire 3-second synchronized countdown
          setStartCountdown(3);
          const t1 = setTimeout(() => setStartCountdown(2), 1000);
          const t2 = setTimeout(() => setStartCountdown(1), 2000);
          const t3 = setTimeout(() => {
            setStartCountdown(0);
            setRoomQuizStarted(true);
            setStartedAt(new Date());
          }, 3000);
          return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
        },
      });
      emitStudentProgress({
        roomCode: roomSession.roomCode,
        mobile: student.mobile,
        currentLevel: levelNum,
        score: student.totalScore || 0,
        status: 'in-progress',
      });
      return cleanup;
    }
  }, [isRoomQuiz, roomSession?.roomCode, student, levelNum]);

  // ── Scroll Lock when Room Closed Modal is Active ────────────────────────
  useEffect(() => {
    if (isRoomClosed) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isRoomClosed]);

  // ── Auto-save progress restoration ───────────────────────────────────────
  const restoreSavedProgress = (qs) => {
    if (!progressKey) return;
    try {
      const saved = localStorage.getItem(progressKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.answers && typeof parsed.answers === 'object') {
          setAnswers(parsed.answers);
          // If answers are already recorded, student is actively resuming; do not block with timer setup
          if (Object.keys(parsed.answers).length > 0) {
            setShowTimerSetup(false);
          }
        }
        if (typeof parsed?.customTimeSeconds === 'number' && parsed.customTimeSeconds > 0) {
          setCustomTimeSeconds(parsed.customTimeSeconds);
          setTimerSetupMins(Math.floor(parsed.customTimeSeconds / 60));
          setTimerSetupSecs(parsed.customTimeSeconds % 60);
        }
        if (typeof parsed?.currentIndex === 'number' && parsed.currentIndex < qs.length) {
          setCurrentIndex(parsed.currentIndex);
        }
      }
    } catch { /* noop */ }
  };

  // ── Auto-save progress change listener ───────────────────────────────────
  useEffect(() => {
    if (!progressKey || loading || questions.length === 0 || hasSubmitted.current) return;
    try {
      localStorage.setItem(progressKey, JSON.stringify({
        currentIndex,
        answers,
        customTimeSeconds,
        updatedAt: Date.now(),
      }));
    } catch { /* noop */ }
  }, [answers, currentIndex, customTimeSeconds, progressKey, loading, questions]);

  // ── Browser unload / navigation protection ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!hasSubmitted.current && !loading && questions.length > 0) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to exit? Your quiz progress will be lost.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [loading, questions]);

  // ── Show reconnecting toast on API retry ──────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      setToast({
        type: 'warning',
        message: `Reconnecting… (attempt ${e.detail.attempt}/3)`,
        duration: 3000,
      });
    };
    window.addEventListener('api:retry', handler);
    return () => window.removeEventListener('api:retry', handler);
  }, []);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await getQuestions(levelNum, student.mobile, roomSession?.roomCode);
      const resData = res.data;

      // ── Handle empty-level skip signals for room quizzes ─────────────────
      // When a room level has no questions, the server sends skipToLevel or quizComplete.
      if (!resData.success) {
        if (resData.skipToLevel) {
          // Auto-advance: this level is empty, jump to the next level with questions
          console.log(`[loadQuestions] Level ${levelNum} empty — advancing to Level ${resData.skipToLevel}`);
          // Update student's currentLevel in context so guards pass
          updateStudent({ currentLevel: resData.skipToLevel });
          navigate(`/quiz/${resData.skipToLevel}`);
          return;
        }
        if (resData.quizComplete) {
          // No more questions at any level — complete the quiz
          console.log('[loadQuestions] No more questions in any level — quiz complete');
          updateStudent({ status: 'completed' });
          navigate('/results');
          return;
        }
        // Generic error from server
        setLoadError(resData.error || 'Failed to load questions. Check your connection and refresh.');
        return;
      }

      const { questions: qs, startedAt: sAt, subject: resSub, unit: resUn, customTimeSeconds: resCustomTime, timeSeconds: resTime, totalLevels: apiTotalLevels } = resData.data;
      setQuestions(qs);
      if (resSub) setQuizSubject(resSub);
      if (resUn) setQuizUnit(resUn);
      // Set dynamic total levels from API if provided (overrides config default)
      if (apiTotalLevels && apiTotalLevels >= 1) setTotalLevels(apiTotalLevels);

      const targetTime = resCustomTime || resTime || levelConfig?.timeSeconds || 900;
      setCustomTimeSeconds(targetTime);
      setTimerSetupMins(Math.floor(targetTime / 60));
      setTimerSetupSecs(targetTime % 60);

      if (isRoomQuiz) {
        setShowTimerSetup(false);
      }

      setStartedAt(new Date(sAt || Date.now()));
      restoreSavedProgress(qs);
    } catch (err) {
      // If room quiz and standard questions endpoint had an error, fallback to getRoomQuestions
      if (isRoomQuiz && roomSession?.roomCode) {
        try {
          const roomRes = await getRoomQuestions(roomSession.roomCode, levelNum);
          const { questions: qs, subject: resSub, unit: resUn, customTimeSeconds: resCustomTime, totalLevels: fallbackTotalLevels } = roomRes.data.data;
          if (Array.isArray(qs) && qs.length > 0) {
            setQuestions(qs);
            if (resSub) setQuizSubject(resSub);
            if (resUn) setQuizUnit(resUn);
            if (fallbackTotalLevels && fallbackTotalLevels >= 1) setTotalLevels(fallbackTotalLevels);

            const targetTime = resCustomTime || levelConfig?.timeSeconds || 900;
            setCustomTimeSeconds(targetTime);
            setTimerSetupMins(Math.floor(targetTime / 60));
            setTimerSetupSecs(targetTime % 60);
            setShowTimerSetup(false);

            setStartedAt(new Date());
            restoreSavedProgress(qs);
            return;
          }
        } catch (fallbackErr) {
          console.warn('Fallback getRoomQuestions failed:', fallbackErr.message);
        }
      }
      setLoadError(err.response?.data?.error || 'Failed to load questions. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  };

  // ── Answer selection & clearing ───────────────────────────────────────────
  const handleAnswer = useCallback((questionId, val) => {
    if (isRoomClosed || isAntiCheatTerminal || hasSubmitted.current) return;
    setAnswers((prev) => {
      const next = { ...prev };
      if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
        delete next[questionId]; // deselect / clear choice
      } else {
        next[questionId] = val; // select or modify choice (number index or direct string)
      }
      return next;
    });
  }, [isRoomClosed, isAntiCheatTerminal]);

  // Helper to check if a question has been answered (supports MCQ index and direct string)
  const isQuestionAnswered = useCallback((qId) => {
    const a = answers[qId];
    if (a === undefined || a === null || a === -1) return false;
    if (typeof a === 'string' && a.trim() === '') return false;
    return true;
  }, [answers]);

  // ── Clear saved progress ──────────────────────────────────────────────────
  const clearSavedProgress = () => {
    if (progressKey) {
      try { localStorage.removeItem(progressKey); } catch { /* noop */ }
    }
    if (bookmarkKey) {
      try { localStorage.removeItem(bookmarkKey); } catch { /* noop */ }
    }
  };

  // ── Core Submit execution (API call) ────────────────────────────────────
  const executeSubmit = useCallback(async (isDisqualified = false) => {
    if (hasSubmitted.current || isRoomClosed) return;
    hasSubmitted.current = true;
    setSubmitting(true);
    clearSavedProgress();

    const elapsed = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : (customTimeSeconds || levelConfig.timeSeconds);

    // Build answers array supporting both MCQ and Direct question formats
    const answersArray = questions.map((q) => {
      const val = answers[q._id];
      const isDirect = q.questionType === 'direct' || (!q.options || q.options.length === 0);

      if (isDirect) {
        return {
          questionId: q._id,
          questionType: 'direct',
          directAnswer: typeof val === 'string' ? val.trim() : (val !== null && val !== undefined ? String(val).trim() : ''),
          selectedIndex: -1,
        };
      }

      const selectedOptText = (typeof val === 'number' && q.options && q.options[val]) ? String(q.options[val]).trim() : '';
      return {
        questionId: q._id,
        questionType: 'mcq',
        selectedIndex: typeof val === 'number' ? val : -1,
        selectedText: selectedOptText,
      };
    });

    try {
      const res = await submitQuiz({
        mobile:          student.mobile,
        level:           levelNum,
        answers:         answersArray,
        timeTaken:       elapsed,
        isDisqualified:  Boolean(isDisqualified),
        isRoom:          Boolean(isRoomQuiz),
        roomCode:        roomSession?.roomCode || '',
        activeAttemptId: activeAttemptId.current,
      });
      const result = res.data.data;
      setLastResult({ ...result, isDisqualified: Boolean(isDisqualified || result.isDisqualified) });

      // Update context so student object has updated totals
      updateStudent({
        currentLevel:   result.nextLevel ?? student.currentLevel,
        status:         isDisqualified ? 'disqualified' : result.status,
        totalScore:     result.totalScore,
        totalTimeTaken: result.totalTimeTaken,
      });

      // Emit real-time progress update to host if room session
      if (isRoomQuiz && roomSession?.roomCode) {
        emitStudentProgress({
          roomCode:       roomSession.roomCode,
          mobile:         student.mobile,
          currentLevel:   levelNum,
          score:          result.totalScore ?? 0,
          timeTaken:      result.totalTimeTaken ?? elapsed,
          status:         isDisqualified ? 'disqualified' : (result.passed ? (result.nextLevel ? 'advanced' : 'completed') : 'eliminated'),
          isDisqualified: Boolean(isDisqualified),
        });
      }

      if (result.passed && result.nextLevel && !isDisqualified) {
        navigate('/level-up');
      } else {
        navigate('/results');
      }
    } catch (err) {
      hasSubmitted.current = false;
      setSubmitting(false);

      console.error('[executeSubmit Error]:', err.response?.data || err.message || err);

      // 409 = already submitted → treat as success and navigate
      if (err.response?.status === 409) {
        navigate('/results');
        return;
      }
      const errorMsg = err.response?.data?.error || err.message || 'Submission failed. Please try again.';
      setToast({ type: 'error', message: errorMsg, duration: 6000 });
    }
  }, [answers, questions, startedAt, levelNum, student, navigate, setLastResult, updateStudent, levelConfig, isRoomQuiz, roomSession]);

  // ── Manual Submit Click (with Unattempted Questions Check) ───────────────
  const handleManualSubmit = () => {
    if (isRoomClosed) return;
    const answeredCount = questions.filter((q) => isQuestionAnswered(q._id)).length;
    const unattempted = questions.length - answeredCount;
    if (unattempted > 0) {
      setShowUnattemptedModal(true);
    } else {
      executeSubmit();
    }
  };

  const handleGoBackAndReview = () => {
    setShowUnattemptedModal(false);
    // Jump to the first unattempted question for convenience
    const firstUnansweredIdx = questions.findIndex((q) => !isQuestionAnswered(q._id));
    if (firstUnansweredIdx !== -1) {
      setCurrentIndex(firstUnansweredIdx);
    }
  };

  const handleSubmitAnyway = () => {
    setShowUnattemptedModal(false);
    executeSubmit();
  };

  // Auto-submit when level timer fires
  const handleTimeUp = useCallback(() => {
    setToast({ type: 'warning', message: "Time's up! Submitting your answers…", duration: 2000 });
    setTimeout(() => executeSubmit(), 2000);
  }, [executeSubmit]);

  // ── Tab-Switching & Visibility Monitoring ───────────────────────────────
  useEffect(() => {
    if (loading || submitting || hasSubmitted.current) return;

    let lastSwitchTime = 0;

    const handleSwitchViolation = () => {
      if (hasSubmitted.current || isAntiCheatTerminal) return;
      const now = Date.now();
      if (now - lastSwitchTime < 800) return; // Debounce blur + visibilitychange
      lastSwitchTime = now;

      setTabSwitchCount((prev) => {
        const nextCount = prev + 1;
        const clampedCount = Math.min(nextCount, MAX_TAB_SWITCH_ALLOWED);
        if (student?.mobile) {
          try {
            localStorage.setItem(`quiz_tab_switches_${student.mobile}`, String(clampedCount));
          } catch { /* noop */ }
        }

        if (nextCount >= MAX_TAB_SWITCH_ALLOWED) {
          // Exact 4th detection (if switchCount >= 4): immediately stop quiz timers, invalidate input handlers, route to disqualification flow without execution lag
          hasSubmitted.current = true;
          setIsAntiCheatTerminal(true);
          setShowAntiCheatModal(true);

          if (student?.mobile) {
            try {
              localStorage.setItem(`quiz_anti_cheated_${student.mobile}`, '1');

              // If active in a live room, notify room host via socket immediately
              if (isRoomQuiz && roomSession?.roomCode) {
                emitStudentDisqualified({
                  roomCode: roomSession.roomCode,
                  mobile:   student.mobile,
                });
              }

              // Immediately record isDisqualified: true in LocalStorage attempt history
              const HISTORY_STORAGE_KEY = 'quiz_attempts_history';
              const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
              const attemptId = activeAttemptId.current || `${student.mobile}_lvl${levelNum}_${student.totalScore || 0}_${student.totalTimeTaken || 0}`;
              const alreadySaved = existing.some((a) => a.id === attemptId);
              if (!alreadySaved) {
                const newRecord = {
                  id: attemptId,
                  attemptDate: new Date().toISOString(),
                  studentName: student.name || 'Student',
                  mobile: student.mobile,
                  branch: student.branch || '',
                  levelReached: levelNum,
                  totalScore: student.totalScore || 0,
                  maxPossible: 50,
                  accuracyPct: 0,
                  totalTimeTaken: student.totalTimeTaken || 0,
                  timeFormatted: '00:00',
                  status: 'disqualified',
                  isDisqualified: true,
                  isRoom: Boolean(isRoomQuiz),
                  roomCode: roomSession?.roomCode || '',
                  quizType: isRoomQuiz ? 'room' : 'normal',
                };
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([newRecord, ...existing].slice(0, 30)));
              } else {
                const updated = existing.map((a) => (a.id === attemptId ? {
                  ...a,
                  status: 'disqualified',
                  isDisqualified: true,
                  isRoom: Boolean(isRoomQuiz || a.isRoom),
                  roomCode: roomSession?.roomCode || a.roomCode || '',
                  quizType: isRoomQuiz ? 'room' : (a.quizType || 'normal'),
                } : a));
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
              }
            } catch { /* noop */ }
          }

          executeSubmit(true);
          return clampedCount;
        } else {
          // Switches 1 to (MAX-1): Trigger warning toast displaying remaining attempts
          setToast({
            type: 'warning',
            message: `Warning ${clampedCount}/${MAX_TAB_SWITCH_ALLOWED}: Switching tabs is monitored. ${MAX_TAB_SWITCH_ALLOWED}th switch will auto-disqualify.`,
            duration: 4000,
          });
          setShowAntiCheatModal(true);
          return clampedCount;
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleSwitchViolation();
      }
    };

    const handleWindowBlur = () => {
      handleSwitchViolation();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [loading, submitting, student?.mobile, executeSubmit, isRoomQuiz, roomSession]);

  // Handle confirmed exit
  const handleConfirmExit = () => {
    if (student?.mobile) {
      try { localStorage.removeItem(`quiz_tab_switches_${student.mobile}`); } catch { /* noop */ }
    }
    if (roomStartedKey) {
      try { sessionStorage.removeItem(roomStartedKey); } catch { /* noop */ }
    }
    clearSavedProgress();
    clearStudent();
    navigate('/');
  };

  // ── Render states ─────────────────────────────────────────────────────────
  if (!student || !levelConfig) return null;

  if (loading) {
    return (
      <div className="centered-page">
        <div className="spinner" />
        <p className="loading-text">Loading your questions…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="centered-page">
        <p className="error-icon">⚠️</p>
        <p className="error-text">{loadError}</p>
        <button className="btn btn-primary" onClick={loadQuestions}>Try Again</button>
      </div>
    );
  }

  // ── ROOM QUIZ: Student Waiting Lobby (shown until admin starts the quiz) ──
  if (isRoomQuiz && !roomQuizStarted && startCountdown === 0 && !loading && questions.length > 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'var(--bg-color, #0f172a)',
      }}>
        {/* Waiting Lobby Modal Card */}
        <div style={{
          maxWidth: '460px',
          width: '100%',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          borderRadius: '24px',
          background: 'var(--surface-color, #1e293b)',
          border: '2px solid rgba(99,102,241,0.35)',
          boxShadow: '0 24px 60px -12px rgba(0,0,0,0.6)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Subtle animated gradient background */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at center top, rgba(99,102,241,0.1) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative' }}>
            {/* Animated pulse ring */}
            <div style={{ position: 'relative', display: 'inline-flex', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: '3.5rem', lineHeight: 1 }}>⏳</span>
              <span style={{
                position: 'absolute', inset: '-12px',
                borderRadius: '50%',
                border: '3px solid rgba(99,102,241,0.5)',
                animation: 'pulse-ring 1.8s ease-in-out infinite',
              }} />
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.5rem' }}>
              Waiting for Host to Start
            </h2>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
              You've joined <strong style={{ color: '#a5b4fc' }}>Room {roomSession?.roomCode}</strong>.<br />
              Questions are ready — the quiz will start for everyone simultaneously when the host fires it.
            </p>

            {/* Live participant count badge */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 1rem',
              borderRadius: '999px',
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              color: '#a5b4fc',
              fontSize: '0.85rem',
              fontWeight: 700,
              marginBottom: '1.5rem',
            }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: '#6366f1',
                display: 'inline-block',
                boxShadow: '0 0 0 3px rgba(99,102,241,0.3)',
                animation: 'pulse-dot 1.4s ease-in-out infinite',
              }} />
              You're in! Waiting for the host to start…
            </div>

            {/* Info strip */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              fontSize: '0.8rem',
              color: '#64748b',
              lineHeight: 1.5,
            }}>
              📌 {questions.length} question{questions.length !== 1 ? 's' : ''} loaded &nbsp;·&nbsp;
              Level {levelNum} &nbsp;·&nbsp;
              {student?.name || 'You'}
            </div>

            {/* Room info footer */}
            <p style={{ fontSize: '0.75rem', color: '#475569', marginTop: '1rem', marginBottom: 0 }}>
              <strong style={{ color: '#6366f1' }}>{roomSession?.roomCode}</strong> — Do not refresh the page
            </p>
          </div>
        </div>

        {/* Inline keyframe styles */}
        <style>{`
          @keyframes pulse-ring {
            0% { transform: scale(0.9); opacity: 0.8; }
            50% { transform: scale(1.1); opacity: 0.3; }
            100% { transform: scale(0.9); opacity: 0.8; }
          }
          @keyframes pulse-dot {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </div>
    );
  }

  // ── ROOM QUIZ: 3-2-1 Countdown Overlay (fires after admin starts, before questions show) ──
  if (isRoomQuiz && startCountdown > 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-color, #0f172a)',
        gap: '1rem',
      }}>
        <p style={{ color: '#94a3b8', fontSize: '1rem', fontWeight: 600, margin: 0, letterSpacing: '0.05em' }}>
          QUIZ STARTING IN
        </p>
        <div style={{
          fontSize: '9rem',
          fontWeight: 900,
          lineHeight: 1,
          color: '#6366f1',
          textShadow: '0 0 60px rgba(99,102,241,0.6)',
          animation: 'countdown-pop 0.4s ease-out',
          minWidth: '1ch',
          textAlign: 'center',
        }}>
          {startCountdown}
        </div>
        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
          Get ready — questions unlock in {startCountdown} second{startCountdown !== 1 ? 's' : ''}…
        </p>
        <style>{`
          @keyframes countdown-pop {
            0% { transform: scale(1.4); opacity: 0; }
            60% { transform: scale(0.95); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // ── PRE-QUIZ CUSTOM TIMER SETUP SCREEN ─────────────────────────────────
  const handleConfirmTimerSetup = () => {
    const total = (parseInt(timerSetupMins, 10) || 0) * 60 + (parseInt(timerSetupSecs, 10) || 0);
    const finalSecs = total > 0 ? total : (levelConfig?.timeSeconds || 900);
    setCustomTimeSeconds(finalSecs);
    setStartedAt(new Date());
    setShowTimerSetup(false);
    if (progressKey) {
      try {
        const existing = JSON.parse(localStorage.getItem(progressKey) || '{}');
        localStorage.setItem(progressKey, JSON.stringify({
          ...existing,
          customTimeSeconds: finalSecs,
          updatedAt: Date.now(),
        }));
      } catch { /* noop */ }
    }
  };

  if (!isRoomQuiz && showTimerSetup && questions.length > 0) {
    return (
      <div className="quiz-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div className="room-modal-card" style={{ maxWidth: '440px', width: '100%', padding: '2rem 2.25rem', textAlign: 'center', borderRadius: '20px', background: 'var(--surface-color, #1e293b)', border: '1px solid rgba(139,92,246,0.3)', boxShadow: '0 20px 40px -15px rgba(0,0,0,0.5)' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>⏱️</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.75rem', borderRadius: '999px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              <span>{levelConfig.label}</span>
              {(displaySubject || displayUnit) && <span>• {displaySubject} {displayUnit ? `(${displayUnit})` : ''}</span>}
            </div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.4rem' }}>
              Set Your Quiz Timer
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
              Questions are ready ({questions.length} questions). Choose your countdown time for this level before starting.
            </p>
          </div>

          {/* Big Digital Countdown Time Inputs */}
          <div style={{
            background: 'rgba(15,23,42,0.6)',
            border: '2px solid rgba(139,92,246,0.4)',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.25rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                  MINUTES
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={timerSetupMins}
                  onChange={(e) => setTimerSetupMins(Math.max(0, Math.min(180, parseInt(e.target.value) || 0)))}
                  style={{
                    width: '88px',
                    fontSize: '2.2rem',
                    fontWeight: 800,
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1.5px solid rgba(139,92,246,0.5)',
                    borderRadius: '10px',
                    color: '#f8fafc',
                    padding: '0.35rem',
                    outline: 'none',
                  }}
                />
              </div>
              <span style={{ fontSize: '2.2rem', fontWeight: 800, color: '#818cf8', lineHeight: 1, marginTop: '1rem' }}>:</span>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                  SECONDS
                </label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={timerSetupSecs}
                  onChange={(e) => setTimerSetupSecs(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  style={{
                    width: '88px',
                    fontSize: '2.2rem',
                    fontWeight: 800,
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1.5px solid rgba(139,92,246,0.5)',
                    borderRadius: '10px',
                    color: '#f8fafc',
                    padding: '0.35rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem' }}>
              {[
                { label: '5 min', m: 5, s: 0 },
                { label: '10 min', m: 10, s: 0 },
                { label: '15 min', m: 15, s: 0 },
                { label: '20 min', m: 20, s: 0 },
                { label: '30 min', m: 30, s: 0 },
                { label: `Default (${Math.floor(levelConfig.timeSeconds / 60)}m)`, m: Math.floor(levelConfig.timeSeconds / 60), s: levelConfig.timeSeconds % 60 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => { setTimerSetupMins(preset.m); setTimerSetupSecs(preset.s); }}
                  style={{
                    background: (timerSetupMins === preset.m && timerSetupSecs === preset.s)
                      ? 'rgba(99,102,241,0.35)'
                      : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(139,92,246,0.35)',
                    borderRadius: '20px',
                    color: '#c4b5fd',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.65rem',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.75rem 0 0', textAlign: 'center' }}>
              {(timerSetupMins === 0 && timerSetupSecs === 0)
                ? '⚠️ Untimed: Timer will not auto-submit.'
                : `⏱️ ${timerSetupMins}m ${timerSetupSecs}s countdown will start upon entering.`}
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700 }}
            onClick={handleConfirmTimerSetup}
          >
            🚀 Start Quiz ({questions.length} Questions)
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const answeredCount   = Object.keys(answers).length;
  const canGoPrev       = currentIndex > 0;
  const canGoNext       = currentIndex < questions.length - 1;
  const allAnswered     = answeredCount === questions.length;

  return (
    <div className="quiz-page">
      {/* ── Sticky header: Level Badge, Room Tag, Student Name, Theme Toggle ── */}
      <header className="quiz-header">
        <div className="quiz-header-left">
          <span className="quiz-level-badge">{levelConfig.label}</span>
          {isRoomQuiz && roomSession?.roomCode && (
            <span className="quiz-room-tag">🏫 Room: {roomSession.roomCode}</span>
          )}
          <span className="quiz-student-name">{student.name}</span>
        </div>
        <div className="quiz-header-right">
          <ThemeToggle />
        </div>
      </header>

      {/* ── Dynamic Level Stepper: renders N steps from totalLevels, never hardcoded ── */}
      {totalLevels > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
          padding: '0.45rem 1rem',
          background: 'rgba(15,23,42,0.55)',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
        }}>
          {Array.from({ length: totalLevels }, (_, i) => {
            const lvl = i + 1;
            const isCompleted = lvl < levelNum;
            const isCurrent = lvl === levelNum;
            return (
              <div key={lvl} style={{ display: 'flex', alignItems: 'center' }}>
                {/* Connector line before each step except the first */}
                {i > 0 && (
                  <div style={{
                    width: '32px',
                    height: '2px',
                    background: isCompleted || isCurrent
                      ? 'rgba(99,102,241,0.7)'
                      : 'rgba(99,102,241,0.18)',
                    transition: 'background 0.3s',
                  }} />
                )}
                {/* Step dot */}
                <div
                  title={`Level ${lvl}${LEVELS[lvl] ? ` — ${LEVELS[lvl].label || LEVELS[lvl].sublabel || ''}` : ''}`}
                  style={{
                    width: isCurrent ? '30px' : '22px',
                    height: isCurrent ? '30px' : '22px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: isCurrent ? '0.8rem' : '0.68rem',
                    color: isCompleted ? '#fff' : isCurrent ? '#fff' : '#475569',
                    background: isCompleted
                      ? 'linear-gradient(135deg, #10b981, #059669)'
                      : isCurrent
                        ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                        : 'rgba(99,102,241,0.08)',
                    border: isCompleted
                      ? '2px solid #10b981'
                      : isCurrent
                        ? '2px solid #818cf8'
                        : '2px solid rgba(99,102,241,0.2)',
                    boxShadow: isCurrent ? '0 0 12px rgba(99,102,241,0.5)' : 'none',
                    transition: 'all 0.3s ease',
                    cursor: 'default',
                    flexShrink: 0,
                  }}
                >
                  {isCompleted ? '✓' : lvl}
                </div>
              </div>
            );
          })}
          {/* Level count label */}
          <span style={{
            marginLeft: '0.75rem',
            fontSize: '0.72rem',
            color: '#64748b',
            fontWeight: 600,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}>
            Level {levelNum} of {totalLevels}
          </span>
        </div>
      )}

      {/* ── Centered Action Strip: Instructions button & Timer between Header and Progress Bar ── */}
      <div className="quiz-action-strip">
        <button
          type="button"
          className="guidance-pill quiz-instructions-pill"
          onClick={() => setShowGuide(true)}
          title="View Quiz Solving Instructions"
        >
          ℹ️ Instructions
        </button>
        {startedAt && (
          <TimerBar
            totalSeconds={customTimeSeconds || levelConfig.timeSeconds}
            startedAt={startedAt}
            onTimeUp={handleTimeUp}
            isPaused={isAntiCheatTerminal || submitting || hasSubmitted.current}
          />
        )}
      </div>

      <GuidanceDrawer
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        guide={GUIDES.quiz}
      />

      {/* ── Progress bar ── */}
      <ProgressBar
        current={currentIndex + 1}
        total={questions.length}
        answered={answeredCount}
      />

      {/* ── Subject & Unit Metadata Info Banner ── */}
      {(displaySubject || displayUnit) && (
        <div className="quiz-subject-unit-banner" role="region" aria-label="Topic Information">
          <div className="quiz-banner-inner">
            {displaySubject && (
              <span className="quiz-banner-item quiz-banner-subject">
                <span className="quiz-banner-icon">📚</span>
                <span className="quiz-banner-label">Subject:</span>
                <strong className="quiz-banner-value">{displaySubject}</strong>
              </span>
            )}
            {displaySubject && displayUnit && <span className="quiz-banner-dot" aria-hidden>•</span>}
            {displayUnit && (
              <span className="quiz-banner-item quiz-banner-unit">
                <span className="quiz-banner-icon">📖</span>
                <span className="quiz-banner-label">Unit/Topic:</span>
                <span className="quiz-banner-value">{displayUnit}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Question card (slides in on change) ── */}
      {currentQuestion && (
        <QuestionCard
          key={currentQuestion._id}
          question={currentQuestion}
          selectedIndex={answers[currentQuestion._id] ?? null}
          onAnswer={(idx) => handleAnswer(currentQuestion._id, idx)}
          questionNumber={currentIndex + 1}
          isBookmarked={!!bookmarks[currentQuestion._id]}
          onToggleBookmark={handleToggleBookmark}
        />
      )}

      {/* ── Interactive Question Palette Grid (1 to N) ── */}
      <QuestionPalette
        questions={questions}
        currentIndex={currentIndex}
        answers={answers}
        bookmarks={bookmarks}
        onSelectQuestion={(i) => setCurrentIndex(i)}
      />

      {/* ── Bottom Controls: Left ThemeToggle (above Prev), Right Exit (above Next) ── */}
      <div className="quiz-bottom-controls">
        <div className="quiz-bottom-left">
          <ThemeToggle />
        </div>
        <div className="quiz-bottom-right">
          <button
            className="exit-quiz-btn"
            onClick={() => setShowExitModal(true)}
            title="Exit Quiz"
            aria-label="Exit Quiz"
          >
            🚪 Exit
          </button>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="quiz-nav">
        <button
          className="btn btn-secondary"
          onClick={() => setCurrentIndex((i) => i - 1)}
          disabled={!canGoPrev || submitting}
        >
          ← Prev
        </button>

        <span className="quiz-answered-count">
          {answeredCount}/{questions.length} answered
        </span>

        {canGoNext ? (
          <button
            className="btn btn-primary"
            onClick={() => setCurrentIndex((i) => i + 1)}
            disabled={submitting}
          >
            Next →
          </button>
        ) : (
          <button
            id="submit-quiz-btn"
            className="btn btn-submit"
            onClick={handleManualSubmit}
            disabled={submitting}
          >
            {submitting
              ? <><span className="btn-spinner" /> Submitting…</>
              : allAnswered ? 'Submit Quiz ✓' : `Submit (${answeredCount}/${questions.length})`
            }
          </button>
        )}
      </nav>

      <ExitConfirmModal
        isOpen={showExitModal}
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
      />

      <AntiCheatModal
        isOpen={showAntiCheatModal}
        count={Math.min(tabSwitchCount, MAX_TAB_SWITCH_ALLOWED)}
        maxLimit={MAX_TAB_SWITCH_ALLOWED}
        isLimitReached={isAntiCheatTerminal}
        onAcknowledge={() => setShowAntiCheatModal(false)}
        onTerminalProceed={() => navigate('/results')}
      />

      <UnattemptedWarningModal
        isOpen={showUnattemptedModal}
        unattemptedCount={questions.length - answeredCount}
        level={levelNum}
        onGoBack={handleGoBackAndReview}
        onSubmitAnyway={handleSubmitAnyway}
        submitting={submitting}
      />

      {/* ── Room Closed Modal Overlay ── */}
      {isRoomClosed && (
        <div className="modal-backdrop room-closed-backdrop" role="dialog" aria-modal="true">
          <div className="modal-content room-closed-modal-content">
            <div className="room-closed-icon">🚪</div>
            <h2 className="room-closed-title">The Host has ended this room session. 🚪</h2>
            <p className="room-closed-desc">
              The administrator has closed this live quiz room. Active answering is disabled and your session has ended.
            </p>
            <button
              type="button"
              className="btn btn-primary room-closed-return-btn"
              onClick={() => {
                document.body.style.overflow = '';
                if (clearRoomSession) clearRoomSession();
                if (clearStudent) clearStudent();
                navigate('/');
              }}
            >
              OK / Return to Home
            </button>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
