import axios from 'axios';

/**
 * Axios instance with:
 * - Base URL from VITE_API_URL env var
 * - Automatic retry on network errors / 5xx (3 attempts, exponential backoff)
 * - Dispatches a 'api:retry' event so components can show a "Reconnecting…" banner
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://quizfunnel-rqqp.onrender.com',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Retry interceptor ────────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config) return Promise.reject(error);

    config._retryCount = config._retryCount || 0;

    // Retry only on network errors or server-side 5xx
    const isNetworkError = !error.response;
    const isServerError  = error.response?.status >= 500;

    if ((isNetworkError || isServerError) && config._retryCount < 3) {
      config._retryCount++;
      const delayMs = 1000 * Math.pow(2, config._retryCount - 1); // 1s → 2s → 4s

      // Notify UI to show a "Reconnecting…" state
      window.dispatchEvent(
        new CustomEvent('api:retry', {
          detail: { attempt: config._retryCount, maxAttempts: 3, delayMs },
        })
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return api(config);
    }

    return Promise.reject(error);
  }
);

// ── Student endpoints ────────────────────────────────────────────────────────
export const registerStudent = (data) =>
  api.post('/api/students/register', data);

export const getStudentStatus = (mobile) =>
  api.get(`/api/students/${encodeURIComponent(mobile)}/status`);

export const verifyResultsAuth = (data) =>
  api.post('/api/students/verify-results-auth', data);

export const resetStudentPassword = (data) =>
  api.post('/api/students/reset-password', data);

export const sendSmsOtp = (data) =>
  api.post('/api/students/send-otp', data);

export const verifySmsOtp = (data) =>
  api.post('/api/students/verify-otp', data);

export const resetPasswordWithOtp = (data) =>
  api.post('/api/students/reset-password-otp', data);

export const deleteStudentAttempt = (data) =>
  api.post('/api/students/delete-attempt', data);

// ── Quiz endpoints ───────────────────────────────────────────────────────────
export const getQuestions = (level, mobile) =>
  api.get(`/api/quiz/questions/${level}`, {
    headers: { 'x-student-mobile': mobile },
  });

export const submitQuiz = (payload) =>
  api.post('/api/quiz/submit', payload);

export const getQuizReview = (mobile) =>
  api.get(`/api/quiz/review/${encodeURIComponent(mobile)}`);

export const generateAiQuestions = (data) =>
  api.post('/api/generate-questions', data);

// ── Feedback endpoints ────────────────────────────────────────────────────────
export const submitFeedback = (payload) =>
  api.post('/api/feedback', payload);

export const getAttemptFeedback = (attemptId, mobile) =>
  api.get(`/api/feedback/${encodeURIComponent(attemptId)}`, { params: { mobile } });

// ── Room Quiz endpoints ───────────────────────────────────────────────────────
export const createRoom = (data) =>
  api.post('/api/rooms/create', data);

export const verifyRoom = (data) =>
  api.post('/api/rooms/verify', data);

export const joinRoom = (data) =>
  api.post('/api/rooms/join', data);

export const getRoomDetails = (roomCode, password) =>
  api.get(`/api/rooms/${encodeURIComponent(roomCode)}`, { params: { password } });

export const closeRoom = (roomCode, data) =>
  api.post(`/api/rooms/${encodeURIComponent(roomCode)}/close`, data);

export const rejoinRoom = (data) =>
  api.post('/api/rooms/admin/rejoin', data);

export const getRoomAnalytics = (roomCode, password) =>
  api.get(`/api/rooms/${encodeURIComponent(roomCode)}/analytics`, { params: { password } });

export const approveReattempt = (roomCode, data) =>
  api.post(`/api/rooms/${encodeURIComponent(roomCode)}/approve-reattempt`, data);

export const denyReattempt = (roomCode, data) =>
  api.post(`/api/rooms/${encodeURIComponent(roomCode)}/deny-reattempt`, data);

export const checkReattemptStatus = (roomCode, mobile) =>
  api.get(`/api/rooms/${encodeURIComponent(roomCode)}/reattempt-status`, { params: { mobile } });


// ── Admin endpoints ──────────────────────────────────────────────────────────
const adminHeaders = (password) => ({ Authorization: `Bearer ${password}` });

export const getAdminStudents = (password, filters = {}) =>
  api.get('/api/admin/students', { headers: adminHeaders(password), params: filters });

export const getAdminStats = (password) =>
  api.get('/api/admin/stats', { headers: adminHeaders(password) });

export const getLeaderboard = (password) =>
  api.get('/api/admin/leaderboard', { headers: adminHeaders(password) });

export const exportCSV = (password) =>
  api.get('/api/admin/export', {
    headers: adminHeaders(password),
    responseType: 'blob',
  });

export default api;
