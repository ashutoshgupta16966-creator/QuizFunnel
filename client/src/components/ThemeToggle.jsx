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

  // Synchronize across multiple ThemeToggle instances on the same page and across tabs
  useEffect(() => {
    const handleSync = (e) => {
      const newTheme = e.detail;
      if (newTheme && (newTheme === 'dark' || newTheme === 'light')) {
        setTheme(newTheme);
      }
    };

    const handleStorage = (e) => {
      if (e.key === 'quiz_theme' && e.newValue) {
        setTheme(e.newValue);
      }
    };

    window.addEventListener('quiz:theme-change', handleSync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('quiz:theme-change', handleSync);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      window.dispatchEvent(new CustomEvent('quiz:theme-change', { detail: next }));
      return next;
    });
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
