let GoogleGenAI;
try {
  const genaiPkg = require('@google/genai');
  GoogleGenAI = genaiPkg.GoogleGenAI;
} catch (e) {
  console.warn('[AI Vision Controller]: @google/genai package failed to load:', e.message);
}

const ALLOWED_SECTIONS = ['GK', 'Technical', 'Reasoning', 'Aptitude', 'Mixed'];
const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard'];
const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_IMAGES = 10;

// Gemini Multimodal Model Fallback Ladder (gemini-3.6-flash primary with gemini-3.5-flash-lite fallback, 3.x series)
const FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
];

/**
 * Helper to test if a string is a generic placeholder option
 * like "Option A", "Option 1", "Choice A", "Option", or empty.
 */
function isGenericPlaceholderOption(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(option|choice)\s*[a-d1-4]?$/i.test(trimmed) || /^[a-d][.)]?$/i.test(trimmed);
}

/**
 * Strips leading option prefixes like "A. ", "(B) ", "C) ", "Option D: " from option text
 */
function cleanOptionPrefix(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().replace(/^(\(?[a-dA-D1-4]\)?\s*[:.)-]\s*|^option\s*[a-dA-D1-4]\s*[:.)-]\s*)/i, '').trim() || text.trim();
}

/**
 * Intelligent context-aware option synthesizer.
 * If options are generic placeholders, missing, or corrupt, synthesizes plausible,
 * readable choices based on question text, direct answer, and subject/section context.
 */
function synthesizeContextualOptions(questionText = '', directAnswer = '', section = 'Technical') {
  const qLower = (questionText || '').toLowerCase();
  const directClean = (directAnswer || '').trim();

  // Case 1: True / False or Boolean style questions
  if (
    qLower.includes('true or false') ||
    qLower.includes('whether') ||
    /\b(is it true|can a|does a|are all)\b/.test(qLower)
  ) {
    const isTrue = directClean.toLowerCase().includes('true') || !directClean.toLowerCase().includes('false');
    return {
      options: ['True', 'False', 'Partially true', 'Cannot be determined'],
      correctIndex: isTrue ? 0 : 1,
    };
  }

  // Case 2: Numerical or calculation style questions
  const numMatch = directClean.match(/^-?\d+(?:\.\d+)?$/) || qLower.match(/equals?\s*(-?\d+)/);
  if (numMatch) {
    const baseNum = parseFloat(numMatch[1] || numMatch[0]);
    if (!isNaN(baseNum)) {
      const isInt = Number.isInteger(baseNum);
      const d1 = isInt ? String(baseNum + 1) : (baseNum + 1).toFixed(1);
      const d2 = isInt ? String(Math.max(0, baseNum - 1)) : Math.max(0, baseNum - 1).toFixed(1);
      const d3 = isInt ? String(baseNum * 2 || baseNum + 5) : (baseNum * 2).toFixed(1);
      return {
        options: [String(baseNum), d1, d2, d3],
        correctIndex: 0,
      };
    }
  }

  // Case 3: Direct answer exists and is non-generic
  if (directClean && !isGenericPlaceholderOption(directClean)) {
    return {
      options: [
        directClean,
        'None of the above',
        'Both of the above',
        'Cannot be determined from given information',
      ],
      correctIndex: 0,
    };
  }

  // Case 4: Complexity / Big-O questions
  if (qLower.includes('time complexity') || qLower.includes('space complexity') || qLower.includes('big o')) {
    return {
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctIndex: 1,
    };
  }

  // Case 5: Data structure questions
  if (qLower.includes('data structure') || qLower.includes('fifo') || qLower.includes('lifo')) {
    return {
      options: ['Stack', 'Queue', 'Array', 'Linked List'],
      correctIndex: qLower.includes('fifo') ? 1 : 0,
    };
  }

  // Case 6: Memory / Architecture / Hardware
  if (qLower.includes('memory') || qLower.includes('cache') || qLower.includes('cpu')) {
    return {
      options: ['Primary Memory', 'Secondary Storage', 'Cache Memory', 'Virtual Memory'],
      correctIndex: 0,
    };
  }

  // Case 7: Network / Web / Protocols
  if (qLower.includes('protocol') || qLower.includes('network') || qLower.includes('ip') || qLower.includes('osi')) {
    return {
      options: ['Application Layer', 'Transport Layer', 'Network Layer', 'Data Link Layer'],
      correctIndex: 0,
    };
  }

  // Case 8: General Technical / Conceptual fallback
  return {
    options: [
      'Standard definition according to core principles',
      'Alternative configuration under specific constraints',
      'Both of the above statements are correct',
      'Neither of the above statements is correct',
    ],
    correctIndex: 0,
  };
}

