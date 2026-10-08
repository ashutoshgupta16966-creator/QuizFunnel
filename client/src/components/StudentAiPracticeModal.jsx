import { useState, useEffect, useRef } from 'react';
import { parseAiQuizDocument, savePracticeAttempt, generateMcqOptions } from '../api';
import ThemeToggle from './ThemeToggle';
import GuidanceDrawer, { GUIDES } from './GuidanceDrawer';
import AntiCheatModal from './AntiCheatModal';
import { checkDirectAnswerCorrectness } from '../utils/scoringHelper';
import { useTabSwitchMonitor, MAX_TAB_SWITCH_ALLOWED } from '../utils/antiCheat';

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

function isNumericalOrMathQuestion(q) {
  const text = (q?.questionText || '').toLowerCase();
  const direct = String(q?.directAnswer || '').trim();
  const opts = Array.isArray(q?.options) ? q.options : [];

  // 1. Direct answer is a number or contains numbers with optional units (e.g. "42", "-3.5", "10 m/s", "50%", "0.05")
  if (direct && (/^-?\d+(?:\.\d+)?(?:\s*[%°a-zA-Z/]+)?$/.test(direct) || /^\d+$/.test(direct.replace(/[^0-9]/g, '')))) {
    return true;
  }

  // 2. Any option contains purely numbers
  if (opts.some((o) => /^-?\d+(?:\.\d+)?(?:\s*[%°a-zA-Z/]+)?$/.test(String(o || '').trim()))) {
    return true;
  }

  // 3. Question contains calculation keywords
  const mathKeywords = [
    'calculate', 'compute', 'evaluate', 'solve for', 'value of', 'sum of', 'product of',
    'difference between', 'ratio of', 'remainder', 'percentage', 'how many', 'how much',
    'equals', 'mod', 'area of', 'perimeter', 'volume', 'probability', 'average', 'mean',
    'speed', 'velocity', 'acceleration', 'frequency', 'resistance', 'voltage', 'current',
  ];
  if (mathKeywords.some((kw) => text.includes(kw))) {
    return true;
  }

  // 4. Mathematical operators
  if (/[-+*/^%=]\s*\d+/.test(text) || /\d+\s*[-+*/^%=]/.test(text)) {
    return true;
  }

  return false;
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

  const isMath = isNumericalOrMathQuestion(q);

  if (isMath) {
    // Mathematical / Numerical question: synthesize distinct realistic math variations
    let baseNum = null;
    let unit = '';

    const directMatch = direct.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
    if (directMatch) {
      baseNum = parseFloat(directMatch[1]);
      unit = directMatch[2] ? ` ${directMatch[2].trim()}` : '';
    } else {
      const qNumMatch =
        (q?.questionText || '').match(/equals?\s*(-?\d+(?:\.\d+)?)/i) ||
        (q?.questionText || '').match(/(-?\d+(?:\.\d+)?)\s*(?:m\/s|km\/h|hz|v|a|w|%|ohms?|deg|°c)/i) ||
        (q?.questionText || '').match(/\b(-?\d+(?:\.\d+)?)\b/);
      if (qNumMatch) {
        baseNum = parseFloat(qNumMatch[1]);
      } else {
        baseNum = 10;
      }
    }

    const isInt = Number.isInteger(baseNum);
    const formatVal = (n) => `${isInt ? Math.round(n) : Number(n).toFixed(1)}${unit}`;

    const mathVariations = isInt
      ? [
          baseNum + 1,
          baseNum - 1,
          baseNum * 2,
          baseNum + 2,
          baseNum > 1 ? Math.floor(baseNum / 2) : baseNum + 3,
          baseNum + 5,
          Math.max(0, baseNum - 2),
        ]
      : [
          baseNum + 0.5,
          Math.max(0, baseNum - 0.5),
          baseNum * 1.5,
          baseNum * 0.5,
          baseNum + 1.0,
        ];

    for (const v of mathVariations) {
      if (options.length >= 4) break;
      const formatted = formatVal(v);
      if (!options.includes(formatted)) {
        options.push(formatted);
      }
    }

    while (options.length < 4) {
      options.push(formatVal(baseNum + options.length * 2));
    }

    return options.slice(0, 4);
  }

  // Non-mathematical: Check if strictly boolean
  const qText = (q?.questionText || '').toLowerCase();
  const isBool =
    direct.toLowerCase() === 'true' ||
    direct.toLowerCase() === 'false' ||
    qText.includes('true or false') ||
    qText.includes('true/false');

  if (isBool) {
    const boolFallbacks = ['True', 'False', 'Partially true', 'Cannot be determined'];
    for (const f of boolFallbacks) {
      if (options.length >= 4) break;
      if (!options.includes(f)) options.push(f);
    }
    return options.slice(0, 4);
  }

  // Conceptual non-boolean question: Use contextual conceptual distractors (strictly NO True/False)
  const conceptualFallbacks = [
    'Standard operational specification',
    'Alternative architectural structure',
    'Primary operational characteristic',
    'Specialized interface protocol',
  ];

  for (const f of conceptualFallbacks) {
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
  // Steps: 'upload' | 'setup_preview' | 'timer_setup' | 'quiz_running' | 'results_review'
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
  const [isMcqDropdownOpen, setIsMcqDropdownOpen] = useState(false);
  const [mcqOptionMode, setMcqOptionMode] = useState('auto'); // 'auto' | 'manual'

  // Bulk AI generation state
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkGenIdx, setBulkGenIdx] = useState(null); // index currently being generated
  const [bulkGenErrors, setBulkGenErrors] = useState({}); // { [qIdx]: errorString }
  const [editingPracticeIdxs, setEditingPracticeIdxs] = useState({});
  const [confirmedPracticeIdxs, setConfirmedPracticeIdxs] = useState({});

  // Custom Timer Setup State (timer_setup step)
  const [timerMins, setTimerMins] = useState(30);
  const [timerSecs, setTimerSecs] = useState(0);

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
  const [showGuide, setShowGuide] = useState(false);

  // ── Tab-Switch Anti-Cheat State (mirrors Quiz.jsx) ────────────────────────
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showAntiCheatModal, setShowAntiCheatModal] = useState(false);
  const [isAntiCheatTerminal, setIsAntiCheatTerminal] = useState(false);
  const hasSubmittedPractice = useRef(false); // Guard against double-submit

  // Lock scroll when modal is open and safely release when closed
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
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
      setCandidateName(homeFormData?.name || '');
      setCandidateMobile(homeFormData?.mobile || '');
      setCandidateBranch(homeFormData?.branch || 'CSE');
      // Invalidate any past completed attempt or in-progress state: always land fresh on Step 1
      setStep('upload');
      setQuestions([]);
      setAnswers({});
      setBookmarks({});
      setCurrentIndex(0);
      setQuizSeconds(0);
      setTimerRunning(false);
      setQuizResults(null);
      setSaveStatus('');
      setFiles((prev) => {
        prev.forEach((f) => {
          if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        });
        return [];
      });
      setUploadError('');
    }
  }, [isOpen, reattemptData, homeFormData]);

  // Timer Tick — counts DOWN from the user-set time; auto-submits at 0:00
  // When timerMins=0 && timerSecs=0, the user chose untimed so we count UP for reference
  const isTimedSession = timerMins > 0 || timerSecs > 0;
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setQuizSeconds((s) => {
          if (isTimedSession) {
            // Countdown mode
            if (s <= 1) {
              // Time's up — clear interval and auto-submit
              clearInterval(timerRef.current);
              setTimerRunning(false);
              // Trigger submit asynchronously to avoid state update inside setState
              setTimeout(() => {
                document.getElementById('practice-auto-submit-btn')?.click();
              }, 50);
              return 0;
            }
            return s - 1;
          } else {
            // Untimed — count up for elapsed time display
            return s + 1;
          }
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning, isTimedSession]);

  // ── Tab-Switch Detection ─────────────────────────────────────────────────
  // Uses the shared 4.5-second cooldown hook so a single physical tab-switch
  // (which fires both visibilitychange + blur in rapid succession) is only
  // counted once — identical behaviour to Quiz.jsx, zero code duplication.
  const handlePracticeSwitchViolation = () => {
    if (hasSubmittedPractice.current || isAntiCheatTerminal) return;

    setTabSwitchCount((prev) => {
      const nextCount = prev + 1;
      const clampedCount = Math.min(nextCount, MAX_TAB_SWITCH_ALLOWED);

      if (nextCount >= MAX_TAB_SWITCH_ALLOWED) {
        // 4th switch → terminal disqualification
        hasSubmittedPractice.current = true;
        setTimerRunning(false);
        setIsAntiCheatTerminal(true);
        setShowAntiCheatModal(true);
        // Auto-submit with isDisqualified=true after a short lag so the modal can render
        setTimeout(() => {
          document.getElementById('practice-disqualified-submit-btn')?.click();
        }, 150);
        return clampedCount;
      }

      // Warnings 1–3: show modal with remaining count
      setShowAntiCheatModal(true);
      return clampedCount;
    });
  };

  useTabSwitchMonitor({
    enabled: step === 'quiz_running',
    onViolation: handlePracticeSwitchViolation,
  });



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

  const resetToFreshPractice = () => {
    try {
      setStep('upload');
      setQuestions([]);
      setAnswers({});
      setBookmarks({});
      setCurrentIndex(0);
      setQuizSeconds(0);
      setTimerRunning(false);
      setQuizResults(null);
      setSaveStatus('');
      setIsParsing(false);
      setParseProgressMsg('');
      setBulkFormatMode('manual');
      setIsMcqDropdownOpen(false);
      setMcqOptionMode('auto');
      setSubject('Self Practice Quiz');
      setUnit('');
      setIsBulkGenerating(false);
      setBulkGenIdx(null);
      setBulkGenErrors({});
      setTimerMins(30);
      setTimerSecs(0);
      setEditingPracticeIdxs({});
      setConfirmedPracticeIdxs({});
      // Reset anti-cheat state
      setTabSwitchCount(0);
      setShowAntiCheatModal(false);
      setIsAntiCheatTerminal(false);
      hasSubmittedPractice.current = false;
      handleClearFiles();
      setUploadError('');
    } catch (err) {
      console.error('[StudentAiPracticeModal] resetToFreshPractice error:', err);
    }
  };

  const handleCloseModal = (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    resetToFreshPractice();
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  // ── Digitize & Extract Questions with Gemini 3.x ─────────────────────────
  const handleStartExtraction = async () => {
    if (!files.length) {
      setUploadError('Please snap a photo or select at least 1 image / PDF document to begin.');
      return;
    }

    setUploadError('');
    setIsParsing(true);
    setParseProgressMsg('Initializing AI Processing Pipeline…');

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
        setEditingPracticeIdxs({});
        setConfirmedPracticeIdxs({});
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
  const handleToggleMcqDropdown = () => {
    setIsMcqDropdownOpen((prev) => !prev);
    if (bulkFormatMode !== 'all_mcq') {
      handleApplyMcqSubOption(mcqOptionMode || 'auto');
    }
  };

  const handleApplyMcqSubOption = async (mode) => {
    setBulkFormatMode('all_mcq');
    setMcqOptionMode(mode);
    setIsMcqDropdownOpen(false);

    // First: convert all questions to MCQ format
    const mcqQuestions = questions.map((q) => {
      let opts = q.options;
      if (mode === 'auto') {
        opts = ensureValidMcqOptions(q);
      } else {
        if (!Array.isArray(opts) || opts.length !== 4) {
          const seed = q.directAnswer || (q.options && q.options[q.correctAnswerIndex]) || '';
          opts = seed ? [seed, '', '', ''] : ['', '', '', ''];
        }
      }
      return {
        ...q,
        questionType: 'mcq',
        optionMode: mode,
        options: opts,
        correctAnswerIndex: typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0,
      };
    });
    setQuestions(mcqQuestions);

    // Auto mode: trigger parallel AI option generation for questions needing options
    if (mode === 'auto') {
      setIsBulkGenerating(true);
      setBulkGenErrors({});

      const tasks = [];
      for (let qIdx = 0; qIdx < mcqQuestions.length; qIdx++) {
        const q = mcqQuestions[qIdx];
        if (!q?.questionText?.trim()) continue;

        // If document already provided 4 valid options, preserve them!
        const hasCompleteValidOptions = Array.isArray(q.options) &&
          q.options.length === 4 &&
          q.options.every((opt) => opt && opt.trim() && !/^(option|choice)\s*[a-d1-4]?$/i.test(opt.trim()));

        if (hasCompleteValidOptions) {
          continue;
        }

        tasks.push({ q, qIdx });
      }

      if (tasks.length > 0) {
        await Promise.allSettled(
          tasks.map(async ({ q, qIdx }) => {
            const known = q.directAnswer || (Array.isArray(q.options) && q.options[q.correctAnswerIndex]) || '';
            try {
              const res = await generateMcqOptions({
                questionText: q.questionText.trim(),
                knownAnswer: known,
              });
              if (res.data?.success && res.data?.data) {
                const { options, correctAnswerIndex, correctIndex } = res.data.data;
                const finalIdx = typeof correctAnswerIndex === 'number'
                  ? correctAnswerIndex
                  : (typeof correctIndex === 'number' ? correctIndex : 0);
                setQuestions((prev) => {
                  const next = [...prev];
                  next[qIdx] = {
                    ...next[qIdx],
                    options: Array.isArray(options) && options.length === 4 ? options : next[qIdx].options,
                    correctAnswerIndex: finalIdx,
                    directAnswer: Array.isArray(options) ? (options[finalIdx] || '') : next[qIdx].directAnswer,
                    optionMode: 'auto',
                  };
                  return next;
                });
              } else {
                setBulkGenErrors((prev) => ({
                  ...prev,
                  [qIdx]: res.data?.error || 'AI generation failed for this question.',
                }));
              }
            } catch (err) {
              setBulkGenErrors((prev) => ({
                ...prev,
                [qIdx]: err.response?.data?.error || err.message || 'AI generation failed. Edit manually.',
              }));
            }
          })
        );
      }
      setBulkGenIdx(null);
      setIsBulkGenerating(false);
    }
  };

  const handlePracticeOptionChange = (qIdx, optIdx, val) => {
    setQuestions((prev) => {
      const next = [...prev];
      const cur = next[qIdx];
      const nextOptions = [...(cur.options || ['', '', '', ''])];
      nextOptions[optIdx] = val;
      next[qIdx] = {
        ...cur,
        options: nextOptions,
      };
      return next;
    });
  };

  const handlePracticeCorrectAnswerChange = (qIdx, correctIdx) => {
    setQuestions((prev) => {
      const next = [...prev];
      const cur = next[qIdx];
      const selectedText = (cur.options && cur.options[correctIdx]) || '';
      next[qIdx] = {
        ...cur,
        correctAnswerIndex: correctIdx,
        directAnswer: selectedText || cur.directAnswer,
      };
      return next;
    });
  };

  const handleToggleEditPractice = (qIdx) => {
    setEditingPracticeIdxs((prev) => ({
      ...prev,
      [qIdx]: !prev[qIdx],
    }));
  };

  const handleConfirmPracticeAnswer = (qIdx) => {
    const q = questions[qIdx];
    if (!q) return;

    if (q.questionType === 'direct') {
      if (!q.directAnswer?.trim()) {
        alert('Please specify a valid direct answer before confirming.');
        return;
      }
    } else {
      if (typeof q.correctAnswerIndex !== 'number' || q.correctAnswerIndex < 0 || q.correctAnswerIndex > 3) {
        alert('Please select a designated correct option (A, B, C, or D).');
        return;
      }
      const selectedText = (q.options && q.options[q.correctAnswerIndex]) || '';
      if (!selectedText.trim()) {
        alert(`Option ${['A', 'B', 'C', 'D'][q.correctAnswerIndex]} cannot be blank.`);
        return;
      }
    }

    setConfirmedPracticeIdxs((prev) => ({ ...prev, [qIdx]: true }));
    setEditingPracticeIdxs((prev) => ({ ...prev, [qIdx]: false }));
  };

  const handlePracticeQuestionTextChange = (qIdx, text) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], questionText: text };
      return next;
    });
  };

  const handlePracticeDirectAnswerChange = (qIdx, val) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], directAnswer: val };
      return next;
    });
  };

  const handlePracticeLevelChange = (qIdx, lvl) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], level: parseInt(lvl, 10) || 1 };
      return next;
    });
  };

  const handleApplyAllDirect = () => {
    setBulkFormatMode('all_direct');
    setIsMcqDropdownOpen(false);
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
  // Go to timer setup first so the user can set a custom countdown
  const handleStartPracticeQuiz = () => {
    setStep('timer_setup');
  };

  // Called when user confirms the timer and starts the quiz
  const handleConfirmTimer = () => {
    const totalSecs = (parseInt(timerMins, 10) || 0) * 60 + (parseInt(timerSecs, 10) || 0);
    setAnswers({});
    setBookmarks({});
    setCurrentIndex(0);
    // Set countdown timer: if user entered valid time, use it; otherwise use 0 (no limit displayed)
    setQuizSeconds(totalSecs > 0 ? totalSecs : 0);
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
  const handleSubmitPractice = async (isDisqualified = false) => {
    // Guard: prevent double-submit (e.g., timer expiry + disqualification racing)
    if (hasSubmittedPractice.current) return;
    hasSubmittedPractice.current = true;

    setTimerRunning(false);

    // Capture final tab-switch count at submit time
    const finalTabSwitchCount = tabSwitchCount;

    // For countdown mode: elapsed = totalSetTime - remaining; for untimed: elapsed = quizSeconds
    const totalSetSecs = (timerMins * 60) + timerSecs;
    const elapsedSecs = isTimedSession ? Math.max(0, totalSetSecs - quizSeconds) : quizSeconds;

    let score = 0;
    const detailedList = questions.map((q, idx) => {
      const userAns = answers[idx];
      let isCorrect = false;

      if (q.questionType === 'direct') {
        isCorrect = checkDirectAnswerCorrectness(userAns, q.directAnswer);
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
      timeSeconds: elapsedSecs,
      timeFormatted: formatMMSS(elapsedSecs),
      questions: detailedList,
      tabSwitchCount: finalTabSwitchCount,
      isDisqualified,
    };

    setQuizResults(computedResults);
    setStep('results_review');

    // ── Dual Persistence: Save to LocalStorage & MongoDB ────────────────────
    const studentMobile = candidateMobile.trim();
    const studentName = candidateName.trim() || 'Student';
    const calculatedTotalLevels = Math.max(...questions.map((q) => Number(q.level) || 1), 1);

    const attemptId = `practice_${studentMobile || 'guest'}_${Date.now()}`;
    const newRecord = {
      id: attemptId,
      attemptDate: new Date().toISOString(),
      studentName,
      mobile: studentMobile,
      branch: candidateBranch,
      levelReached: calculatedTotalLevels,
      totalLevels: calculatedTotalLevels,
      totalScore: score,
      maxPossible: totalQuestions,
      accuracyPct: accuracy,
      totalTimeTaken: elapsedSecs,
      timeFormatted: formatMMSS(elapsedSecs),
      status: isDisqualified ? 'disqualified' : 'completed',
      isDisqualified,
      isPractice: true,
      quizType: 'practice',
      tabSwitchCount: finalTabSwitchCount,
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
          totalLevels: calculatedTotalLevels,
          levelReached: calculatedTotalLevels,
          accuracy,
          totalTimeTaken: elapsedSecs,
          practiceQuestions: questions,
          tabSwitchCount: finalTabSwitchCount,
          isDisqualified,
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
    <div className="modal-backdrop" onClick={handleCloseModal} role="dialog" aria-modal="true">
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
            <div className="ai-practice-timer-pill" style={isTimedSession && quizSeconds <= 60 ? { background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)', color: '#f87171' } : {}}>
              {isTimedSession ? `⏱️ ${formatMMSS(quizSeconds)} left` : `⏱️ ${formatMMSS(quizSeconds)}`}
            </div>
          ) : (
            <div className="nav-placeholder" />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              type="button"
              className="guidance-pill"
              onClick={() => setShowGuide(true)}
              title="View Self Practice Instructions"
            >
              ℹ️ Instructions
            </button>
            <ThemeToggle />
            <button
              type="button"
              className="room-close-btn"
              onClick={handleCloseModal}
              aria-label="Close Self Practice and return to home"
              title="Close Self Practice"
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
                <h4 className="ai-parsing-title">Processing…</h4>
                <p className="ai-parsing-desc">
                  {parseProgressMsg || 'Transcribing questions and diagrams without spoiling answers. Usually takes 5–15 seconds.'}
                </p>
              </div>
            ) : (
              <div className="ai-actions-row" style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseModal}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary ai-parse-submit-btn"
                  onClick={handleStartExtraction}
                  disabled={files.length === 0}
                >
                  ✨ Extract Questions
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="ai-bulk-format-label">Batch Format:</span>
                <div className="ai-bulk-btn-group">
                  <button
                    type="button"
                    className={`ai-bulk-pill ai-bulk-expandable-btn ${isMcqDropdownOpen ? 'is-expanded' : ''} ${bulkFormatMode === 'all_mcq' ? 'is-active' : ''}`}
                    onClick={handleToggleMcqDropdown}
                    title="Choose AI Auto-Generate or Manual Options for MCQs"
                    aria-expanded={isMcqDropdownOpen}
                  >
                    <span>🔘 Apply All MCQ</span>
                    <span className={`ai-dropdown-chevron ${isMcqDropdownOpen ? 'open' : ''}`} aria-hidden="true">▼</span>
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

              {/* Expandable sub-options row */}
              {isMcqDropdownOpen && (
                <div className="ai-bulk-suboptions-container">
                  <span className="ai-suboptions-label">⚡ MCQ Option Setup:</span>
                  <div className="ai-optmode-pill-group">
                    <button
                      type="button"
                      className={`ai-optmode-pill ${mcqOptionMode === 'auto' ? 'is-active' : ''}`}
                      onClick={() => handleApplyMcqSubOption('auto')}
                    >
                      🪄 AI Auto-Generate
                    </button>
                    <button
                      type="button"
                      className={`ai-optmode-pill ${mcqOptionMode === 'manual' ? 'is-active' : ''}`}
                      onClick={() => handleApplyMcqSubOption('manual')}
                    >
                      ✏️ Manual
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Questions count badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.5rem 0' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#818cf8' }}>
                📝 <strong>{questions.length}</strong> Questions Ready
              </span>
            </div>

            {/* Questions Review & Edit List */}
            <div className="ai-review-questions-list" style={{ maxHeight: '42vh', overflowY: 'auto', paddingRight: '0.35rem' }}>
              {questions.map((q, qIdx) => {
                const isEditing = Boolean(editingPracticeIdxs[qIdx]);
                const isConfirmed = Boolean(confirmedPracticeIdxs[qIdx]);
                const correctLetter = ['A', 'B', 'C', 'D'][q.correctAnswerIndex ?? 0];
                const correctText = q.questionType === 'direct'
                  ? (q.directAnswer || 'None set')
                  : `${correctLetter}. ${(q.options && q.options[q.correctAnswerIndex]) || ''}`;

                return (
                  <div
                    key={q.id || qIdx}
                    className="ai-review-q-card"
                    style={{
                      marginBottom: '0.85rem',
                      border: isConfirmed ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(139,92,246,0.25)',
                      background: isConfirmed ? 'rgba(34,197,94,0.03)' : undefined,
                      borderRadius: '10px',
                      padding: '0.85rem 1rem',
                    }}
                  >
                    <div className="ai-review-q-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="q-num-pill">Q{qIdx + 1}</span>

                        {/* Confirmation Badge */}
                        {isConfirmed ? (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: 'rgba(34,197,94,0.2)',
                            border: '1px solid rgba(34,197,94,0.4)',
                            color: '#86efac',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}>
                            ✅ Confirmed
                          </span>
                        ) : (
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: 'rgba(234,179,8,0.15)',
                            border: '1px solid rgba(234,179,8,0.35)',
                            color: '#fde047',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}>
                            ⏳ Pending Confirmation
                          </span>
                        )}

                        <span className={`ai-level-tag lvl-${q.level || 1}`}>Level {q.level || 1}</span>
                        <span className="ai-section-tag">{q.questionType === 'direct' ? 'Direct / Numerical' : 'MCQ'}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleToggleEditPractice(qIdx)}
                          title="Edit question text, options and designated answer"
                          style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                        >
                          {isEditing ? '👁️ View' : '✏️ Edit'}
                        </button>
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

                    {/* EDIT MODE */}
                    {isEditing ? (
                      <div style={{ marginTop: '0.75rem' }}>
                        <div className="form-group" style={{ marginBottom: '0.65rem' }}>
                          <label className="form-label" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Question Text</label>
                          <textarea
                            className="form-input"
                            rows={2}
                            value={q.questionText}
                            onChange={(e) => handlePracticeQuestionTextChange(qIdx, e.target.value)}
                            placeholder="Enter question text..."
                            style={{ fontSize: '0.85rem' }}
                          />
                        </div>

                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.65rem' }}>
                          <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>Level:</label>
                          <select
                            className="form-input"
                            value={q.level || 1}
                            onChange={(e) => handlePracticeLevelChange(qIdx, e.target.value)}
                            style={{ width: '100px', fontSize: '0.8rem', padding: '3px 6px' }}
                          >
                            <option value={1}>Level 1</option>
                            <option value={2}>Level 2</option>
                            <option value={3}>Level 3</option>
                            <option value={4}>Level 4</option>
                          </select>
                        </div>

                        {q.questionType === 'direct' ? (
                          <div style={{ marginBottom: '0.65rem' }}>
                            <label className="form-label" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              Designated Direct Answer:
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={q.directAnswer || ''}
                              onChange={(e) => handlePracticeDirectAnswerChange(qIdx, e.target.value)}
                              placeholder="e.g. 42, O(n), Mitochondria, True"
                              style={{ fontSize: '0.85rem' }}
                            />
                          </div>
                        ) : (
                          <div className="ai-manual-options-container" style={{ marginTop: '0.5rem', marginBottom: '0.65rem' }}>
                            <span className="ai-options-label" style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>
                              Options (click radio to select designated correct answer):
                            </span>
                            {['A', 'B', 'C', 'D'].map((letter, optIdx) => (
                              <div key={optIdx} className={`ai-option-input-row ${q.correctAnswerIndex === optIdx ? 'is-correct-row' : ''}`} style={{ marginBottom: '0.35rem' }}>
                                <label className="ai-correct-radio-label" title={`Mark Option ${letter} as correct`}>
                                  <input
                                    type="radio"
                                    name={`practice_correct_edit_${qIdx}`}
                                    checked={q.correctAnswerIndex === optIdx}
                                    onChange={() => handlePracticeCorrectAnswerChange(qIdx, optIdx)}
                                  />
                                  <span className="ai-opt-letter">{letter}</span>
                                </label>
                                <input
                                  type="text"
                                  className="form-input ai-opt-input"
                                  value={(q.options && q.options[optIdx]) || ''}
                                  onChange={(e) => handlePracticeOptionChange(qIdx, optIdx, e.target.value)}
                                  placeholder={`Option ${letter}`}
                                  style={{ fontSize: '0.82rem', padding: '4px 6px' }}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.65rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleToggleEditPractice(qIdx)}
                          >
                            Close Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              background: '#16a34a',
                              borderColor: '#15803d',
                              color: '#fff',
                              fontWeight: 700,
                              padding: '0.35rem 0.95rem',
                            }}
                            onClick={() => handleConfirmPracticeAnswer(qIdx)}
                          >
                            ✅ Confirm Answer
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* LOCKED REVIEW MODE */
                      <div style={{ marginTop: '0.65rem' }}>
                        <p className="ai-review-q-text" style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem', marginBottom: '0.65rem', lineHeight: 1.45 }}>
                          {q.questionText}
                        </p>

                        {q.questionType === 'direct' ? (
                          <div style={{
                            background: 'rgba(34,197,94,0.08)',
                            border: '1px solid rgba(34,197,94,0.3)',
                            borderRadius: '8px',
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.82rem',
                            color: '#86efac',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.65rem',
                          }}>
                            <span>🎯</span>
                            <span>Designated Direct Answer: <strong>{q.directAnswer || <span style={{ color: '#ef4444' }}>Not specified</span>}</strong></span>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.45rem', marginBottom: '0.65rem' }}>
                            {/* FIX 1: One-tap radio selectors in locked review mode */}
                            {['A', 'B', 'C', 'D'].map((letter, optIdx) => {
                              const isTarget = q.correctAnswerIndex === optIdx;
                              const optVal = (q.options && q.options[optIdx]) || '';
                              return (
                                <label
                                  key={optIdx}
                                  title={`Mark Option ${letter} as correct answer`}
                                  style={{
                                    padding: '0.45rem 0.65rem',
                                    borderRadius: '6px',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    background: isTarget ? 'rgba(34,197,94,0.14)' : 'rgba(15,23,42,0.4)',
                                    border: isTarget ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(148,163,184,0.15)',
                                    color: isTarget ? '#86efac' : '#cbd5e1',
                                    fontWeight: isTarget ? 700 : 400,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`practice_review_correct_${qIdx}`}
                                    checked={isTarget}
                                    onChange={() => handlePracticeCorrectAnswerChange(qIdx, optIdx)}
                                    style={{ accentColor: '#4ade80', cursor: 'pointer', flexShrink: 0 }}
                                  />
                                  <span style={{
                                    fontWeight: 800,
                                    color: isTarget ? '#4ade80' : '#94a3b8',
                                    fontSize: '0.75rem',
                                  }}>
                                    {letter}.
                                  </span>
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {optVal || <span style={{ color: '#ef4444' }}>(blank)</span>}
                                  </span>
                                  {isTarget && <span>✅</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {/* Confirmed Banner */}
                        {isConfirmed && (
                          <div style={{
                            marginTop: '0.45rem',
                            padding: '0.4rem 0.75rem',
                            background: 'rgba(34,197,94,0.12)',
                            border: '1px solid rgba(34,197,94,0.35)',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            color: '#86efac',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                          }}>
                            <span>✅</span>
                            <span>Confirmed Answer: <strong>{correctText}</strong></span>
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.65rem' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.7rem' }}
                            onClick={() => handleToggleEditPractice(qIdx)}
                          >
                            ✏️ Edit Question &amp; Answer
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.25rem 0.8rem',
                              background: isConfirmed ? 'rgba(34,197,94,0.2)' : '#16a34a',
                              borderColor: '#15803d',
                              color: '#fff',
                              fontWeight: 700,
                            }}
                            onClick={() => handleConfirmPracticeAnswer(qIdx)}
                          >
                            {isConfirmed ? '✅ Confirmed' : '✅ Confirm Answer'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bulk AI generation progress banner */}
            {isBulkGenerating && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(168,85,247,0.18))',
                border: '1px solid rgba(139,92,246,0.35)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                marginTop: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                fontSize: '0.85rem',
                color: '#c4b5fd',
              }}>
                <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                <span>
                  🪄 AI generating options…
                  <span style={{ color: '#94a3b8', marginLeft: '0.4rem', fontSize: '0.78rem' }}>
                    Options will fill in automatically.
                  </span>
                </span>
              </div>
            )}

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
              >
                🚀 Start Practice Test ({questions.length} Qs)
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2.5: CUSTOM TIMER SETUP ── */}
        {step === 'timer_setup' && (
          <div className="room-form-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', paddingTop: '2rem' }}>
            <div className="room-modal-header" style={{ textAlign: 'center' }}>
              <span className="room-modal-icon">⏱️</span>
              <h2 className="room-modal-title">Set Your Quiz Timer</h2>
              <p className="room-modal-subtitle">
                Choose how long you have for this {questions.length}-question practice set.
                Leave at 0:00 for an untimed session.
              </p>
            </div>

            <div style={{
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(139,92,246,0.3)',
              borderRadius: '14px',
              padding: '2rem 2.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.25rem',
              width: '100%',
              maxWidth: '380px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.4rem', letterSpacing: '0.05em' }}>
                    MINUTES
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={timerMins}
                    onChange={(e) => setTimerMins(Math.max(0, Math.min(180, parseInt(e.target.value) || 0)))}
                    style={{
                      width: '90px', fontSize: '2.4rem', fontWeight: 800, textAlign: 'center',
                      background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(139,92,246,0.5)',
                      borderRadius: '10px', color: '#f8fafc', padding: '0.4rem', outline: 'none',
                    }}
                  />
                </div>
                <span style={{ fontSize: '2.4rem', fontWeight: 800, color: '#6366f1', lineHeight: 1 }}>:</span>
                <div style={{ textAlign: 'center' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.4rem', letterSpacing: '0.05em' }}>
                    SECONDS
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={timerSecs}
                    onChange={(e) => setTimerSecs(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                    style={{
                      width: '90px', fontSize: '2.4rem', fontWeight: 800, textAlign: 'center',
                      background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(139,92,246,0.5)',
                      borderRadius: '10px', color: '#f8fafc', padding: '0.4rem', outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Quick preset buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {[{label:'15 min',m:15,s:0},{label:'30 min',m:30,s:0},{label:'45 min',m:45,s:0},{label:'1 hour',m:60,s:0},{label:'No limit',m:0,s:0}].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => { setTimerMins(preset.m); setTimerSecs(preset.s); }}
                    style={{
                      background: (timerMins === preset.m && timerSecs === preset.s)
                        ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(139,92,246,0.4)', borderRadius: '20px',
                      color: '#c4b5fd', fontSize: '0.78rem', fontWeight: 600,
                      padding: '0.3rem 0.8rem', cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <p style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', margin: 0 }}>
                {timerMins === 0 && timerSecs === 0
                  ? '⏸ Untimed — no countdown will run'
                  : `⏱ ${timerMins}m ${timerSecs}s — quiz auto-submits when time runs out`}
              </p>
            </div>

            <div className="ai-actions-row" style={{ width: '100%', maxWidth: '380px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep('setup_preview')}
              >
                ← Back to Review
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmTimer}
              >
                🚀 Start Quiz
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTERACTIVE PRACTICE QUIZ RUNNER ── */}
        {step === 'quiz_running' && currentQ && (
          <div className="room-form-view ai-quiz-running-view">
            {/* Hidden button used as auto-submit target when timer expires */}
            <button
              id="practice-auto-submit-btn"
              type="button"
              onClick={() => handleSubmitPractice(false)}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
            {/* Hidden button used for disqualification auto-submit (4th tab switch) */}
            <button
              id="practice-disqualified-submit-btn"
              type="button"
              onClick={() => handleSubmitPractice(true)}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
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
              {quizResults.tabSwitchCount > 0 && (
                <div className="score-row">
                  <span className="score-label">⚠️ Tab Switches</span>
                  <span className="score-value" style={{ color: quizResults.isDisqualified ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                    {quizResults.tabSwitchCount} / {MAX_TAB_SWITCH_ALLOWED}
                    {quizResults.isDisqualified && ' — Disqualified 🚫'}
                  </span>
                </div>
              )}
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
                onClick={handleCloseModal}
              >
                🏠 Return to Home
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartPracticeQuiz}
              >
                🔄 Re-Attempt Practice Set
              </button>
            </div>
          </div>
        )}
      </div>
      {/* ── Guidance Drawer (ℹ️ Guide pill) ── */}
      <GuidanceDrawer
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        guide={GUIDES.practice}
      />
      {/* ── Anti-Cheat Modal (Tab-Switch Detection) ── */}
      <AntiCheatModal
        isOpen={showAntiCheatModal}
        count={Math.min(tabSwitchCount, MAX_TAB_SWITCH_ALLOWED)}
        maxLimit={MAX_TAB_SWITCH_ALLOWED}
        isLimitReached={isAntiCheatTerminal}
        onAcknowledge={() => setShowAntiCheatModal(false)}
        onTerminalProceed={() => setShowAntiCheatModal(false)}
      />
    </div>
  );
}
