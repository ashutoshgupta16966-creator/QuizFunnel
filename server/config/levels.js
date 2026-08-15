/**
 * LEVEL CONFIGURATION — Single source of truth.
 * Change timers, cutoffs, and question counts here.
 * Keep this in sync with client/src/config.js.
 */
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
    cutoff: 7,             // minimum correct to advance
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
};