/**
 * Active MCQ option sanitizer:
 * Ensures every MCQ question has exactly 4 distinct, readable, non-placeholder options.
 */
function sanitizeMcqOptions(questionText, rawOptions, directAnswer, rawCorrectIndex, section) {
  let opts = Array.isArray(rawOptions)
    ? rawOptions.map((o) => cleanOptionPrefix(String(o || ''))).filter(Boolean)
    : [];

  // Filter out generic placeholders
  opts = opts.map((opt) => (isGenericPlaceholderOption(opt) ? '' : opt));

  const genericCount = opts.filter((o) => !o).length;

  // If all 4 options (or all provided options) were generic placeholders
  if (opts.length === 0 || genericCount >= opts.length) {
    const synth = synthesizeContextualOptions(questionText, directAnswer, section);
    return {
      options: synth.options,
      correctAnswerIndex: synth.correctIndex,
      directAnswer: synth.options[synth.correctIndex],
    };
  }

  // If some options are valid and some are empty/generic placeholders
  const standardFillers = [
    'None of the above',
    'All of the above',
    'Cannot be determined',
    'Both A and B',
  ];

  const finalOpts = [];
  for (let i = 0; i < 4; i++) {
    const existing = opts[i];
    if (existing && !isGenericPlaceholderOption(existing) && !finalOpts.includes(existing)) {
      finalOpts.push(existing);
    } else {
      const filler = standardFillers.find((f) => !finalOpts.includes(f)) || `Alternative ${i + 1}`;
      finalOpts.push(filler);
    }
  }

  let cIdx = parseInt(rawCorrectIndex, 10);
  if (isNaN(cIdx) || cIdx < 0 || cIdx > 3) {
    cIdx = 0;
  }

  return {
    options: finalOpts,
    correctAnswerIndex: cIdx,
    directAnswer: finalOpts[cIdx] || '',
  };
}

/**
 * Parses uploaded exam/quiz documents (images or PDF) using Gemini Vision (multimodal).
 * Extracts Subject, Unit/Chapter, and structured Questions matching the Question schema.
 *
 * @param {Array} files - Array of files from multer (each having buffer, mimetype, size, originalname)
 * @returns {Promise<{ success: boolean, subject: string, unit: string, questions: Array }>}
 */
