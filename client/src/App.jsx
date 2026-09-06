import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QuizProvider } from './context/QuizContext';
import EntryForm          from './pages/EntryForm';
import Quiz               from './pages/Quiz';
import LevelTransition    from './pages/LevelTransition';
import Results            from './pages/Results';
import Admin              from './pages/Admin';
import RoomAdminDashboard from './pages/RoomAdminDashboard';
import OfflineBanner      from './components/OfflineBanner';

export default function App() {
  return (
    <QuizProvider>
      <OfflineBanner />
      <BrowserRouter>
        <Routes>
          <Route path="/"                      element={<EntryForm />} />
          <Route path="/quiz/:level"           element={<Quiz />} />
          <Route path="/level-up"              element={<LevelTransition />} />
          <Route path="/results"               element={<Results />} />
          <Route path="/admin"                 element={<Admin />} />
          <Route path="/room/admin/:roomCode"  element={<RoomAdminDashboard />} />
          {/* Catch-all */}
          <Route path="*"                      element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QuizProvider>
  );
}
