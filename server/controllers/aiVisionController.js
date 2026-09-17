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
 * Detects whether a question or answer is mathematical, numerical, or calculation-oriented.
 */
function isNumericalOrMathQuery(questionText = '', directAnswer = '', rawOptions = []) {
  const q = (questionText || '').toLowerCase();
  const d = (directAnswer || '').trim();

  // 1. Direct answer is a number or contains numbers with optional units (e.g. "42", "-3.5", "10 m/s", "50%", "0.05")
  if (d && (/^-?\d+(?:\.\d+)?(?:\s*[%°a-zA-Z/]+)?$/.test(d) || /^\d+$/.test(d.replace(/[^0-9]/g, '')))) {
    return true;
  }

  // 2. Any option contains purely numbers or numbers with units
  if (Array.isArray(rawOptions) && rawOptions.some((o) => /^-?\d+(?:\.\d+)?(?:\s*[%°a-zA-Z/]+)?$/.test(String(o || '').trim()))) {
    return true;
  }

  // 3. Question contains calculation keywords or arithmetic operations
  const mathKeywords = [
    'calculate', 'compute', 'evaluate', 'solve for', 'value of', 'sum of', 'product of',
    'difference between', 'ratio of', 'remainder', 'percentage', 'how many', 'how much',
    'equals', 'mod', 'area of', 'perimeter', 'volume', 'probability', 'average', 'mean',
    'median', 'mode', 'standard deviation', 'speed', 'velocity', 'acceleration',
    'frequency', 'resistance', 'voltage', 'current', 'capacitance', 'inductance',
    'binary to decimal', 'decimal to binary', 'hexadecimal', 'simplify', 'solve'
  ];
  if (mathKeywords.some((kw) => q.includes(kw))) {
    return true;
  }

  // 4. Mathematical operators with numbers (e.g., "15 + 4", "10 * 2", "5 / 2", "x = 4")
  if (/[-+*/^%=]\s*\d+/.test(q) || /\d+\s*[-+*/^%=]/.test(q)) {
    return true;
  }

  return false;
}

/**
 * Detects whether a question is genuinely a True/False or Boolean query.
 */
function isBooleanQuery(questionText = '', directAnswer = '') {
  const q = (questionText || '').toLowerCase();
  const d = (directAnswer || '').toLowerCase().trim();

  // If question is a math calculation, it is NEVER a boolean question
  if (isNumericalOrMathQuery(questionText, directAnswer)) {
    return false;
  }

  // If directAnswer is explicitly true/false/yes/no
  if (d === 'true' || d === 'false' || d === 'yes' || d === 'no') {
    return true;
  }

  // If question explicitly specifies True/False
  if (q.includes('true or false') || q.includes('true/false') || q.includes('whether the statement is true')) {
    return true;
  }

  return false;
}

/**
 * Synthesizes 4 realistic, distinct mathematical variations for numerical problem-solving.
 * Strictly avoids generic fillers like "True", "False", "Cannot be determined".
 */
function generateMathematicalOptions(questionText = '', directAnswer = '', existingOptions = []) {
  const directClean = (directAnswer || '').trim();
  let baseNum = null;
  let unit = '';

  // Extract base number and unit from directAnswer if available
  const directMatch = directClean.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (directMatch) {
    baseNum = parseFloat(directMatch[1]);
    unit = directMatch[2] ? ` ${directMatch[2].trim()}` : '';
  }

  // Otherwise, extract number from question text
  if (baseNum === null || isNaN(baseNum)) {
    const qNumMatch =
      questionText.match(/equals?\s*(-?\d+(?:\.\d+)?)/i) ||
      questionText.match(/(-?\d+(?:\.\d+)?)\s*(?:m\/s|km\/h|hz|v|a|w|%|ohms?|deg|°c)/i) ||
      questionText.match(/\b(-?\d+(?:\.\d+)?)\b/);
    if (qNumMatch) {
      baseNum = parseFloat(qNumMatch[1]);
    } else {
      baseNum = 10;
    }
  }

  const isInt = Number.isInteger(baseNum);
  const formatVal = (n) => `${isInt ? Math.round(n) : Number(n).toFixed(1)}${unit}`;

  const generated = [formatVal(baseNum)];

  // Candidates for realistic calculation variations / distractors
  const variations = isInt
    ? [
        baseNum + 1,
        baseNum - 1,
        baseNum * 2,
        baseNum + 2,
        baseNum > 1 ? Math.floor(baseNum / 2) : baseNum + 3,
        baseNum + 5,
        baseNum + 10,
        Math.max(0, baseNum - 2),
      ]
    : [
        baseNum + 0.5,
        Math.max(0, baseNum - 0.5),
        baseNum * 1.5,
        baseNum * 0.5,
        baseNum + 1.0,
        baseNum * 2,
      ];

  // Include any valid pre-existing options that aren't generic placeholders
  if (Array.isArray(existingOptions)) {
    for (const opt of existingOptions) {
      const cleanOpt = cleanOptionPrefix(String(opt || ''));
      if (cleanOpt && !isGenericPlaceholderOption(cleanOpt) && !generated.includes(cleanOpt)) {
        generated.push(cleanOpt);
        if (generated.length >= 4) break;
      }
    }
  }

  for (const v of variations) {
    if (generated.length >= 4) break;
    const formatted = formatVal(v);
    if (!generated.includes(formatted)) {
      generated.push(formatted);
    }
  }

  while (generated.length < 4) {
    generated.push(formatVal(baseNum + generated.length * 2));
  }

  return {
    options: generated.slice(0, 4),
    correctIndex: 0,
  };
}

