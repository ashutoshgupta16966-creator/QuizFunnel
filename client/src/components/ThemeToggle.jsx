import { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('quiz_theme');
      if (saved) return saved;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('quiz_theme', theme);
    } catch { /* noop */ }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const isLight = theme === 'light';

  return (
    <button
      className={`theme-switch-pill ${isLight ? 'is-light' : 'is-dark'}`}
      onClick={toggleTheme}
      title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
      aria-label="Toggle dark/light mode"
      type="button"
    >
      <span className="theme-switch-icon" aria-hidden>{isLight ? '☀️' : '🌙'}</span>
      <span className="theme-switch-label">{isLight ? 'Light' : 'Dark'}</span>
      <span className="theme-switch-track" aria-hidden>
        <span className="theme-switch-thumb" />
      </span>
    </button>
  );
}
