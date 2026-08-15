import { useState, useEffect, useCallback } from 'react';
import { getAdminStudents, getAdminStats, getLeaderboard, exportCSV } from '../api';

const STATUS_LABELS = {
  'in-progress': 'In Progress',
  advanced:      'Advanced',
  eliminated:    'Eliminated',
  completed:     'Completed',
};

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Password Gate ─────────────────────────────────────────────────────────────
function PasswordGate({ onAuth }) {
  const [pwd, setPwd]   = useState('');
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pwd.trim()) { setErr('Please enter the admin password.'); return; }
    setLoading(true);
    try {
      await getAdminStats(pwd.trim()); // test call
      sessionStorage.setItem('admin_pwd', pwd.trim());
      onAuth(pwd.trim());
    } catch {
      setErr('Incorrect password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-gate">
      <div className="admin-gate-card">
        <div className="entry-logo" style={{ margin: '0 auto 1.5rem' }} aria-hidden>🔐</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Admin Dashboard</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Enter the admin password to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="password"
              className="form-input"
              placeholder="Admin password"
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setErr(''); }}
              autoFocus
            />
            {err && <p className="form-error">{err}</p>}
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Checking…' : 'Enter Dashboard →'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Stats Strip ───────────────────────────────────────────────────────────────
function StatsStrip({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Total Registered', value: stats.total, color: 'var(--color-text)' },
    { label: 'In Progress',      value: stats.inProgress, color: 'var(--color-warning)' },
    { label: 'Advanced',         value: stats.advanced,   color: 'var(--color-primary)' },
    { label: 'Eliminated',       value: stats.eliminated, color: 'var(--color-danger)' },
    { label: 'Completed L4',     value: stats.completed,  color: 'var(--color-success)' },
  ];
  return (
    <div className="stats-strip">
      {items.map((it) => (
        <div key={it.label} className="stat-card">
          <span className="stat-value" style={{ color: it.color }}>{it.value}</span>
          <span className="stat-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Admin Component ──────────────────────────────────────────────────────
export default function Admin() {
  const [password, setPassword] = useState(() => sessionStorage.getItem('admin_pwd') || '');
  const [authed, setAuthed]     = useState(!!sessionStorage.getItem('admin_pwd'));

  const [tab, setTab]           = useState('students'); // 'students' | 'leaderboard'
  const [students, setStudents] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  // Filters for student list
  const [search, setSearch]     = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async (pwd) => {
    setLoading(true);
    setError('');
    try {
      const [studRes, statsRes, lbRes] = await Promise.all([
        getAdminStudents(pwd, {
          search:  search  || undefined,
          branch:  filterBranch || undefined,
          status:  filterStatus || undefined,
        }),
        getAdminStats(pwd),
        getLeaderboard(pwd),
      ]);
      setStudents(studRes.data.data);
      setStats(statsRes.data.data);
      setLeaderboard(lbRes.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data. Check connection.');
    } finally {
      setLoading(false);
    }
  }, [search, filterBranch, filterStatus]);

  useEffect(() => {
    if (authed && password) load(password);
  }, [authed, password, load]);

  const handleAuth = (pwd) => {
    setPassword(pwd);
    setAuthed(true);
  };

  const handleExport = async () => {
    try {
      const res = await exportCSV(password);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quiz-results-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    }
  };

  if (!authed) return <PasswordGate onAuth={handleAuth} />;

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">📊 Admin Dashboard</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Freshers Orientation Quiz — Live Results
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => load(password)} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button className="btn btn-primary" onClick={handleExport}>
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsStrip stats={stats} />

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab${tab === 'students' ? ' active' : ''}`} onClick={() => setTab('students')}>
          All Students
        </button>
        <button className={`admin-tab${tab === 'leaderboard' ? ' active' : ''}`} onClick={() => setTab('leaderboard')}>
          🏆 Level 4 Leaderboard
        </button>
      </div>

      {error && <div className="server-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* ── Students Tab ── */}
      {tab === 'students' && (
        <>
          <div className="admin-filters">
            <input
              className="admin-search"
              placeholder="Search by name or mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="admin-filter-select" value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
              <option value="">All Branches</option>
              {['CSE', 'CSE-AIML', 'MBA'].map((b) => <option key={b}>{b}</option>)}
            </select>
            <select className="admin-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {['in-progress', 'advanced', 'eliminated', 'completed'].map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={() => load(password)}>Apply</button>
          </div>

          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>L1</th>
                  <th>L2</th>
                  <th>L3</th>
                  <th>L4</th>
                  <th>Total Score</th>
                  <th>Total Time</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={12} style={{ textAlign: 'center', padding: '2rem' }}>Loading…</td></tr>
                ) : students.length === 0 ? (
                  <tr><td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>No students found.</td></tr>
                ) : students.map((s, i) => (
                  <tr key={s._id}>
                    <td style={{ color: 'var(--color-text-dim)' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.mobile}</td>
                    <td>{s.branch}</td>
                    <td><span className={`status-badge ${s.status}`}>{STATUS_LABELS[s.status]}</span></td>
                    <td style={{ textAlign: 'center' }}>{s.currentLevel}</td>
                    <td>{s.levels?.find((l) => l.level === 1)?.score ?? '—'}</td>
                    <td>{s.levels?.find((l) => l.level === 2)?.score ?? '—'}</td>
                    <td>{s.levels?.find((l) => l.level === 3)?.score ?? '—'}</td>
                    <td>{s.levels?.find((l) => l.level === 4)?.score ?? '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{s.totalScore}</td>
                    <td>{formatTime(s.totalTimeTaken)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Leaderboard Tab ── */}
      {tab === 'leaderboard' && (
        <div className="leaderboard">
          <div className="leaderboard-header">
            Final Leaderboard — Level 4 Completers
            <span style={{ float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              Sorted: Score ↓ · Time ↑
            </span>
          </div>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
          ) : leaderboard.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No Level 4 completers yet.
            </div>
          ) : leaderboard.map((s) => (
            <div key={s.mobile} className="leaderboard-row">
              <span className={`leaderboard-rank${s.rank <= 3 ? ' top-3' : ''}`}>
                {s.rank <= 3 ? ['🥇','🥈','🥉'][s.rank - 1] : `#${s.rank}`}
              </span>
              <div style={{ flex: 1 }}>
                <div className="leaderboard-name">{s.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {s.branch} · {s.mobile}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="leaderboard-score">{s.totalScore} pts</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {formatTime(s.totalTimeTaken)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
