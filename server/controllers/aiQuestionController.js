const Question = require('../models/Question');

let GoogleGenAI;
try {
  const genaiPkg = require('@google/genai');
  GoogleGenAI = genaiPkg.GoogleGenAI;
} catch {
  console.log('[AI Question Generator]: @google/genai package loading optional');
}

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
      const prompt = `You are an expert quiz question author for college students.
Generate exactly ${targetCount} multiple-choice quiz questions for Level ${levelNum} candidates.
Topic/Subject: ${topicName}.

OUTPUT FORMAT:
Return ONLY a raw, valid JSON array of objects. Do NOT use markdown styling, backticks, or any conversational text.
JSON Structure:
[
  {
    "questionText": "Question text string?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswerIndex": 0,
    "section": "Technical",
    "difficulty": "medium"
  }
]

RULES:
1. "options" MUST be an array of exactly 4 non-empty strings.
2. "correctAnswerIndex" MUST be an integer between 0 and 3 (index of correct option).
3. "section" MUST be one of: ["GK", "Technical", "Reasoning", "Aptitude", "Mixed"].
4. "difficulty" MUST be "easy", "medium", or "hard".
5. Level is ${levelNum}. Make question complexity appropriate for Level ${levelNum}.`;

      let rawText = '';
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        rawText = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
      } catch {
        const response = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: prompt,
        });
        rawText = response.text || (response.candidates && response.candidates[0]?.content?.parts[0]?.text) || '';
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
            item.options.length === 4 &&
            Number.isInteger(item.correctAnswerIndex) &&
            item.correctAnswerIndex >= 0 &&
            item.correctAnswerIndex <= 3
          ) {
            validDocs.push({
              level: levelNum,
              section: ['GK', 'Technical', 'Reasoning', 'Aptitude', 'Mixed'].includes(item.section)
                ? item.section
                : 'Technical',
              questionText: item.questionText.trim(),
              options: item.options.map((o) => String(o).trim()),
              correctAnswerIndex: item.correctAnswerIndex,
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
