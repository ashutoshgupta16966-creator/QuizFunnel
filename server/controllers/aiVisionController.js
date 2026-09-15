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
   - "direct": Fill-in-the-blank, numerical answer, short text, or direct question with NO printed choices.
   For "direct" questions, set "questionType": "direct", "directAnswer": "<verbatim or factually correct answer>", and "options": [].
   For "mcq" questions, set "questionType": "mcq", provide exactly 4 options in "options", and set "correctAnswerIndex": 0..3.

STRICT OUTPUT FORMAT:
You must return ONLY a raw, valid JSON object without markdown code blocks, backticks, or any conversational prose.
JSON Structure:
{
  "subject": "Subject Name",
  "unit": "Unit / Chapter Name",
  "questions": [
    {
      "questionText": "Verbatim question text here?",
      "questionType": "mcq",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswerIndex": 0,
      "directAnswer": "",
      "level": 1,
      "section": "Technical",
      "difficulty": "medium",
      "explanation": "Brief explanation of the answer"
    },
    {
      "questionText": "Verbatim direct question or numerical problem?",
      "questionType": "direct",
      "options": [],
      "correctAnswerIndex": -1,
      "directAnswer": "42",
      "level": 2,
      "section": "Technical",
      "difficulty": "medium",
      "explanation": "Brief explanation of the answer"
    }
  ]
}

CRITICAL RULES:
1. If "questionType" is "mcq":
   - "options" MUST contain 4 distinct options transcribed verbatim. If only 2 or 3 choices exist in the document (e.g. True/False), add realistic plausible distractors to make 4 options.
   - "correctAnswerIndex" MUST be an integer between 0 and 3 (0 for Option A, 1 for Option B, 2 for Option C, 3 for Option D).
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
  const validatedQuestions = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i];
    const qText = (q.questionText || q.question || '').trim();
    if (!qText) continue;

    const isDirect = q.questionType === 'direct' ||
      ((!Array.isArray(q.options) || q.options.length === 0) && Boolean(q.directAnswer || q.correctAnswer));

    let lvl = parseInt(q.level, 10);
    if (isNaN(lvl) || lvl < 1 || lvl > 4) lvl = 1;

    let sec = ALLOWED_SECTIONS.includes(q.section) ? q.section : 'Technical';
    let diff = ALLOWED_DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium';
    let explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

    if (isDirect) {
      const directAns = String(q.directAnswer || q.correctAnswer || '').trim();
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
      // Ensure 4 options for MCQ
      let opts = Array.isArray(q.options)
        ? q.options.map((o) => String(o).trim()).filter(Boolean)
        : [];

      if (opts.length === 0) {
        opts = ['True', 'False', 'Cannot be determined', 'None of the above'];
      } else if (opts.length < 4) {
        const genericDummies = ['None of the above', 'All of the above', 'Cannot be determined', 'Both A and B'];
        while (opts.length < 4) {
          opts.push(genericDummies[opts.length] || `Option ${opts.length + 1}`);
        }
      } else if (opts.length > 4) {
        opts = opts.slice(0, 4);
      }

      let correctIdx = parseInt(q.correctAnswerIndex, 10);
      if (isNaN(correctIdx) || correctIdx < 0 || correctIdx > 3) {
        correctIdx = 0;
      }

      validatedQuestions.push({
        questionText: qText,
        questionType: 'mcq',
        options: opts,
        correctAnswerIndex: correctIdx,
        directAnswer: opts[correctIdx] || '',
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
};
