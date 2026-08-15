/**
 * seed.js — Populates MongoDB with 50 quiz questions.
 *
 * Usage:
 *   node seed.js                   # uses MONGO_URI from .env
 *   node seed.js --uri mongodb://… # override connection
 *
 * Questions are organized by level (1–4) and section.
 * To swap in your own questions, edit the QUESTIONS array below
 * or replace it with data loaded from a JSON/Markdown file.
 *
 * Run from the project root: node seed.js
 */

require('dotenv').config({ path: './server/.env' });
const mongoose = require('mongoose');

// ── Inline Question Bank (50 questions) ─────────────────────────────────────
// Schema: { level, section, questionText, options[4], correctAnswerIndex, difficulty }
const QUESTIONS = [
  // ═══════════════════════════════════════════════════════════════════
  // LEVEL 1 — Easy  (20 questions: GK×5, Technical×5, Reasoning×5, Aptitude×5)
  // ═══════════════════════════════════════════════════════════════════

  // — GK ——————————————————————————————————————————————
  {
    level: 1, section: 'GK', difficulty: 'easy',
    questionText: 'What does CPU stand for in computing?',
    options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processor Unit'],
    correctAnswerIndex: 0,
  },
  {
    level: 1, section: 'GK', difficulty: 'easy',
    questionText: 'Which company originally developed the Java programming language?',
    options: ['Microsoft', 'Apple', 'Sun Microsystems', 'IBM'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'GK', difficulty: 'easy',
    questionText: 'What does HTTP stand for?',
    options: ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'Hybrid Text Markup Protocol', 'HyperText Transmission Protocol'],
    correctAnswerIndex: 0,
  },
  {
    level: 1, section: 'GK', difficulty: 'easy',
    questionText: 'Which of the following is NOT an input device?',
    options: ['Keyboard', 'Mouse', 'Monitor', 'Joystick'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'GK', difficulty: 'easy',
    questionText: "What does 'www' stand for in a web URL?",
    options: ['World Wide Web', 'Web World Wide', 'Wide World Web', 'World Web Wide'],
    correctAnswerIndex: 0,
  },

  // — Technical ———————————————————————————————————————
  {
    level: 1, section: 'Technical', difficulty: 'easy',
    questionText: 'Which data structure follows the LIFO (Last In, First Out) principle?',
    options: ['Queue', 'Stack', 'Array', 'Linked List'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Technical', difficulty: 'easy',
    questionText: 'What is the decimal value of the binary number 1101?',
    options: ['11', '12', '13', '14'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'Technical', difficulty: 'easy',
    questionText: 'Which symbol starts a single-line comment in Python?',
    options: ['//', '/*', '#', '--'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'Technical', difficulty: 'easy',
    questionText: "In Object-Oriented Programming, what is 'inheritance'?",
    options: [
      'Hiding internal data from the outside world',
      'A class acquiring properties and methods from another class',
      'Defining multiple methods with the same name',
      'Restricting access to certain data members',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Technical', difficulty: 'easy',
    questionText: 'Which of the following is primary (volatile) memory?',
    options: ['Hard Disk Drive', 'RAM', 'SSD', 'USB Flash Drive'],
    correctAnswerIndex: 1,
  },

  // — Reasoning ———————————————————————————————————————
  {
    level: 1, section: 'Reasoning', difficulty: 'easy',
    questionText: 'What comes next in the series: 2, 4, 8, 16, __?',
    options: ['24', '32', '20', '30'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Reasoning', difficulty: 'easy',
    questionText: 'Find the missing term: 1, 4, 9, 16, 25, __',
    options: ['30', '36', '42', '49'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Reasoning', difficulty: 'easy',
    questionText: 'All programmers are logical. Priya is a programmer. Which statement MUST be true?',
    options: [
      'All logical people are programmers',
      'Priya is logical',
      'Priya is not logical',
      'Some programmers are not logical',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Reasoning', difficulty: 'easy',
    questionText: 'Complete the alphabetical series: A, C, E, G, __',
    options: ['H', 'I', 'J', 'K'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Reasoning', difficulty: 'easy',
    questionText: 'A is heavier than B. C is lighter than A. D is heavier than C but lighter than B. Who is the lightest?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswerIndex: 2,
  },

  // — Aptitude ————————————————————————————————————————
  {
    level: 1, section: 'Aptitude', difficulty: 'easy',
    questionText: 'What is 30% of 250?',
    options: ['60', '70', '75', '80'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'Aptitude', difficulty: 'easy',
    questionText: 'A train 150 m long passes a pole in 15 seconds. What is its speed in km/h?',
    options: ['30', '36', '40', '45'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Aptitude', difficulty: 'easy',
    questionText: 'What is the LCM of 8 and 12?',
    options: ['16', '24', '32', '48'],
    correctAnswerIndex: 1,
  },
  {
    level: 1, section: 'Aptitude', difficulty: 'easy',
    questionText: 'A product costs ₹800. After a 25% discount, what is the final price?',
    options: ['₹550', '₹575', '₹600', '₹625'],
    correctAnswerIndex: 2,
  },
  {
    level: 1, section: 'Aptitude', difficulty: 'easy',
    questionText: 'If x + y = 10 and x − y = 4, what is the value of x?',
    options: ['3', '5', '7', '9'],
    correctAnswerIndex: 2,
  },

  // ═══════════════════════════════════════════════════════════════════
  // LEVEL 2 — Medium  (15 questions: Technical×5, Reasoning×5, Aptitude×5)
  // ═══════════════════════════════════════════════════════════════════

  // — Technical ———————————————————————————————————————
  {
    level: 2, section: 'Technical', difficulty: 'medium',
    questionText: 'What is the time complexity of binary search on a sorted array of n elements?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    correctAnswerIndex: 1,
  },
  {
    level: 2, section: 'Technical', difficulty: 'medium',
    questionText: 'Which sorting algorithm guarantees O(n log n) time complexity in the worst case?',
    options: ['Quick Sort', 'Bubble Sort', 'Merge Sort', 'Insertion Sort'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Technical', difficulty: 'medium',
    questionText: 'In SQL, which clause filters records AFTER they have been grouped?',
    options: ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Technical', difficulty: 'medium',
    questionText: 'What does API stand for in software development?',
    options: [
      'Applied Programming Interface',
      'Application Programming Interface',
      'Automated Protocol Interface',
      'Application Protocol Integration',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 2, section: 'Technical', difficulty: 'medium',
    questionText: 'Which HTTP status code indicates that the requested resource was not found?',
    options: ['200', '301', '403', '404'],
    correctAnswerIndex: 3,
  },

  // — Reasoning ———————————————————————————————————————
  {
    level: 2, section: 'Reasoning', difficulty: 'medium',
    questionText: 'Complete the Fibonacci series: 1, 1, 2, 3, 5, 8, 13, __',
    options: ['18', '19', '21', '24'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Reasoning', difficulty: 'medium',
    questionText: "In a code language, COLD is written as DPME (each letter shifted +1). How is HOT coded?",
    options: ['IPU', 'GNS', 'JQV', 'HPS'],
    correctAnswerIndex: 0,
  },
  {
    level: 2, section: 'Reasoning', difficulty: 'medium',
    questionText: "Pointing to a photo, Rohan says: 'She is the daughter of my grandfather's only son.' How is the girl related to Rohan?",
    options: ['Mother', 'Aunt', 'Sister', 'Cousin'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Reasoning', difficulty: 'medium',
    questionText: 'A bat and ball together cost ₹110. The bat costs ₹100 more than the ball. How much does the ball cost?',
    options: ['₹5', '₹10', '₹15', '₹20'],
    correctAnswerIndex: 0,
  },
  {
    level: 2, section: 'Reasoning', difficulty: 'medium',
    questionText: 'Find the next term: 3, 6, 11, 18, 27, __',
    options: ['32', '35', '38', '41'],
    correctAnswerIndex: 2,
  },

  // — Aptitude ————————————————————————————————————————
  {
    level: 2, section: 'Aptitude', difficulty: 'medium',
    questionText: 'Two pipes fill a tank in 10 hours and 15 hours respectively. Together, how long do they take?',
    options: ['4 hours', '5 hours', '6 hours', '8 hours'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Aptitude', difficulty: 'medium',
    questionText: 'What is the compound interest on ₹1,000 at 10% per annum for 2 years?',
    options: ['₹200', '₹205', '₹210', '₹220'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Aptitude', difficulty: 'medium',
    questionText: 'If 6 men complete a job in 10 days, how many days will 4 men take to do the same job?',
    options: ['12', '13', '14', '15'],
    correctAnswerIndex: 3,
  },
  {
    level: 2, section: 'Aptitude', difficulty: 'medium',
    questionText: 'A car travels at 60 km/h for 2 hours and 80 km/h for 3 hours. What is the average speed for the entire journey?',
    options: ['68 km/h', '70 km/h', '72 km/h', '75 km/h'],
    correctAnswerIndex: 2,
  },
  {
    level: 2, section: 'Aptitude', difficulty: 'medium',
    questionText: 'The ratio of boys to girls in a class is 3:2. If there are 30 boys, how many girls are there?',
    options: ['15', '18', '20', '25'],
    correctAnswerIndex: 2,
  },

  // ═══════════════════════════════════════════════════════════════════
  // LEVEL 3 — Hard  (10 questions: Technical×5, Reasoning×5)
  // ═══════════════════════════════════════════════════════════════════

  // — Technical ———————————————————————————————————————
  {
    level: 3, section: 'Technical', difficulty: 'hard',
    questionText: 'What is the space (auxiliary) complexity of Merge Sort?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    correctAnswerIndex: 2,
  },
  {
    level: 3, section: 'Technical', difficulty: 'hard',
    questionText: 'Which technique is most effective at preventing SQL injection attacks?',
    options: [
      'Restricting input length',
      'Using prepared statements (parameterized queries)',
      'Placing a firewall in front of the database',
      'Encrypting the entire database',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 3, section: 'Technical', difficulty: 'hard',
    questionText: "What does the 'S' in the SOLID principles of object-oriented design stand for?",
    options: [
      'Simple Responsibility',
      'Single Responsibility',
      'Structured Responsibility',
      'Sequential Responsibility',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 3, section: 'Technical', difficulty: 'hard',
    questionText: "What is the output of: list(map(lambda x: x**2, [1, 2, 3]))?",
    options: ['[1, 4, 9]', '[1, 2, 3]', '[2, 4, 6]', '[1, 8, 27]'],
    correctAnswerIndex: 0,
  },
  {
    level: 3, section: 'Technical', difficulty: 'hard',
    questionText: 'Which data structure is most efficient for implementing a priority queue?',
    options: ['Stack', 'Sorted Array', 'Binary Heap', 'Doubly Linked List'],
    correctAnswerIndex: 2,
  },

  // — Reasoning ———————————————————————————————————————
  {
    level: 3, section: 'Reasoning', difficulty: 'hard',
    questionText: 'A 3-digit number has digits summing to 18. The tens digit is twice the units digit, and the hundreds digit is thrice the units digit. What is the number?',
    options: ['936', '963', '693', '639'],
    correctAnswerIndex: 1,
  },
  {
    level: 3, section: 'Reasoning', difficulty: 'hard',
    questionText: 'A clock gains 5 minutes every hour. Set correctly at 8 AM, what time does it show at 8 PM the same day?',
    options: ['8:30 PM', '8:45 PM', '9:00 PM', '9:15 PM'],
    correctAnswerIndex: 2,
  },
  {
    level: 3, section: 'Reasoning', difficulty: 'hard',
    questionText: 'In how many distinct ways can 4 people be seated in a row?',
    options: ['12', '16', '24', '48'],
    correctAnswerIndex: 2,
  },
  {
    level: 3, section: 'Reasoning', difficulty: 'hard',
    questionText: 'The probability of an event occurring is 0.35. What is the probability of the complementary event?',
    options: ['0.35', '0.55', '0.65', '0.75'],
    correctAnswerIndex: 2,
  },
  {
    level: 3, section: 'Reasoning', difficulty: 'hard',
    questionText: 'What is the next term in the series: 2, 5, 10, 17, 26, __?',
    options: ['33', '35', '37', '39'],
    correctAnswerIndex: 2,
  },

  // ═══════════════════════════════════════════════════════════════════
  // LEVEL 4 — Hardest  (5 questions: Mixed)
  // ═══════════════════════════════════════════════════════════════════
  {
    level: 4, section: 'Mixed', difficulty: 'hard',
    questionText: [
      'What will this Python snippet print?',
      '  x = [1, 2, 3]',
      '  y = x',
      '  y.append(4)',
      '  print(len(x))',
    ].join('\n'),
    options: ['3', '4', '5', 'Error'],
    correctAnswerIndex: 1,
  },
  {
    level: 4, section: 'Mixed', difficulty: 'hard',
    questionText: 'A bank offers 8% compound interest annually. What is the minimum number of complete years for ₹1,000 to exceed ₹1,500?',
    options: ['5', '6', '7', '8'],
    correctAnswerIndex: 1,
  },
  {
    level: 4, section: 'Mixed', difficulty: 'hard',
    questionText: 'In an election, Candidate A received 60% of total votes and won by 240 votes. How many total votes were cast?',
    options: ['800', '1,000', '1,200', '1,500'],
    correctAnswerIndex: 2,
  },
  {
    level: 4, section: 'Mixed', difficulty: 'hard',
    questionText: 'Which of the following best describes a deadlock in an operating system?',
    options: [
      'A process waiting indefinitely for user input',
      'Two or more processes each waiting for a resource held by the other',
      'A process consuming 100% of CPU time continuously',
      'A process that terminates unexpectedly due to a segmentation fault',
    ],
    correctAnswerIndex: 1,
  },
  {
    level: 4, section: 'Mixed', difficulty: 'hard',
    questionText: 'What is the time complexity of the naive recursive algorithm to compute the nth Fibonacci number?',
    options: ['O(n)', 'O(n log n)', 'O(2ⁿ)', 'O(n²)'],
    correctAnswerIndex: 2,
  },
];

// ── Seed Logic ───────────────────────────────────────────────────────────────
async function seed() {
  const uri = process.argv.find((a) => a.startsWith('--uri='))?.split('=')[1]
           || process.env.MONGO_URI;

  if (!uri) {
    console.error('❌  MONGO_URI not set. Add it to server/.env or pass --uri=<connection-string>');
    process.exit(1);
  }

  console.log('🔗  Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('✅  Connected.\n');

  // Use a minimal inline schema so seed.js doesn't depend on compiled models
  const QuestionSchema = new mongoose.Schema({
    level: Number, section: String, questionText: String,
    options: [String], correctAnswerIndex: Number, difficulty: String,
  });
  const Question = mongoose.models.Question || mongoose.model('Question', QuestionSchema);

  console.log('🗑️   Dropping existing questions…');
  await Question.deleteMany({});

  console.log(`📥  Inserting ${QUESTIONS.length} questions…`);
  await Question.insertMany(QUESTIONS);

  // Summary
  const counts = {};
  QUESTIONS.forEach(({ level, section }) => {
    const key = `Level ${level} — ${section}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  console.log('\n📊  Inserted:');
  Object.entries(counts).forEach(([k, v]) => console.log(`     ${k}: ${v}`));

  console.log(`\n✅  Seed complete — ${QUESTIONS.length} questions loaded.\n`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
