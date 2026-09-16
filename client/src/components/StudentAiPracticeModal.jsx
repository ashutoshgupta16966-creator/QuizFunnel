import { useState, useEffect, useRef } from 'react';
import { parseAiQuizDocument, savePracticeAttempt } from '../api';

const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_IMAGES = 10;
const HISTORY_STORAGE_KEY = 'quiz_attempts_history';

function formatMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function StudentAiPracticeModal({
  isOpen,
  onClose,
  homeFormData = {},
  reattemptData = null,
}) {
  // Steps: 'upload' | 'setup_preview' | 'quiz_running' | 'results_review'
  const [step, setStep] = useState('upload');

  // Student details for saving practice history
  const [candidateName, setCandidateName] = useState(homeFormData.name || '');
  const [candidateMobile, setCandidateMobile] = useState(homeFormData.mobile || '');
  const [candidateBranch, setCandidateBranch] = useState(homeFormData.branch || 'CSE');

  // Upload State
  const [files, setFiles] = useState([]); // [{ file, name, size, type, previewUrl }]
  const [uploadError, setUploadError] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgressMsg, setParseProgressMsg] = useState('');

  // Parsed Questions State
  const [subject, setSubject] = useState('AI Practice Quiz');
  const [unit, setUnit] = useState('');
  const [questions, setQuestions] = useState([]);
  const [bulkFormatMode, setBulkFormatMode] = useState('manual'); // 'manual' | 'all_mcq' | 'all_direct'

  // Practice Quiz Engine State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { [questionIndex]: value }
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
        setSubject(pData.subject || reattemptData.subject || 'AI Practice Quiz');
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

  // ── File Upload Handlers ──────────────────────────────────────────────────
  const handleFileChange = (e) => {
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
        setUploadError(`Unsupported file format: ${f.name}. Please upload JPG, PNG, WEBP or PDF.`);
        return;
      }
    }

    const combined = [...files, ...newFiles.map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.type,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }))];

    const totalSize = combined.reduce((acc, f) => acc + (f.size || 0), 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      setUploadError(`Total file size (${(totalSize / 1024 / 1024).toFixed(1)} MB) exceeds 15 MB limit.`);
      return;
    }

    setFiles(combined);
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
      setUploadError('Please select at least 1 image or 1 PDF document to begin.');
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
          throw new Error('No questions could be detected in this document. Please upload a clearer image.');
        }

        const formattedQs = rawQs.map((q, idx) => ({
          id: `q_${idx}_${Date.now()}`,
          questionText: q.questionText || `Question ${idx + 1}`,
          questionType: q.questionType === 'direct' ? 'direct' : 'mcq',
          options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
          correctAnswerIndex: typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0,
          directAnswer: q.directAnswer || '',
          level: [1, 2, 3, 4].includes(q.level) ? q.level : ((idx % 3) + 1),
          section: q.section || 'Technical',
          difficulty: q.difficulty || 'medium',
          explanation: q.explanation || 'Based on core conceptual principles.',
        }));

        setSubject(res.data.subject || 'AI Practice Assessment');
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
    setQuestions((prev) => prev.map((q) => {
      const opts = Array.isArray(q.options) && q.options.length === 4 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'];
      return {
        ...q,
        questionType: 'mcq',
        options: opts,
        correctAnswerIndex: typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0,
      };
    }));
  };

  const handleApplyAllDirect = () => {
    setBulkFormatMode('all_direct');
    setQuestions((prev) => prev.map((q) => {
      let direct = q.directAnswer;
      if (!direct && q.options && q.options[q.correctAnswerIndex]) {
        direct = q.options[q.correctAnswerIndex];
      }
      return {
        ...q,
        questionType: 'direct',
        directAnswer: direct || '',
      };
    }));
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
        options: newType === 'mcq' ? (cur.options && cur.options.length === 4 ? cur.options : ['Option A', 'Option B', 'Option C', 'Option D']) : cur.options,
      };
      return next;
    });
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

      // 2-line AI explanation guarantee
      let exp = q.explanation || '';
      if (!exp || exp.length < 20) {
        if (q.questionType === 'direct') {
          exp = `The correct answer is "${q.directAnswer}". Make sure to verify your numerical formula or exact terminology.`;
        } else {
          const correctText = q.options?.[q.correctAnswerIndex] || 'designated choice';
          exp = `Option ${['A', 'B', 'C', 'D'][q.correctAnswerIndex]} (${correctText}) is correct. Review this chapter's key formulas to solidify your understanding.`;
        }
      }

      return {
        questionIndex: idx,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.options,
        correctAnswerIndex: q.correctAnswerIndex,
        directAnswer: q.directAnswer,
        userAnswer: userAns,
        isCorrect,
        level: q.level || 1,
        section: q.section || 'Technical',
        explanation: exp,
      };
    });

    const total = questions.length;
    const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;
    const timeTaken = quizSeconds;

    const resultObj = {
      score,
      total,
      accuracy,
      timeTaken,
      timeFormatted: formatMMSS(timeTaken),
      subject,
      unit,
      details: detailedList,
    };

    setQuizResults(resultObj);
    setStep('results_review');

    // ── Permanently save into My Results (MongoDB + LocalStorage) ───────────
    const historyId = `practice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const historyRecord = {
      id: historyId,
      attemptId: historyId,
      attemptDate: new Date().toISOString(),
      studentName: candidateName || 'Practice Student',
      mobile: candidateMobile || '',
      branch: candidateBranch || 'CSE',
      levelReached: 1,
      totalScore: score,
      maxPossible: total,
      accuracyPct: accuracy,
      totalTimeTaken: timeTaken,
      timeFormatted: formatMMSS(timeTaken),
      status: 'completed',
      isDisqualified: false,
      quizType: 'practice',
      isPractice: true,
      subject: subject || 'AI Self-Practice',
      unit: unit || '',
      practiceData: {
        subject,
        unit,
        questions,
      },
    };

    // 1. Save to LocalStorage
    try {
      const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([historyRecord, ...existing].slice(0, 40)));
      setSaveStatus('Saved to My Results ✅');
    } catch { /* noop */ }

    // 2. Save to Backend MongoDB if candidate mobile is available
    if (candidateMobile && /^\d{10}$/.test(candidateMobile.trim())) {
      try {
        await savePracticeAttempt({
          mobile: candidateMobile.trim(),
          name: candidateName.trim(),
          branch: candidateBranch,
          totalScore: score,
          maxPossible: total,
          accuracyPct: accuracy,
          totalTimeTaken: timeTaken,
          subject,
          unit,
          practiceData: {
            subject,
            unit,
            questions,
          },
        });
      } catch (err) {
        console.warn('Backend practice save error:', err.message);
      }
    }
  };

  // ── Re-Attempt Same Practice Set ──────────────────────────────────────────
  const handleReattemptSameSet = () => {
    setAnswers({});
    setBookmarks({});
    setCurrentIndex(0);
    setQuizSeconds(0);
    setTimerRunning(true);
    setStep('quiz_running');
  };

  const answeredCount = Object.keys(answers).length;
  const currentQ = questions[currentIndex];

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content ai-practice-modal-card max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navigation Bar */}
        <div className="ai-practice-nav-bar">
          <div className="ai-practice-nav-left">
            <span className="ai-badge-icon">🤖</span>
            <span className="ai-badge-title">AI Self-Practice Engine</span>
            {step === 'quiz_running' && (
              <span className="ai-practice-timer-pill">
                ⏱️ {formatMMSS(quizSeconds)}
              </span>
            )}
          </div>
          <button
            type="button"
            className="room-close-btn"
            onClick={onClose}
            aria-label="Close AI practice modal"
          >
            ✕
          </button>
        </div>

        {/* ── STEP 1: UPLOAD DOCUMENT ── */}
        {step === 'upload' && (
          <div className="ai-practice-step-view">
            <div className="ai-practice-header">
              <h2 className="ai-practice-title">Generate AI Practice Set</h2>
              <p className="ai-practice-subtitle">
                Upload question papers, handwritten notes, or lecture worksheets. Gemini 3.x extracts questions instantly without spoiling answers.
              </p>
            </div>

            {uploadError && <div className="server-error" role="alert">⚠️ {uploadError}</div>}

            {/* Student metadata optional fields for history saving */}
            <div className="ai-practice-user-row">
              <div className="form-group flex-1">
                <label className="form-label">Your Name (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rahul Verma"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                />
              </div>
              <div className="form-group flex-1">
                <label className="form-label">Mobile Number (For My Results sync)</label>
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

            {/* Dropzone */}
            <div className="ai-dropzone">
              <input
                type="file"
                id="aiPracticeFileInput"
                className="ai-file-input"
                multiple
                accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                onChange={handleFileChange}
                disabled={isParsing}
              />
              <label htmlFor="aiPracticeFileInput" className="ai-dropzone-label">
                <span className="ai-dropzone-icon">📸</span>
                <span className="ai-dropzone-text">
                  <strong>Click to browse</strong> or drag &amp; drop photos or 1 PDF
                </span>
                <span className="ai-dropzone-subtext">
                  Up to 10 photos (JPG, PNG, WEBP) or 1 PDF file · Max total 15 MB
                </span>
              </label>
            </div>

            {/* File thumbnails preview */}
            {files.length > 0 && (
              <div className="ai-files-preview-list">
                {files.map((item, idx) => (
                  <div key={idx} className="ai-file-preview-item">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.name} className="ai-thumb" />
                    ) : (
                      <div className="ai-thumb-pdf">📄 PDF</div>
                    )}
                    <div className="ai-file-meta">
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
            )}

            {/* Action button */}
            <div className="ai-practice-actions-row">
              <button
                type="button"
                className="btn btn-primary btn-block ai-extract-btn"
                onClick={handleStartExtraction}
                disabled={isParsing || files.length === 0}
              >
                {isParsing ? (
                  <><span className="btn-spinner" /> {parseProgressMsg || 'Extracting Questions via Gemini 3.x…'}</>
                ) : (
                  `⚡ Extract & Build Practice Set (${files.length} file${files.length !== 1 ? 's' : ''})`
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: MASKED CONFIGURATION SETUP (NO SPOILERS) ── */}
        {step === 'setup_preview' && (
          <div className="ai-practice-step-view">
            <div className="ai-practice-header">
              <div className="ai-header-badge-row">
                <span className="ai-practice-badge">🛡️ Masked Setup (Zero Spoilers)</span>
                <span className="ai-practice-count-badge">📝 {questions.length} Questions Ready</span>
              </div>
              <h2 className="ai-practice-title">Configure Your Practice Run</h2>
              <p className="ai-practice-subtitle">
                Answer keys and choices are strictly hidden so your practice test remains unbiased and authentic.
              </p>
            </div>

            {/* Metadata Fields */}
            <div className="ai-meta-editor-card">
              <div className="ai-meta-field">
                <label className="form-label">Subject / Topic</label>
                <input
                  type="text"
                  className="form-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Operating Systems"
                />
              </div>
              <div className="ai-meta-field">
                <label className="form-label">Unit / Chapter (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. CPU Scheduling"
                />
              </div>
            </div>

            {/* Bulk Format Selector Toolbar */}
            <div className="ai-bulk-format-bar">
              <span className="ai-bulk-format-label">⚡ Format Controls:</span>
              <div className="ai-bulk-btn-group">
                <button
                  type="button"
                  className={`ai-bulk-pill ${bulkFormatMode === 'all_mcq' ? 'is-active' : ''}`}
                  onClick={handleApplyAllMcq}
                  title="Enforce MCQ format for all questions"
                >
                  🔘 Apply All MCQ
                </button>
                <button
                  type="button"
                  className={`ai-bulk-pill ${bulkFormatMode === 'all_direct' ? 'is-active' : ''}`}
                  onClick={handleApplyAllDirect}
                  title="Enforce Direct / Numerical input for all questions"
                >
                  ✏️ Apply All Direct/Numerical
                </button>
                <button
                  type="button"
                  className={`ai-bulk-pill ${bulkFormatMode === 'manual' ? 'is-active' : ''}`}
                  onClick={() => setBulkFormatMode('manual')}
                  title="Manual per-question toggle"
                >
                  🛠️ Manual Edit
                </button>
              </div>
            </div>

            {/* Masked Question Cards List (Zero Spoilers!) */}
            <div className="ai-masked-questions-list">
              {questions.map((q, idx) => (
                <div key={idx} className="ai-masked-q-card">
                  <div className="ai-masked-q-header">
                    <div className="ai-masked-tags">
                      <span className="ai-masked-q-num">Q{idx + 1}</span>
                      <span className={`ai-level-tag lvl-${q.level || 1}`}>
                        Level {q.level || 1}
                      </span>
                      <span className="ai-section-tag">{q.section || 'General'}</span>
                    </div>

                    <button
                      type="button"
                      className="ai-format-switch-btn"
                      onClick={() => handleToggleSingleFormat(idx)}
                      title="Toggle question between MCQ and Direct Numerical"
                    >
                      {q.questionType === 'direct' ? '✏️ Direct Input' : '🔘 MCQ (4 Options)'}
                    </button>
                  </div>

                  <p className="ai-masked-q-text">{q.questionText}</p>

                  <div className="ai-masked-shield-note">
                    🔒 <em>Options &amp; Answer Keys masked until test submission</em>
                  </div>
                </div>
              ))}
            </div>

            {/* Launch Practice Quiz Button */}
            <div className="ai-practice-actions-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('upload')}
              >
                ← Back / Re-Upload
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={handleStartPracticeQuiz}
              >
                🚀 Start Practice Quiz ({questions.length} Qs)
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTERACTIVE PRACTICE QUIZ (UNRESTRICTED PROGRESSION) ── */}
        {step === 'quiz_running' && currentQ && (
          <div className="ai-practice-step-view">
            {/* Top Info Bar */}
            <div className="ai-quiz-runner-header">
              <div className="ai-runner-meta">
                <span className={`ai-level-tag lvl-${currentQ.level || 1}`}>
                  Level {currentQ.level || 1}
                </span>
                <span className="ai-runner-subject">{subject}</span>
                {unit && <span className="ai-runner-unit">· {unit}</span>}
              </div>
              <div className="ai-runner-right">
                <span className="ai-runner-progress">
                  Question <strong>{currentIndex + 1}</strong> of <strong>{questions.length}</strong>
                </span>
                <button
                  type="button"
                  className={`ai-bookmark-btn ${bookmarks[currentIndex] ? 'is-bookmarked' : ''}`}
                  onClick={handleToggleBookmark}
                  title="Bookmark question"
                >
                  {bookmarks[currentIndex] ? '★ Bookmarked' : '☆ Bookmark'}
                </button>
              </div>
            </div>

            {/* Question Card */}
            <div className="ai-quiz-runner-card">
              <h3 className="ai-runner-question-text">{currentQ.questionText}</h3>

              {currentQ.questionType === 'direct' ? (
                <div className="ai-direct-input-section">
                  <label className="form-label">Your Answer (Text or Numerical value):</label>
                  <input
                    type="text"
                    className="form-input ai-direct-play-input"
                    placeholder="Type your answer here..."
                    value={answers[currentIndex] !== undefined ? answers[currentIndex] : ''}
                    onChange={(e) => handleSelectAnswer(e.target.value)}
                    autoFocus
                  />
                  <p className="form-hint">Scoring is trimmed and case-insensitive.</p>
                </div>
              ) : (
                <div className="ai-options-grid">
                  {(currentQ.options || []).map((optText, optIdx) => {
                    const isSelected = answers[currentIndex] === optIdx;
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        className={`ai-option-play-btn ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleSelectAnswer(optIdx)}
                      >
                        <span className="ai-option-letter">{['A', 'B', 'C', 'D'][optIdx]}</span>
                        <span className="ai-option-body">{optText}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Unrestricted Palette Grid */}
            <div className="ai-palette-container">
              <div className="ai-palette-header">
                <span>Navigate Questions (Free Unrestricted Access):</span>
                <span>{answeredCount}/{questions.length} answered</span>
              </div>
              <div className="ai-palette-grid">
                {questions.map((q, pIdx) => {
                  const isAns = answers[pIdx] !== undefined && answers[pIdx] !== '' && answers[pIdx] !== null;
                  const isCur = pIdx === currentIndex;
                  const isBmk = !!bookmarks[pIdx];
                  return (
                    <button
                      key={pIdx}
                      type="button"
                      className={`ai-palette-cell ${isCur ? 'is-current' : ''} ${isAns ? 'is-answered' : ''} ${isBmk ? 'is-bmk' : ''}`}
                      onClick={() => setCurrentIndex(pIdx)}
                    >
                      {pIdx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Navigation Controls */}
            <div className="ai-quiz-bottom-nav">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
              >
                ← Prev
              </button>

              <button
                type="button"
                className="btn btn-submit ai-finish-btn"
                onClick={handleSubmitPractice}
              >
                Submit Practice Set ({answeredCount}/{questions.length}) ✓
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                disabled={currentIndex === questions.length - 1}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: SUBMISSION RESULTS & DETAILED REVIEW WITH 2-LINE AI EXPLANATIONS ── */}
        {step === 'results_review' && quizResults && (
          <div className="ai-practice-step-view">
            <div className="ai-results-hero">
              <span className="ai-results-icon">🎉</span>
              <h2 className="ai-results-title">Practice Set Completed!</h2>
              <p className="ai-results-sub">{subject} {unit ? `· ${unit}` : ''}</p>

              <div className="ai-results-stat-bar">
                <div className="ai-stat-card">
                  <span className="ai-stat-val">{quizResults.score} / {quizResults.total}</span>
                  <span className="ai-stat-lbl">Final Score</span>
                </div>
                <div className="ai-stat-card">
                  <span className="ai-stat-val">{quizResults.accuracy}%</span>
                  <span className="ai-stat-lbl">Accuracy</span>
                </div>
                <div className="ai-stat-card">
                  <span className="ai-stat-val">{quizResults.timeFormatted}</span>
                  <span className="ai-stat-lbl">Time Taken</span>
                </div>
              </div>

              {saveStatus && (
                <div className="ai-save-pill">
                  {saveStatus}
                </div>
              )}
            </div>

            {/* Action buttons: Re-attempt practice set or finish */}
            <div className="ai-review-actions-bar">
              <button
                type="button"
                className="btn btn-primary ai-reattempt-btn"
                onClick={handleReattemptSameSet}
              >
                🔄 Re-Attempt Practice Set
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                ✕ Close &amp; Return Home
              </button>
            </div>

            {/* Detailed Question Review List */}
            <div className="ai-detailed-review-list">
              <h3 className="ai-review-list-title">Detailed Solutions &amp; 2-Line AI Explanations</h3>
              {quizResults.details.map((item, idx) => (
                <div key={idx} className={`ai-review-card ${item.isCorrect ? 'is-pass' : 'is-fail'}`}>
                  <div className="ai-review-card-header">
                    <span className="ai-review-q-num">Q{idx + 1}</span>
                    <span className={`ai-level-tag lvl-${item.level}`}>Level {item.level}</span>
                    <span className={`ai-status-pill ${item.isCorrect ? 'pill-correct' : 'pill-wrong'}`}>
                      {item.isCorrect ? '✅ Correct' : '❌ Incorrect'}
                    </span>
                  </div>

                  <p className="ai-review-q-text">{item.questionText}</p>

                  <div className="ai-review-answers-box">
                    <div className="ai-review-ans-row">
                      <span className="ai-ans-label">Your Answer:</span>
                      <span className={`ai-ans-val ${item.isCorrect ? 'text-correct' : 'text-wrong'}`}>
                        {item.questionType === 'direct'
                          ? (item.userAnswer || 'Unattempted')
                          : (item.userAnswer !== undefined && item.options?.[item.userAnswer]
                            ? `Option ${['A', 'B', 'C', 'D'][item.userAnswer]}: ${item.options[item.userAnswer]}`
                            : 'Unattempted')}
                      </span>
                    </div>

                    {!item.isCorrect && (
                      <div className="ai-review-ans-row">
                        <span className="ai-ans-label">Correct Answer:</span>
                        <span className="ai-ans-val text-correct">
                          {item.questionType === 'direct'
                            ? item.directAnswer
                            : `Option ${['A', 'B', 'C', 'D'][item.correctAnswerIndex]}: ${item.options?.[item.correctAnswerIndex]}`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 2-line AI explanation */}
                  <div className="ai-explanation-box">
                    <span className="ai-explanation-title">💡 Explanation:</span>
                    <p className="ai-explanation-text">{item.explanation}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Re-attempt button */}
            <div className="ai-review-actions-bar" style={{ marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-primary ai-reattempt-btn"
                onClick={handleReattemptSameSet}
              >
                🔄 Re-Attempt Practice Set
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                ✕ Close &amp; Return Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
