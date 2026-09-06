import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomDetails, closeRoom, getRoomAnalytics, approveReattempt, denyReattempt } from '../api';
import { joinAdminRoomSocket, disconnectSocket } from '../utils/socket';
import ThemeToggle from '../components/ThemeToggle';


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

  const adminPassword = sessionStorage.getItem(`room_admin_pwd_${roomCode?.toUpperCase()}`) || '';

  // ── Pending Re-attempt Requests Queue ───────────────────────────────────────
  const [pendingRequests, setPendingRequests] = useState([]);
  const [processingAction, setProcessingAction] = useState('');

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
        setRoom((prev) => (prev ? { ...prev, ...data } : data));
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
            participants: (prev.participants || []).map((p) =>
              p.mobile === update.mobile ? { ...p, ...update } : p
            ),
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
      setPendingRequests((prev) => prev.filter((r) => r.mobile !== mobile));
      fetchDetails();
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

  // ── CSV Export ────────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const allParticipants = room?.participants || [];
    if (allParticipants.length === 0) {
      alert('No participant data to export yet.');
      return;
    }

    // Sort by score desc, time asc (same as table)
    const sorted = [...allParticipants].sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return (a.timeTaken || 0) - (b.timeTaken || 0);
    });

    const statusLabel = (p) => {
      if (p.isDisqualified) return 'Disqualified 🚫';
      if (p.status === 'completed' || p.status === 'advanced') return 'Passed';
      if (p.status === 'eliminated') return 'Failed';
      return 'In Progress';
    };

    const header = ['Rank', 'Student Name', 'Roll Number/Phone', 'Branch', 'Level Reached', 'Total Score', 'Completion Time', 'Status'];
    const rows = sorted.map((p, idx) => [
      idx + 1,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      p.mobile || '',
      p.branch || '',
      p.level || 1,
      p.score ?? 0,
      formatTimeMMSS(p.timeTaken || 0),
      statusLabel(p),
    ]);

    const csvContent = [header, ...rows].map((r) => r.join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `QuizFunnel_Room_${room.roomCode}_Results.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [room]);

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
            onClick={() => navigate('/')}
          >
            ← Home
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
                  onClick={handleExportCSV}
                  title="Download participant results as CSV"
                  disabled={participants.length === 0}
                >
                  📥 Export Results (CSV)
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
                    <th>#</th>
                    <th>Student Name</th>
                    <th>Branch</th>
                    <th>Mobile</th>
                    <th>Current Level</th>
                    <th>Live Score</th>
                    <th>Status</th>
                    <th>Time</th>
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

                      return (
                        <tr key={p.mobile} className={`participant-row ${isDisq ? 'row-disqualified' : ''}`}>
                          <td className="rank-cell">{idx + 1}</td>
                          <td className="name-cell">
                            <div className="name-with-badge">
                              <strong>{p.name}</strong>
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
                          <td className="score-cell">
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
                          <td className="time-cell">{formatTimeMMSS(p.timeTaken || 0)}</td>
                        </tr>
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
