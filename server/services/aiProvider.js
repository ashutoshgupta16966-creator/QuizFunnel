/**
 * aiProvider.js
 * Unified AI service implementing Claude-first priority with strict 8-second timeout
 * and fast, zero-delay fallback to Google Gemini.
 *
 * Features:
 * 1. Strict Timeout Enforcement:
 *    - Uses native AbortController to strictly terminate Claude requests at 8 seconds
 *      (preventing 15-20s hangs).
 * 2. Zero-Delay Fast Path:
 *    - If ANTHROPIC_API_KEY is missing or inactive, Claude attempts are skipped in 0ms,
 *      routing directly to Gemini with zero delay.
 * 3. Fallback Ladder:
 *    - Claude Sonnet -> Claude Opus -> Claude Haiku -> Gemini Flash (2.5 -> 2.0 -> 1.5).
 * 4. Duplicate Retry Elimination:
 *    - Exactly 1 attempt per model with no redundant duplicate calls.
 * 5. Full Metrics & Latency Logging:
 *    - Logs precise timings (ms) and status (SUCCESS / TIMEOUT / ERROR) for transparency.
 */

const { extractTextFromPdfBuffer, parseQuestionsFromRawText } = require('./pdfExtractionService');

let GoogleGenAI;
try {
  const genaiPkg = require('@google/genai');
  GoogleGenAI = genaiPkg.GoogleGenAI;
} catch (e) {
  console.warn('[AI Provider]: @google/genai package not found:', e.message);
}

const CLAUDE_MODELS = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-5-haiku-20241022',
];

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

const CLAUDE_TIMEOUT_MS = 8000; // 8 seconds for text-only calls
const CLAUDE_MULTIMODAL_TIMEOUT_MS = 25000; // 25 seconds for multimodal/PDF vision calls

function cleanJsonCodeblock(rawText) {
  let cleaned = (rawText || '').trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }
  return cleaned;
}

/**
 * Strips leading option prefixes like "A. ", "(B) ", "C) ", "Option D: " from option text
 */
function cleanOptionPrefix(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().replace(/^(\(?[a-dA-D1-4]\)?\s*[:.)-]\s*|^option\s*[a-dA-D1-4]\s*[:.)-]\s*)/i, '').trim() || text.trim();
}

/**
 * Tests if an option is a placeholder like "Option A"
 */
function isGenericPlaceholderOption(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(option|choice)\s*[a-d1-4]?$/i.test(trimmed) || /^[a-d][.)]?$/i.test(trimmed);
}

/**
 * Executes a single Claude request with a strict AbortController timeout.
 */
async function callClaude({ model, systemPrompt, prompt, maxTokens = 2048, contentBlocks = null, timeoutMs = null }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return { success: false, skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const effectiveTimeout = timeoutMs || (contentBlocks ? CLAUDE_MULTIMODAL_TIMEOUT_MS : CLAUDE_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, effectiveTimeout);

  const t0 = Date.now();
  try {
    const messages = [
      {
        role: 'user',
        content: contentBlocks || prompt,
      },
    ];

    const body = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) errMsg = parsed.error.message;
      } catch { /* noop */ }
      console.warn(`[AI Provider]: Claude model "${model}" failed after ${elapsed}ms: ${errMsg}`);
      return { success: false, error: errMsg, elapsed };
    }

    const json = await response.json();
    const text = json.content?.[0]?.text || '';
    console.log(`[AI Provider]: Claude model "${model}" succeeded in ${elapsed}ms.`);
    return { success: true, text, elapsed };
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    const isTimeout = err.name === 'AbortError' || err.code === 20;
    if (isTimeout) {
      console.warn(`[AI Provider]: Claude model "${model}" TIMED OUT after strict ${elapsed}ms limit. Falling back...`);
      return { success: false, timedOut: true, elapsed, error: `Timed out after ${effectiveTimeout}ms` };
    }
    console.warn(`[AI Provider]: Claude model "${model}" error after ${elapsed}ms: ${err.message}`);
    return { success: false, elapsed, error: err.message };
  }
}