/**
 * Intelligent context-aware option synthesizer.
 * If options are generic placeholders, missing, or corrupt, synthesizes plausible,
 * readable choices based on question text, direct answer, and subject/section context.
 */
function synthesizeContextualOptions(questionText = '', directAnswer = '', section = 'Technical', existingOptions = []) {
  const qLower = (questionText || '').toLowerCase();
  const directClean = (directAnswer || '').trim();

  // Case 1: Mathematical / Numerical / Calculation question
  // STRICT RULE: BANS generic fillers ('True', 'False', 'Cannot be determined')
  if (isNumericalOrMathQuery(questionText, directAnswer, existingOptions)) {
    return generateMathematicalOptions(questionText, directAnswer, existingOptions);
  }

  // Case 2: Strictly Boolean / True-False questions
  if (isBooleanQuery(questionText, directAnswer)) {
    const isTrue = directClean.toLowerCase().includes('true') || !directClean.toLowerCase().includes('false');
    return {
      options: ['True', 'False', 'Partially true', 'Cannot be determined'],
      correctIndex: isTrue ? 0 : 1,
    };
  }

  // Case 3: Complexity / Big-O questions
  if (qLower.includes('time complexity') || qLower.includes('space complexity') || qLower.includes('big o')) {
    return {
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctIndex: 1,
    };
  }

  // Case 4: Data structure questions
  if (qLower.includes('data structure') || qLower.includes('fifo') || qLower.includes('lifo')) {
    return {
      options: ['Stack', 'Queue', 'Array', 'Linked List'],
      correctIndex: qLower.includes('fifo') ? 1 : 0,
    };
  }

  // Case 5: Memory / Architecture / Hardware
  if (qLower.includes('memory') || qLower.includes('cache') || qLower.includes('cpu')) {
    return {
      options: ['Primary Memory', 'Secondary Storage', 'Cache Memory', 'Virtual Memory'],
      correctIndex: 0,
    };
  }

  // Case 6: Network / Web / Protocols
  if (qLower.includes('protocol') || qLower.includes('network') || qLower.includes('ip') || qLower.includes('osi')) {
    return {
      options: ['Application Layer', 'Transport Layer', 'Network Layer', 'Data Link Layer'],
      correctIndex: 0,
    };
  }

  // Case 7: Direct answer exists and is non-generic
  if (directClean && !isGenericPlaceholderOption(directClean)) {
    return {
      options: [
        directClean,
        'Standard operational configuration',
        'Alternative execution parameter',
        'Specialized system interface',
      ],
      correctIndex: 0,
    };
  }

  // Case 8: General Conceptual fallback
  return {
    options: [
      'Standard definition according to core principles',
      'Alternative configuration under specific constraints',
      'Specialized theoretical implementation model',
      'Integrated procedural framework',
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
    const synth = synthesizeContextualOptions(questionText, directAnswer, section, rawOptions);
    return {
      options: synth.options,
      correctAnswerIndex: synth.correctIndex,
      directAnswer: synth.options[synth.correctIndex],
    };
  }

  const isMath = isNumericalOrMathQuery(questionText, directAnswer, opts);

  if (isMath) {
    // Fill any missing slots with realistic mathematical variations, never boolean fillers
    const synth = generateMathematicalOptions(questionText, directAnswer, opts);
    let cIdx = parseInt(rawCorrectIndex, 10);
    if (isNaN(cIdx) || cIdx < 0 || cIdx > 3) cIdx = 0;
    return {
      options: synth.options,
      correctAnswerIndex: cIdx,
      directAnswer: synth.options[cIdx] || synth.options[0],
    };
  }

  // If some options are valid and some are empty/generic placeholders
  const standardFillers = [
    'Standard operational specification',
    'Alternative framework structure',
    'Primary behavioral characteristic',
    'Secondary interface property',
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
   - CRITICAL FOR MATHEMATICAL / NUMERICAL / CALCULATION QUESTIONS:
     * Options MUST be 4 realistic, distinct mathematical numbers, variations, or formulas.
     * STRICTLY BAN generic filler options ('True', 'False', 'Cannot be determined', 'None of the above') on non-boolean mathematical queries!
   - ONLY for explicit boolean/truth questions (e.g. True/False questions) may True/False choices be used.
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
  isNumericalOrMathQuery,
  isBooleanQuery,
  generateMathematicalOptions,
};
