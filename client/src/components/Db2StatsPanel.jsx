import { useState, useEffect } from 'react';
import { getDb2Health, getDb2Stats } from '../api';

export default function Db2StatsPanel({ roomCode }) {
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAndFetch() {
      try {
        const healthRes = await getDb2Health();
        if (!isMounted) return;

        const isEnabled = Boolean(healthRes?.data?.enabled);
        const isConn = Boolean(healthRes?.data?.connected);
        setEnabled(isEnabled);
        setConnected(isConn);

        if (isEnabled && roomCode) {
          setLoading(true);
          const statsRes = await getDb2Stats(roomCode);
          if (isMounted && statsRes?.data?.data) {
            setStats(statsRes.data.data);
          }
        }
      } catch (err) {
        // Silently hide on any failure — never block or disrupt the dashboard
        if (isMounted) {
          setEnabled(false);
          setConnected(false);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    checkAndFetch();
    return () => {
      isMounted = false;
    };
  }, [roomCode]);

  // Completely hidden if Db2 is not enabled
  if (!enabled) return null;

  return (
    <div
      style={{
        margin: '1rem 0',
        padding: '1rem 1.25rem',
        borderRadius: '12px',
        background: 'linear-gradient(135deg, rgba(15, 98, 254, 0.08) 0%, rgba(0, 45, 156, 0.12) 100%)',
        border: '1px solid rgba(15, 98, 254, 0.25)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '1.25rem' }}>🔷</span>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary, #1e293b)' }}>
              Powered by IBM Db2
            </span>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '999px',
                background: connected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: connected ? '#16a34a' : '#dc2626',
              }}
            >
              {connected ? '● Dual-Write Synced' : '○ Offline'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
            Enterprise relational backup & analytics store
          </p>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
              Db2 Participants
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f62fe' }}>
              {stats.participantsCount ?? 0}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
              Db2 Answers
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f62fe' }}>
              {stats.answersCount ?? 0}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
              Db2 Avg Score
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f62fe' }}>
              {stats.averageScore ?? 0}
            </div>
          </div>
        </div>
      )}

      {loading && !stats && (
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Syncing stats…</span>
      )}
    </div>
  );
}
