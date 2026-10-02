const Question = require('../models/Question');
const { sanitizeMcqOptions } = require('./aiVisionController');
const { generateTextWithFallback, cleanJsonCodeblock } = require('../services/aiProvider');

/**
 * Generates dynamic quiz questions using AI (Claude-first priority, falling back to Gemini).
 * Automatically inserts newly generated questions into MongoDB.
 * Fallback: If AI APIs fail or exceed quota, falls back gracefully
 * to fetching existing questions from MongoDB using $sample aggregation.
 */
async function generateAndPopulateQuestions({ topic, difficultyLevel, count = 5 }) {
  const levelNum = parseInt(difficultyLevel, 10) || 1;
  const targetCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);
  const topicName = topic || 'Technical & General Aptitude';

  const hasApiKey = Boolean(
    (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here') ||
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_google_gemini_api_key_here')
  );

  if (hasApiKey) {
    try {
      console.log(`[AI Question Generator]: Generating ${targetCount} Level ${levelNum} questions for topic '${topicName}' via AI Provider...`);

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

      const validate = (raw) => {
        try {
          const arr = JSON.parse(cleanJsonCodeblock(raw));
          return Array.isArray(arr) && arr.length > 0;
        } catch {
          return false;
        }
      };

      const { text, modelUsed, provider } = await generateTextWithFallback({
        prompt,
        jsonMode: true,
        validate,
      });

      const parsedArray = JSON.parse(cleanJsonCodeblock(text));

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
          console.log(`[AI Question Generator]: Successfully inserted ${inserted.length} generated questions into MongoDB (model: ${modelUsed}).`);
          return {
            success: true,
            source: `${provider}-ai`,
            modelUsed,
            count: inserted.length,
            message: `Successfully generated and stored ${inserted.length} questions via ${provider.toUpperCase()} (${modelUsed}).`,
            questions: inserted,
          };
        }
      }
    } catch (aiErr) {
      console.warn(`[AI Question Generator Warning]: AI generation error (${aiErr.message}). Falling back to MongoDB $sample...`);
    }
  } else {
    console.log('[AI Question Generator]: No active AI API keys configured. Falling back to MongoDB $sample...');
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
