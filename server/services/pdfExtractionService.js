/**
 * pdfExtractionService.js
 * Robust PDF text extraction and offline/local fallback question parser.
 *
 * Capabilities:
 * 1. Extract raw text from PDF buffer using pdf-parse (with multi-version compatibility).
 * 2. Intelligent local regex-based question extraction for MCQ and Direct question formats.
 * 3. Serves as a zero-failure fallback when AI multimodal APIs (Claude/Gemini) are unavailable,
 *    rate-limited (429), or missing API keys.
 */

let pdfPkg = null;
try {
  pdfPkg = require('pdf-parse');
} catch (e) {
  console.warn('[pdfExtractionService]: pdf-parse package not loaded:', e.message);
}

const { distributeQuestionsAcrossLevels } = require('../config/levels');

/**
 * Extracts raw textual content from an uploaded PDF file buffer.
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<string>} Clean text content of the PDF.
 */
async function extractTextFromPdfBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return '';
  }

  // 1. Try pdf-parse
  if (pdfPkg) {
    try {
      if (typeof pdfPkg === 'function') {
        const data = await pdfPkg(buffer);
        if (data && data.text) return data.text.trim();
      } else if (pdfPkg.PDFParse) {
        const parser = new pdfPkg.PDFParse({ data: buffer });
        const res = await parser.getText();
        if (res && res.text) return res.text.trim();
      }
    } catch (parseErr) {
      console.warn('[pdfExtractionService]: pdf-parse failed:', parseErr.message);
    }
  }

  // 2. Fallback: stream text extraction from buffer (for simple text streams in PDF)
  try {
    const rawString = buffer.toString('latin1');
    const textMatches = [];
    const streamRegex = /BT\s+([\s\S]*?)\s+ET/g;
    let match;
    while ((match = streamRegex.exec(rawString)) !== null) {
      const block = match[1];
      const tjRegex = /\((.*?)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textMatches.push(tjMatch[1]);
      }
    }
    if (textMatches.length > 0) {
      return textMatches.join(' ').replace(/\s+/g, ' ').trim();
    }
  } catch (rawErr) {
    console.warn('[pdfExtractionService]: Buffer stream extraction fallback failed:', rawErr.message);
  }

  return '';
}

/**
 * Clean option prefix from string (e.g. "A. Paris" -> "Paris", "(b) 42" -> "42")
 */
function cleanPrefix(str) {
  if (!str) return '';
  return str.replace(/^(\(?[a-dA-D1-4]\)?\s*[:.)-]\s*|^option\s*[a-dA-D1-4]\s*[:.)-]\s*)/i, '').trim();
}

/**
 * Intelligently parses raw document text into structured quiz questions.
 * Handles:
 *  - Numbered questions: "1.", "Q1:", "Question 1)", etc.
 *  - Options: "A.", "B.", "(a)", "1)", etc.
 *  - Answer keys: "Answer: B", "Ans: (c)", "Correct Answer: London", etc.
 *  - Direct questions: questions without choices.
 *
 * @param {string} text - Raw document text.
 * @returns {{ subject: string, unit: string, questions: Array }}
 */
