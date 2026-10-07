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

    // Level assignment (1 to 4 distributed)
    const level = (i % 4) + 1;

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
    questions,
  };
}

module.exports = {
  extractTextFromPdfBuffer,
  parseQuestionsFromRawText,
};