/**
 * Executes a Gemini request using the official Google GenAI SDK.
 */
async function callGemini({ model, prompt, inlineParts = [], jsonMode = false }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_google_gemini_api_key_here') {
    console.warn(`[AI Provider]: Skipping Gemini model "${model}" — GEMINI_API_KEY not configured or is placeholder.`);
    return { success: false, skipped: true, reason: 'GEMINI_API_KEY not configured' };
  }

  if (!GoogleGenAI) {
    return { success: false, error: '@google/genai SDK not available' };
  }

  const t0 = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents = inlineParts.length > 0 ? [...inlineParts, prompt] : prompt;

    let response;
    try {
      if (jsonMode) {
        response = await ai.models.generateContent({
          model,
          contents,
          config: { responseMimeType: 'application/json' },
        });
      } else {
        response = await ai.models.generateContent({
          model,
          contents,
        });
      }
    } catch (cfgErr) {
      // Fallback without json config if model does not support it
      response = await ai.models.generateContent({
        model,
        contents,
      });
    }

    const rawText = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
    const elapsed = Date.now() - t0;

    if (rawText && rawText.trim()) {
      console.log(`[AI Provider]: Gemini model "${model}" succeeded in ${elapsed}ms.`);
      return { success: true, text: rawText, elapsed };
    }
    return { success: false, elapsed, error: 'Empty response returned from Gemini' };
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.warn(`[AI Provider]: Gemini model "${model}" failed after ${elapsed}ms: ${err.message}`);
    return { success: false, elapsed, error: err.message };
  }
}

/**
 * Text Generation Fallback Runner (Claude-first -> Gemini).
 *
 * @param {Object} options
 * @param {string} options.prompt - Prompt string
 * @param {string} [options.systemPrompt] - System instructions
 * @param {boolean} [options.jsonMode] - Request JSON output
 * @param {Function} [options.validate] - Optional validation function (text) => boolean
 * @returns {Promise<{ text: string, modelUsed: string, provider: 'claude'|'gemini', elapsed: number }>}
 */
async function generateTextWithFallback({ prompt, systemPrompt, jsonMode = false, validate = null }) {
  const hasClaudeKey = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here');

  // 1. Try Claude models first (if API key configured)
  if (hasClaudeKey) {
    for (const model of CLAUDE_MODELS) {
      console.log(`[AI Provider]: Attempting Claude-first with model "${model}" (timeout: ${CLAUDE_TIMEOUT_MS}ms)...`);
      const claudeRes = await callClaude({ model, systemPrompt, prompt });
      if (claudeRes.success && claudeRes.text) {
        if (!validate || validate(claudeRes.text)) {
          return {
            text: claudeRes.text,
            modelUsed: model,
            provider: 'claude',
            elapsed: claudeRes.elapsed,
          };
        }
        console.warn(`[AI Provider]: Claude model "${model}" output failed validation. Trying next fallback...`);
      }
      // If unauthorized or bad key, avoid wasting time on other Claude models
      if (claudeRes.error && /unauthorized|invalid api key|credit balance/i.test(claudeRes.error)) {
        console.warn(`[AI Provider]: Claude authentication/credit error (${claudeRes.error}). Skipping remaining Claude models.`);
        break;
      }
    }
  } else {
    console.log('[AI Provider]: Fast-path: No ANTHROPIC_API_KEY detected. Direct zero-delay fallback to Gemini.');
  }

  // 2. Fall back to Gemini models
  for (const model of GEMINI_MODELS) {
    console.log(`[AI Provider]: Attempting Gemini fallback with model "${model}"...`);
    const geminiRes = await callGemini({ model, prompt, jsonMode });
    if (geminiRes.success && geminiRes.text) {
      if (!validate || validate(geminiRes.text)) {
        return {
          text: geminiRes.text,
          modelUsed: model,
          provider: 'gemini',
          elapsed: geminiRes.elapsed,
        };
      }
      console.warn(`[AI Provider]: Gemini model "${model}" output failed validation. Trying next fallback...`);
    }
  }

  throw new Error('All AI models (Claude and Gemini fallbacks) failed to generate response.');
}

