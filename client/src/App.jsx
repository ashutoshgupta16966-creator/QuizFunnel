import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QuizProvider } from './context/QuizContext';
import EntryForm       from './pages/EntryForm';
import Quiz            from './pages/Quiz';
import LevelTransition from './pages/LevelTransition';
import Results         from './pages/Results';
import Admin           from './pages/Admin';

export default function App() {
  return (
    <QuizProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"          element={<EntryForm />} />
          <Route path="/quiz/:level" element={<Quiz />} />
          <Route path="/level-up"  element={<LevelTransition />} />
          <Route path="/results"   element={<Results />} />
          <Route path="/admin"     element={<Admin />} />
          {/* Catch-all */}
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QuizProvider>
  );
}
