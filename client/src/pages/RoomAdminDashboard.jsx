import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoomDetails, closeRoom } from '../api';
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

  // ── Fetch Initial Room Details ──
  const fetchDetails = useCallback(async () => {
    if (!roomCode) return;
    try {
      setLoading(true);
      setError('');
      const res = await getRoomDetails(roomCode, adminPassword);
      setRoom(res.data.data);
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
      onError: (err) => {
        console.warn('Admin room socket notice:', err.message);
      },
    });

    return () => {
      cleanupSocket();
      disconnectSocket();
    };
  }, [roomCode, adminPassword]);

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
                            <strong>{p.name}</strong>
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
          </>
        )}
      </main>
    </div>
  );
}
