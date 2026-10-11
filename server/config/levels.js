/**
 * LEVEL CONFIGURATION — Single source of truth.
 * Change timers, cutoffs, and question counts here.
 * Keep this in sync with client/src/config.js.
 */

/**
 * Calculates the smart default passing cutoff for a given question count.
 *
 * Anchor points (from product spec):
 *   n = 10  → cutoff = 7   (70%)
 *   n = 15  → cutoff = 10  (66.7%)
 *   n = 20  → cutoff = 15  (75%)
 *
 * Linear interpolation between anchors; extrapolation for n < 10 or n > 20.
 *
 * @param {number} count - Number of questions in the level.
 * @returns {number} Recommended passing cutoff.
 */
function calculateDefaultCutoff(count) {
  const n = parseInt(count, 10);
  if (isNaN(n) || n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 9)  return Math.min(n, Math.max(1, Math.round(n * 0.7)));  // ~70%
  if (n === 10) return 7;
  if (n < 15)  return 7 + Math.round((n - 10) * 0.6);                // 10→7, 15→10
  if (n === 15) return 10;
  if (n < 20)  return 10 + Math.round((n - 15) * 1.0);               // 15→10, 20→15
  if (n === 20) return 15;
  // n > 20: scale at ~73%, floor at 15
  return Math.min(n, Math.max(15, Math.round(n * 0.73)));
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
    timeSeconds: 720,      // 12 minutes
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
};
