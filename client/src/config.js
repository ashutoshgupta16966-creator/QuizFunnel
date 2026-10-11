/**
 * CLIENT-SIDE level configuration.
 * Keep in sync with server/config/levels.js.
 * Edit ONLY this file to change timers or labels.
 */
export const LEVELS = {
  1: {
    questions: 20,
    cutoff: 15,
    timeSeconds: 900,   // 15 min
    label: 'Level 1',
    sublabel: 'Foundation Round',
    sections: ['GK', 'Technical', 'Reasoning', 'Aptitude'],
  },
  2: {
    questions: 15,
    cutoff: 10,
    timeSeconds: 720,   // 12 min
    label: 'Level 2',
    sublabel: 'Intermediate Round',
    sections: ['Technical', 'Reasoning', 'Aptitude'],
  },
  3: {
    questions: 10,
    cutoff: 6,
    timeSeconds: 480,   // 8 min
    label: 'Level 3',
    sublabel: 'Advanced Round',
    sections: ['Technical', 'Reasoning'],
  },
  4: {
    questions: 5,
    cutoff: 0,
    timeSeconds: 300,   // 5 min
    label: 'Level 4',
    sublabel: 'Final Round',
    sections: ['Mixed'],
  },
};

export const TOTAL_LEVELS = 4;
export const BRANCHES = ['CSE', 'CSE-AIML', 'MBA'];

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
export function calculateDefaultCutoff(count) {
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
