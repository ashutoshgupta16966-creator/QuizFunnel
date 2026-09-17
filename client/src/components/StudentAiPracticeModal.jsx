import { useState, useEffect, useRef } from 'react';
import { parseAiQuizDocument, savePracticeAttempt } from '../api';
import ThemeToggle from './ThemeToggle';

const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_IMAGES = 10;
const HISTORY_STORAGE_KEY = 'quiz_attempts_history';

function formatMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isPlaceholderChoice(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(option|choice)\s*[a-d1-4]?$/i.test(trimmed) || /^[a-d][.)]?$/i.test(trimmed);
}

function ensureValidMcqOptions(q) {
  const existing = Array.isArray(q?.options)
    ? q.options.map((o) => String(o || '').trim()).filter((o) => !isPlaceholderChoice(o))
    : [];

  if (existing.length === 4) return existing;

  const direct = String(q?.directAnswer || '').trim();
  const options = [...existing];

  if (direct && !isPlaceholderChoice(direct) && !options.includes(direct)) {
    options.unshift(direct);
  }

  const standardFallbacks = [
    'True',
    'False',
    'Cannot be determined',
    'None of the above',
    'All of the above',
    'Both of the above',
  ];

  for (const f of standardFallbacks) {
    if (options.length >= 4) break;
    if (!options.includes(f)) {
      options.push(f);
    }
  }

  while (options.length < 4) {
    options.push(`Alternative ${options.length + 1}`);
  }

  return options.slice(0, 4);
}

