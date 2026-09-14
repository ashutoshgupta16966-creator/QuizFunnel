import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomDetails, closeRoom, getRoomAnalytics, approveReattempt, denyReattempt, exportRoomResultsXLSX } from '../api';
import { joinAdminRoomSocket, disconnectSocket } from '../utils/socket';
import ThemeToggle from '../components/ThemeToggle';
import LevelDistributionChart from '../components/LevelDistributionChart';


function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function RoomAdminDashboard() {
  const { roomCode } = useParams();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [closing, setClosing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const adminPassword = sessionStorage.getItem(`room_admin_pwd_${roomCode?.toUpperCase()}`) || '';

  // ── Pending Re-attempt Requests Queue ───────────────────────────────────────
  const [pendingRequests, setPendingRequests] = useState([]);
  const [processingAction, setProcessingAction] = useState('');

  // ── Expandable Student Row (Accordion: only 1 row expanded at a time) ───────
  const [expandedMobile, setExpandedMobile] = useState(null);
  const [attemptTabMap, setAttemptTabMap] = useState({}); // { [mobile]: 'current' | 'previous' }
  const toggleExpandRow = (mobile) => {
    setExpandedMobile((prev) => (prev === mobile ? null : mobile));
  };

  // ── Analytics state ─────────────────────────────────────────────────────────
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null); // { totalStudents, byLevel }
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsLevel, setAnalyticsLevel] = useState(1); // active level tab


  // ── Fetch Initial Room Details ──
  const fetchDetails = useCallback(async () => {
    if (!roomCode) return;
    try {
      setLoading(true);
      setError('');
      const res = await getRoomDetails(roomCode, adminPassword);
      setRoom(res.data.data);
      if (Array.isArray(res.data.data?.reattemptRequests)) {
        setPendingRequests(res.data.data.reattemptRequests);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load room details. Please check room code.');
    } finally {
      setLoading(false);
    }
  }, [roomCode, adminPassword]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // ── Connect Admin Real-time Socket ──
  useEffect(() => {
    if (!roomCode) return;

    const cleanupSocket = joinAdminRoomSocket(roomCode, adminPassword, {
      onJoined: (data) => {
        setRoom((prev) => {
          if (!prev) return data;
          const incoming = data?.participants || [];
          const merged = incoming.map((p) => {
            const existing = (prev.participants || []).find((old) => old.mobile === p.mobile);
            const hasLevels = Array.isArray(p.levels) && p.levels.length > 0;
            return {
              ...p,
              levels: hasLevels ? p.levels : (existing?.levels || []),
            };
          });
          return {
            ...prev,
            ...data,
            participants: merged.length > 0 ? merged : (data?.participants || prev.participants || []),
          };
        });
        if (Array.isArray(data?.reattemptRequests)) {
          setPendingRequests(data.reattemptRequests);
        }
      },
      onStudentJoined: (newStudent) => {
        setRoom((prev) => {
          if (!prev) return prev;
          const existingList = prev.participants || [];
          const exists = existingList.some((p) => p.mobile === newStudent.mobile);
          if (exists) {
            return {
              ...prev,
              participants: existingList.map((p) => (p.mobile === newStudent.mobile ? { ...p, ...newStudent } : p)),
            };
          }
          return {
            ...prev,
            participants: [newStudent, ...existingList],
          };
        });
      },
      onStudentUpdated: (update) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: (prev.participants || []).map((p) => {
              if (p.mobile !== update.mobile) return p;
              const hasLevels = Array.isArray(update.levels) && update.levels.length > 0;
              return {
                ...p,
                ...update,
                levels: hasLevels ? update.levels : (p.levels || []),
              };
            }),
          };
        });
      },
      onStudentDisqualified: ({ mobile }) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: (prev.participants || []).map((p) =>
              p.mobile === mobile ? { ...p, status: 'eliminated', isDisqualified: true } : p
            ),
          };
        });
      },
      onReattemptRequest: (newReq) => {
        setPendingRequests((prev) => {
          const filtered = prev.filter((r) => r.mobile !== newReq.mobile);
          return [newReq, ...filtered];
        });
      },
      onError: (err) => {
        console.warn('Admin room socket notice:', err.message);
      },
    });

    return () => {
      cleanupSocket();
      disconnectSocket();
    };
  }, [roomCode, adminPassword]);

  // ── Re-attempt Host Approval Handlers ───────────────────────────────────────
  const handleApproveReattempt = async (mobile) => {
    try {
      setProcessingAction(`approve_${mobile}`);
      await approveReattempt(roomCode, { mobile, password: adminPassword });
      // Immediately remove from pendingRequests array to hide popup/card from Live Dashboard
      setPendingRequests((prev) => prev.filter((r) => r.mobile !== mobile));
      // Do NOT call fetchDetails() here: preserve the student's previous attempt record on dashboard
      // until they submit their first answer in the new attempt.
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve re-attempt.');
    } finally {
      setProcessingAction('');
    }
  };

  const handleDenyReattempt = async (mobile) => {
    try {
      setProcessingAction(`deny_${mobile}`);
      await denyReattempt(roomCode, { mobile, password: adminPassword });
      setPendingRequests((prev) => prev.filter((r) => r.mobile !== mobile));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to deny re-attempt.');
    } finally {
      setProcessingAction('');
    }
  };

  // ── Copy Room Code ──
  const handleCopyCode = () => {
    if (!room?.roomCode) return;
    navigator.clipboard.writeText(room.roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Copy Shareable Join Link ──
  const handleCopyLink = () => {
    if (!room?.roomCode) return;
    const url = `${window.location.origin}/?joinRoom=${room.roomCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // ── Close Room Handler ──
  const handleCloseRoom = async () => {
    if (!window.confirm('Are you sure you want to close this room? Students will no longer be able to submit.')) {
      return;
    }
    setClosing(true);
    try {
      await closeRoom(roomCode, { password: adminPassword });
      setRoom((prev) => (prev ? { ...prev, status: 'closed' } : prev));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to close room.');
    } finally {
      setClosing(false);
    }
  };

  // ── Excel (.xlsx) Export ──────────────────────────────────────────────────────
  const handleExportXLSX = async () => {
    if (!roomCode) return;
    const allParticipants = room?.participants || [];
    if (allParticipants.length === 0) {
      alert('No participant data to export yet.');
      return;
    }

    try {
      setExporting(true);
      const res = await exportRoomResultsXLSX(roomCode, adminPassword);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `QuizFunnel_Room_${room?.roomCode || roomCode}_Results.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export Excel error:', err);
      alert('Failed to export Excel results. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ── Fetch Question Analytics ──────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async () => {
    if (!roomCode) return;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const res = await getRoomAnalytics(roomCode, adminPassword);
      setAnalyticsData(res.data.data);
      // Auto-select the first available level
      const levels = Object.keys(res.data.data.byLevel || {}).map(Number).sort();
      if (levels.length > 0) setAnalyticsLevel(levels[0]);
    } catch (err) {
      setAnalyticsError(err.response?.data?.error || 'Failed to load analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [roomCode, adminPassword]);

  const handleToggleAnalytics = () => {
    const willOpen = !analyticsOpen;
    setAnalyticsOpen(willOpen);
    // Fetch on first open (or if no data yet)
    if (willOpen && !analyticsData && !analyticsLoading) {
      fetchAnalytics();
    }
  };

  // Filter and sort participants

  const participants = room?.participants || [];
  const totalJoined = participants.length;
  const maxCapacity = room?.maxCapacity || 60;
  const capacityPct = Math.min(100, Math.round((totalJoined / maxCapacity) * 100));

  const filteredParticipants = useMemo(() => {
    return participants
      .filter((p) => {
        if (filterStatus === 'completed') return p.status === 'completed';
        if (filterStatus === 'in-progress') return p.status === 'in-progress' || p.status === 'advanced';
        if (filterStatus === 'disqualified') return p.isDisqualified;
        if (filterStatus === 'eliminated') return p.status === 'eliminated' && !p.isDisqualified;
        return true;
      })
      .filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.name?.toLowerCase().includes(q) ||
          p.mobile?.includes(q) ||
          p.branch?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Sort by score desc, then time taken asc
        if ((b.score || 0) !== (a.score || 0)) {
          return (b.score || 0) - (a.score || 0);
        }
        return (a.timeTaken || 0) - (b.timeTaken || 0);
      });
  }, [participants, filterStatus, searchQuery]);

  return (
    <div className="admin-room-dashboard-page">
      {/* Top Navbar */}
      <header className="room-dashboard-header">
        <div className="header-left">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const adminPhone = room?.adminPhone || sessionStorage.getItem('room_admin_phone') || '';
              navigate('/', {
                state: {
                  openRoomModal: true,
                  initialStep: adminPhone ? 'admin_my_rooms_list' : 'select_role',
                  initialPhone: adminPhone,
                },
              });
            }}
            title="Return to Host History Hub"
          >
            ← Back
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/')}
            title="Return to Home Page"
          >
            🏠 Home
          </button>
          <div className="room-title-block">
            <span className="room-icon">👑</span>
            <h1 className="room-dashboard-title">Live Room Dashboard</h1>
          </div>
        </div>
        <div className="header-right">
          <ThemeToggle />
        </div>
      </header>

      <main className="room-dashboard-content">
        {loading && (
          <div className="dashboard-loading-state">
            <div className="spinner" />
            <p>Loading Live Room session…</p>
          </div>
        )}

        {error && (
          <div className="dashboard-error-state">
            <p>⚠️ {error}</p>
            <button className="btn btn-primary" onClick={fetchDetails}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && room && (
          <>
            {/* ── Room Hero Info Bar ── */}
            <div className="room-hero-card">
              <div className="hero-details">
                <div className="room-code-tag">
                  <span className="code-label">ROOM CODE:</span>
                  <span className="code-value">{room.roomCode}</span>
                  <button
                    type="button"
                    className="copy-chip-btn"
                    onClick={handleCopyCode}
                    title="Copy Room Code"
                  >
                    {copied ? '✅ Copied!' : '📋 Copy Code'}
                  </button>
                  <button
                    type="button"
                    className="copy-chip-btn link-chip"
                    onClick={handleCopyLink}
                    title="Copy direct invitation link"
                  >
                    {copiedLink ? '✅ Link Copied!' : '🔗 Copy Invite Link'}
                  </button>
                </div>

                {room.quizTitle && (
                  <div className="room-title-subhead">
                    <span className="title-icon">📝</span>
                    <span className="title-text">{room.quizTitle}</span>
                  </div>
                )}

                {(room.subject || room.unit || room.isAiGenerated) && (
                  <div className="room-subject-subhead" style={{ marginTop: '0.35rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {room.isAiGenerated && <span className="badge-ai-indicator" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>🤖 AI Quiz</span>}
                    {room.subject && <span className="badge-subject" style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.08))', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>📚 {room.subject}</span>}
                    {room.unit && <span className="badge-unit" style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.08))', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>🔖 {room.unit}</span>}
                  </div>
                )}

                <div className="room-admin-meta">
                  <span>Host: <strong>{room.adminName}</strong></span>
                  {room.adminPhone && <span>· Phone: <strong>{room.adminPhone}</strong></span>}
                  <span>· Status: <strong className={`room-status-pill ${room.status}`}>{room.status.toUpperCase()}</strong></span>
                </div>
              </div>

              {/* Capacity Progress Block */}
              <div className="capacity-container">
                <div className="capacity-text-row">
                  <span className="capacity-label">Active Room Capacity</span>
                  <span className={`capacity-count ${totalJoined >= maxCapacity ? 'capacity-full' : ''}`}>
                    {totalJoined} / {maxCapacity} Students
                  </span>
                </div>
                <div className="capacity-progress-bar">
                  <div
                    className={`capacity-fill ${totalJoined >= maxCapacity ? 'fill-full' : capacityPct > 75 ? 'fill-high' : ''}`}
                    style={{ width: `${capacityPct}%` }}
                  />
                </div>
                {totalJoined >= maxCapacity && (
                  <span className="capacity-full-warning">⚠️ Room Full (Maximum 60 students limit reached)</span>
                )}
              </div>
            </div>

            {/* ── Pending Re-attempt Requests Queue ── */}
            {pendingRequests.length > 0 && (
              <div className="reattempt-requests-container">
                <div className="reattempt-requests-header">
                  <span className="reattempt-alert-badge">
                    🔔 {pendingRequests.length} Pending Re-attempt Request{pendingRequests.length > 1 ? 's' : ''}
                  </span>
                  <p className="reattempt-header-sub">
                    Candidates who previously completed or were eliminated are requesting re-entry.
                  </p>
                </div>
                <div className="reattempt-cards-list">
                  {pendingRequests.map((req) => (
                    <div key={req.mobile} className="reattempt-card-item">
                      <div className="reattempt-student-details">
                        <strong className="reattempt-student-name">{req.name}</strong>
                        <span className="reattempt-student-meta">
                          {req.branch} · {req.mobile}
                        </span>
                        {req.previousStatus && (
                          <span className="reattempt-prev-status">
                            Previous status: <em>{req.previousStatus} ({req.previousScore || 0} pts)</em>
                          </span>
                        )}
                      </div>
                      <div className="reattempt-action-buttons">
                        <button
                          type="button"
                          className="btn btn-sm btn-success reattempt-allow-btn"
                          onClick={() => handleApproveReattempt(req.mobile)}
                          disabled={Boolean(processingAction)}
                        >
                          {processingAction === `approve_${req.mobile}` ? 'Allowing…' : '✓ Allow Re-attempt'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger reattempt-deny-btn"
                          onClick={() => handleDenyReattempt(req.mobile)}
                          disabled={Boolean(processingAction)}
                        >
                          {processingAction === `deny_${req.mobile}` ? 'Denying…' : '✕ Deny'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Level Distribution Pie Chart ── */}
            <LevelDistributionChart participants={participants} />

            {/* ── Control Action Strip ── */}
            <div className="dashboard-control-strip">
              <div className="search-filter-box">
                <input
                  type="text"
                  className="dashboard-search-input"
                  placeholder="🔍 Search by Name, Mobile, or Branch…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                <div className="filter-pills-row">
                  <button
                    type="button"
                    className={`filter-pill ${filterStatus === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterStatus('all')}
                  >
                    All ({participants.length})
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${filterStatus === 'in-progress' ? 'active' : ''}`}
                    onClick={() => setFilterStatus('in-progress')}
                  >
                    In Progress ({participants.filter((p) => p.status === 'in-progress' || p.status === 'advanced').length})
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${filterStatus === 'completed' ? 'active' : ''}`}
                    onClick={() => setFilterStatus('completed')}
                  >
                    Completed ({participants.filter((p) => p.status === 'completed').length})
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${filterStatus === 'disqualified' ? 'active' : ''}`}
                    onClick={() => setFilterStatus('disqualified')}
                  >
                    Disqualified ({participants.filter((p) => p.isDisqualified).length})
                  </button>
                </div>
              </div>

              <div className="action-buttons-group">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={fetchDetails}
                  title="Force re-fetch participant data"
                >
                  🔄 Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-export btn-sm"
                  onClick={handleExportXLSX}
                  title="Download participant results as Excel (.xlsx)"
                  disabled={exporting || participants.length === 0}
                >
                  {exporting ? '⏳ Exporting…' : '📥 Export Results (.xlsx)'}
                </button>
                <button
                  type="button"
                  className={`btn btn-analytics btn-sm ${analyticsOpen ? 'active' : ''}`}
                  onClick={handleToggleAnalytics}
                  title="View per-question answer analytics"
                >
                  📊 Question Analytics {analyticsOpen ? '▲' : '▼'}
                </button>
                {room.status === 'active' && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm close-room-btn"
                    onClick={handleCloseRoom}
                    disabled={closing}
                  >
                    {closing ? 'Closing…' : '🔒 Close Room'}
                  </button>
                )}
              </div>
            </div>


            {/* ── Real-Time Participants Table ── */}
            <div className="table-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th className="th-center">#</th>
                    <th>Student Name</th>
                    <th>Branch</th>
                    <th>Mobile</th>
                    <th>Current Level</th>
                    <th className="th-center">Live Score</th>
                    <th>Status</th>
                    <th className="th-center">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParticipants.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="empty-table-cell">
                        {participants.length === 0 ? (
                          <div className="waiting-students-state">
                            <span className="pulse-dot" />
                            <p>Waiting for students to join room <strong>{room.roomCode}</strong>…</p>
                            <span className="sub-hint">Share the Room Code or invite link with students</span>
                          </div>
                        ) : (
                          <p>No students match the current filter.</p>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredParticipants.map((p, idx) => {
                      const isDisq = Boolean(p.isDisqualified);
                      const isComp = !isDisq && p.status === 'completed';
                      const isAdv  = !isDisq && p.status === 'advanced';
                      const isElim = !isDisq && p.status === 'eliminated';
                      const isExpanded = expandedMobile === p.mobile;

                      return (
                        <Fragment key={p.mobile}>
                          <tr
                            className={`participant-row ${isDisq ? 'row-disqualified' : ''} ${isExpanded ? 'row-is-expanded' : ''}`}
                          >
                            <td className="rank-cell td-center">{idx + 1}</td>
                            <td className="name-cell">
                              <div className="name-with-badge">
                                <button
                                  type="button"
                                  className={`row-expand-btn ${isExpanded ? 'expanded' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpandRow(p.mobile);
                                  }}
                                  title={isExpanded ? 'Click to collapse breakdown' : 'Click to view level breakdown'}
                                  aria-expanded={isExpanded}
                                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} level details for ${p.name}`}
                                >
                                  <span className="expand-chevron" aria-hidden="true">›</span>
                                </button>
                                <strong className="student-name-text">{p.name}</strong>
                                {p.isReattempt && (
                                  <span className="reattempt-badge" title="Re-attempt approved by Host">
                                    Re-attempted 🔄
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="branch-tag">{p.branch || '—'}</span>
                            </td>
                            <td className="mono-cell">{p.mobile}</td>
                            <td>
                              <span className="level-badge">Level {p.level || 1}</span>
                            </td>
                            <td className="score-cell td-center">
                              <strong>{p.score ?? 0} pts</strong>
                            </td>
                            <td>
                              {isDisq ? (
                                <span className="status-badge disqualified">Disqualified 🚫</span>
                              ) : isComp ? (
                                <span className="status-badge completed">Completed 🏆</span>
                              ) : isAdv ? (
                                <span className="status-badge advanced">Advanced ⚡</span>
                              ) : isElim ? (
                                <span className="status-badge eliminated">Eliminated</span>
                              ) : (
                                <span className="status-badge in-progress">In Progress ⏳</span>
                              )}
                            </td>
                            <td className="time-cell td-center">{formatTimeMMSS(p.timeTaken || 0)}</td>
                          </tr>

                          {/* ── Expandable Accordion: Level-wise Breakdown ── */}
                          {isExpanded && (() => {
                            const hasReattempt = Boolean(
                              p.isReattempt ||
                              p.previousAttempt ||
                              (pendingRequests || []).some((r) => r.mobile === p.mobile)
                            );
                            const activeTab = attemptTabMap[p.mobile] || 'current';
                            const isPreviousView = hasReattempt && activeTab === 'previous';

                            const studentLevels = isPreviousView
                              ? (Array.isArray(p.previousAttempt?.levels) ? p.previousAttempt.levels : [])
                              : (Array.isArray(p.levels) ? p.levels : []);

                            const totalScoreVal = isPreviousView
                              ? (p.previousAttempt?.score ?? 0)
                              : (p.computedTotalScore ?? (studentLevels.length > 0
                                  ? studentLevels.reduce((acc, curr) => acc + (curr.score || 0), 0)
                                  : (p.score ?? 0)));

                            const totalTimeVal = isPreviousView
                              ? (p.previousAttempt?.timeTaken ?? 0)
                              : (p.computedTotalTime ?? (studentLevels.length > 0
                                  ? studentLevels.reduce((acc, curr) => acc + (curr.timeTaken || 0), 0)
                                  : (p.timeTaken ?? 0)));

                            const finalStatusVal = isPreviousView
                              ? (p.previousAttempt?.status || (p.previousAttempt?.isDisqualified ? 'Disqualified' : 'Eliminated'))
                              : (p.isDisqualified ? 'Disqualified' : (
                                  p.status === 'completed' ? 'Completed' :
                                  p.status === 'eliminated' ? 'Eliminated' :
                                  p.status === 'advanced' ? 'Advanced' : 'In Progress'
                                ));

                            return (
                              <tr className="expanded-details-row">
                                <td colSpan="8" className="expanded-details-cell">
                                  <div className="level-breakdown-card">
                                    <div className="level-breakdown-header">
                                      <div className="breakdown-title-left">
                                        <span className="breakdown-icon">📊</span>
                                        <span className="breakdown-title-text">
                                          Level-wise Breakdown: <strong>{p.name}</strong>
                                        </span>
                                        <span className="breakdown-branch-pill">{p.branch || 'CSE'}</span>
                                      </div>
                                      <span className="breakdown-mobile-meta">📱 {p.mobile}</span>
                                    </div>

                                    {/* ── Multi-Attempt Toggle Switch ── */}
                                    {hasReattempt && (
                                      <div className="attempt-toggle-tabs-bar">
                                        <div className="attempt-toggle-tabs" role="tablist">
                                          <button
                                            type="button"
                                            role="tab"
                                            aria-selected={activeTab === 'previous'}
                                            className={`attempt-tab-btn ${activeTab === 'previous' ? 'active' : ''}`}
                                            onClick={() => setAttemptTabMap((prev) => ({ ...prev, [p.mobile]: 'previous' }))}
                                          >
                                            📜 Previous Attempt
                                          </button>
                                          <button
                                            type="button"
                                            role="tab"
                                            aria-selected={activeTab === 'current'}
                                            className={`attempt-tab-btn ${activeTab === 'current' ? 'active' : ''}`}
                                            onClick={() => setAttemptTabMap((prev) => ({ ...prev, [p.mobile]: 'current' }))}
                                          >
                                            ⚡ Re-attempt Data
                                          </button>
                                        </div>
                                        <span className="attempt-tab-mode-tag">
                                          {isPreviousView ? 'Initial Attempt Score & History' : 'Current Re-attempt Performance'}
                                        </span>
                                      </div>
                                    )}

                                    <div className="level-breakdown-table-wrapper">
                                      <table className="level-breakdown-table">
                                        <thead>
                                          <tr>
                                            <th>Level</th>
                                            <th className="th-center">Score</th>
                                            <th className="th-center">Time Taken</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {[1, 2, 3, 4].map((lvlNum) => {
                                            const lvlData = studentLevels.find((l) => l.level === lvlNum);
                                            const isCurrentPlaying =
                                              !isPreviousView &&
                                              !lvlData &&
                                              p.level === lvlNum &&
                                              (p.status === 'in-progress' || p.status === 'advanced');
                                            const isNotAttempted = !lvlData && !isCurrentPlaying;

                                            return (
                                              <tr key={lvlNum} className={isNotAttempted ? 'row-not-attempted' : ''}>
                                                <td>
                                                  <span
                                                    className={`breakdown-level-badge ${
                                                      isNotAttempted ? 'badge-muted' : isCurrentPlaying ? 'badge-active-level' : ''
                                                    }`}
                                                  >
                                                    Level {lvlNum}
                                                  </span>
                                                </td>
                                                <td className="td-center breakdown-score-cell">
                                                  {lvlData ? (
                                                    <span><strong>{lvlData.score ?? 0}</strong> pts</span>
                                                  ) : isCurrentPlaying ? (
                                                    <span className="text-subtle">—</span>
                                                  ) : (
                                                    <span className="text-muted">—</span>
                                                  )}
                                                </td>
                                                <td className="td-center breakdown-time-cell">
                                                  {lvlData ? (
                                                    formatTimeMMSS(lvlData.timeTaken || 0)
                                                  ) : isCurrentPlaying ? (
                                                    <span className="status-badge-inline in-progress">In progress ⏳</span>
                                                  ) : (
                                                    <span className="status-badge-inline not-attempted">Not attempted</span>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>

                                    {/* Separate Total Section below the level breakdown */}
                                    <div className="breakdown-total-container">
                                      <div className="total-container-header">
                                        <span className="total-heading">
                                          {isPreviousView ? 'Initial Attempt Performance Summary' : 'Total (Sum Across All Levels)'}
                                        </span>
                                      </div>
                                      <div className="total-metric-items">
                                        <div className="total-metric-card score-card">
                                          <span className="total-metric-label">Total Score:</span>
                                          <span className="total-metric-val score-val">
                                            {totalScoreVal} pts
                                          </span>
                                        </div>
                                        <div className="total-metric-card time-card">
                                          <span className="total-metric-label">Total Time:</span>
                                          <span className="total-metric-val time-val">
                                            {formatTimeMMSS(totalTimeVal)}
                                          </span>
                                        </div>
                                        <div className="total-metric-card status-card">
                                          <span className="total-metric-label">Final Status:</span>
                                          <span className={`total-metric-val status-val status-${String(finalStatusVal).toLowerCase().replace(/\s+/g, '-')}`}>
                                            {finalStatusVal}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Question Analytics Accordion ── */}
            {analyticsOpen && (
              <div className="analytics-accordion">
                <div className="analytics-accordion-header">
                  <span className="analytics-title-icon">📊</span>
                  <h3 className="analytics-title">Question Analytics</h3>
                  {analyticsData && (
                    <span className="analytics-meta">
                      {analyticsData.totalStudents} student{analyticsData.totalStudents !== 1 ? 's' : ''} analysed
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs analytics-refresh-btn"
                    onClick={fetchAnalytics}
                    disabled={analyticsLoading}
                    title="Re-fetch analytics"
                  >
                    {analyticsLoading ? '⏳' : '🔄'} Refresh
                  </button>
                </div>

                {analyticsLoading && (
                  <div className="analytics-loading">
                    <span className="spinner" /> Loading question data…
                  </div>
                )}

                {analyticsError && (
                  <div className="analytics-error">⚠️ {analyticsError}</div>
                )}

                {!analyticsLoading && !analyticsError && analyticsData && (
                  (() => {
                    const levels = Object.keys(analyticsData.byLevel || {}).map(Number).sort();
                    if (levels.length === 0) {
                      return (
                        <p className="analytics-empty">
                          No question data yet — analytics populate after students submit each level.
                        </p>
                      );
                    }

                    const activeQuestions = analyticsData.byLevel[analyticsLevel] || [];

                    return (
                      <>
                        {/* Level tab strip */}
                        <div className="analytics-level-tabs">
                          {levels.map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              className={`analytics-level-tab ${analyticsLevel === lvl ? 'active' : ''}`}
                              onClick={() => setAnalyticsLevel(lvl)}
                            >
                              Level {lvl}
                              <span className="analytics-tab-count">
                                {analyticsData.byLevel[lvl]?.length || 0}Q
                              </span>
                            </button>
                          ))}
                        </div>

                        {/* Per-question cards */}
                        {activeQuestions.length === 0 ? (
                          <p className="analytics-empty">
                            No submissions for Level {analyticsLevel} yet.
                          </p>
                        ) : (
                          <div className="analytics-questions-list">
                            {activeQuestions.map((q, idx) => {
                              const difficulty = q.difficulty || 'medium';
                              return (
                                <div
                                  key={q.questionId}
                                  className={`analytics-question-card difficulty-${difficulty}`}
                                >
                                  {/* Card header */}
                                  <div className="analytics-q-header">
                                    <span className="analytics-q-num">Q{idx + 1}</span>
                                    <span className={`analytics-difficulty-tag tag-${difficulty}`}>
                                      {difficulty}
                                    </span>
                                    <span className="analytics-section-tag">{q.section}</span>
                                    <span className="analytics-attempts">
                                      {q.totalAttempts} attempt{q.totalAttempts !== 1 ? 's' : ''}
                                    </span>
                                  </div>

                                  {/* Question prompt (Bright Pure White, bold font-semibold) */}
                                  <p className="analytics-q-text">
                                    {q.questionText}
                                  </p>

                                  {/* High-Contrast Options List */}
                                  {Array.isArray(q.options) && q.options.length > 0 && (
                                    <div className="analytics-options-list">
                                      {q.options.map((opt, oIdx) => {
                                        const isCorrect = oIdx === q.correctAnswerIndex;
                                        const isMostMistaken = oIdx === q.mostCommonWrongIndex && q.wrongCount > 0;
                                        return (
                                          <div
                                            key={oIdx}
                                            className={`analytics-option-item ${isCorrect ? 'opt-correct' : ''} ${isMostMistaken ? 'opt-most-mistaken' : ''}`}
                                          >
                                            <span className="opt-letter">{String.fromCharCode(65 + oIdx)}.</span>
                                            <span className="opt-content">{opt}</span>
                                            {isCorrect && (
                                              <span className="opt-badge opt-badge-correct">✓ Correct Choice</span>
                                            )}
                                            {isMostMistaken && (
                                              <span className="opt-badge opt-badge-mistaken">
                                                ⚠ Most Chosen Wrong ({q.mostCommonWrongCount})
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Correct / Wrong bar */}
                                  <div className="analytics-bar-container">
                                    <div className="analytics-bar-row">
                                      <div
                                        className="analytics-bar-fill correct-fill"
                                        style={{ width: `${q.correctPct}%` }}
                                      />
                                      <div
                                        className="analytics-bar-fill wrong-fill"
                                        style={{ width: `${q.wrongPct}%` }}
                                      />
                                    </div>
                                    <div className="analytics-bar-labels">
                                      <span className="bar-label correct-label">
                                        ✅ {q.correctPct}% correct ({q.correctCount})
                                      </span>
                                      <span className="bar-label wrong-label">
                                        ❌ {q.wrongPct}% wrong ({q.wrongCount})
                                      </span>
                                    </div>
                                  </div>

                                  {/* Most common wrong answer */}
                                  {q.mostCommonWrongText && q.wrongCount > 0 && (
                                    <div className="analytics-wrong-badge">
                                      🔴 Most chosen wrong answer ({q.mostCommonWrongCount} student{q.mostCommonWrongCount !== 1 ? 's' : ''}):&nbsp;
                                      <strong>{q.mostCommonWrongText}</strong>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
