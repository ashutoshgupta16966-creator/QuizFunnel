/**
 * LEVEL CONFIGURATION — Single source of truth.
 * Change timers, cutoffs, and question counts here.
 * Keep this in sync with client/src/config.js.
 */

/**
 * Calculates the passing cutoff for a given level question count using
 * the exact reference table and generic cutoff rules.
 *
 * Generic rules:
 * - 2 questions  → cutoff 2 (both must be correct)
 * - 4 questions  → cutoff 3
 * - 5 questions  → cutoff 3 (multi-level) / cutoff 4 (single-level 5-question quiz)
 * - 6 questions  → cutoff 4
 * - 7 questions  → cutoff 5
 * - 8..10 qs     → cutoff 7
 * - 15 questions → cutoff 10
 * - 20 questions → cutoff 15
 *
 * @param {number} count - Number of questions in the level.
 * @param {boolean} isSingleLevelQuizOf5 - True if the entire quiz is only 5 questions.
 * @returns {number} Passing cutoff.
 */
function getGenericCutoff(count, isSingleLevelQuizOf5 = false) {
  const n = parseInt(count, 10);
  if (isNaN(n) || n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 5 && isSingleLevelQuizOf5) return 4;
  if (n === 2) return 2;
  if (n === 3) return 2;
  if (n === 4) return 3;
  if (n === 5) return 3;
  if (n === 6) return 4;
  if (n === 7) return 5;
  if (n >= 8 && n <= 10) return 7;
  if (n < 15) return 7 + Math.round((n - 10) * ((10 - 7) / (15 - 10)));
  if (n === 15) return 10;
  if (n < 20) return 10 + Math.round((n - 15) * ((15 - 10) / (20 - 15)));
  if (n === 20) return 15;
  return Math.min(n, Math.max(15, Math.round(n * 0.75)));
}

/**
 * Returns tier caps for question distribution based on the total question count.
 * Matches reference table caps and expands for totals > 50.
 *
 * @param {number} total - Total questions in the quiz.
 * @returns {number[]} Array of caps for each level.
 */
function getTierCaps(total) {
  const n = parseInt(total, 10);
  if (isNaN(n) || n <= 0) return [];
  if (n <= 5) return [n];
  if (n <= 10) return [4, 4, 2];
  if (n <= 15) return [8, 5, 2];
  if (n <= 20) return [10, 5, 5];
  if (n <= 25) return [15, 5, 5];
  if (n <= 30) return [15, 10, 5];
  if (n <= 35) return [20, 10, 5];
  if (n <= 40) return [20, 15, 5];
  if (n <= 45) return [20, 15, 10];
  if (n <= 50) return [20, 15, 10, 5];

  // Totals > 50:
  // When Level 4 reaches 10 questions (totals 51..55): [20, 15, 10, 10]
  if (n <= 55) return [20, 15, 10, 10];
  // Totals 56..60: Level 1 expands by +5 (20 -> 25)
  if (n <= 60) return [25, 15, 10, 10];
  // Totals 61..65: Level 3 expands by +5 (10 -> 15)
  if (n <= 65) return [25, 15, 15, 10];

  // Continue proportional expansion as totals grow further (priority: L1 +5, L3 +5, L4 +5)
  let l1 = 25, l2 = 15, l3 = 15, l4 = 10;
  let remaining = n - 65;
  let cycle = 0;
  while (remaining > 0) {
    if (cycle % 3 === 0) l1 += 5;
    else if (cycle % 3 === 1) l3 += 5;
    else l4 += 5;
    remaining -= 5;
    cycle++;
  }
  return [l1, l2, l3, l4];
}

/**
 * Calculates quiz structure (number of levels, question count per level, and cutoffs)
 * based on total question count.
 *
 * @param {number} totalQuestions
 * @returns {{ totalQuestions: number, totalLevels: number, levels: Array<{ level: number, questions: number, cutoff: number, timeSeconds: number, label: string }> }}
 */