export default function StudentAiPracticeModal({
  isOpen,
  onClose,
  homeFormData = {},
  reattemptData = null,
}) {
  // Steps: 'upload' | 'setup_preview' | 'quiz_running' | 'results_review'
  const [step, setStep] = useState('upload');

  // Candidate details for persistent history sync
  const [candidateName, setCandidateName] = useState(homeFormData.name || '');
  const [candidateMobile, setCandidateMobile] = useState(homeFormData.mobile || '');
  const [candidateBranch, setCandidateBranch] = useState(homeFormData.branch || 'CSE');

  // Upload State
  const [files, setFiles] = useState([]); // [{ file, name, size, type, previewUrl }]
  const [uploadError, setUploadError] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgressMsg, setParseProgressMsg] = useState('');

  // Parsed Questions State
  const [subject, setSubject] = useState('Self Practice Quiz');
  const [unit, setUnit] = useState('');
  const [questions, setQuestions] = useState([]);
  const [bulkFormatMode, setBulkFormatMode] = useState('manual'); // 'manual' | 'all_mcq' | 'all_direct'

  // Practice Quiz Engine State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { [questionIndex]: selectedOptionIndex | textString }
  const [bookmarks, setBookmarks] = useState({});
  const [quizSeconds, setQuizSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef(null);

  // Results State
  const [quizResults, setQuizResults] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');

  // Lock scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Handle re-attempt launch if launched from My Results
  useEffect(() => {
    if (isOpen && reattemptData) {
      const pData = reattemptData.practiceData || reattemptData;
      if (Array.isArray(pData.questions) && pData.questions.length > 0) {
        setSubject(pData.subject || reattemptData.subject || 'Self Practice Quiz');
        setUnit(pData.unit || reattemptData.unit || '');
        setQuestions(pData.questions);
        setCandidateName(reattemptData.studentName || homeFormData.name || '');
        setCandidateMobile(reattemptData.mobile || homeFormData.mobile || '');
        setAnswers({});
        setBookmarks({});
        setCurrentIndex(0);
        setQuizSeconds(0);
        setStep('setup_preview');
      }
    } else if (isOpen && !reattemptData) {
      setCandidateName(homeFormData.name || '');
      setCandidateMobile(homeFormData.mobile || '');
      setCandidateBranch(homeFormData.branch || 'CSE');
    }
  }, [isOpen, reattemptData, homeFormData]);

  // Timer Tick
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setQuizSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

  if (!isOpen) return null;

  // ── File Selection Handlers (Camera & Picker) ──────────────────────────────
  const handleFileSelect = (e) => {
    setUploadError('');
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;

    const hasPdf = newFiles.some((f) => f.type === 'application/pdf');
    if (hasPdf && (newFiles.length > 1 || files.length > 0)) {
      setUploadError('PDF files must be uploaded individually (1 PDF at a time).');
      return;
    }
    if (!hasPdf && files.length + newFiles.length > MAX_IMAGES) {
      setUploadError(`You can upload at most ${MAX_IMAGES} images.`);
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
    for (const f of newFiles) {
      if (!validTypes.includes(f.type)) {
        setUploadError(`Unsupported format: ${f.name}. Please upload JPG, PNG, WEBP or PDF.`);
        return;
      }
    }

    const combined = [
      ...files,
      ...newFiles.map((f) => ({
        file: f,
        name: f.name,
        size: f.size,
        type: f.type,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })),
    ];

    const totalSize = combined.reduce((acc, f) => acc + (f.size || 0), 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      setUploadError(`Total file size (${(totalSize / 1024 / 1024).toFixed(1)} MB) exceeds 15 MB limit.`);
      return;
    }

    setFiles(combined);
    // Reset file input value so same file can be re-selected if removed
    e.target.value = '';
  };

  const handleClearFiles = () => {
    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setFiles([]);
    setUploadError('');
  };

  const handleRemoveFile = (idx) => {
    setFiles((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // ── Digitize & Extract Questions with Gemini 3.x ─────────────────────────
  const handleStartExtraction = async () => {
    if (!files.length) {
      setUploadError('Please snap a photo or select at least 1 image / PDF document to begin.');
      return;
    }

    setUploadError('');
    setIsParsing(true);
    setParseProgressMsg('Initializing Gemini 3.x Multimodal Vision Pipeline…');

    const msgTimer1 = setTimeout(() => {
      setParseProgressMsg('Transcribing verbatim text, diagrams & numerical problems…');
    }, 2500);
    const msgTimer2 = setTimeout(() => {
      setParseProgressMsg('Structuring questions & categorizing difficulty levels…');
    }, 5500);

    try {
      const formData = new FormData();
      files.forEach((item) => formData.append('files', item.file));

      const res = await parseAiQuizDocument(formData);
      clearTimeout(msgTimer1);
      clearTimeout(msgTimer2);

      if (res.data?.success) {
        const rawQs = Array.isArray(res.data.questions) ? res.data.questions : [];
        if (!rawQs.length) {
          throw new Error('No questions could be detected in this document. Please upload a clearer image or document.');
        }

        const formattedQs = rawQs.map((q, idx) => ({
          id: `q_${idx}_${Date.now()}`,
          questionText: q.questionText || `Question ${idx + 1}`,
          questionType: q.questionType === 'direct' ? 'direct' : 'mcq',
          options: q.questionType === 'direct' ? [] : ensureValidMcqOptions(q),
          correctAnswerIndex: typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0,
          directAnswer: q.directAnswer || '',
          level: [1, 2, 3, 4].includes(q.level) ? q.level : ((idx % 3) + 1),
          section: q.section || 'Technical',
          difficulty: q.difficulty || 'medium',
          explanation: q.explanation || 'Based on standard conceptual principles.',
        }));

        setSubject(res.data.subject || 'Self Practice Assessment');
        setUnit(res.data.unit || '');
        setQuestions(formattedQs);
        setAnswers({});
        setBookmarks({});
        setCurrentIndex(0);
        setStep('setup_preview');
      } else {
        throw new Error(res.data?.error || 'Failed to extract questions.');
      }
    } catch (err) {
      clearTimeout(msgTimer1);
      clearTimeout(msgTimer2);
      setUploadError(err.response?.data?.error || err.message || 'AI document extraction failed. Please try again.');
    } finally {
      setIsParsing(false);
      setParseProgressMsg('');
    }
  };

  // ── Bulk Format Toggle Handlers ───────────────────────────────────────────
  const handleApplyAllMcq = () => {
    setBulkFormatMode('all_mcq');
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        questionType: 'mcq',
        options: ensureValidMcqOptions(q),
        correctAnswerIndex: typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0,
      }))
    );
  };

  const handleApplyAllDirect = () => {
    setBulkFormatMode('all_direct');
    setQuestions((prev) =>
      prev.map((q) => {
        let direct = q.directAnswer;
        if (!direct && q.options && q.options[q.correctAnswerIndex]) {
          direct = q.options[q.correctAnswerIndex];
        }
        return {
          ...q,
          questionType: 'direct',
          directAnswer: direct || '',
        };
      })
    );
  };

  const handleToggleSingleFormat = (qIdx) => {
    setQuestions((prev) => {
      const next = [...prev];
      const cur = next[qIdx];
      const newType = cur.questionType === 'direct' ? 'mcq' : 'direct';
      next[qIdx] = {
        ...cur,
        questionType: newType,
        directAnswer: newType === 'direct' ? (cur.directAnswer || (cur.options && cur.options[cur.correctAnswerIndex]) || '') : cur.directAnswer,
        options: newType === 'mcq' ? ensureValidMcqOptions(cur) : [],
      };
      return next;
    });
  };

  const handleRemoveQuestion = (qIdx) => {
    if (questions.length <= 1) {
      alert('Practice set must have at least 1 question.');
      return;
    }
    setQuestions((prev) => prev.filter((_, i) => i !== qIdx));
  };

  // ── Launch Practice Quiz ──────────────────────────────────────────────────
  const handleStartPracticeQuiz = () => {
    setAnswers({});
    setBookmarks({});
    setCurrentIndex(0);
    setQuizSeconds(0);
    setTimerRunning(true);
    setStep('quiz_running');
  };

  // ── Answer Handlers ───────────────────────────────────────────────────────
  const handleSelectAnswer = (val) => {
    setAnswers((prev) => ({
      ...prev,
      [currentIndex]: val,
    }));
  };

  const handleToggleBookmark = () => {
    setBookmarks((prev) => ({
      ...prev,
      [currentIndex]: !prev[currentIndex],
    }));
  };

  // ── Submit Practice Quiz & Compute Results ────────────────────────────────
  const handleSubmitPractice = async () => {
    setTimerRunning(false);

    let score = 0;
    const detailedList = questions.map((q, idx) => {
      const userAns = answers[idx];
      let isCorrect = false;

      if (q.questionType === 'direct') {
        const userNorm = String(userAns || '').trim().toLowerCase();
        const correctNorm = String(q.directAnswer || '').trim().toLowerCase();
        isCorrect = userNorm !== '' && userNorm === correctNorm;
      } else {
        isCorrect = typeof userAns === 'number' && userAns === q.correctAnswerIndex;
      }

      if (isCorrect) score++;

      let aiExplanation = q.explanation;
      if (!isCorrect) {
        if (q.questionType === 'direct') {
          aiExplanation = `The correct answer is "${q.directAnswer}". Ensure accurate numerical computation or spelling.`;
        } else {
          const correctOptionText = (q.options && q.options[q.correctAnswerIndex]) || `Option ${String.fromCharCode(65 + q.correctAnswerIndex)}`;
          aiExplanation = `Correct: "${correctOptionText}". ${q.explanation || 'Review core formulas and theoretical principles for this topic.'}`;
        }
      }

      return {
        ...q,
        userAnswer: userAns,
        isCorrect,
        aiExplanation,
      };
    });

    const totalQuestions = questions.length;
    const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    const computedResults = {
      subject,
      unit,
      score,
      totalQuestions,
      accuracy,
      timeSeconds: quizSeconds,
      timeFormatted: formatMMSS(quizSeconds),
      questions: detailedList,
    };

    setQuizResults(computedResults);
    setStep('results_review');

    // ── Dual Persistence: Save to LocalStorage & MongoDB ────────────────────
    const studentMobile = candidateMobile.trim();
    const studentName = candidateName.trim() || 'Student';

    const attemptId = `practice_${studentMobile || 'guest'}_${Date.now()}`;
    const newRecord = {
      id: attemptId,
      attemptDate: new Date().toISOString(),
      studentName,
      mobile: studentMobile,
      branch: candidateBranch,
      levelReached: 1,
      totalScore: score,
      maxPossible: totalQuestions,
      accuracyPct: accuracy,
      totalTimeTaken: quizSeconds,
      timeFormatted: formatMMSS(quizSeconds),
      status: 'completed',
      isDisqualified: false,
      isPractice: true,
      quizType: 'practice',
      subject,
      unit,
      practiceData: {
        subject,
        unit,
        questions,
      },
    };

    // 1. Save to LocalStorage
    try {
      const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      const updated = [newRecord, ...existing.filter((a) => a.id !== attemptId)];
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed saving practice to localStorage:', e);
    }

    // 2. Save to MongoDB if mobile provided
    if (studentMobile && studentMobile.length === 10) {
      setSaveStatus('Saving to My Results…');
      try {
        await savePracticeAttempt({
          mobile: studentMobile,
          studentName,
          branch: candidateBranch,
          subject,
          unit,
          score,
          totalQuestions,
          accuracy,
          totalTimeTaken: quizSeconds,
          practiceQuestions: questions,
        });
        setSaveStatus('Saved to My Results ✓');
      } catch (err) {
        console.warn('Backend practice save error:', err.message);
        setSaveStatus('');
      }
    }
  };

  const answeredCount = Object.keys(answers).length;
  const currentQ = questions[currentIndex];

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content room-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Navigation Row */}
        <div className="room-modal-nav-row">
          {step === 'setup_preview' ? (
            <button
              type="button"
              className="room-back-btn"
              onClick={() => setStep('upload')}
            >
              ← Back to Upload
            </button>
          ) : step === 'quiz_running' ? (
            <div className="ai-practice-timer-pill">
              ⏱️ {formatMMSS(quizSeconds)}
            </div>
          ) : (
            <div className="nav-placeholder" />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ThemeToggle />
            <button
              type="button"
              className="room-close-btn"
              onClick={onClose}
              aria-label="Close modal"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── STEP 1: UPLOAD SCREEN (MIRRORING PROVEN ROOMROLEMODAL LAYOUT) ── */}
        {step === 'upload' && (
          <div className="room-form-view ai-upload-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">📸</span>
              <h2 className="room-modal-title">Self Practice: Upload Paper</h2>
              <p className="room-modal-subtitle">
                Snap photos with your camera or select files (up to 10 images or 1 PDF • max 15MB)
              </p>
            </div>

            {uploadError && <div className="server-error" role="alert">⚠️ {uploadError}</div>}

            {/* Candidate metadata optional fields for history saving */}
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rahul Verma"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Mobile Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit number"
                  maxLength={10}
                  value={candidateMobile}
                  onChange={(e) => setCandidateMobile(e.target.value)}
                />
              </div>
            </div>

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
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  disabled={isParsing}
                />
              </label>

              {/* File Picker Button */}
              <label className="ai-method-btn ai-method-upload">
                <span className="method-icon">📁</span>
                <span className="method-title">Upload Image / PDF</span>
                <span className="method-desc">Select from gallery, photos, or documents</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  disabled={isParsing}
                />
              </label>
            </div>

            {/* Selected Files List & Summary */}
            {files.length > 0 && (
              <div className="ai-files-container">
                <div className="ai-files-header">
                  <span className="ai-files-count">
                    📑 <strong>{files.length}</strong> file{files.length !== 1 ? 's' : ''} selected
                    {' '}({(files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB / 15 MB)
                  </span>
                  <button
                    type="button"
                    className="ai-clear-btn"
                    onClick={handleClearFiles}
                    disabled={isParsing}
                  >
                    Clear All
                  </button>
                </div>

                <div className="ai-files-grid">
                  {files.map((item, idx) => (
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
                        onClick={() => handleRemoveFile(idx)}
                        disabled={isParsing}
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
            {isParsing ? (
              <div className="ai-parsing-state">
                <div className="ai-spinner-glow" />
                <h4 className="ai-parsing-title">Gemini Vision is Processing…</h4>
                <p className="ai-parsing-desc">
                  {parseProgressMsg || 'Transcribing questions and diagrams without spoiling answers. Usually takes 5–15 seconds.'}
                </p>
              </div>
            ) : (
              <div className="ai-actions-row" style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary ai-parse-submit-btn"
                  onClick={handleStartExtraction}
                  disabled={files.length === 0}
                >
                  ✨ Extract Questions with Gemini
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: MASKED SETUP REVIEW SCREEN (ZERO SPOILERS) ── */}
        {step === 'setup_preview' && (
          <div className="room-form-view ai-review-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🛡️</span>
              <h2 className="room-modal-title">Review Practice Set (Masked Setup)</h2>
              <p className="room-modal-subtitle">
                Questions extracted. Choices and correct answers are strictly masked to avoid spoilers!
              </p>
            </div>

            {/* Metadata Fields: Subject & Unit */}
            <div className="ai-meta-editor-card">
              <div className="ai-meta-field">
                <label className="form-label">Subject / Topic</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Operating Systems"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div className="ai-meta-field">
                <label className="form-label">Unit / Chapter</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Unit 3: Process Synchronization"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
            </div>

            {/* Bulk Format Selector Toolbar */}
            <div className="ai-bulk-format-bar">
              <span className="ai-bulk-format-label">Batch Format:</span>
              <div className="ai-bulk-btn-group">
                <button
                  type="button"
                  className={`ai-bulk-pill ${bulkFormatMode === 'all_mcq' ? 'is-active' : ''}`}
                  onClick={handleApplyAllMcq}
                >
                  🔘 Apply All MCQ
                </button>
                <button
                  type="button"
                  className={`ai-bulk-pill ${bulkFormatMode === 'all_direct' ? 'is-active' : ''}`}
                  onClick={handleApplyAllDirect}
                >
                  🔢 Apply All Direct/Numerical
                </button>
              </div>
            </div>

            {/* Questions count badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#818cf8' }}>
                📝 <strong>{questions.length}</strong> Questions Ready
              </span>
            </div>

            {/* Masked Question List */}
            <div className="ai-review-questions-list" style={{ maxHeight: '42vh', overflowY: 'auto', paddingRight: '0.35rem' }}>
              {questions.map((q, qIdx) => (
                <div key={q.id || qIdx} className="ai-review-q-card" style={{ marginBottom: '0.85rem' }}>
                  <div className="ai-review-q-header">
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span className="q-num-pill">Q{qIdx + 1}</span>
                      <span className={`ai-level-tag lvl-${q.level || 1}`}>Level {q.level || 1}</span>
                      <span className="ai-section-tag">{q.questionType === 'direct' ? 'Direct / Numerical' : 'MCQ'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleToggleSingleFormat(qIdx)}
                        title="Toggle between MCQ and Direct answer"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                      >
                        {q.questionType === 'direct' ? 'Switch to MCQ' : 'Switch to Direct'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-subtle btn-sm"
                        onClick={() => handleRemoveQuestion(qIdx)}
                        title="Remove question"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <p className="ai-review-q-text" style={{ marginTop: '0.4rem', fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem' }}>
                    {q.questionText}
                  </p>

                  {/* Strictly Masked Answer Preview (Anti-Spoil) */}
                  <div className="masked-anti-spoil-box">
                    {q.questionType === 'direct' ? (
                      <div className="masked-hint">
                        🔒 <strong>Direct / Numerical Entry:</strong> Type your exact answer during the test. Correct key is hidden.
                      </div>
                    ) : (
                      <div className="masked-options-grid">
                        <div className="masked-option-pill">Option A: 🔒 Hidden (Choices revealed during test)</div>
                        <div className="masked-option-pill">Option B: 🔒 Hidden</div>
                        <div className="masked-option-pill">Option C: 🔒 Hidden</div>
                        <div className="masked-option-pill">Option D: 🔒 Hidden</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Launch Practice Test Button */}
            <div className="ai-actions-row" style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('upload')}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartPracticeQuiz}
                disabled={questions.length === 0}
                style={{ flex: 2 }}
              >
                🚀 Start Practice Test ({questions.length} Qs)
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTERACTIVE PRACTICE QUIZ RUNNER ── */}
        {step === 'quiz_running' && currentQ && (
          <div className="room-form-view ai-quiz-running-view">
            {/* Top Bar with Subject, Unit & Current Position */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  {subject} {unit ? `· ${unit}` : ''}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Question {currentIndex + 1} of {questions.length} · {answeredCount} answered
                </span>
              </div>
              <button
                type="button"
                className={`bookmark-btn ${bookmarks[currentIndex] ? 'is-bookmarked' : ''}`}
                onClick={handleToggleBookmark}
                title="Bookmark for review"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
              >
                {bookmarks[currentIndex] ? '★ Bookmarked' : '☆ Bookmark'}
              </button>
            </div>

            {/* Dynamic Horizontal Progress Bar */}
            <div className="progress-bar-track" style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', marginBottom: '1rem', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${((currentIndex + 1) / questions.length) * 100}%`,
                  background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>

            {/* Active Question Card */}
            <div className="ai-quiz-runner-card">
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <span className={`ai-level-tag lvl-${currentQ.level || 1}`}>Level {currentQ.level || 1}</span>
                <span className="ai-section-tag">{currentQ.questionType === 'direct' ? 'Numerical/Direct' : 'Multiple Choice'}</span>
              </div>
              <h4 className="ai-runner-q-text">
                {currentQ.questionText}
              </h4>

              {/* Input: Direct vs MCQ */}
              {currentQ.questionType === 'direct' ? (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label className="form-label direct-answer-label">Your Answer:</label>
                  <input
                    type="text"
                    className="form-input direct-answer-input"
                    placeholder="Enter your exact numerical or text answer…"
                    value={answers[currentIndex] !== undefined ? String(answers[currentIndex]) : ''}
                    onChange={(e) => handleSelectAnswer(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {(currentQ.options || []).map((opt, oIdx) => {
                    const isSelected = answers[currentIndex] === oIdx;
                    return (
                      <button
                        key={oIdx}
                        type="button"
                        className={`ai-runner-opt-btn ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleSelectAnswer(oIdx)}
                      >
                        <span className="ai-runner-opt-letter">
                          {String.fromCharCode(65 + oIdx)}
                        </span>
                        <span className="ai-runner-opt-text">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Interactive Question Palette Grid */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>Question Palette</span>
                <span style={{ fontSize: '0.75rem', color: '#6366f1' }}>Click number to jump</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '100px', overflowY: 'auto' }}>
                {questions.map((_, pIdx) => {
                  const isCurrent = pIdx === currentIndex;
                  const isAnswered = answers[pIdx] !== undefined && answers[pIdx] !== '';
                  const isBookmarked = !!bookmarks[pIdx];

                  return (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => setCurrentIndex(pIdx)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: isCurrent ? '2px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
                        background: isCurrent
                          ? '#4f46e5'
                          : isAnswered
                          ? 'rgba(16, 185, 129, 0.25)'
                          : 'rgba(255,255,255,0.04)',
                        color: isCurrent || isAnswered ? '#ffffff' : '#94a3b8',
                        boxShadow: isBookmarked ? '0 0 0 2px #f59e0b' : 'none',
                      }}
                    >
                      {pIdx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Navigation Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
              >
                ← Previous
              </button>

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitPractice}
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                >
                  Submit Practice Quiz ✓
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: PRACTICE RESULTS & AI EXPLANATIONS ── */}
        {step === 'results_review' && quizResults && (
          <div className="room-form-view ai-results-view">
            <div className="room-modal-header">
              <span className="room-modal-icon">🏆</span>
              <h2 className="room-modal-title">Self-Practice Completed!</h2>
              <p className="room-modal-subtitle">
                {quizResults.subject} {quizResults.unit ? `· ${quizResults.unit}` : ''}
              </p>
            </div>

            {saveStatus && (
              <div style={{ textAlign: 'center', color: '#34d399', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                {saveStatus}
              </div>
            )}

            {/* Performance Score Summary Card */}
            <div className="score-card" style={{ marginBottom: '1rem' }}>
              <div className="score-row">
                <span className="score-label">Performance Score</span>
                <span className="score-value" style={{ color: '#818cf8', fontWeight: 800 }}>
                  {quizResults.score} / {quizResults.totalQuestions}
                </span>
              </div>
              <div className="score-row">
                <span className="score-label">Accuracy Rate</span>
                <span className="score-value">{quizResults.accuracy}%</span>
              </div>
              <div className="score-row">
                <span className="score-label">Total Time</span>
                <span className="score-value">{quizResults.timeFormatted}</span>
              </div>
            </div>

            {/* Detailed Question Review List */}
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc', margin: '1rem 0 0.5rem 0' }}>
              📋 Detailed Review &amp; AI Explanations
            </h4>
            <div style={{ maxHeight: '38vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.35rem' }}>
              {quizResults.questions.map((q, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: q.isCorrect ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '10px',
                    padding: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8' }}>Q{idx + 1}</span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: q.isCorrect ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: q.isCorrect ? '#34d399' : '#f87171',
                      }}
                    >
                      {q.isCorrect ? '✓ Correct' : '✕ Incorrect'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc', margin: '0 0 0.5rem 0' }}>
                    {q.questionText}
                  </p>

                  <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', color: '#cbd5e1' }}>
                    <div>
                      <strong style={{ color: '#94a3b8' }}>Your Answer: </strong>
                      {q.questionType === 'direct'
                        ? (q.userAnswer || 'Not answered')
                        : (q.options && q.userAnswer !== undefined ? q.options[q.userAnswer] : 'Not answered')}
                    </div>
                    {!q.isCorrect && (
                      <div>
                        <strong style={{ color: '#34d399' }}>Correct Answer: </strong>
                        {q.questionType === 'direct' ? q.directAnswer : (q.options && q.options[q.correctAnswerIndex])}
                      </div>
                    )}
                  </div>

                  {/* 2-Line AI Explanation */}
                  {q.aiExplanation && (
                    <div className="ai-explanation-box" style={{ marginTop: '0.6rem' }}>
                      <span className="ai-explanation-title">💡 2-Line AI Conceptual Explanation:</span>
                      <p className="ai-explanation-text">{q.aiExplanation}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="ai-actions-row" style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                🏠 Return to Home
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartPracticeQuiz}
                style={{ flex: 2 }}
              >
                🔄 Re-Attempt Practice Set
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
