import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { createRoom, joinRoom, rejoinRoom, checkReattemptStatus, getAdminRooms, renameRoom, deleteRoom } from '../api';
import { joinStudentRoomSocket } from '../utils/socket';
import { BRANCHES } from '../config';

/**
 * Generate a random, readable 6-character room code.
 * E.g. "ROOM42", "QUIZ89", "LIVE73"
 */
function generateRandomRoomCode() {
  const prefixes = ['ROOM', 'QUIZ', 'CODE', 'LIVE', 'FUN'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(10 + Math.random() * 90); // 2-digit number
  return `${prefix}${num}`;
}

/**
 * Group rooms by formatted calendar date (e.g. "Sep 6, 2026")
 */
function groupRoomsByDate(rooms) {
  const groups = {};
  for (const r of rooms) {
    const d = new Date(r.createdAt || Date.now());
    const dateKey = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(r);
  }
  return groups;
}

/**
 * Format ISO date string into readable 12-hour time (e.g. "11:30 PM")
 */
function formatRoomTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function RoomRoleModal({ isOpen, onClose, homeFormData = {}, initialStep = 'select_role', initialPhone = '' }) {
  const navigate = useNavigate();
  const { saveStudent, setRoomSession } = useQuiz();

  const [step, setStep] = useState(initialStep || 'select_role');
  // steps: 'select_role' | 'admin_create' | 'admin_rejoin' | 'admin_my_rooms_auth' | 'admin_my_rooms_list' | 'student_join' | 'waiting_approval'

  // ── Pending Approval State ───────────────────────────────────────────────────
  const [pendingData, setPendingData] = useState(null);
  const [approvalDenied, setApprovalDenied] = useState(false);
  const [approvalSuccess, setApprovalSuccess] = useState(false);

  // ── Admin Create form state ──────────────────────────────────────────────────
  const [adminForm, setAdminForm] = useState({
    adminName: '',
    adminPhone: '',
    roomCode: '',
    roomPassword: '',
    quizTitle: '',
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');

  // ── Admin Rejoin form state ──────────────────────────────────────────────────
  const [rejoinForm, setRejoinForm] = useState({
    adminPhone: '',
    roomCode: '',
    roomPassword: '',
  });
  const [rejoinLoading, setRejoinLoading] = useState(false);
  const [rejoinError, setRejoinError] = useState('');

  // ── My Live Rooms state ──────────────────────────────────────────────────────
  const [myRoomsPhone, setMyRoomsPhone] = useState(initialPhone || '');
  const [myRoomsPin, setMyRoomsPin] = useState('');
  const [myRoomsLoading, setMyRoomsLoading] = useState(false);
  const [myRoomsError, setMyRoomsError] = useState('');
  const [myRoomsList, setMyRoomsList] = useState([]);

  // ── History Hub Rename & Delete state ────────────────────────────────────────
  const [editingRoomCode, setEditingRoomCode] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteConfirmRoom, setDeleteConfirmRoom] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Student form state ───────────────────────────────────────────────────────
  const [studentForm, setStudentForm] = useState({
    roomCode: '',
    roomPassword: '',
    name: '',
    mobile: '',
    branch: 'CSE',
    password: '',
  });
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState('');

  // ── Scroll lock while modal is open ─────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen]);

  // ── Reset / Initialize state when modal opens ─────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      const targetStep = initialStep || 'select_role';
      const targetPhone = initialPhone || sessionStorage.getItem('room_admin_phone') || '';
      setStep(targetStep);
      setAdminError('');
      setRejoinError('');
      setStudentError('');
      setMyRoomsError('');
      setMyRoomsLoading(false);
      setPendingData(null);
      setApprovalDenied(false);
      setApprovalSuccess(false);
      setEditingRoomCode(null);
      setDeleteConfirmRoom(null);

      if (targetPhone) {
        setMyRoomsPhone(targetPhone);
        if (targetStep === 'admin_my_rooms_list') {
          setMyRoomsLoading(true);
          const savedPin = sessionStorage.getItem('room_admin_pin') || '';
          getAdminRooms(targetPhone, savedPin)
            .then((res) => {
              setMyRoomsList(res.data?.data?.rooms || []);
            })
            .catch(() => {
              setMyRoomsList([]);
            })
            .finally(() => {
              setMyRoomsLoading(false);
            });
        }
      } else if (targetStep !== 'admin_my_rooms_list') {
        setMyRoomsList([]);
      }

      setStudentForm((prev) => ({
        ...prev,
        name: homeFormData.name || prev.name || '',
        mobile: homeFormData.mobile || prev.mobile || '',
        branch: homeFormData.branch || prev.branch || 'CSE',
        password: homeFormData.password || prev.password || '',
      }));
    }
  }, [isOpen, initialStep, initialPhone, homeFormData]);

  // ── Listen for Host Re-Attempt Approval / Denial ──────────────────────────────
  useEffect(() => {
    if (step !== 'waiting_approval' || !pendingData?.roomCode || !pendingData?.mobile) return;

    let isSubscribed = true;

    const handleApproved = (data) => {
      if (!isSubscribed) return;
      setApprovalSuccess(true);
      const studentObj = data?.student || {
        name: pendingData.name,
        mobile: pendingData.mobile,
        branch: pendingData.branch,
        status: 'in-progress',
        currentLevel: 1,
      };
      const roomObj = data?.room || {
        roomCode: pendingData.roomCode,
      };

      saveStudent(studentObj);
      setRoomSession({
        isRoomQuiz: true,
        roomCode: roomObj.roomCode,
        adminName: roomObj.adminName || '',
      });

      setTimeout(() => {
        if (isSubscribed) {
          onClose();
          navigate('/quiz/1');
        }
      }, 1200);
    };

    const handleDenied = () => {
      if (!isSubscribed) return;
      setApprovalDenied(true);
    };

    // 1. Socket listener
    const cleanupSocket = joinStudentRoomSocket(
      pendingData.roomCode,
      { mobile: pendingData.mobile },
      {
        onReattemptApproved: handleApproved,
        onReattemptDenied: handleDenied,
      }
    );

    // 2. Polling fallback every 2.5 seconds
    const pollInterval = setInterval(async () => {
      try {
        const res = await checkReattemptStatus(pendingData.roomCode, pendingData.mobile);
        const status = res.data?.data?.status;
        if (status === 'approved') {
          handleApproved(res.data.data);
        } else if (status === 'denied') {
          handleDenied();
        }
      } catch (err) {
        console.warn('Re-attempt status check polling error:', err.message);
      }
    }, 2500);

    return () => {
      isSubscribed = false;
      cleanupSocket();
      clearInterval(pollInterval);
    };
  }, [step, pendingData, onClose, navigate, saveStudent, setRoomSession]);

  if (!isOpen) return null;

  // ── Auto-generate room code for Admin ───────────────────────────────────────
  const handleAutoGenerateCode = () => {
    const code = generateRandomRoomCode();
    setAdminForm((prev) => ({ ...prev, roomCode: code }));
  };

  // ── Admin Create Room Submit ─────────────────────────────────────────────────
  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setAdminError('');

    if (!adminForm.adminName.trim()) {
      setAdminError('Please enter your Admin Name.');
      return;
    }
    if (!adminForm.adminPhone.trim() || !/^\d{10}$/.test(adminForm.adminPhone.trim())) {
      setAdminError('Please enter a valid 10-digit Phone Number.');
      return;
    }
    if (!adminForm.roomCode.trim()) {
      setAdminError('Please enter or auto-generate a Room Code.');
      return;
    }
    if (!adminForm.roomPassword.trim()) {
      setAdminError('Please set a secret Room Password.');
      return;
    }

    setAdminLoading(true);
    try {
      const code = adminForm.roomCode.trim().toUpperCase();
      const pwd = adminForm.roomPassword.trim();
      await createRoom({
        adminName: adminForm.adminName.trim(),
        adminPhone: adminForm.adminPhone.trim(),
        roomCode: code,
        roomPassword: pwd,
        quizTitle: adminForm.quizTitle.trim(),
      });

      // Save admin credentials to sessionStorage for live dashboard authentication
      sessionStorage.setItem(`room_admin_pwd_${code}`, pwd);
      sessionStorage.setItem(`room_admin_name_${code}`, adminForm.adminName.trim());
      sessionStorage.setItem('room_admin_phone', adminForm.adminPhone.trim());
      sessionStorage.setItem('room_admin_pin', pwd);

      onClose();
      navigate(`/room/admin/${code}`);
    } catch (err) {
      setAdminError(err.response?.data?.error || 'Failed to create room. Please try again.');
    } finally {
      setAdminLoading(false);
    }
  };

  // ── Admin Re-join Room Submit ────────────────────────────────────────────────
  const handleRejoinSubmit = async (e) => {
    e.preventDefault();
    setRejoinError('');

    if (!rejoinForm.adminPhone.trim() || !/^\d{10}$/.test(rejoinForm.adminPhone.trim())) {
      setRejoinError('Please enter a valid 10-digit Phone Number.');
      return;
    }
    if (!rejoinForm.roomCode.trim()) {
      setRejoinError('Please enter the Room Code.');
      return;
    }
    if (!rejoinForm.roomPassword.trim()) {
      setRejoinError('Please enter the Room Password.');
      return;
    }

    setRejoinLoading(true);
    try {
      const code = rejoinForm.roomCode.trim().toUpperCase();
      const pwd = rejoinForm.roomPassword.trim();

      const res = await rejoinRoom({
        adminPhone: rejoinForm.adminPhone.trim(),
        roomCode: code,
        roomPassword: pwd,
      });

      const { adminName } = res.data.data;

      // Persist credentials so dashboard can authenticate
      sessionStorage.setItem(`room_admin_pwd_${code}`, pwd);
      sessionStorage.setItem(`room_admin_name_${code}`, adminName);
      sessionStorage.setItem('room_admin_phone', rejoinForm.adminPhone.trim());
      sessionStorage.setItem('room_admin_pin', pwd);

      onClose();
      navigate(`/room/admin/${code}`);
    } catch (err) {
      setRejoinError(err.response?.data?.error || 'Could not reconnect. Please check your details.');
    } finally {
      setRejoinLoading(false);
    }
  };

  // ── My Live Rooms (History Hub) Handlers ─────────────────────────────────────
  const handleMyRoomsSubmit = async (e) => {
    e.preventDefault();
    setMyRoomsError('');

    const cleanPhone = myRoomsPhone.trim().replace(/\D/g, '').slice(-10);
    if (!cleanPhone || !/^\d{10}$/.test(cleanPhone)) {
      setMyRoomsError('Please enter a valid 10-digit registered phone number.');
      return;
    }
    if (!myRoomsPin.trim()) {
      setMyRoomsError('Please enter your secret Host PIN / Password.');
      return;
    }

    setMyRoomsLoading(true);
    try {
      const res = await getAdminRooms(cleanPhone, myRoomsPin.trim());
      const rooms = res.data?.data?.rooms || [];
      setMyRoomsList(rooms);
      sessionStorage.setItem('room_admin_phone', cleanPhone);
      sessionStorage.setItem('room_admin_pin', myRoomsPin.trim());
      setStep('admin_my_rooms_list');
    } catch (err) {
      setMyRoomsError(err.response?.data?.error || 'Failed to load rooms. Please check your phone number and PIN.');
    } finally {
      setMyRoomsLoading(false);
    }
  };

  const handleOpenPastRoom = (r) => {
    const code = r.roomCode?.toUpperCase();
    const pwd = r.roomPassword || myRoomsPin.trim() || sessionStorage.getItem('room_admin_pin') || '';
    if (pwd) {
      sessionStorage.setItem(`room_admin_pwd_${code}`, pwd);
      sessionStorage.setItem('room_admin_pin', pwd);
    }
    sessionStorage.setItem(`room_admin_name_${code}`, r.adminName || '');
    sessionStorage.setItem('room_admin_phone', r.adminPhone || myRoomsPhone || '');
    onClose();
    navigate(`/room/admin/${code}`);
  };

  // ── History Hub Inline Rename & Delete Handlers ──────────────────────────────
  const handleStartRename = (e, r) => {
    e.stopPropagation();
    setEditingRoomCode(r.roomCode);
    setEditingTitle(r.quizTitle || '');
  };

  const handleCancelRename = (e) => {
    if (e) e.stopPropagation();
    setEditingRoomCode(null);
    setEditingTitle('');
  };

  const handleSaveRename = async (e, r) => {
    if (e) e.stopPropagation();
    if (!editingTitle.trim()) return;

    setRenameLoading(true);
    try {
      const activePhone = myRoomsPhone || sessionStorage.getItem('room_admin_phone') || '';
      const activePin = r.roomPassword || myRoomsPin || sessionStorage.getItem('room_admin_pin') || sessionStorage.getItem(`room_admin_pwd_${r.roomCode}`) || '';
      await renameRoom(r.roomCode, {
        quizTitle: editingTitle.trim(),
        adminPhone: activePhone,
        password: activePin,
      });

      setMyRoomsList((prev) =>
        prev.map((item) => (item.roomCode === r.roomCode ? { ...item, quizTitle: editingTitle.trim() } : item))
      );
      setEditingRoomCode(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename session.');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDeleteClick = (e, r) => {
    e.stopPropagation();
    setDeleteConfirmRoom(r);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmRoom) return;
    setDeleteLoading(true);
    try {
      const activePhone = myRoomsPhone || sessionStorage.getItem('room_admin_phone') || '';
      const activePin = deleteConfirmRoom.roomPassword || myRoomsPin || sessionStorage.getItem('room_admin_pin') || sessionStorage.getItem(`room_admin_pwd_${deleteConfirmRoom.roomCode}`) || '';
      await deleteRoom(deleteConfirmRoom.roomCode, {
        adminPhone: activePhone,
        password: activePin,
      });

      setMyRoomsList((prev) => prev.filter((item) => item.roomCode !== deleteConfirmRoom.roomCode));
      setDeleteConfirmRoom(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete room session.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Student Join Room Submit ─────────────────────────────────────────────────
  const handleStudentSubmit = async (e) => {
    e.preventDefault();
    setStudentError('');

    if (!studentForm.roomCode.trim()) {
      setStudentError('Please enter the Room Code.');
      return;
    }
    if (!studentForm.roomPassword.trim()) {
      setStudentError('Please enter the Room Password.');
      return;
    }
    if (!studentForm.name.trim()) {
      setStudentError('Please enter your Full Name.');
      return;
    }
    if (!studentForm.mobile.trim() || !/^\d{10}$/.test(studentForm.mobile.trim())) {
      setStudentError('Please enter a valid 10-digit Mobile Number.');
      return;
    }
    if (!studentForm.branch.trim()) {
      setStudentError('Please select your Branch.');
      return;
    }
    if (!studentForm.password.trim() || studentForm.password.trim().length < 4) {
      setStudentError('Please create a 4-digit Password or PIN for your account.');
      return;
    }

    setStudentLoading(true);
    try {
      const code = studentForm.roomCode.trim().toUpperCase();
      const res = await joinRoom({
        roomCode: code,
        roomPassword: studentForm.roomPassword.trim(),
        name: studentForm.name.trim(),
        mobile: studentForm.mobile.trim(),
        branch: studentForm.branch.trim(),
        password: studentForm.password.trim(),
      });

      // ── Strict Host-Approved Re-Attempt Queue ────────────────────────────
      if (res.data?.status === 'PENDING_HOST_APPROVAL' || res.data?.pendingApproval) {
        setPendingData({
          roomCode: code,
          mobile: studentForm.mobile.trim(),
          name: studentForm.name.trim(),
          branch: studentForm.branch.trim(),
          password: studentForm.password.trim(),
        });
        setApprovalDenied(false);
        setApprovalSuccess(false);
        setStep('waiting_approval');
        return;
      }

      const { student, room } = res.data.data;

      // 1. Save student in context & localStorage
      saveStudent(student);

      // 2. Set room session in context & localStorage
      setRoomSession({
        isRoomQuiz: true,
        roomCode: room.roomCode,
        adminName: room.adminName,
      });

      // 3. Connect student to room socket
      joinStudentRoomSocket(room.roomCode, student);

      onClose();
      // Start Room Quiz from Level 1
      navigate('/quiz/1');
    } catch (err) {
      setStudentError(err.response?.data?.error || 'Failed to join room. Please check your credentials.');
    } finally {
      setStudentLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content room-modal-card max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Navigation Row (Back to Rooms & Close ✕) */}
        <div className="room-modal-nav-row">
          {step !== 'select_role' ? (
            <button
              type="button"
              className="room-back-btn"
              onClick={() => {
                if (step === 'admin_my_rooms_list') {
                  setStep('admin_my_rooms_auth');
                } else {
                  setStep('select_role');
                }
              }}
            >
              {step === 'admin_my_rooms_list' ? '← Back to Search' : '← Back to Rooms'}
            </button>
          ) : (
            <div className="nav-placeholder" />
          )}
          <button
            type="button"
            className="room-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            title="Close modal"
          >
            ✕
          </button>
        </div>

        {/* ── STEP 1: SELECT YOUR ROLE ── */}
        {step === 'select_role' && (
          <div className="role-selection-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🏫</span>
              <h2 className="room-modal-title">Live Quiz Rooms</h2>
              <p className="room-modal-subtitle">
                Select your role to create or join a real-time room session
              </p>
            </div>

            <div className="role-cards-container">
              {/* Admin Card – three-button layout */}
              <div className="role-card admin-role-card">
                <div className="role-icon">👑</div>
                <h3 className="role-name">Admin / Host</h3>
                <p className="role-desc">
                  Create a live room, get a shareable code, or access historical analytics &amp; reports.
                </p>
                <div className="role-admin-actions">
                  <button
                    type="button"
                    className="role-action-pill role-action-primary"
                    onClick={() => {
                      setStep('admin_create');
                      if (!adminForm.roomCode) handleAutoGenerateCode();
                    }}
                  >
                    Create Room →
                  </button>
                  <button
                    type="button"
                    className="role-action-pill role-action-secondary"
                    onClick={() => setStep('admin_rejoin')}
                  >
                    Join Previous Room ↩
                  </button>
                  <button
                    type="button"
                    className="role-action-pill role-action-history"
                    onClick={() => setStep('admin_my_rooms_auth')}
                  >
                    My Live Rooms 📜
                  </button>
                </div>
              </div>

              {/* Student Card */}
              <div
                className="role-card student-role-card"
                onClick={() => setStep('student_join')}
              >
                <div className="role-icon">🎓</div>
                <h3 className="role-name">Student Participant</h3>
                <p className="role-desc">
                  Enter the room code and password provided by your host to join and compete with up to 60 classmates.
                </p>
                <span className="role-action-pill">Join Room →</span>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2A: ADMIN ROOM CREATION ── */}
        {step === 'admin_create' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">👑</span>
              <h2 className="room-modal-title">Create Live Room</h2>
              <p className="room-modal-subtitle">
                Set room details (Max capacity: <strong>60 Students</strong>)
              </p>
            </div>

            {adminError && <div className="server-error" role="alert">⚠️ {adminError}</div>}

            <form onSubmit={handleAdminSubmit} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">Host / Admin Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Prof. R. K. Sharma"
                  value={adminForm.adminName}
                  onChange={(e) => setAdminForm({ ...adminForm, adminName: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Quiz / Room Title <span className="label-optional">(Optional)</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Web Dev Weekly Quiz, Midterm Round"
                  value={adminForm.quizTitle}
                  onChange={(e) => setAdminForm({ ...adminForm, quizTitle: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Admin Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  value={adminForm.adminPhone}
                  onChange={(e) => setAdminForm({ ...adminForm, adminPhone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <div className="label-with-action">
                  <label className="form-label">Room Code</label>
                  <button
                    type="button"
                    className="auto-code-btn"
                    onClick={handleAutoGenerateCode}
                  >
                    ⚡ Auto-Generate
                  </button>
                </div>
                <input
                  type="text"
                  className="form-input code-input"
                  placeholder="e.g. ROOM42"
                  maxLength={12}
                  value={adminForm.roomCode}
                  onChange={(e) => setAdminForm({ ...adminForm, roomCode: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Set Room Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Secret password for students to join"
                  value={adminForm.roomPassword}
                  onChange={(e) => setAdminForm({ ...adminForm, roomPassword: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary room-submit-btn"
                disabled={adminLoading}
              >
                {adminLoading ? (
                  <><span className="btn-spinner" />Creating Room…</>
                ) : (
                  'Launch Live Room Dashboard →'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 2C: ADMIN RE-JOIN ── */}
        {step === 'admin_rejoin' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">↩️</span>
              <h2 className="room-modal-title">Re-join Your Room</h2>
              <p className="room-modal-subtitle">
                Enter your credentials to reconnect and view live / final stats
              </p>
            </div>

            {rejoinError && <div className="server-error" role="alert">⚠️ {rejoinError}</div>}

            <form onSubmit={handleRejoinSubmit} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">Admin Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit number used when creating the room"
                  maxLength={10}
                  value={rejoinForm.adminPhone}
                  onChange={(e) => setRejoinForm({ ...rejoinForm, adminPhone: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Room Code</label>
                <input
                  type="text"
                  className="form-input code-input"
                  placeholder="e.g. ROOM42"
                  maxLength={12}
                  value={rejoinForm.roomCode}
                  onChange={(e) => setRejoinForm({ ...rejoinForm, roomCode: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Room Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Secret password set when creating the room"
                  value={rejoinForm.roomPassword}
                  onChange={(e) => setRejoinForm({ ...rejoinForm, roomPassword: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary room-submit-btn"
                disabled={rejoinLoading}
              >
                {rejoinLoading ? (
                  <><span className="btn-spinner" />Verifying &amp; Reconnecting…</>
                ) : (
                  'Reconnect to Dashboard →'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 2D: ADMIN MY LIVE ROOMS AUTH ── */}
        {step === 'admin_my_rooms_auth' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">📜</span>
              <h2 className="room-modal-title">My Live Rooms</h2>
              <p className="room-modal-subtitle">
                Enter your Phone Number &amp; PIN to view all your past and active room sessions
              </p>
            </div>

            {myRoomsError && <div className="server-error" role="alert">⚠️ {myRoomsError}</div>}

            <form onSubmit={handleMyRoomsSubmit} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">Admin Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit registered phone number"
                  maxLength={10}
                  value={myRoomsPhone}
                  onChange={(e) => setMyRoomsPhone(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Host PIN / Room Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Your secret host PIN / room password"
                  value={myRoomsPin}
                  onChange={(e) => setMyRoomsPin(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary room-submit-btn"
                disabled={myRoomsLoading}
              >
                {myRoomsLoading ? (
                  <><span className="btn-spinner" />Searching Sessions…</>
                ) : (
                  'Load My Rooms →'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 2E: ADMIN MY LIVE ROOMS HISTORY HUB ── */}
        {step === 'admin_my_rooms_list' && (
          <div className="room-form-view my-rooms-history-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">📜</span>
              <h2 className="room-modal-title">Host History Hub</h2>
              <p className="room-modal-subtitle">
                {myRoomsList.length} session{myRoomsList.length !== 1 ? 's' : ''} found for <strong>{myRoomsPhone}</strong>
              </p>
            </div>

            {myRoomsList.length === 0 ? (
              <div className="history-empty-card">
                <span className="empty-icon">📭</span>
                <h3 className="empty-title">No Recent Rooms Found</h3>
                <p className="empty-subtitle">
                  Create your first room to get started!
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setStep('admin_create');
                    if (!adminForm.roomCode) handleAutoGenerateCode();
                  }}
                >
                  + Create a Room
                </button>
              </div>
            ) : (
              <div className="history-rooms-scroll-list">
                {Object.entries(groupRoomsByDate(myRoomsList)).map(([dateLabel, rooms]) => (
                  <div key={dateLabel} className="history-date-group">
                    <div className="history-date-header">
                      <span>📅 {dateLabel}</span>
                      <span className="date-count">{rooms.length} room{rooms.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="history-cards-column">
                      {rooms.map((r) => {
                        const isEditing = editingRoomCode === r.roomCode;
                        return (
                          <div
                            key={r.roomCode}
                            className={`room-history-card ${r.status === 'active' ? 'status-active' : 'status-closed'}`}
                            onClick={() => !isEditing && handleOpenPastRoom(r)}
                            role="button"
                            tabIndex={0}
                            title={isEditing ? '' : 'Click to view live analytics, leaderboard & CSV report'}
                          >
                            <div className="history-card-top">
                              {isEditing ? (
                                <div className="inline-rename-box" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    className="form-input rename-input"
                                    value={editingTitle}
                                    onChange={(e) => setEditingTitle(e.target.value)}
                                    placeholder="Enter custom session name…"
                                    autoFocus
                                    maxLength={40}
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary save-rename-btn"
                                    onClick={(e) => handleSaveRename(e, r)}
                                    disabled={renameLoading || !editingTitle.trim()}
                                  >
                                    {renameLoading ? '💾…' : '✓ Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary cancel-rename-btn"
                                    onClick={handleCancelRename}
                                    disabled={renameLoading}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className="history-title-row">
                                  <span className="history-quiz-title">
                                    {r.quizTitle || 'Untitled Quiz Session'}
                                  </span>
                                  <button
                                    type="button"
                                    className="history-action-icon-btn rename-icon-btn"
                                    onClick={(e) => handleStartRename(e, r)}
                                    title="Rename this quiz session"
                                  >
                                    ✏️ Rename
                                  </button>
                                </div>
                              )}

                              <div className="history-card-top-right">
                                <span className={`room-status-pill ${r.status}`}>
                                  {r.status === 'active' ? '● ACTIVE' : 'CLOSED'}
                                </span>
                                <button
                                  type="button"
                                  className="history-action-icon-btn delete-icon-btn"
                                  onClick={(e) => handleDeleteClick(e, r)}
                                  title="Delete session & release room code"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            <div className="history-card-meta">
                              <span className="history-code-badge">
                                Room: <strong>{r.roomCode}</strong>
                              </span>
                              <span className="history-time">
                                🕒 {formatRoomTime(r.createdAt)}
                              </span>
                              <span className="history-participants">
                                👥 {r.participantCount || 0} joined
                              </span>
                            </div>

                            <div className="history-card-footer">
                              <span className="open-dashboard-link">
                                Open Live Dashboard &amp; Analytics →
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Session Delete Confirmation Modal ── */}
            {deleteConfirmRoom && (
              <div
                className="modal-backdrop delete-confirm-backdrop"
                onClick={() => !deleteLoading && setDeleteConfirmRoom(null)}
              >
                <div className="modal-content exit-modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="exit-icon" role="img" aria-label="Warning">🗑️</div>
                  <h3 className="exit-title">Delete Quiz Session?</h3>
                  <p className="exit-subtitle">
                    Are you sure you want to permanently delete{' '}
                    <strong>{deleteConfirmRoom.quizTitle || deleteConfirmRoom.roomCode}</strong>?
                    <br />
                    This will delete all participant scores and release code{' '}
                    <strong>{deleteConfirmRoom.roomCode}</strong> for new sessions.
                  </p>
                  <div className="exit-modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setDeleteConfirmRoom(null)}
                      disabled={deleteLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleDeleteConfirm}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? 'Deleting…' : 'Yes, Delete Session'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2B: STUDENT ROOM JOIN ── */}
        {step === 'student_join' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🎓</span>
              <h2 className="room-modal-title">Join Live Quiz Room</h2>
              <p className="room-modal-subtitle">
                Enter Room Code &amp; Password provided by your host
              </p>
            </div>

            {studentError && (
              <div className="server-error" role="alert">
                ⚠️ {studentError}
              </div>
            )}

            <form onSubmit={handleStudentSubmit} className="room-form" noValidate>
              <div className="room-credentials-box">
                <div className="form-group">
                  <label className="form-label">Room Code</label>
                  <input
                    type="text"
                    className="form-input code-input"
                    placeholder="e.g. ROOM42"
                    maxLength={12}
                    value={studentForm.roomCode}
                    onChange={(e) => setStudentForm({ ...studentForm, roomCode: e.target.value.toUpperCase() })}
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Room Password</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Host room password"
                    value={studentForm.roomPassword}
                    onChange={(e) => setStudentForm({ ...studentForm, roomPassword: e.target.value })}
                  />
                </div>
              </div>

              <div className="student-profile-section">
                <p className="section-divider-title">Your Student Profile</p>

                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Ananya Sharma"
                    value={studentForm.name}
                    onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">10-Digit Mobile Number</label>
                  <input
                    type="tel"
                    className="form-input"
                    placeholder="10-digit number"
                    maxLength={10}
                    value={studentForm.mobile}
                    onChange={(e) => setStudentForm({ ...studentForm, mobile: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Branch</label>
                  <select
                    className="form-select"
                    value={studentForm.branch}
                    onChange={(e) => setStudentForm({ ...studentForm, branch: e.target.value })}
                  >
                    {BRANCHES.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Personal Password / PIN</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="4+ character secret password/PIN"
                    maxLength={20}
                    value={studentForm.password}
                    onChange={(e) => setStudentForm({ ...studentForm, password: e.target.value })}
                  />
                  <p className="form-hint">Used to privately view your results in My Results.</p>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary room-submit-btn"
                disabled={studentLoading}
              >
                {studentLoading ? (
                  <><span className="btn-spinner" />Verifying &amp; Joining…</>
                ) : (
                  'Join Room & Start Quiz →'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 3: WAITING FOR HOST APPROVAL ── */}
        {step === 'waiting_approval' && (
          <div className="room-form-view waiting-approval-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">⏳</span>
              <h2 className="room-modal-title">Waiting for Host Approval...</h2>
              <p className="room-modal-subtitle">
                Please ask your Admin to approve your request.
              </p>
            </div>

            <div className="waiting-approval-card">
              <div className="waiting-student-info">
                <span className="info-label">Candidate:</span>
                <strong>{pendingData?.name}</strong> · {pendingData?.branch} ({pendingData?.mobile})
              </div>
              <div className="waiting-room-info">
                <span className="info-label">Room Code:</span>
                <strong className="code-highlight">{pendingData?.roomCode}</strong>
              </div>

              {!approvalDenied && !approvalSuccess && (
                <div className="waiting-status-indicator">
                  <div className="waiting-spinner-pulse" />
                  <p className="waiting-status-text">
                    Pending review on Admin Live Dashboard…
                  </p>
                  <p className="waiting-hint-text">
                    The host must approve your re-attempt on the Live Dashboard before you can enter.
                  </p>
                </div>
              )}

              {approvalSuccess && (
                <div className="approval-success-alert">
                  ✅ <strong>Re-attempt Approved by Host!</strong> Starting Quiz…
                </div>
              )}

              {approvalDenied && (
                <div className="approval-denied-alert">
                  🚫 <strong>Re-attempt denied by Host</strong>
                  <p className="denied-desc">The administrator has declined your request to re-attempt this quiz.</p>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn btn-secondary room-submit-btn"
              onClick={() => {
                setStep('select_role');
                setPendingData(null);
                setApprovalDenied(false);
                setApprovalSuccess(false);
                onClose();
              }}
            >
              {approvalDenied ? 'OK / Return to Home' : 'Cancel Request & Return to Home'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
