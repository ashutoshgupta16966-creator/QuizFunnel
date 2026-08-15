import { createContext, useContext, useState } from 'react';

const QuizContext = createContext(null);

/**
 * QuizProvider — wraps the whole app.
 * Persists the student session in localStorage so a page refresh doesn't
 * log the student out mid-quiz.
 */
export function QuizProvider({ children }) {
  const [student, setStudentState] = useState(() => {
    try {
      const saved = localStorage.getItem('quiz_student');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // lastResult is the submission response from the server ({score, passed, …})
  const [lastResult, setLastResult] = useState(null);

  const saveStudent = (data) => {
    setStudentState(data);
    try {
      localStorage.setItem('quiz_student', JSON.stringify(data));
    } catch {/* storage full — session still works in-memory */}
  };

  const updateStudent = (patch) => {
    setStudentState((prev) => {
      const updated = { ...prev, ...patch };
      try { localStorage.setItem('quiz_student', JSON.stringify(updated)); } catch { /* noop */ }
      return updated;
    });
  };

  const clearStudent = () => {
    setStudentState(null);
    setLastResult(null);
    localStorage.removeItem('quiz_student');
  };

  return (
    <QuizContext.Provider value={{
      student,
      saveStudent,
      updateStudent,
      clearStudent,
      lastResult,
      setLastResult,
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