function parseQuestionsFromRawText(text) {
  if (!text || typeof text !== 'string') {
    return { subject: 'Extracted Quiz', unit: 'Chapter 1', questions: [] };
  }

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanText.split('\n').map((l) => l.trim()).filter(Boolean);

  // Attempt to detect Subject and Unit from top header lines
  let subject = 'General Assessment';
  let unit = 'Unit 1';
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    if (/subject\s*[:=-]\s*(.+)/i.test(line)) {
      subject = line.match(/subject\s*[:=-]\s*(.+)/i)[1].trim();
    } else if (/unit|chapter|topic\s*[:=-]\s*(.+)/i.test(line)) {
      unit = line.match(/(?:unit|chapter|topic)\s*[:=-]\s*(.+)/i)[1].trim();
    }
  }

  // Regex for question starters: "1.", "1)", "Q1.", "Q1:", "Question 1:", "(1)"
  const qStartRegex = /^(?:q(?:uestion)?\s*\.?\s*)?\(?(\d{1,3})\)?\s*[:.)-]\s*(.+)/i;
  // Regex for option lines: "A.", "A)", "(A)", "[A]", "a."
  const optRegex = /^(?:\(?([a-dA-D1-4])\)?\s*[:.)-]\s*|option\s*([a-dA-D1-4])\s*[:.)-]\s*)(.+)/i;
  // Regex for inline answer: "Answer: B", "Ans: A", "Correct: Paris"
  const ansRegex = /^(?:answer|ans|correct\s*answer|key)\s*[:=-]\s*(.+)/i;
  // Regex for explanation: "Explanation: ...", "Exp: ...", "Solution: ..."
  const expRegex = /^(?:explanation|exp|rationale|solution|sol)\s*[:=-]\s*(.+)/i;

  const rawBlocks = [];
  let currentBlock = null;

  for (const line of lines) {
    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      if (currentBlock) rawBlocks.push(currentBlock);
      currentBlock = {
        number: parseInt(qMatch[1], 10),
        questionLines: [qMatch[2].trim()],
        options: [],
        detectedAnswer: '',
        explanation: '',
      };
      continue;
    }

    if (!currentBlock) {
      continue;
    }

    // Check if line is an explanation
    const expMatch = line.match(expRegex);
    if (expMatch) {
      currentBlock.explanation = expMatch[1].trim();
      continue;
    }

    // Check if line is an answer key indicator
    const aMatch = line.match(ansRegex);
    if (aMatch) {
      currentBlock.detectedAnswer = aMatch[1].trim();
      continue;
    }

    // Check if line has horizontal multiple options: "A. Berlin  B. Madrid  C. Paris  D. Rome"
    const horizontalMatches = Array.from(
      line.matchAll(/(?:(?:\(?([A-Da-d1-4])\)?\s*[:.)-]\s*)([\s\S]+?))(?=(?:\s+\(?[A-Da-d1-4]\)?\s*[:.)-])|$)/g)
    );
    if (horizontalMatches.length >= 2) {
      for (const hm of horizontalMatches) {
        currentBlock.options.push({ letter: hm[1].toUpperCase(), text: hm[2].trim() });
      }
      continue;
    }

    // Check if line is a single option
    const oMatch = line.match(optRegex);
    if (oMatch) {
      const optLetter = (oMatch[1] || oMatch[2]).toUpperCase();
      const optText = oMatch[3].trim();
      currentBlock.options.push({ letter: optLetter, text: optText });
      continue;
    }

    // Otherwise append line to either last option or question text
    if (currentBlock.options.length > 0) {
      const lastOpt = currentBlock.options[currentBlock.options.length - 1];
      lastOpt.text += ` ${line}`;
    } else {
      currentBlock.questionLines.push(line);
    }
  }
  if (currentBlock) {
    rawBlocks.push(currentBlock);
  }

  // ── Section-Heading Detection ────────────────────────────────────────────
  // Scan for explicit group/part/section headings in the raw text before parsing
  // individual questions. Each heading defines a level for all questions that follow
  // until the next heading (PATH A from the AI prompt rules).
  //
  // Examples matched:
  //   "Section A: Traffic Rules (20 MCQs)" → level 1 (first heading)
  //   "Part 2 — Intermediate"              → level 2 (second heading)
  //   "Advanced Questions: 15 MCQs"        → level 2
  //   "Level 3: Expert Round"              → level 3
  //   "Expert / Hard Questions"            → level 3

  const sectionHeadingRegex = /^(?:section|part|round|group|level|set|block)\s*[:\-–]?\s*(?:[a-z0-9]+\s*[:\-–]?\s*)?.{0,60}$/i;
  const difficultyKeywords = {
    1: /\b(basic|standard|foundation|easy|beginner|general|introduction|simple|fundamental|level\s*1|section\s*[a1]|part\s*[a1])\b/i,
    2: /\b(intermediate|moderate|medium|average|standard|level\s*2|section\s*[b2]|part\s*[b2])\b/i,
    3: /\b(advanced|hard|difficult|expert|complex|level\s*3|section\s*[c3]|part\s*[c3])\b/i,
    4: /\b(final|hardest|toughest|challenging|level\s*4|section\s*[d4]|part\s*[d4]|expert\s*final)\b/i,
  };

  // Build a map: questionNumber → level, based on section headings in the raw text
  const questionLevelMap = {};
  let currentSectionLevel = null;
  let sectionOrder = 0; // increments on each new heading found (1st→L1, 2nd→L2, …)

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Skip lines that match question starters (they are questions, not headings)
    if (qStartRegex.test(trimmed)) continue;

    // A line qualifies as a section heading if it looks like a header
    // (no leading question number, not an option line, reasonably short)
    const isLikelyHeading =
      !optRegex.test(trimmed) &&
      !ansRegex.test(trimmed) &&
      !expRegex.test(trimmed) &&
      trimmed.length < 120 &&
      sectionHeadingRegex.test(trimmed);

    if (isLikelyHeading) {
      // Try to detect difficulty level from the heading text
      let detectedLevel = null;
      for (const [lvl, rx] of Object.entries(difficultyKeywords)) {
        if (rx.test(trimmed)) { detectedLevel = parseInt(lvl, 10); break; }
      }
      if (detectedLevel === null) {
        // No keyword match — assign based on ordinal position of this heading
        sectionOrder++;
        detectedLevel = Math.min(4, sectionOrder);
      } else {
        sectionOrder = Math.max(sectionOrder, detectedLevel);
      }
      currentSectionLevel = detectedLevel;
    }

    // Tag the most-recent question block with this section's level
    if (currentSectionLevel !== null && rawBlocks.length > 0) {
      const lastBlock = rawBlocks[rawBlocks.length - 1];
      if (lastBlock && questionLevelMap[lastBlock.number] === undefined) {
        questionLevelMap[lastBlock.number] = currentSectionLevel;
      }
    }
  }

  // Also tag any blocks added after the final line was parsed
  if (currentBlock) {
    rawBlocks.push(currentBlock);
  }
  if (currentSectionLevel !== null) {
    for (const block of rawBlocks) {
      if (questionLevelMap[block.number] === undefined) {
        questionLevelMap[block.number] = currentSectionLevel;
      }
    }
  }

  const hasSectionHeadings = Object.keys(questionLevelMap).length > 0;

  // Build structured questions matching QuestionSchema
  const questions = [];
  const letterToIndex = { A: 0, B: 1, C: 2, D: 3, 1: 0, 2: 1, 3: 2, 4: 3 };

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];
    const qText = block.questionLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!qText || qText.length < 3) continue;

    const isMcq = block.options.length >= 2;
    const cleanOpts = block.options.map((o) => cleanPrefix(o.text)).filter(Boolean);

    // Pad options to 4 if between 2 and 3
    if (isMcq) {
      while (cleanOpts.length < 4) {
        cleanOpts.push(`Option ${String.fromCharCode(65 + cleanOpts.length)}`);
      }
    }

    // Resolve correct answer index
    let correctIdx = 0;
    let directAns = block.detectedAnswer || '';

    if (block.detectedAnswer) {
      const ansUpper = block.detectedAnswer.toUpperCase();
      const letterMatch = ansUpper.match(/\b([A-D])\b/);
      if (letterMatch && letterToIndex[letterMatch[1]] !== undefined) {
        correctIdx = letterToIndex[letterMatch[1]];
        if (!directAns && cleanOpts[correctIdx]) {
          directAns = cleanOpts[correctIdx];
        }
      } else {
        // Answer is full text — find matching option
        const foundIdx = cleanOpts.findIndex((o) => o.toLowerCase() === block.detectedAnswer.toLowerCase());
        if (foundIdx !== -1) {
          correctIdx = foundIdx;
        }
      }
    }

    // ── Level assignment ─────────────────────────────────────────────────
    // PATH A: if section headings were detected, use the section-level map.
    // PATH B: fallback to distributing questions evenly across 4 levels.
    let level;
    if (hasSectionHeadings && questionLevelMap[block.number] !== undefined) {
      level = questionLevelMap[block.number]; // PATH A
    } else {
      level = (i % 4) + 1; // PATH B: round-robin (unchanged fallback)
    }

    questions.push({
      questionText: qText,
      questionType: isMcq ? 'mcq' : 'direct',
      options: isMcq ? cleanOpts.slice(0, 4) : [],
      correctAnswerIndex: isMcq ? Math.min(3, Math.max(0, correctIdx)) : -1,
      directAnswer: isMcq ? (cleanOpts[correctIdx] || '') : (directAns || 'Correct'),
      level,
      section: 'Technical',
      difficulty: level === 1 ? 'easy' : level <= 3 ? 'medium' : 'hard',
      explanation: block.explanation || (isMcq ? `Correct answer is: ${cleanOpts[correctIdx] || 'Option A'}` : `Correct answer: ${directAns || 'Confirmed'}`),
    });
  }

  return {
    subject,
    unit,
    questions: distributeQuestionsAcrossLevels(questions),
  };
}

module.exports = {
  extractTextFromPdfBuffer,
  parseQuestionsFromRawText,
};