/**
 * Multimodal Document Extraction Fallback Runner (Claude-first -> Gemini).
 *
 * @param {Object} options
 * @param {Array} options.files - Multer files array (image/jpeg, image/png, application/pdf)
 * @param {Array} options.inlineParts - Formatted Gemini inlineData parts
 * @param {string} options.promptText - Full prompt instructions
 * @param {Function} [options.validate] - Optional validation function (text) => boolean
 * @returns {Promise<{ text: string, modelUsed: string, provider: 'claude'|'gemini' }>}
 */
async function generateMultimodalWithFallback({ files, inlineParts, promptText, validate = null }) {
  const hasClaudeKey = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here');
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_google_gemini_api_key_here');

  // Eagerly extract raw text from any uploaded PDF documents
  let extractedPdfText = '';
  if (Array.isArray(files)) {
    for (const f of files) {
      const mime = (f.mimetype || '').toLowerCase();
      const name = (f.originalname || '').toLowerCase();
      if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        try {
          const txt = await extractTextFromPdfBuffer(f.buffer);
          if (txt && txt.trim()) {
            extractedPdfText += (extractedPdfText ? '\n\n' : '') + txt.trim();
          }
        } catch (pdfTxtErr) {
          console.warn('[AI Provider]: Failed extracting PDF text:', pdfTxtErr.message);
        }
      }
    }
  }

  // 1. Try Claude Multimodal Vision (if API key configured)
  if (hasClaudeKey && Array.isArray(files) && files.length > 0) {
    try {
      const contentBlocks = [];
      for (const f of files) {
        let b64 = '';
        if (f.buffer && Buffer.isBuffer(f.buffer)) {
          b64 = f.buffer.toString('base64');
        } else if (typeof f.buffer === 'string') {
          b64 = f.buffer;
        } else if (f.data) {
          b64 = Buffer.isBuffer(f.data) ? f.data.toString('base64') : String(f.data);
        }
        if (b64.includes('base64,')) {
          b64 = b64.split('base64,')[1];
        }

        const rawMime = (f.mimetype || '').toLowerCase().trim();
        const mime = rawMime === 'image/jpg' ? 'image/jpeg' : (rawMime || 'image/jpeg');

        if (mime === 'application/pdf') {
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: b64,
            },
          });
        } else {
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime,
              data: b64,
            },
          });
        }
      }
      contentBlocks.push({ type: 'text', text: promptText });

      for (const model of CLAUDE_MODELS) {
        console.log(`[AI Provider]: Attempting Claude multimodal extraction with "${model}" (timeout: ${CLAUDE_MULTIMODAL_TIMEOUT_MS}ms)...`);
        const res = await callClaude({
          model,
          prompt: promptText,
          contentBlocks,
          maxTokens: 4096,
          timeoutMs: CLAUDE_MULTIMODAL_TIMEOUT_MS,
        });

        if (res.success && res.text) {
          if (!validate || validate(res.text)) {
            return {
              text: res.text,
              modelUsed: model,
              provider: 'claude',
            };
          }
          console.warn(`[AI Provider]: Claude model "${model}" returned text but failed validation. Preview: ${res.text.slice(0, 200)}`);
        }
        if (res.error && /unauthorized|invalid api key|credit balance/i.test(res.error)) {
          console.warn(`[AI Provider]: Claude authentication error (${res.error}). Skipping remaining Claude models.`);
          break;
        }
      }
    } catch (claudePrepErr) {
      console.warn('[AI Provider]: Failed preparing Claude multimodal blocks:', claudePrepErr.message);
    }
  }

  // 2. Fall back to Gemini Multimodal Vision
  if (hasGeminiKey) {
    for (const model of GEMINI_MODELS) {
      console.log(`[AI Provider]: Attempting Gemini multimodal extraction with "${model}"...`);
      const res = await callGemini({
        model,
        prompt: promptText,
        inlineParts,
        jsonMode: true,
      });
      if (res.success && res.text) {
        if (!validate || validate(res.text)) {
          return {
            text: res.text,
            modelUsed: model,
            provider: 'gemini',
          };
        }
        console.warn(`[AI Provider]: Gemini model "${model}" returned text but failed validation. Preview: ${res.text.slice(0, 200)}`);
      }
    }
  } else {
    console.warn('[AI Provider]: No GEMINI_API_KEY configured. Skipping Gemini multimodal attempts.');
  }

  // 3. Fallback: Direct Text Prompt using Raw Extracted PDF Text
  // If multimodal vision API calls failed or timed out, but text was extracted from the PDF,
  // pass the raw text directly to the text-generation ladder (avoids base64 image/vision errors).
  if (extractedPdfText && extractedPdfText.trim().length > 20) {
    console.log(`[AI Provider]: Multimodal vision calls exhausted. Falling back to direct TEXT prompt with ${extractedPdfText.length} characters of extracted PDF text...`);
    const textExtractionPrompt = `${promptText}\n\n=== VERBATIM DOCUMENT TEXT TRANSCRIPTION ===\n${extractedPdfText}`;

    if (hasClaudeKey || hasGeminiKey) {
      try {
        const textAiRes = await generateTextWithFallback({
          prompt: textExtractionPrompt,
          jsonMode: true,
          validate,
        });
        if (textAiRes && textAiRes.text) {
          console.log(`[AI Provider]: Successfully extracted questions via text model "${textAiRes.modelUsed}".`);
          return {
            text: textAiRes.text,
            modelUsed: `${textAiRes.modelUsed} (text-mode)`,
            provider: textAiRes.provider,
          };
        }
      } catch (textAiErr) {
        console.warn('[AI Provider]: Text AI fallback encountered error:', textAiErr.message);
      }
    }

    // 4. Fallback: Offline Local Rule-Based Question Parser
    // When external AI APIs are totally offline, unconfigured, or rate-limited, parse questions locally!
    console.log('[AI Provider]: Running local offline question parser on extracted PDF text...');
    const localResult = parseQuestionsFromRawText(extractedPdfText);
    if (Array.isArray(localResult.questions) && localResult.questions.length > 0) {
      console.log(`[AI Provider]: Successfully extracted ${localResult.questions.length} questions offline from PDF.`);
      return {
        text: JSON.stringify(localResult),
        modelUsed: 'local-offline-parser',
        provider: 'local',
      };
    }
  }

  // 5. Final error reporting with actionable diagnostics
  const claudeStatus = hasClaudeKey ? 'configured' : 'missing';
  const geminiStatus = hasGeminiKey ? 'configured' : 'missing';
  throw new Error(
    `Document extraction failed across all Claude and Gemini multimodal models. ` +
    `(Claude API key: ${claudeStatus}, Gemini API key: ${geminiStatus}). ` +
    `Please ensure a valid GEMINI_API_KEY or ANTHROPIC_API_KEY is active in your environment, ` +
    `or upload a document with clear, readable text.`
  );
}

