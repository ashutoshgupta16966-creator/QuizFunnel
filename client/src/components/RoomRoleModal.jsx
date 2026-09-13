import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { createRoom, createAiRoom, parseAiQuizDocument, joinRoom, rejoinRoom, checkReattemptStatus, getAdminRooms, renameRoom, deleteRoom, sendAdminOtp, verifyAdminOtp, resetAdminPin, generateMcqOptions } from '../api';
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

  // ── Admin Host Forgot PIN (Demo OTP) state ──────────────────────────────────
  const [adminOtpCode, setAdminOtpCode] = useState('');
  const [adminNewPin, setAdminNewPin] = useState('');
  const [adminOtpNotice, setAdminOtpNotice] = useState('');
  const [adminOtpError, setAdminOtpError] = useState('');
  const [adminOtpLoading, setAdminOtpLoading] = useState(false);
  const [adminResendTimer, setAdminResendTimer] = useState(0);

  useEffect(() => {
    let interval = null;
    if (adminResendTimer > 0) {
      interval = setInterval(() => {
        setAdminResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [adminResendTimer]);

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

  // ── AI Quiz Generator state ──────────────────────────────────────────────────
  const [aiForm, setAiForm] = useState({
    adminName: homeFormData?.name || '',
    adminPhone: homeFormData?.mobile || '',
    quizTitle: '',
    roomCode: '',
    roomPassword: '',
  });
  const [aiFiles, setAiFiles] = useState([]); // [{ file, name, size, type, previewUrl }]
  const [aiParsing, setAiParsing] = useState(false);
  const [aiParseError, setAiParseError] = useState('');
  const [aiResult, setAiResult] = useState({ subject: '', unit: '', questions: [] });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiDetailsError, setAiDetailsError] = useState('');
  const [aiReviewError, setAiReviewError] = useState('');
  const [generatingOptionsIdx, setGeneratingOptionsIdx] = useState(null);
  const [optGenErrors, setOptGenErrors] = useState({});

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
      setAdminOtpCode('');
      setAdminNewPin('');
      setAdminOtpNotice('');
      setAdminOtpError('');
      setAdminOtpLoading(false);
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

  // ── AI Quiz Generator Handlers ─────────────────────────────────────────────
  const handleAutoGenerateAiCode = () => {
    const code = generateRandomRoomCode();
    setAiForm((prev) => ({ ...prev, roomCode: code }));
  };

  const handleAiDetailsSubmit = (e) => {
    e.preventDefault();
    setAiDetailsError('');

    if (!aiForm.adminName.trim()) {
      setAiDetailsError('Please enter your Host / Admin Name.');
      return;
    }
    if (!aiForm.adminPhone.trim() || !/^\d{10}$/.test(aiForm.adminPhone.trim())) {
      setAiDetailsError('Please enter a valid 10-digit Phone Number.');
      return;
    }
    if (!aiForm.roomCode.trim()) {
      setAiDetailsError('Please enter or auto-generate a Room Code.');
      return;
    }
    if (!aiForm.roomPassword.trim()) {
      setAiDetailsError('Please set a secret Room Password.');
      return;
    }

    setStep('admin_ai_upload');
  };

  const handleAiFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    setAiParseError('');

    const existingHasPdf = aiFiles.some((f) => f.type === 'application/pdf');
    const newHasPdf = selected.some((f) => f.type === 'application/pdf');

    if (newHasPdf) {
      if (selected.length > 1 || aiFiles.length > 0) {
        setAiParseError('When uploading a PDF, please upload only a single PDF without additional files.');
        return;
      }
    } else if (existingHasPdf) {
      setAiParseError('A PDF is already uploaded. Remove it first if you want to upload images instead.');
      return;
    }

    const combined = [...aiFiles];
    for (const file of selected) {
      if (file.type === 'application/pdf') {
        combined.push({
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          previewUrl: null,
        });
      } else if (file.type.startsWith('image/')) {
        if (combined.length >= 10) {
          setAiParseError('Maximum 10 images allowed. Extra images were skipped.');
          break;
        }
        combined.push({
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          previewUrl: URL.createObjectURL(file),
        });
      } else {
        setAiParseError(`Unsupported file format: ${file.name}. Only JPG, PNG, WEBP, and PDF are supported.`);
      }
    }

    const totalBytes = combined.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > 15 * 1024 * 1024) {
      setAiParseError(`Total file size (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds the 15 MB limit.`);
      return;
    }

    setAiFiles(combined);
    e.target.value = '';
  };

  const handleRemoveAiFile = (index) => {
    setAiFiles((prev) => {
      const target = prev[index];
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* noop */ }
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleClearAiFiles = () => {
    aiFiles.forEach((f) => {
      if (f.previewUrl) {
        try { URL.revokeObjectURL(f.previewUrl); } catch { /* noop */ }
      }
    });
    setAiFiles([]);
    setAiParseError('');
  };

  const handleAiParseSubmit = async () => {
    if (aiFiles.length === 0) {
      setAiParseError('Please capture a photo or upload an image/PDF first.');
      return;
    }

    const totalBytes = aiFiles.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > 15 * 1024 * 1024) {
      setAiParseError(`Total upload size (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds the 15 MB limit.`);
      return;
    }

    setAiParsing(true);
    setAiParseError('');

    try {
      const formData = new FormData();
      aiFiles.forEach((f) => {
        formData.append('files', f.file);
      });

      const res = await parseAiQuizDocument(formData);
      const { subject, unit, questions } = res.data;

      setAiResult({
        subject: subject || 'General Quiz',
        unit: unit || '',
        questions: Array.isArray(questions) ? questions : [],
      });
      setStep('admin_ai_review');
    } catch (err) {
      console.error('AI Document Parse error:', err);
      setAiParseError(
        err.response?.data?.error || err.message || 'Failed to parse document with Gemini Vision. Please try a clearer photo or file.'
      );
    } finally {
      setAiParsing(false);
    }
  };

  const handleAiQuestionChange = (qIdx, field, value) => {
    setAiResult((prev) => {
      const nextQs = [...prev.questions];
      nextQs[qIdx] = { ...nextQs[qIdx], [field]: value };
      return { ...prev, questions: nextQs };
    });
  };

  const handleAiOptionChange = (qIdx, optIdx, value) => {
    setAiResult((prev) => {
      const nextQs = [...prev.questions];
      const nextOpts = [...nextQs[qIdx].options];
      nextOpts[optIdx] = value;
      nextQs[qIdx] = { ...nextQs[qIdx], options: nextOpts };
      return { ...prev, questions: nextQs };
    });
  };

  const handleAiRemoveQuestion = (qIdx) => {
    if (aiResult.questions.length <= 1) {
      alert('The quiz must contain at least one question.');
      return;
    }
    setAiResult((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== qIdx),
    }));
  };

  const handleAiAddQuestion = () => {
    setAiResult((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          questionText: '',
          questionType: 'mcq',
          optionMode: 'manual',
          options: ['', '', '', ''],
          correctAnswerIndex: 0,
          directAnswer: '',
          level: 1,
          section: 'Technical',
          difficulty: 'medium',
          explanation: '',
        },
      ],
    }));
  };

  const handleGenerateOptions = async (qIdx) => {
    const q = aiResult.questions[qIdx];
    if (!q?.questionText?.trim()) {
      setOptGenErrors((prev) => ({
        ...prev,
        [qIdx]: 'Please enter the question text before auto-generating options.',
      }));
      return;
    }

    setGeneratingOptionsIdx(qIdx);
    setOptGenErrors((prev) => ({ ...prev, [qIdx]: '' }));
    try {
      const res = await generateMcqOptions(q.questionText.trim());
      if (res.data?.success && res.data?.data) {
        const { options, correctIndex } = res.data.data;
        setAiResult((prev) => {
          const nextQs = [...prev.questions];
          nextQs[qIdx] = {
            ...nextQs[qIdx],
            options: Array.isArray(options) && options.length === 4 ? options : nextQs[qIdx].options,
            correctAnswerIndex: typeof correctIndex === 'number' ? correctIndex : 0,
            optionMode: 'auto',
          };
          return { ...prev, questions: nextQs };
        });
      } else {
        setOptGenErrors((prev) => ({
          ...prev,
          [qIdx]: res.data?.error || 'Failed to auto-generate options with AI.',
        }));
      }
    } catch (err) {
      setOptGenErrors((prev) => ({
        ...prev,
        [qIdx]: err.response?.data?.error || err.message || 'AI generation failed. Please use custom manual options.',
      }));
    } finally {
      setGeneratingOptionsIdx(null);
    }
  };

  const handleAiConfirmAndCreate = async () => {
    setAiReviewError('');

    for (let i = 0; i < aiResult.questions.length; i++) {
      const q = aiResult.questions[i];
      if (!q.questionText.trim()) {
        setAiReviewError(`Question #${i + 1} is missing question text.`);
        return;
      }
      if (q.questionType === 'direct') {
        if (!q.directAnswer || !String(q.directAnswer).trim()) {
          setAiReviewError(`Question #${i + 1} is a Direct Fill-in question and requires a Correct Answer.`);
          return;
        }
      } else {
        for (let j = 0; j < 4; j++) {
          if (!q.options || !q.options[j] || !q.options[j].trim()) {
            setAiReviewError(`Question #${i + 1} has an empty Option ${['A', 'B', 'C', 'D'][j]}. All 4 options are required.`);
            return;
          }
        }
      }
    }

    setAiSaving(true);
    try {
      const code = aiForm.roomCode.trim().toUpperCase();
      const pwd = aiForm.roomPassword.trim();

      await createAiRoom({
        adminName: aiForm.adminName.trim(),
        adminPhone: aiForm.adminPhone.trim(),
        roomCode: code,
        roomPassword: pwd,
        quizTitle: aiForm.quizTitle.trim() || (aiResult.subject ? `${aiResult.subject} Quiz` : 'AI Generated Quiz'),
        subject: aiResult.subject.trim(),
        unit: aiResult.unit.trim(),
        questions: aiResult.questions,
      });

      // Save admin credentials to sessionStorage for live dashboard authentication
      sessionStorage.setItem(`room_admin_pwd_${code}`, pwd);
      sessionStorage.setItem(`room_admin_name_${code}`, aiForm.adminName.trim());
      sessionStorage.setItem('room_admin_phone', aiForm.adminPhone.trim());
      sessionStorage.setItem('room_admin_pin', pwd);

      handleClearAiFiles();
      onClose();
      navigate(`/room/admin/${code}`);
    } catch (err) {
      console.error('Create AI Room error:', err);
      setAiReviewError(err.response?.data?.error || 'Failed to create AI Quiz room. Please check the details and try again.');
    } finally {
      setAiSaving(false);
    }
  };

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

  // ── Admin Host Forgot PIN (Demo OTP) Handlers ────────────────────────────────
  const handleStartAdminForgotPin = async (e) => {
    if (e) e.preventDefault();
    setMyRoomsError('');
    const cleanPhone = myRoomsPhone.trim().replace(/\D/g, '').slice(-10);
    if (!cleanPhone || !/^\d{10}$/.test(cleanPhone)) {
      setMyRoomsError('Please enter your 10-digit registered phone number above first.');
      return;
    }

    setAdminOtpLoading(true);
    setAdminOtpError('');
    setAdminOtpNotice('');
    try {
      const res = await sendAdminOtp({ adminPhone: cleanPhone });
      const demoOtpMsg = res.data.demoOtp ? ` [Demo OTP: ${res.data.demoOtp}]` : '';
      setAdminOtpNotice(`4-digit OTP sent to +91 ${cleanPhone}.${demoOtpMsg}`);
      setAdminResendTimer(30);
      setAdminOtpCode('');
      setAdminNewPin('');
      setStep('admin_my_rooms_forgot_otp');
    } catch (err) {
      setMyRoomsError(err.response?.data?.error || 'Failed to send OTP. Check phone number.');
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleResendAdminOtp = async () => {
    if (adminResendTimer > 0) return;
    const cleanPhone = myRoomsPhone.trim().replace(/\D/g, '').slice(-10);
    setAdminOtpLoading(true);
    setAdminOtpError('');
    try {
      const res = await sendAdminOtp({ adminPhone: cleanPhone });
      const demoOtpMsg = res.data.demoOtp ? ` [Demo OTP: ${res.data.demoOtp}]` : '';
      setAdminOtpNotice(`New 4-digit OTP sent to +91 ${cleanPhone}.${demoOtpMsg}`);
      setAdminResendTimer(30);
    } catch (err) {
      setAdminOtpError(err.response?.data?.error || 'Failed to resend OTP.');
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleVerifyAdminOtp = async (e) => {
    if (e) e.preventDefault();
    if (!/^\d{4}$/.test(adminOtpCode.trim())) {
      setAdminOtpError('Please enter the 4-digit OTP code sent to your phone.');
      return;
    }

    const cleanPhone = myRoomsPhone.trim().replace(/\D/g, '').slice(-10);
    setAdminOtpLoading(true);
    setAdminOtpError('');
    try {
      await verifyAdminOtp({
        adminPhone: cleanPhone,
        otp: adminOtpCode.trim(),
      });
      setStep('admin_my_rooms_forgot_new_pin');
    } catch (err) {
      setAdminOtpError(err.response?.data?.error || 'Invalid OTP code. Please try again.');
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleResetAdminPin = async (e) => {
    if (e) e.preventDefault();
    const pin = adminNewPin.trim();
    if (!pin || pin.length < 4) {
      setAdminOtpError('New PIN / Password must be at least 4 characters or digits.');
      return;
    }

    const cleanPhone = myRoomsPhone.trim().replace(/\D/g, '').slice(-10);
    setAdminOtpLoading(true);
    setAdminOtpError('');
    try {
      await resetAdminPin({
        adminPhone: cleanPhone,
        otp: adminOtpCode.trim(),
        newPIN: pin,
      });

      // Auto-authenticate with the new PIN and fetch rooms directly
      setMyRoomsPin(pin);
      sessionStorage.setItem('room_admin_phone', cleanPhone);
      sessionStorage.setItem('room_admin_pin', pin);

      const res = await getAdminRooms(cleanPhone, pin);
      setMyRoomsList(res.data?.data?.rooms || []);
      setStep('admin_my_rooms_list');
    } catch (err) {
      setAdminOtpError(err.response?.data?.error || 'Failed to reset PIN. Please try again.');
    } finally {
      setAdminOtpLoading(false);
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
                  <button
                    type="button"
                    className="role-action-pill role-action-ai"
                    onClick={() => {
                      setStep('admin_ai_details');
                      if (!aiForm.roomCode) handleAutoGenerateAiCode();
                    }}
                    title="Generate an instant quiz from question paper photo or PDF using Gemini Vision"
                  >
                    AI Quiz Generator 🤖✨
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

        {/* ── STEP: AI QUIZ GENERATOR DETAILS ── */}
        {step === 'admin_ai_details' && (
          <div className="room-form-view ai-details-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🤖</span>
              <h2 className="room-modal-title">AI Quiz Generator</h2>
              <p className="room-modal-subtitle">
                Step 1 of 3: Set up quiz session &amp; room access details
              </p>
            </div>

            {aiDetailsError && <div className="server-error" role="alert">⚠️ {aiDetailsError}</div>}

            <form onSubmit={handleAiDetailsSubmit} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">Host / Admin Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Prof. R. K. Sharma"
                  value={aiForm.adminName}
                  onChange={(e) => setAiForm({ ...aiForm, adminName: e.target.value })}
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
                  placeholder="e.g. Unit 3 Midterm Test, Python Assessment"
                  value={aiForm.quizTitle}
                  onChange={(e) => setAiForm({ ...aiForm, quizTitle: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Admin Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  value={aiForm.adminPhone}
                  onChange={(e) => setAiForm({ ...aiForm, adminPhone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <div className="label-with-action">
                  <label className="form-label">Room Code</label>
                  <button
                    type="button"
                    className="auto-code-btn"
                    onClick={handleAutoGenerateAiCode}
                  >
                    ⚡ Auto-Generate
                  </button>
                </div>
                <input
                  type="text"
                  className="form-input code-input"
                  placeholder="e.g. QUIZ88"
                  maxLength={12}
                  value={aiForm.roomCode}
                  onChange={(e) => setAiForm({ ...aiForm, roomCode: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Set Room Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Secret password for students to join"
                  value={aiForm.roomPassword}
                  onChange={(e) => setAiForm({ ...aiForm, roomPassword: e.target.value })}
                />
              </div>

              <div className="ai-actions-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep('select_role')}
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Next: Upload Question Paper →
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── STEP: AI QUIZ UPLOAD SCREEN ── */}
        {step === 'admin_ai_upload' && (
          <div className="room-form-view ai-upload-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">📸</span>
              <h2 className="room-modal-title">Upload Question Paper</h2>
              <p className="room-modal-subtitle">
                Snap photos with your camera or select files (up to 10 images or 1 PDF • max 15MB)
              </p>
            </div>

            {aiParseError && <div className="server-error" role="alert">⚠️ {aiParseError}</div>}

            {/* Input method buttons */}
            <div className="ai-input-methods">
              {/* Native Camera Button */}
              <label className="ai-method-btn ai-method-camera">
                <span className="method-icon">📷</span>
                <span className="method-title">Snap with Camera</span>
                <span className="method-desc">Directly take photos of printed questions</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleAiFileSelect}
                  style={{ display: 'none' }}
                  disabled={aiParsing}
                />
              </label>

              {/* File Picker Button */}
              <label className="ai-method-btn ai-method-upload">
                <span className="method-icon">📁</span>
                <span className="method-title">Upload Image / PDF</span>
                <span className="method-desc">Select from gallery, photos, or documents</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={handleAiFileSelect}
                  style={{ display: 'none' }}
                  disabled={aiParsing}
                />
              </label>
            </div>

            {/* Selected Files List & Summary */}
            {aiFiles.length > 0 && (
              <div className="ai-files-container">
                <div className="ai-files-header">
                  <span className="ai-files-count">
                    📑 <strong>{aiFiles.length}</strong> file{aiFiles.length !== 1 ? 's' : ''} selected
                    {' '}({(aiFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB / 15 MB)
                  </span>
                  <button
                    type="button"
                    className="ai-clear-btn"
                    onClick={handleClearAiFiles}
                    disabled={aiParsing}
                  >
                    Clear All
                  </button>
                </div>

                <div className="ai-files-grid">
                  {aiFiles.map((item, idx) => (
                    <div key={idx} className="ai-file-card">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt={item.name} className="ai-file-thumb" />
                      ) : (
                        <div className="ai-file-pdf-badge">📄 PDF</div>
                      )}
                      <div className="ai-file-info">
                        <span className="ai-file-name" title={item.name}>{item.name}</span>
                        <span className="ai-file-size">{(item.size / 1024).toFixed(0)} KB</span>
                      </div>
                      <button
                        type="button"
                        className="ai-remove-file-btn"
                        onClick={() => handleRemoveAiFile(idx)}
                        disabled={aiParsing}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Submit or loading state */}
            {aiParsing ? (
              <div className="ai-parsing-state">
                <div className="ai-spinner-glow" />
                <h4 className="ai-parsing-title">Gemini Vision is Processing…</h4>
                <p className="ai-parsing-desc">
                  Analyzing question paper text, options, and diagrams. This usually takes 5–15 seconds.
                </p>
              </div>
            ) : (
              <div className="ai-actions-row" style={{ marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep('admin_ai_details')}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary ai-parse-submit-btn"
                  onClick={handleAiParseSubmit}
                  disabled={aiFiles.length === 0}
                >
                  ✨ Extract Questions with Gemini
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP: AI QUIZ REVIEW & EDIT SCREEN ── */}
        {step === 'admin_ai_review' && (
          <div className="room-form-view ai-review-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">✏️</span>
              <h2 className="room-modal-title">Review &amp; Edit Questions</h2>
              <p className="room-modal-subtitle">
                Verify extracted content before launching your live quiz room.
              </p>
            </div>

            {aiReviewError && <div className="server-error" role="alert">⚠️ {aiReviewError}</div>}

            {/* Metadata Fields: Subject & Unit */}
            <div className="ai-meta-editor-card">
              <div className="ai-meta-field">
                <label className="form-label">Subject / Course Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Data Structures & Algorithms"
                  value={aiResult.subject}
                  onChange={(e) => setAiResult({ ...aiResult, subject: e.target.value })}
                />
              </div>
              <div className="ai-meta-field">
                <label className="form-label">Unit / Chapter / Topic</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Unit 2: Stack & Queue"
                  value={aiResult.unit}
                  onChange={(e) => setAiResult({ ...aiResult, unit: e.target.value })}
                />
              </div>
            </div>

            {/* Questions List Header */}
            <div className="ai-questions-toolbar">
              <span className="ai-questions-count">
                📝 <strong>{aiResult.questions.length}</strong> Question{aiResult.questions.length !== 1 ? 's' : ''}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={handleAiAddQuestion}
              >
                + Add Question
              </button>
            </div>

            {/* Questions Scrollable Editor */}
            <div className="ai-questions-editor-list">
              {aiResult.questions.map((q, qIdx) => (
                <div key={qIdx} className="ai-question-edit-card">
                  <div className="ai-q-header">
                    <div className="ai-q-title-group">
                      <span className="ai-q-badge">Q{qIdx + 1}</span>
                      <div className="ai-q-selects">
                        <select
                          className="ai-select-mini"
                          value={q.level || 1}
                          onChange={(e) => handleAiQuestionChange(qIdx, 'level', parseInt(e.target.value, 10))}
                          title="Level (1–4)"
                        >
                          <option value={1}>Level 1 (Foundation)</option>
                          <option value={2}>Level 2 (Intermediate)</option>
                          <option value={3}>Level 3 (Advanced)</option>
                          <option value={4}>Level 4 (Final Round)</option>
                        </select>

                        <select
                          className="ai-select-mini"
                          value={q.section || 'Technical'}
                          onChange={(e) => handleAiQuestionChange(qIdx, 'section', e.target.value)}
                          title="Section"
                        >
                          <option value="Technical">Technical</option>
                          <option value="GK">GK</option>
                          <option value="Reasoning">Reasoning</option>
                          <option value="Aptitude">Aptitude</option>
                          <option value="Mixed">Mixed</option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="ai-q-delete-btn"
                      onClick={() => handleAiRemoveQuestion(qIdx)}
                      title="Delete this question"
                    >
                      🗑️
                    </button>
                  </div>

                  {/* Question Format Toggle */}
                  <div className="ai-format-toggle-bar">
                    <span className="ai-format-label">Question Format:</span>
                    <div className="ai-format-pill-group">
                      <button
                        type="button"
                        className={`ai-format-pill ${q.questionType !== 'direct' ? 'is-active' : ''}`}
                        onClick={() => {
                          handleAiQuestionChange(qIdx, 'questionType', 'mcq');
                          if (!q.options || q.options.length < 4) {
                            handleAiQuestionChange(qIdx, 'options', ['', '', '', '']);
                          }
                        }}
                      >
                        🔘 Multiple Choice (MCQ)
                      </button>
                      <button
                        type="button"
                        className={`ai-format-pill ${q.questionType === 'direct' ? 'is-active' : ''}`}
                        onClick={() => {
                          handleAiQuestionChange(qIdx, 'questionType', 'direct');
                          if (!q.directAnswer && q.options && q.options[q.correctAnswerIndex]) {
                            handleAiQuestionChange(qIdx, 'directAnswer', q.options[q.correctAnswerIndex]);
                          }
                        }}
                      >
                        ✏️ Direct Fill-in Answer
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Question Text</label>
                    <textarea
                      className="form-input ai-q-textarea"
                      rows={2}
                      value={q.questionText}
                      onChange={(e) => handleAiQuestionChange(qIdx, 'questionText', e.target.value)}
                      placeholder="Enter question text..."
                    />
                  </div>

                  {q.questionType === 'direct' ? (
                    <div className="ai-direct-answer-row">
                      <label className="form-label" style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                        Correct Answer (Direct Text / Numerical):
                      </label>
                      <input
                        type="text"
                        className="form-input ai-direct-ans-input"
                        value={q.directAnswer || ''}
                        onChange={(e) => handleAiQuestionChange(qIdx, 'directAnswer', e.target.value)}
                        placeholder="e.g. 42, O(log n), Mitochondria, True, etc."
                      />
                      <p className="ai-direct-hint">
                        💡 Students will see a direct text box. Scoring uses trimmed, case-insensitive evaluation.
                      </p>
                    </div>
                  ) : (
                    <div className="ai-options-editor">
                      {/* MCQ Sub-toggle: [ 🪄 AI Auto-Generate Options | ✏️ Custom Manual Options ] */}
                      <div className="ai-optmode-toggle-bar">
                        <span className="ai-optmode-label">Options Setup:</span>
                        <div className="ai-optmode-pill-group">
                          <button
                            type="button"
                            className={`ai-optmode-pill ${(q.optionMode || 'manual') === 'auto' ? 'is-active' : ''}`}
                            onClick={() => {
                              handleAiQuestionChange(qIdx, 'optionMode', 'auto');
                              const isEmpty = !q.options || q.options.every((opt) => !opt || !opt.trim());
                              if (isEmpty && q.questionText?.trim()) {
                                handleGenerateOptions(qIdx);
                              }
                            }}
                          >
                            🪄 AI Auto-Generate Options
                          </button>
                          <button
                            type="button"
                            className={`ai-optmode-pill ${(q.optionMode || 'manual') === 'manual' ? 'is-active' : ''}`}
                            onClick={() => handleAiQuestionChange(qIdx, 'optionMode', 'manual')}
                          >
                            ✏️ Custom Manual Options
                          </button>
                        </div>
                      </div>

                      {(q.optionMode || 'manual') === 'auto' ? (
                        <div className="ai-auto-options-container">
                          <div className="ai-auto-options-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-primary ai-gen-action-btn"
                              onClick={() => handleGenerateOptions(qIdx)}
                              disabled={generatingOptionsIdx === qIdx}
                            >
                              {generatingOptionsIdx === qIdx ? (
                                <><span className="btn-spinner" />Generating 4 Options via Gemini…</>
                              ) : (
                                '🪄 Generate / Re-generate Options with AI'
                              )}
                            </button>
                            <span className="ai-auto-action-hint">
                              Uses Gemini to craft 4 plausible options with 1 designated correct answer.
                            </span>
                          </div>

                          {optGenErrors[qIdx] && (
                            <div className="server-error" style={{ margin: '0.5rem 0', fontSize: '0.78rem' }}>
                              ⚠️ {optGenErrors[qIdx]}
                            </div>
                          )}

                          <span className="ai-options-label" style={{ marginTop: '0.6rem' }}>
                            Options Preview (Designated Correct Answer selected):
                          </span>
                          {(q.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className={`ai-option-input-row ${q.correctAnswerIndex === optIdx ? 'is-correct-row' : ''}`}>
                              <label className="ai-correct-radio-label" title={`Mark Option ${['A', 'B', 'C', 'D'][optIdx]} as correct`}>
                                <input
                                  type="radio"
                                  name={`correct_auto_${qIdx}`}
                                  checked={q.correctAnswerIndex === optIdx}
                                  onChange={() => handleAiQuestionChange(qIdx, 'correctAnswerIndex', optIdx)}
                                />
                                <span className="ai-opt-letter">{['A', 'B', 'C', 'D'][optIdx]}</span>
                              </label>
                              <input
                                type="text"
                                className="form-input ai-opt-input"
                                value={opt}
                                onChange={(e) => handleAiOptionChange(qIdx, optIdx, e.target.value)}
                                placeholder={`Option ${['A', 'B', 'C', 'D'][optIdx]} (auto-generated)`}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="ai-manual-options-container">
                          <span className="ai-options-label">Custom Manual Options (click radio to select correct answer):</span>
                          {(q.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className={`ai-option-input-row ${q.correctAnswerIndex === optIdx ? 'is-correct-row' : ''}`}>
                              <label className="ai-correct-radio-label" title={`Mark Option ${['A', 'B', 'C', 'D'][optIdx]} as correct`}>
                                <input
                                  type="radio"
                                  name={`correct_${qIdx}`}
                                  checked={q.correctAnswerIndex === optIdx}
                                  onChange={() => handleAiQuestionChange(qIdx, 'correctAnswerIndex', optIdx)}
                                />
                                <span className="ai-opt-letter">{['A', 'B', 'C', 'D'][optIdx]}</span>
                              </label>
                              <input
                                type="text"
                                className="form-input ai-opt-input"
                                value={opt}
                                onChange={(e) => handleAiOptionChange(qIdx, optIdx, e.target.value)}
                                placeholder={`Option ${['A', 'B', 'C', 'D'][optIdx]}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer buttons */}
            <div className="ai-actions-row" style={{ marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('admin_ai_upload')}
                disabled={aiSaving}
              >
                ← Re-upload / Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAiConfirmAndCreate}
                disabled={aiSaving || aiResult.questions.length === 0}
              >
                {aiSaving ? (
                  <><span className="btn-spinner" />Creating AI Room…</>
                ) : (
                  `Confirm & Launch Live Room (${aiResult.questions.length} Qs) 🚀`
                )}
              </button>
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

              <div className="forgot-pin-row">
                <button
                  type="button"
                  className="forgot-pin-link-btn"
                  onClick={handleStartAdminForgotPin}
                  disabled={adminOtpLoading}
                >
                  {adminOtpLoading ? 'Sending Demo OTP…' : 'Forgot Password / Room PIN?'}
                </button>
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

        {/* ── STEP 2D-OTP: ADMIN HOST FORGOT PIN - DEMO OTP ENTRY ── */}
        {step === 'admin_my_rooms_forgot_otp' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🔐</span>
              <h2 className="room-modal-title">Verify Admin Phone</h2>
              <p className="room-modal-subtitle">
                Enter the 4-digit Demo OTP code to recover your Host PIN for <strong>+91 {myRoomsPhone}</strong>
              </p>
            </div>

            {adminOtpNotice && (
              <div className="sms-otp-banner" style={{ marginBottom: '1rem' }}>
                <span className="sms-otp-icon">📱</span>
                <span className="sms-otp-text">{adminOtpNotice}</span>
              </div>
            )}

            {adminOtpError && <div className="server-error" role="alert">⚠️ {adminOtpError}</div>}

            <form onSubmit={handleVerifyAdminOtp} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">Enter 4-Digit OTP Code</label>
                <input
                  type="text"
                  className="form-input otp-input"
                  placeholder="• • • •"
                  maxLength={4}
                  value={adminOtpCode}
                  onChange={(e) => {
                    setAdminOtpCode(e.target.value.replace(/\D/g, ''));
                    setAdminOtpError('');
                  }}
                  autoFocus
                />
              </div>

              <div className="otp-resend-row" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  onClick={handleResendAdminOtp}
                  disabled={adminResendTimer > 0 || adminOtpLoading}
                >
                  {adminResendTimer > 0 ? `Resend OTP in ${adminResendTimer}s` : 'Resend Demo OTP'}
                </button>
              </div>

              <div className="ai-actions-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep('admin_my_rooms_auth')}
                  disabled={adminOtpLoading}
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={adminOtpLoading || adminOtpCode.length < 4}
                >
                  {adminOtpLoading ? <><span className="btn-spinner" />Verifying…</> : 'Verify OTP →'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── STEP 2D-PIN: ADMIN HOST SET NEW ROOM PIN / PASSWORD ── */}
        {step === 'admin_my_rooms_forgot_new_pin' && (
          <div className="room-form-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🔑</span>
              <h2 className="room-modal-title">Set New Room PIN</h2>
              <p className="room-modal-subtitle">
                Create a new Host Password / PIN for all rooms linked to <strong>+91 {myRoomsPhone}</strong>
              </p>
            </div>

            {adminOtpError && <div className="server-error" role="alert">⚠️ {adminOtpError}</div>}

            <form onSubmit={handleResetAdminPin} className="room-form" noValidate>
              <div className="form-group">
                <label className="form-label">New Host PIN / Room Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter new 4+ digit PIN / password"
                  value={adminNewPin}
                  onChange={(e) => {
                    setAdminNewPin(e.target.value);
                    setAdminOtpError('');
                  }}
                  autoFocus
                />
                <span className="form-hint" style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', display: 'block' }}>
                  This PIN will update and authenticate all rooms associated with your phone number.
                </span>
              </div>

              <div className="ai-actions-row" style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStep('admin_my_rooms_forgot_otp')}
                  disabled={adminOtpLoading}
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={adminOtpLoading || adminNewPin.trim().length < 4}
                >
                  {adminOtpLoading ? <><span className="btn-spinner" />Updating PIN…</> : 'Save PIN & Load Rooms 🚀'}
                </button>
              </div>
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
