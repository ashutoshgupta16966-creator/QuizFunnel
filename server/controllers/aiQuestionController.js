const Question = require('../models/Question');
const { sanitizeMcqOptions } = require('./aiVisionController');

let GoogleGenAI;
try {
  const genaiPkg = require('@google/genai');
  GoogleGenAI = genaiPkg.GoogleGenAI;
} catch {
  console.log('[AI Question Generator]: @google/genai package loading optional');
}

// Gemini Model Fallback Ladder (gemini-3.6-flash primary with gemini-3.5-flash-lite fallback, 3.x series)
const FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
];

/**
 * Generates dynamic quiz questions using Google Gemini API based on topic & difficulty level.
 * Automatically inserts newly generated questions into MongoDB.
 * Fallback: If Gemini API fails or exceeds quota/rate-limits, falls back gracefully
 * to fetching existing questions from MongoDB using $sample aggregation.
 */
async function generateAndPopulateQuestions({ topic, difficultyLevel, count = 5 }) {
  const levelNum = parseInt(difficultyLevel, 10) || 1;
  const targetCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);
  const topicName = topic || 'Technical & General Aptitude';

  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey && apiKey !== 'your_google_gemini_api_key_here' && GoogleGenAI) {
    try {
      console.log(`[AI Question Generator]: Generating ${targetCount} Level ${levelNum} questions for topic '${topicName}' via Gemini API...`);

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a world-class academic quiz question author and assessment designer for college students.
Generate exactly ${targetCount} multiple-choice quiz questions for Level ${levelNum} candidates.
Topic/Subject: ${topicName}.

OUTPUT FORMAT:
Return ONLY a raw, valid JSON array of objects. Do NOT use markdown code blocks, backticks, or any conversational prose.
JSON Structure:
[
  {
    "questionText": "What is the time complexity of searching an element in a balanced binary search tree?",
    "options": ["O(log n)", "O(n)", "O(n log n)", "O(1)"],
    "correctAnswerIndex": 0,
    "section": "Technical",
    "difficulty": "medium"
  }
]

STRICT ACCURACY & DISTRACTOR RULES:
1. 100% FACTUAL & LOGICAL ACCURACY: The marked correct answer ("correctAnswerIndex") MUST be strictly verified as factually and logically correct with 100% accuracy. NEVER mark an incorrect or inaccurate option as correct.
2. EXACT SOLVE MATCHING: If a question is mathematical, numerical, or computational, solve it step-by-step first. The correct answer must exactly match what a correct solve produces (accounting for standard equivalent representations) — never an approximate, inaccurate, or guessed value.
3. REALISTIC & PLAUSIBLE DISTRACTORS: For every question, the 3 incorrect options must NOT be random, nonsensical, or obviously wrong at a glance. They must look like plausible, realistic answers that require actually solving or reading the question carefully to rule out. Distractors must match the exact structure, format, style, and magnitude of the correct option (e.g. if the answer is a numerical value, all 4 choices must be plausible numerical values; if the answer is a technical definition or protocol, all 4 choices must be relevant domain terms).
4. MANDATORY PRE-RESPONSE DOUBLE-CHECK: You MUST double-check your own correct answer against each question text before finalizing the JSON. Verify that "correctAnswerIndex" points precisely to the correct choice.
5. NEVER output generic placeholder strings like "Option A", "Option B", "Option C", "Option D", "None of the above", or "All of the above".
6. "correctAnswerIndex" MUST be an integer between 0 and 3. Shuffle the correct answer position randomly across indices 0, 1, 2, and 3.
7. "section" MUST be one of: ["GK", "Technical", "Reasoning", "Aptitude", "Mixed"].
8. "difficulty" MUST be "easy", "medium", or "hard".
9. Level is ${levelNum}. Make question complexity appropriate for Level ${levelNum}.`;

      let rawText = '';
      for (const modelName of FALLBACK_MODELS) {
        try {
          console.log(`[AI Question Generator]: Trying model "${modelName}"...`);
          let response;
          try {
            response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: { responseMimeType: 'application/json' },
            });
          } catch (cfgErr) {
            response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
            });
          }
          rawText = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
          if (rawText && rawText.trim()) {
            console.log(`[AI Question Generator]: Succeeded with model "${modelName}".`);
            break;
          }
        } catch (modelErr) {
          console.warn(`[AI Question Generator]: Model "${modelName}" failed (${modelErr.message}). Trying next fallback model...`);
        }
      }

      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      const parsedArray = JSON.parse(cleaned);

      if (Array.isArray(parsedArray) && parsedArray.length > 0) {
        const validDocs = [];
        for (const item of parsedArray) {
          if (
            item.questionText &&
            Array.isArray(item.options) &&
            Number.isInteger(item.correctAnswerIndex)
          ) {
            const sec = ['GK', 'Technical', 'Reasoning', 'Aptitude', 'Mixed'].includes(item.section)
              ? item.section
              : 'Technical';
            const sanitized = sanitizeMcqOptions(item.questionText, item.options, '', item.correctAnswerIndex, sec);

            validDocs.push({
              level: levelNum,
              section: sec,
              questionText: item.questionText.trim(),
              options: sanitized.options,
              correctAnswerIndex: sanitized.correctAnswerIndex,
              difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty)
                ? item.difficulty
                : 'medium',
            });
          }
        }

        if (validDocs.length > 0) {
          const inserted = await Question.insertMany(validDocs);
          console.log(`[AI Question Generator]: Successfully inserted ${inserted.length} generated questions into MongoDB.`);
          return {
            success: true,
            source: 'gemini-ai',
            count: inserted.length,
            message: `Successfully generated and stored ${inserted.length} questions via Gemini API.`,
            questions: inserted,
          };
        }
      }
    } catch (aiErr) {
      console.warn(`[AI Question Generator Warning]: Gemini API error (${aiErr.message}). Falling back to MongoDB $sample...`);
    }
  } else {
    console.log('[AI Question Generator]: Gemini API key missing or inactive. Falling back to MongoDB $sample...');
  }

  // ── FALLBACK MECHANISM: Fetch existing questions from MongoDB using $sample ──
  const fallbackQuestions = await Question.aggregate([
    { $match: { level: levelNum } },
    { $sample: { size: targetCount } },
  ]);

  return {
    success: true,
    source: 'database-fallback',
    count: fallbackQuestions.length,
    message: fallbackQuestions.length > 0
      ? `Retrieved ${fallbackQuestions.length} existing questions from database (AI Fallback).`
      : 'No existing questions found for this level in database.',
    questions: fallbackQuestions,
  };
}

module.exports = { generateAndPopulateQuestions };
