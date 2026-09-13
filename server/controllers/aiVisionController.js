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

// Gemini Multimodal Model Fallback Ladder (Prioritizes 3.7 -> 3.6 -> 3.6-lite -> 3.5 series with 2.5/1.5 safety fallbacks)
const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
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
  const inlineParts = files.map((f) => ({
    inlineData: {
      mimeType: f.mimetype === 'image/jpg' ? 'image/jpeg' : f.mimetype,
      data: f.buffer.toString('base64'),
    },
  }));

  const promptText = `You are an expert academic assessment digitizer and quiz extraction engine.
Analyze the provided document (exam paper, test sheet, lecture quiz, or question bank) thoroughly and extract:
1. "subject": The name of the subject or course (e.g. "Data Structures", "Digital Electronics", "Operating Systems", "Physics"). If not explicitly mentioned, infer a concise and accurate subject name from the content.
2. "unit": The unit, chapter, module, or topic name (e.g. "Unit 3: Binary Trees", "Chapter 2: Thermodynamics", "Arrays & Pointers"). If not specified, infer a concise topic name.
3. "questions": All multiple-choice questions found in the document.

STRICT OUTPUT FORMAT:
You must return ONLY a raw, valid JSON object without markdown code blocks, backticks, or any conversational prose.
JSON Structure:
{
  "subject": "Subject Name",
  "unit": "Unit / Chapter Name",
  "questions": [
    {
      "questionText": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswerIndex": 0,
      "level": 1,
      "section": "Technical",
      "difficulty": "medium",
      "explanation": "Brief explanation of the correct answer"
    }
  ]
}

CRITICAL RULES:
1. "options" MUST be an array of EXACTLY 4 non-empty strings.
   - If the original question has fewer than 4 choices (e.g., True/False or 3 choices), generate plausible, realistic distractor options to make exactly 4 choices.
2. "correctAnswerIndex" MUST be an integer between 0 and 3 (0 for Option A, 1 for Option B, 2 for Option C, 3 for Option D).
   - If the answer key is clearly marked in the document, use it.
   - If the answer key is NOT indicated in the document, determine the factually correct option yourself and accurately set its index.
3. "level" MUST be an integer from 1 to 4:
   - Level 1: Foundation / Basic concepts & definitions
   - Level 2: Intermediate / Application & conceptual understanding
   - Level 3: Advanced / Problem solving & code tracing
   - Level 4: Final Round / Complex analysis & comprehensive questions
   If questions are already organized by difficulty or parts (e.g. Part A, Part B), map them appropriately. Otherwise, distribute them logically starting at Level 1.
4. "section" MUST be one of: ["Technical", "GK", "Reasoning", "Aptitude", "Mixed"].
   - Use "Technical" for engineering, computer science, and STEM topics.
5. "difficulty" MUST be one of: ["easy", "medium", "hard"].
6. Preserve formatting, mathematical formulas, code blocks, or special terminology accurately in "questionText".`;

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
    throw new Error('No multiple-choice questions could be detected in the uploaded file(s). Please check that the document contains readable questions.');
  }

  // ── Sanitize & Validate Questions against QuestionSchema ────────────────
  const validatedQuestions = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i];
    const qText = (q.questionText || q.question || '').trim();
    if (!qText) continue;

    // Ensure 4 options
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

    // Validate correctAnswerIndex
    let correctIdx = parseInt(q.correctAnswerIndex, 10);
    if (isNaN(correctIdx) || correctIdx < 0 || correctIdx > 3) {
      correctIdx = 0;
    }

    // Validate level
    let lvl = parseInt(q.level, 10);
    if (isNaN(lvl) || lvl < 1 || lvl > 4) {
      lvl = 1;
    }

    // Validate section
    let sec = ALLOWED_SECTIONS.includes(q.section) ? q.section : 'Technical';

    // Validate difficulty
    let diff = ALLOWED_DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium';

    validatedQuestions.push({
      questionText: qText,
      options: opts,
      correctAnswerIndex: correctIdx,
      level: lvl,
      section: sec,
      difficulty: diff,
      explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
    });
  }

  if (validatedQuestions.length === 0) {
    throw new Error('Found question text, but could not parse valid options. Please ensure questions have distinct multiple-choice options.');
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