function calculateQuizStructure(totalQuestions) {
  const total = parseInt(totalQuestions, 10);
  if (isNaN(total) || total <= 0) {
    return { totalQuestions: 0, totalLevels: 0, levels: [] };
  }
  if (total <= 5) {
    const cutoff = getGenericCutoff(total, total === 5);
    return {
      totalQuestions: total,
      totalLevels: 1,
      levels: [
        {
          level: 1,
          questions: total,
          cutoff,
          timeSeconds: Math.max(180, total * 60),
          label: 'Level 1',
        },
      ],
    };
  }

  const caps = getTierCaps(total);
  let remaining = total;
  const levels = [];

  for (let i = 0; i < caps.length; i++) {
    if (remaining <= 0) break;
    const cap = caps[i];
    const count = Math.min(cap, remaining);
    remaining -= count;
    levels.push({
      level: i + 1,
      questions: count,
      cutoff: getGenericCutoff(count, false),
      timeSeconds: Math.max(180, count * 60),
      label: `Level ${i + 1}`,
    });
  }

  if (remaining > 0 && levels.length > 0) {
    const last = levels[levels.length - 1];
    last.questions += remaining;
    last.cutoff = getGenericCutoff(last.questions, false);
  }

  return {
    totalQuestions: total,
    totalLevels: levels.length,
    levels,
  };
}

/**
 * Distributes an array of questions across levels according to calculated quiz structure.
 * Sets question.level for each item.
 *
 * @param {Array} questions - Array of question objects.
 * @returns {Array} Questions with level assigned.
 */
function distributeQuestionsAcrossLevels(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }
  const structure = calculateQuizStructure(questions.length);
  let currentIndex = 0;
  const distributed = [];

  for (const lvl of structure.levels) {
    const chunk = questions.slice(currentIndex, currentIndex + lvl.questions);
    for (const q of chunk) {
      if (typeof q === 'object' && q !== null) {
        distributed.push({
          ...q,
          level: lvl.level,
        });
      } else {
        distributed.push(q);
      }
    }
    currentIndex += lvl.questions;
  }

  while (currentIndex < questions.length) {
    const q = questions[currentIndex];
    const lastLvl = structure.totalLevels || 1;
    if (typeof q === 'object' && q !== null) {
      distributed.push({
        ...q,
        level: lastLvl,
      });
    } else {
      distributed.push(q);
    }
    currentIndex++;
  }

  return distributed;
}

function calculateDefaultCutoff(count) {
  return getGenericCutoff(count, false);
}

module.exports = {
  1: {
    questions: 20,         // total questions in this level
    cutoff: 15,            // minimum correct to advance
    timeSeconds: 900,      // 15 minutes
    sections: ['GK', 'Technical', 'Reasoning', 'Aptitude'],
    questionsPerSection: 5,
    label: 'Level 1 — Foundation',
  },
  2: {
    questions: 15,
    cutoff: 10,            // minimum correct to advance
    timeSeconds: 600,      // 10 minutes
    sections: ['Technical', 'Reasoning', 'Aptitude'],
    questionsPerSection: 5,
    label: 'Level 2 — Intermediate',
  },
  3: {
    questions: 10,
    cutoff: 6,             // minimum correct to advance (6/10 = 60%)
    timeSeconds: 480,      // 8 minutes
    sections: ['Technical', 'Reasoning'],
    questionsPerSection: 5,
    label: 'Level 3 — Advanced',
  },
  4: {
    questions: 5,
    cutoff: 0,             // no cutoff — final ranking decides selection
    timeSeconds: 300,      // 5 minutes
    sections: ['Mixed'],
    questionsPerSection: 5,
    label: 'Level 4 — Final Round',
  },
  calculateDefaultCutoff,
  getGenericCutoff,
  getTierCaps,
  calculateQuizStructure,
  distributeQuestionsAcrossLevels,
};
