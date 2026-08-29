import { useState, useEffect } from 'react';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [restoredToast, setRestoredToast] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setRestoredToast(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setRestoredToast(true);
      const t = setTimeout(() => setRestoredToast(false), 3500);
      return () => clearTimeout(t);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (isOffline) {
    return (
      <div className="offline-banner">
        <span className="offline-icon">📡</span>
        <span className="offline-text">
          Connection lost. Please check your internet connection...
        </span>
      </div>
    );
  }

  if (restoredToast) {
    return (
      <div className="online-restored-banner">
        <span className="online-icon">🟢</span>
        <span className="online-text">
          Connection restored! Continuing your quiz...
        </span>
      </div>
    );
  }

  return null;
}
