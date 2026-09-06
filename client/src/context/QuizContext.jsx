import { createContext, useContext, useState } from 'react';

const QuizContext = createContext(null);

// Keys used in localStorage/sessionStorage — kept in one place so
// clearAllStorage() never misses anything.
const STORAGE_KEYS = {
  student:     'quiz_student',
  adminPwd:    'admin_pwd', // sessionStorage
  roomSession: 'quiz_room_session',
};

/**
 * Wipes every quiz-related key from both localStorage and sessionStorage.
 * Called on "Return to Home" and when the app detects a stale session.
 */
function clearAllStorage() {
  try { localStorage.removeItem(STORAGE_KEYS.student); } catch { /* noop */ }
  try { localStorage.removeItem(STORAGE_KEYS.roomSession); } catch { /* noop */ }
  try { sessionStorage.removeItem(STORAGE_KEYS.adminPwd); } catch { /* noop */ }
}

/**
 * QuizProvider — wraps the whole app.
 *
 * Session persistence strategy:
 *  - Active quiz (in-progress / advanced): persisted in localStorage so a
 *    mid-quiz browser refresh doesn't lose progress.
 *  - Terminal states (eliminated / completed): localStorage is cleared
 *    immediately so re-visiting "/" always shows a clean registration form.
 */
export function QuizProvider({ children }) {
  const [student, setStudentState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.student);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      // FIX: Don't restore terminal-state students from storage.
      // If a student finished or was eliminated and they reload the page,
      // they should land on a clean entry form, not get stuck on the results screen.
      if (parsed?.status === 'eliminated' || parsed?.status === 'completed') {
        clearAllStorage();
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  // Room Session state (for room-based quizzes)
  const [roomSession, setRoomSessionState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.roomSession);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const isRoomQuiz = Boolean(roomSession?.isRoomQuiz && roomSession?.roomCode);

  const setRoomSession = (session) => {
    setRoomSessionState(session);
    if (session) {
      try {
        localStorage.setItem(STORAGE_KEYS.roomSession, JSON.stringify(session));
      } catch { /* noop */ }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEYS.roomSession);
      } catch { /* noop */ }
    }
  };

  const clearRoomSession = () => {
    setRoomSessionState(null);
    try {
      localStorage.removeItem(STORAGE_KEYS.roomSession);
    } catch { /* noop */ }
  };

  // lastResult holds the most recent level submission response
  const [lastResult, setLastResult] = useState(null);

  const saveStudent = (data) => {
    setStudentState(data);
    // Don't persist terminal states — keeps re-entry clean
    if (data?.status === 'eliminated' || data?.status === 'completed') {
      clearAllStorage();
    } else {
      try {
        localStorage.setItem(STORAGE_KEYS.student, JSON.stringify(data));
      } catch { /* storage full — session still works in-memory */ }
    }
  };

  const updateStudent = (patch) => {
    setStudentState((prev) => {
      const updated = { ...prev, ...patch };
      if (updated?.status === 'eliminated' || updated?.status === 'completed') {
        clearAllStorage();
      } else {
        try {
          localStorage.setItem(STORAGE_KEYS.student, JSON.stringify(updated));
        } catch { /* noop */ }
      }
      return updated;
    });
  };

  /**
   * clearStudent — called when "Return to Home" is clicked.
   * Wipes all stored state so the next visit starts cleanly from Level 1.
   */
  const clearStudent = () => {
    setStudentState(null);
    setLastResult(null);
    clearRoomSession();
    clearAllStorage();
  };

  return (
    <QuizContext.Provider value={{
      student,
      saveStudent,
      updateStudent,
      clearStudent,
      lastResult,
      setLastResult,
      roomSession,
      isRoomQuiz,
      setRoomSession,
      clearRoomSession,
    }}>
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() {
  const ctx = useContext(QuizContext);
  if (!ctx) throw new Error('useQuiz must be used inside <QuizProvider>');
  return ctx;
}