async function parseQuizDocumentWithGemini(files) {
  if (!files || files.length === 0) {
    throw new Error('No files uploaded. Please capture a photo or upload an image/PDF.');
  }

  // ── Validation: Check total size ─────────────────────────────────────────
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    throw new Error(`Total file size (${sizeMB} MB) exceeds the 15 MB limit. Please upload fewer or smaller files.`);
  }

  // ── Validation: Check file count & types ─────────────────────────────────
  const isPdf = files.some((f) => f.mimetype === 'application/pdf');
  if (isPdf && files.length > 1) {
    throw new Error('Please upload only one PDF file at a time, or up to 10 images.');
  }
  if (!isPdf && files.length > MAX_IMAGES) {
    throw new Error(`Maximum ${MAX_IMAGES} images allowed per submission. Received ${files.length}.`);
  }

  // Allowed mimetypes
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
  for (const file of files) {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`Unsupported file type: ${file.mimetype}. Supported formats: JPG, PNG, WEBP, PDF.`);
    }
  }

  // ── Gemini API Client Check ──────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_google_gemini_api_key_here') {
    throw new Error(
      'Gemini API Key is not configured on the server. Please add a valid GEMINI_API_KEY to your environment variables (.env).'
    );
  }

  if (!GoogleGenAI) {
    throw new Error('@google/genai SDK is not available. Please install @google/genai in the server directory.');
  }

  const ai = new GoogleGenAI({ apiKey });

  // ── Build Multimodal Prompt Parts ────────────────────────────────────────
  const inlineParts = files.map((f) => {
    let base64Data = '';
    if (f.buffer && Buffer.isBuffer(f.buffer)) {
      base64Data = f.buffer.toString('base64');
    } else if (typeof f.buffer === 'string') {
      base64Data = f.buffer;
    } else if (f.data) {
      base64Data = Buffer.isBuffer(f.data) ? f.data.toString('base64') : String(f.data);
    }
    if (base64Data.includes('base64,')) {
      base64Data = base64Data.split('base64,')[1];
    }
    const mimeType = (f.mimetype === 'image/jpg' ? 'image/jpeg' : (f.mimetype || 'image/jpeg')).trim();
    return {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    };
  });

  const promptText = `You are a Strict Verbatim OCR Digitizer and Academic Assessment Extraction Engine.
Your job is to perform STRICT VERBATIM OCR EXTRACTION on the provided document (exam paper, test sheet, lecture quiz, or question bank).

MANDATORY OCR EXTRACTION DIRECTIVES:
1. WORD-FOR-WORD & LINE-FOR-LINE ACCURACY: Transcribe every question, option, heading, and text segment EXACTLY as printed in the document.
2. STRICTLY PROHIBITED: Do NOT rephrase, do NOT rewrite, do NOT paraphrase, do NOT summarize, do NOT condense, and do NOT generate artificial or replacement questions. Transcribe the exact characters and wording.
3. DUAL QUESTION FORMAT SUPPORT:
   - "mcq": Multiple-choice questions that have printed choices (e.g. A, B, C, D).
     * CRITICAL: Transcribe the ACTUAL, REAL text of each choice printed in the document.
     * NEVER output generic placeholder text such as "Option A", "Option B", "Option C", "Option D", "Choice 1", or blank choices.
     * Strip leading labels like "A.", "B)", "(c)", "D:" from the option text.
   - "direct": Fill-in-the-blank, numerical answer, short text, or direct question with NO printed choices.
     * If the document prints a question without multiple-choice choices, DO NOT invent fake "Option A/B/C/D" labels! Classify it as "questionType": "direct", set "options": [], and provide the target answer in "directAnswer".

STRICT OUTPUT FORMAT:
You must return ONLY a raw, valid JSON object without markdown code blocks, backticks, or any conversational prose.
JSON Structure:
{
  "subject": "Subject Name",
  "unit": "Unit / Chapter Name",
  "questions": [
    {
      "questionText": "What protocol is used for secure hypermedia document transfer on the web?",
      "questionType": "mcq",
      "options": [
        "HTTPS",
        "FTP",
        "Telnet",
        "SNMP"
      ],
      "correctAnswerIndex": 0,
      "directAnswer": "HTTPS",
      "level": 1,
      "section": "Technical",
      "difficulty": "easy",
      "explanation": "HTTPS provides encrypted communication over TLS/SSL."
    },
    {
      "questionText": "What is the result of evaluating 15 mod 4?",
      "questionType": "direct",
      "options": [],
      "correctAnswerIndex": -1,
      "directAnswer": "3",
      "level": 1,
      "section": "Technical",
      "difficulty": "easy",
      "explanation": "15 divided by 4 leaves a remainder of 3."
    }
  ]
}

CRITICAL RULES:
1. If "questionType" is "mcq":
   - "options" MUST contain 4 distinct, meaningful, contextual option strings transcribed directly from the document.
   - NEVER output generic placeholder strings like "Option A", "Option B", "Option C", "Option D".
   - If only 2 or 3 choices exist in the document (e.g. True/False), add realistic plausible distractors (e.g. "Cannot be determined", "Partially true") to make 4 options.
   - "correctAnswerIndex" MUST be an integer between 0 and 3 (0 for first option, 1 for second, 2 for third, 3 for fourth).
2. If "questionType" is "direct":
   - "options" should be empty [].
   - "directAnswer" MUST be a non-empty string with the expected target answer (can be an integer, short phrase, formula, or symbol).
3. "level" MUST be an integer from 1 to 4:
   - Level 1: Basic concepts & definitions
   - Level 2: Intermediate / application
   - Level 3: Advanced / problem solving & code tracing
   - Level 4: Final Round / complex analysis
4. "section" MUST be one of: ["Technical", "GK", "Reasoning", "Aptitude", "Mixed"].
5. "difficulty" MUST be one of: ["easy", "medium", "hard"].
6. Preserve formatting, mathematical formulas, code blocks, or special symbols accurately in "questionText".`;

  let rawText = '';
  let lastError = null;

  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`[AI Vision Controller]: Attempting visual extraction with model "${modelName}"...`);
      let response;
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [...inlineParts, promptText],
          config: {
            responseMimeType: 'application/json',
          },
        });
      } catch (cfgErr) {
        // Retry without responseMimeType in case model doesn't support json config
        response = await ai.models.generateContent({
          model: modelName,
          contents: [...inlineParts, promptText],
        });
      }

      rawText = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
      if (rawText && rawText.trim()) {
        console.log(`[AI Vision Controller]: Successfully parsed questions using model "${modelName}".`);
        lastError = null;
        break;
      }
    } catch (modelErr) {
      lastError = modelErr;
      console.warn(`[AI Vision Controller]: Model "${modelName}" failed or returned error (${modelErr.message}). Retrying next model in fallback ladder...`);
    }
  }

  if (!rawText || !rawText.trim()) {
    throw new Error(
      `Gemini Vision processing failed across all fallback models (${FALLBACK_MODELS.join(', ')}). Last error: ${lastError?.message || 'No output generated.'}`
    );
  }

  // ── Parse & Clean JSON Response ──────────────────────────────────────────
  let cleaned = (rawText || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (jsonErr) {
    console.error('[AI Vision Controller] Failed to parse JSON:', cleaned.slice(0, 500));
    throw new Error('Gemini did not return valid JSON. Please try uploading a clearer image or PDF.');
  }

  const subject = typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim() : 'General Quiz';
  const unit = typeof parsed.unit === 'string' && parsed.unit.trim() ? parsed.unit.trim() : '';
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];

  if (rawQuestions.length === 0) {
    throw new Error('No questions could be detected in the uploaded file(s). Please check that the document contains readable questions.');
  }

  // ── Sanitize & Validate Questions against QuestionSchema ────────────────
  const seenQuestionTexts = new Set();
  const validatedQuestions = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i];
    const qText = (q.questionText || q.question || '').trim();
    if (!qText) continue;

    // Deduplicate questions by normalized text (ignore case, whitespace, special characters)
    const normalizedKey = qText.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenQuestionTexts.has(normalizedKey)) continue;
    seenQuestionTexts.add(normalizedKey);

    const isExplicitDirect = q.questionType === 'direct' ||
      ((!Array.isArray(q.options) || q.options.length === 0) && Boolean(q.directAnswer || q.correctAnswer));

    let lvl = parseInt(q.level, 10);
    if (isNaN(lvl) || lvl < 1 || lvl > 4) lvl = 1;

    let sec = ALLOWED_SECTIONS.includes(q.section) ? q.section : 'Technical';
    let diff = ALLOWED_DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium';
    let explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

    const directAnsCandidate = String(q.directAnswer || q.correctAnswer || '').trim();

    // Check if options array was provided but only contains generic placeholders like "Option A"
    const rawOpts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    const allOptionsGeneric = rawOpts.length > 0 && rawOpts.every(isGenericPlaceholderOption);

    // If Gemini forced MCQ on a question with no real choices, but provided a valid directAnswer, convert to direct
    const shouldConvertToDirect = !isExplicitDirect && allOptionsGeneric && Boolean(directAnsCandidate && !isGenericPlaceholderOption(directAnsCandidate));

    if (isExplicitDirect || shouldConvertToDirect) {
      const directAns = directAnsCandidate;
      validatedQuestions.push({
        questionText: qText,
        questionType: 'direct',
        options: [],
        correctAnswerIndex: -1,
        directAnswer: directAns,
        level: lvl,
        section: sec,
        difficulty: diff,
        explanation,
      });
    } else {
      // Active Option Sanitizer: Guarantees 4 valid, non-placeholder, readable choices
      const sanitized = sanitizeMcqOptions(qText, q.options, directAnsCandidate, q.correctAnswerIndex, sec);

      validatedQuestions.push({
        questionText: qText,
        questionType: 'mcq',
        options: sanitized.options,
        correctAnswerIndex: sanitized.correctAnswerIndex,
        directAnswer: sanitized.directAnswer,
        level: lvl,
        section: sec,
        difficulty: diff,
        explanation,
      });
    }
  }

  if (validatedQuestions.length === 0) {
    throw new Error('Found question text, but could not parse valid options or answers. Please ensure questions are clearly formatted.');
  }

  console.log(`[AI Vision Controller]: Successfully parsed ${validatedQuestions.length} questions for "${subject}" (${unit})`);

  return {
    success: true,
    subject,
    unit,
    questions: validatedQuestions,
  };
}

module.exports = {
  parseQuizDocumentWithGemini,
  isGenericPlaceholderOption,
  sanitizeMcqOptions,
};
