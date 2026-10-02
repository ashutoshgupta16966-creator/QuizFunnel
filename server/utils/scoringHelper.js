/**
 * scoringHelper.js
 * Provides intelligent, robust answer scoring for Direct Fill-in / Numerical questions.
 *
 * Implements:
 * 1. Case-insensitivity & whitespace trimming normalization.
 * 2. Pure numerical validation: Strict exact match only (numbers cannot have fuzzy typos, e.g. "41" is NOT "42").
 * 3. Text/Name fuzzy matching using Levenshtein distance and string similarity:
 *    - Allows minor spelling variations and single/double letter typos (e.g. "canbera" -> "Canberra").
 *    - Space-collapsed comparison (e.g. "Ravindra Nath Tagore" -> "Rabindranath Tagore").
 *    - Length-scaled edit distance guards:
 *      * Short strings (<= 3 chars, like "tcp", "yes"): exact match only (0 distance).
 *      * Medium strings (4-7 chars): max edit distance 1.
 *      * Long strings (8-15 chars): max edit distance 2.
 *      * Very long strings (>= 16 chars): max edit distance 3.
 *    - Minimum similarity threshold: 82%.
 */

function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],    // deletion
          dp[i][j - 1],    // insertion
          dp[i - 1][j - 1] // substitution
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Returns true if the string is purely numerical (e.g. "42", "3.14", "-15", "0.5").
 */
function isPureNumber(str) {
  if (!str) return false;
  const clean = String(str).trim();
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean);
}

/**
 * Checks whether a student's direct answer is acceptable against the target correct answer.
 *
 * @param {string|number} studentAns - The student's submitted answer
 * @param {string|number} correctAns - The correct answer stored in the database
 * @returns {boolean} True if the answer is considered correct
 */
function checkDirectAnswerCorrectness(studentAns, correctAns) {
  const sNorm = String(studentAns ?? '').trim().toLowerCase();
  const cNorm = String(correctAns ?? '').trim().toLowerCase();

  if (!sNorm || !cNorm) return false;

  // 1. Exact match (case-insensitive & whitespace-trimmed)
  if (sNorm === cNorm) return true;

  // 2. Purely numerical answers: STRICT exact match only!
  // Near matches on numbers (e.g. "41" vs "42") must NEVER be accepted as typos.
  if (isPureNumber(sNorm) || isPureNumber(cNorm)) {
    // Check numerical equivalence (e.g. "42" vs "42.0" or "0.5" vs ".5")
    const sNum = parseFloat(sNorm);
    const cNum = parseFloat(cNorm);
    if (!isNaN(sNum) && !isNaN(cNum) && isPureNumber(sNorm) && isPureNumber(cNorm)) {
      return sNum === cNum;
    }
    return false;
  }

  const maxLen = Math.max(sNorm.length, cNorm.length);
  // Short acronyms or words (e.g. "tcp", "dna", "yes", "cpu") must match exactly
  if (maxLen <= 3) {
    return false;
  }

  // Allowed edit distance scaling with target answer length
  let allowedDist = 1;
  if (maxLen >= 16) allowedDist = 3;
  else if (maxLen >= 8) allowedDist = 2;

  // 3. Direct Levenshtein similarity check
  const dist = levenshteinDistance(sNorm, cNorm);
  const similarity = 1 - (dist / maxLen);
  if (dist <= allowedDist && similarity >= 0.82) {
    return true;
  }

  // 4. Space-collapsed comparison (handles e.g. "Ravindra Nath Tagore" vs "Rabindranath Tagore")
  const sNoSpace = sNorm.replace(/\s+/g, '');
  const cNoSpace = cNorm.replace(/\s+/g, '');
  const maxLenNoSpace = Math.max(sNoSpace.length, cNoSpace.length);

  if (maxLenNoSpace > 3) {
    const distNoSpace = levenshteinDistance(sNoSpace, cNoSpace);
    const simNoSpace = 1 - (distNoSpace / maxLenNoSpace);
    let allowedNoSpace = 1;
    if (maxLenNoSpace >= 16) allowedNoSpace = 3;
    else if (maxLenNoSpace >= 8) allowedNoSpace = 2;

    if (distNoSpace <= allowedNoSpace && simNoSpace >= 0.82) {
      return true;
    }
  }

  return false;
}

module.exports = {
  checkDirectAnswerCorrectness,
  isPureNumber,
  levenshteinDistance,
};
