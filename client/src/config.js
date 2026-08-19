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