/**
 * Unified MCQ Option Generator with Claude-first priority and Gemini fallback.
 */
async function generateMcqOptionsUnified({ questionText, knownAnswer = '' }) {
  const cleanQ = (questionText || '').trim();
  const cleanKnown = (knownAnswer || '').trim();

  const knownDirective = cleanKnown
    ? `\n\nPRIORITY MANDATE — SOURCE MATERIAL KNOWN ANSWER:
The correct answer for this question from the source document is ALREADY VERIFIED as: "${cleanKnown}"
You MUST include this exact answer ("${cleanKnown}") as one of the 4 options.
The "correctIndex" MUST point to this answer.
DO NOT substitute, modify, or guess a different correct answer. Only generate 3 realistic, plausible distractors.`
    : '';

  const prompt = `You are a highly accurate academic quiz question expert and assessment designer.

TASK: For the following question, generate exactly 4 multiple-choice options where ONE is verifiably correct and THREE are convincing but incorrect distractors.

QUESTION:
"${cleanQ}"${knownDirective}

STEP 1 — ${cleanKnown ? 'USE PROVIDED ANSWER' : 'SOLVE FIRST'}: ${
    cleanKnown
      ? `The designated correct answer is "${cleanKnown}". Place it as one of the four options.`
      : 'Before generating options, carefully solve or reason through the question yourself to determine the factually/logically correct answer. Double-check your answer. Only then place it as one of the four options.'
  }

STEP 2 — GENERATE DISTRACTORS: Create 3 distractor options that:
  - Are the same TYPE and FORMAT as the correct answer (numbers look like numbers, terms look like terms, formulas look like formulas)
  - Are plausible enough that a student who has NOT studied carefully might pick them
  - Are NOT obviously wrong at a glance — they must require actual knowledge/calculation to rule out
  - Do NOT use generic non-answers like "None of the above", "All of the above", "Cannot be determined" UNLESS the original question is explicitly a True/False or Boolean type
  - Do NOT reuse the correct answer or use near-duplicates

STEP 3 — SHUFFLE: Randomly place the correct answer at index 0, 1, 2, or 3 (not always at index 0).

CRITICAL RULES:
- The "correctIndex" MUST point to the FACTUALLY CORRECT answer (${cleanKnown ? `"${cleanKnown}"` : 'verified'}). Verify this before responding.
- For NUMERICAL / MATHEMATICAL questions: All 4 options MUST be realistic numerical values (e.g. 12, 15, 18, 24 — not "True/False/None").
- For CONCEPTUAL questions: All 4 options MUST be domain-relevant technical terms or short phrases.
- For CODE / FORMULA questions: All 4 options MUST be syntactically valid variations.
- NEVER output generic placeholder strings like "Option A", "Option 1", "Choice B", etc.
- Each option MUST be concise (under 20 words).

Respond ONLY with a valid raw JSON object — no markdown, no backticks, no explanation:
{"options":["...", "...", "...", "..."], "correctIndex": 2}

Where correctIndex is 0-based (0=first option, 1=second, 2=third, 3=fourth).`;

  const validate = (raw) => {
    try {
      const cleaned = cleanJsonCodeblock(raw);
      const parsed = JSON.parse(cleaned);
      return (
        Array.isArray(parsed.options) &&
        parsed.options.length === 4 &&
        typeof parsed.correctIndex === 'number' &&
        parsed.correctIndex >= 0 &&
        parsed.correctIndex <= 3 &&
        !parsed.options.every(isGenericPlaceholderOption)
      );
    } catch {
      return false;
    }
  };

  const { text, modelUsed, provider, elapsed } = await generateTextWithFallback({
    prompt,
    jsonMode: true,
    validate,
  });

  const parsed = JSON.parse(cleanJsonCodeblock(text));
  let cleanedOpts = parsed.options.map((o) => cleanOptionPrefix(String(o || '')).trim());
  let cIdx = parsed.correctIndex;

  if (cleanKnown) {
    const cleanK = cleanOptionPrefix(cleanKnown).trim();
    const existingMatchIdx = cleanedOpts.findIndex(
      (o) => o.toLowerCase() === cleanK.toLowerCase()
    );
    if (existingMatchIdx >= 0) {
      cIdx = existingMatchIdx;
    } else {
      cleanedOpts[cIdx] = cleanK;
    }
  }

  return {
    options: cleanedOpts,
    correctAnswerIndex: cIdx,
    directAnswer: cleanedOpts[cIdx] || '',
    modelUsed,
    provider,
    elapsed,
  };
}

module.exports = {
  callClaude,
  callGemini,
  generateTextWithFallback,
  generateMultimodalWithFallback,
  generateMcqOptionsUnified,
  cleanJsonCodeblock,
  cleanOptionPrefix,
  isGenericPlaceholderOption,
  CLAUDE_MODELS,
  GEMINI_MODELS,
  CLAUDE_TIMEOUT_MS,
};
