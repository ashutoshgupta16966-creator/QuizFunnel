import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { createRoom, joinRoom } from '../api';
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

export default function RoomRoleModal({ isOpen, onClose, homeFormData = {} }) {
  const navigate = useNavigate();
  const { saveStudent, setRoomSession } = useQuiz();

  const [step, setStep] = useState('select_role'); // 'select_role' | 'admin_create' | 'student_join'

  // Admin form state
  const [adminForm, setAdminForm] = useState({
    adminName: '',
    adminPhone: '',
    roomCode: '',
    roomPassword: '',
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');

  // Student form state
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

  // Sync prefilled data from Home registration form whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('select_role');
      setAdminError('');
      setStudentError('');
      setStudentForm((prev) => ({
        ...prev,
        name: homeFormData.name || prev.name || '',
        mobile: homeFormData.mobile || prev.mobile || '',
        branch: homeFormData.branch || prev.branch || 'CSE',
        password: homeFormData.password || prev.password || '',
      }));
    }
  }, [isOpen, homeFormData]);

  if (!isOpen) return null;

  // ── Auto-generate room code for Admin ──
  const handleAutoGenerateCode = () => {
    const code = generateRandomRoomCode();
    setAdminForm((prev) => ({ ...prev, roomCode: code }));
  };

  // ── Admin Create Room Submit ──
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
      const res = await createRoom({
        adminName: adminForm.adminName.trim(),
        adminPhone: adminForm.adminPhone.trim(),
        roomCode: code,
        roomPassword: pwd,
      });

      // Save admin credentials to sessionStorage for live dashboard authentication
      sessionStorage.setItem(`room_admin_pwd_${code}`, pwd);
      sessionStorage.setItem(`room_admin_name_${code}`, adminForm.adminName.trim());

      onClose();
      navigate(`/room/admin/${code}`);
    } catch (err) {
      setAdminError(err.response?.data?.error || 'Failed to create room. Please try again.');
    } finally {
      setAdminLoading(false);
    }
  };

  // ── Student Join Room Submit ──
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
      <div className="modal-content room-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Close Button */}
        <button
          type="button"
          className="modal-close-btn"
          onClick={onClose}
          aria-label="Close modal"
        >
          ✕
        </button>

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
              {/* Admin Card */}
              <div
                className="role-card admin-role-card"
                onClick={() => {
                  setStep('admin_create');
                  if (!adminForm.roomCode) handleAutoGenerateCode();
                }}
              >
                <div className="role-icon">👑</div>
                <h3 className="role-name">Admin / Host</h3>
                <p className="role-desc">
                  Create a live room, get a shareable code, and monitor student rankings &amp; progress in real time.
                </p>
                <span className="role-action-pill">Create Room →</span>
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
              <button
                type="button"
                className="room-back-btn"
                onClick={() => setStep('select_role')}
              >
                ← Back
              </button>
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

        {/* ── STEP 2B: STUDENT ROOM JOIN ── */}
        {step === 'student_join' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <button
                type="button"
                className="room-back-btn"
                onClick={() => setStep('select_role')}
              >
                ← Back
              </button>
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
      </div>
    </div>
  );
}
