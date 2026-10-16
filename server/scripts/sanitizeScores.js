/**
 * sanitizeScores.js
 * -----------------
 * Standalone CLI script to trigger the universal permanent data sanitization.
 *
 * Enforces:
 *   - totalScore <= 45
 *   - totalTimeTaken <= 1980s (33:00)
 *   - timeTakenFormatted = "MM:SS"
 *   - per-level limits (L1:20, L2:15, L3:10, L4:5)
 *
 * Usage:
 *   node server/scripts/sanitizeScores.js
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const { runUniversalSanitization } = require('../utils/dataSanitizer');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not found in server/.env');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('✅ Connected.\n');

  console.log('🛡️  Running Universal Data Sanitization…');
  const result = await runUniversalSanitization({ silent: false });

  console.log('\n📊 Summary:');
  console.log(`   - Students: ${result.studentsUpdated} updated / ${result.studentsChecked} checked`);
  console.log(`   - Rooms:    ${result.roomsUpdated} updated / ${result.roomsChecked} checked`);
  console.log(`   - Duration: ${result.elapsedMs}ms`);

  await mongoose.disconnect();
  console.log('\n👋 Disconnected. Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
