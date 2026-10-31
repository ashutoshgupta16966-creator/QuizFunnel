/**
 * db2.js — IBM Db2 dual-write add-on for QuizFunnel.
 *
 * Rules:
 *  - Only active when DB2_ENABLED=true in env.
 *  - Connection failures are logged, never thrown.
 *  - All writes are fire-and-forget (non-blocking).
 *  - Existing MongoDB / Socket logic is untouched.
 */

'use strict';

const DB2_ENABLED = (process.env.DB2_ENABLED || '').toLowerCase() === 'true';
const CONN_STRING = process.env.DB2_CONN_STRING || '';

// Pool handle — lazily created on first use.
let _pool = null;
let _ready = false; // becomes true after successful init
let _ibmdb = null;  // the ibm_db module (loaded only when enabled)

/* --- Internal helpers ---------------------------------------------------- */

/** Load the ibm_db native module once, safely. */
function loadIbmDb() {
  if (_ibmdb) return _ibmdb;
  try {
    _ibmdb = require('ibm_db'); // eslint-disable-line global-require
    return _ibmdb;
  } catch (err) {
    console.warn('[Db2] ibm_db native module not found — Db2 integration disabled.', err.message);
    return null;
  }
}

/**
 * Open a connection. ibm_db has built-in pooling; we keep one handle.
 * Returns false if anything goes wrong.
 */
async function openPool() {
  const ibmdb = loadIbmDb();
  if (!ibmdb) return false;
  if (!CONN_STRING) {
    console.warn('[Db2] DB2_CONN_STRING is not set — Db2 integration disabled.');
    return false;
  }

  return new Promise((resolve) => {
    try {
      ibmdb.open(CONN_STRING, (err, conn) => {
        if (err) {
          console.warn('[Db2] Connection failed:', err.message);
          resolve(false);
          return;
        }
        _pool = conn;
        _ready = true;
        console.log('[Db2] Connected to IBM Db2.');
        resolve(true);
      });
    } catch (err) {
      console.warn('[Db2] openPool exception:', err.message);
      resolve(false);
    }
  });
}

/**
 * Execute a parameterised SQL statement.
 * Always resolves — never rejects.
 * Returns { rows, error }.
 */
async function query(sql, params = []) {
  if (!_ready || !_pool) {
    return { rows: [], error: new Error('Db2 not ready') };
  }

  return new Promise((resolve) => {
    try {
      _pool.query(sql, params, (err, rows) => {
        if (err) {
          console.warn('[Db2] query error:', err.message, '|', sql.slice(0, 80));
          resolve({ rows: [], error: err });
        } else {
          resolve({ rows: rows || [], error: null });
        }
      });
    } catch (err) {
      console.warn('[Db2] query exception:', err.message);
      resolve({ rows: [], error: err });
    }
  });
}

/* --- Table creation ------------------------------------------------------- */

const CREATE_TABLES_SQL = [
  // QUIZ_ROOMS — one row per room
  `CREATE TABLE QUIZ_ROOMS (
    ROOM_ID       VARCHAR(50)  NOT NULL PRIMARY KEY,
    QUIZ_TITLE    VARCHAR(200) DEFAULT '',
    ADMIN_NAME    VARCHAR(100) NOT NULL,
    ADMIN_PHONE   VARCHAR(20)  NOT NULL,
    STATUS        VARCHAR(20)  DEFAULT 'active',
    MAX_CAPACITY  SMALLINT     DEFAULT 60,
    MAX_LEVEL     SMALLINT     DEFAULT 4,
    PROGRESSION   VARCHAR(30)  DEFAULT 'level_gated',
    CREATED_AT    TIMESTAMP    DEFAULT CURRENT TIMESTAMP,
    UPDATED_AT    TIMESTAMP    DEFAULT CURRENT TIMESTAMP
  )`,

  // PARTICIPANTS — one row per (room x participant)
  `CREATE TABLE PARTICIPANTS (
    ROOM_ID         VARCHAR(50)  NOT NULL,
    PARTICIPANT_ID  VARCHAR(50)  NOT NULL,
    NAME            VARCHAR(100) NOT NULL,
    BRANCH          VARCHAR(50)  DEFAULT 'CSE',
    STATUS          VARCHAR(30)  DEFAULT 'in-progress',
    IS_DISQUALIFIED SMALLINT     DEFAULT 0,
    JOINED_AT       TIMESTAMP    DEFAULT CURRENT TIMESTAMP,
    LAST_ACTIVE     TIMESTAMP    DEFAULT CURRENT TIMESTAMP,
    CONSTRAINT PK_PARTICIPANTS PRIMARY KEY (ROOM_ID, PARTICIPANT_ID)
  )`,

  // ANSWERS — one row per (room x participant x question)
  // UNIQUE constraint on (room_id, participant_id, question_id) guarantees no duplicate answers
  `CREATE TABLE ANSWERS (
    ROOM_ID        VARCHAR(50)  NOT NULL,
    PARTICIPANT_ID VARCHAR(50)  NOT NULL,
    QUESTION_ID    VARCHAR(50)  NOT NULL,
    QUESTION_TYPE  VARCHAR(20)  DEFAULT 'mcq',
    LEVEL_NUM      SMALLINT     DEFAULT 1,
    IS_CORRECT     SMALLINT     DEFAULT 0,
    SELECTED_TEXT  VARCHAR(500) DEFAULT '',
    SUBMITTED_AT   TIMESTAMP    DEFAULT CURRENT TIMESTAMP,
    CONSTRAINT UQ_ANS UNIQUE (ROOM_ID, PARTICIPANT_ID, QUESTION_ID)
  )`,

  // RESULTS — one row per (room x participant x level)
  `CREATE TABLE RESULTS (
    ROOM_ID        VARCHAR(50)  NOT NULL,
    PARTICIPANT_ID VARCHAR(50)  NOT NULL,
    NAME           VARCHAR(100) NOT NULL,
    LEVEL_NUM      SMALLINT     DEFAULT 1,
    SCORE          SMALLINT     DEFAULT 0,
    TIME_TAKEN     INTEGER      DEFAULT 0,
    STATUS         VARCHAR(30)  DEFAULT 'in-progress',
    IS_DISQ        SMALLINT     DEFAULT 0,
    SAVED_AT       TIMESTAMP    DEFAULT CURRENT TIMESTAMP,
    CONSTRAINT PK_RESULTS PRIMARY KEY (ROOM_ID, PARTICIPANT_ID, LEVEL_NUM)
  )`,

  // SECURITY_LOG — failed attempts and lockout events
  `CREATE TABLE SECURITY_LOG (
    ID                  VARCHAR(50)  NOT NULL PRIMARY KEY,
    EVENT_TYPE          VARCHAR(50)  NOT NULL,
    MOBILE_OR_USERNAME  VARCHAR(100) NOT NULL,
    IP                  VARCHAR(100) DEFAULT '',
    CREATED_AT          TIMESTAMP    DEFAULT CURRENT TIMESTAMP
  )`,
];

async function createTablesIfNotExist() {
  for (const sql of CREATE_TABLES_SQL) {
    const { error } = await query(sql);
    if (error) {
      const msg = String(error.message || '');
      // -601 / SQL0601N means table or view already exists in Db2 — safe to ignore
      if (!msg.includes('-601') && !msg.includes('SQL0601N') && !msg.toLowerCase().includes('already exists')) {
        console.warn('[Db2] createTable warning:', error.message);
      }
    }
  }
  console.log('[Db2] Table check complete.');
}

/* --- Public init ---------------------------------------------------------- */

/**
 * Call once at startup (in index.js after MongoDB is up).
 * Safe to call when DB2_ENABLED=false — it is a no-op.
 */
async function initDb2() {
  if (!DB2_ENABLED) return;
  const ok = await openPool();
  if (ok) {
    await createTablesIfNotExist();
  }
}

/* --- Save helpers (fire-and-forget, non-blocking) ------------------------- */

/**
 * Upsert a room record in QUIZ_ROOMS.
 * Called when a room is created or closed.
 */
function saveRoom(room) {
  if (!_ready || !room) return;
  try {
    const sql = `
      MERGE INTO QUIZ_ROOMS AS T
      USING (VALUES (?, ?, ?, ?, ?, ?, ?, ?)) AS S
        (ROOM_ID, QUIZ_TITLE, ADMIN_NAME, ADMIN_PHONE, MAX_CAPACITY, MAX_LEVEL, PROGRESSION, STATUS)
      ON T.ROOM_ID = S.ROOM_ID
      WHEN MATCHED THEN
        UPDATE SET
          QUIZ_TITLE  = S.QUIZ_TITLE,
          STATUS      = S.STATUS,
          UPDATED_AT  = CURRENT TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (ROOM_ID, QUIZ_TITLE, ADMIN_NAME, ADMIN_PHONE, MAX_CAPACITY, MAX_LEVEL, PROGRESSION, STATUS)
        VALUES (S.ROOM_ID, S.QUIZ_TITLE, S.ADMIN_NAME, S.ADMIN_PHONE, S.MAX_CAPACITY, S.MAX_LEVEL, S.PROGRESSION, S.STATUS)
    `;
    const params = [
      String(room.roomCode || ''),
      String(room.quizTitle || ''),
      String(room.adminName || ''),
      String(room.adminPhone || ''),
      Number(room.maxCapacity || 60),
      Number(room.maxLevel || 4),
      String(room.progressionMode || 'level_gated'),
      String(room.status || 'active'),
    ];
    query(sql, params).catch((err) => console.warn('[Db2] saveRoom error:', err.message));
  } catch (err) {
    console.warn('[Db2] saveRoom exception:', err.message);
  }
}

/**
 * Upsert a participant row in PARTICIPANTS.
 * Called when a student joins a room.
 */
function saveParticipant(roomCode, participant) {
  if (!_ready || !participant) return;
  try {
    const room = String(roomCode || '');
    const partId = String(participant.mobile || participant.participantId || '');
    const name = String(participant.name || 'Student');
    const branch = String(participant.branch || 'CSE');
    const status = String(participant.status || 'in-progress');
    const disq = participant.isDisqualified ? 1 : 0;

    const sql = `
      MERGE INTO PARTICIPANTS AS T
      USING (VALUES (?, ?)) AS S (ROOM_ID, PARTICIPANT_ID)
      ON T.ROOM_ID = S.ROOM_ID AND T.PARTICIPANT_ID = S.PARTICIPANT_ID
      WHEN MATCHED THEN
        UPDATE SET
          NAME            = ?,
          BRANCH          = ?,
          STATUS          = ?,
          IS_DISQUALIFIED = ?,
          LAST_ACTIVE     = CURRENT TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (ROOM_ID, PARTICIPANT_ID, NAME, BRANCH, STATUS, IS_DISQUALIFIED)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [
      room, partId,
      name, branch, status, disq,
      room, partId, name, branch, status, disq,
    ];
    query(sql, params).catch((err) => console.warn('[Db2] saveParticipant error:', err.message));
  } catch (err) {
    console.warn('[Db2] saveParticipant exception:', err.message);
  }
}

/**
 * Upsert answers for a level submission.
 * Called after a student submits quiz answers.
 */
function saveAnswers(roomCode, participantId, level, scoredAnswers) {
  if (!_ready || !Array.isArray(scoredAnswers) || scoredAnswers.length === 0) return;
  try {
    const room = String(roomCode || '');
    const partId = String(participantId || '');

    for (const ans of scoredAnswers) {
      const qid = String(ans.questionId || '');
      const qtyp = String(ans.questionType || 'mcq');
      const corr = ans.isCorrect ? 1 : 0;
      const text = String(ans.selectedText || ans.directAnswer || '').slice(0, 500);

      const sql = `
        MERGE INTO ANSWERS AS T
        USING (VALUES (?, ?, ?)) AS S (ROOM_ID, PARTICIPANT_ID, QUESTION_ID)
        ON T.ROOM_ID = S.ROOM_ID AND T.PARTICIPANT_ID = S.PARTICIPANT_ID AND T.QUESTION_ID = S.QUESTION_ID
        WHEN MATCHED THEN
          UPDATE SET IS_CORRECT = ?, SELECTED_TEXT = ?, SUBMITTED_AT = CURRENT TIMESTAMP
        WHEN NOT MATCHED THEN
          INSERT (ROOM_ID, PARTICIPANT_ID, QUESTION_ID, QUESTION_TYPE, LEVEL_NUM, IS_CORRECT, SELECTED_TEXT)
          VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        room, partId, qid,
        corr, text,
        room, partId, qid, qtyp, Number(level || 1), corr, text,
      ];
      query(sql, params).catch((err) => console.warn('[Db2] saveAnswers error:', err.message));
    }
  } catch (err) {
    console.warn('[Db2] saveAnswers exception:', err.message);
  }
}

/**
 * Upsert result row(s) in RESULTS (one per level).
 * Called when quiz is finished / participant completes.
 */
function saveResult(roomCode, participant) {
  if (!_ready || !participant) return;
  try {
    const room = String(roomCode || '');
    const partId = String(participant.mobile || participant.participantId || '');
    const name = String(participant.name || 'Student');
    const levels = Array.isArray(participant.levels) ? participant.levels : [];

    const persistLevel = (lvlNum, score, time) => {
      const status = String(participant.status || 'in-progress');
      const disq = participant.isDisqualified ? 1 : 0;
      const sql = `
        MERGE INTO RESULTS AS T
        USING (VALUES (?, ?, ?)) AS S (ROOM_ID, PARTICIPANT_ID, LEVEL_NUM)
        ON T.ROOM_ID = S.ROOM_ID AND T.PARTICIPANT_ID = S.PARTICIPANT_ID AND T.LEVEL_NUM = S.LEVEL_NUM
        WHEN MATCHED THEN
          UPDATE SET SCORE = ?, TIME_TAKEN = ?, STATUS = ?, IS_DISQ = ?, SAVED_AT = CURRENT TIMESTAMP
        WHEN NOT MATCHED THEN
          INSERT (ROOM_ID, PARTICIPANT_ID, NAME, LEVEL_NUM, SCORE, TIME_TAKEN, STATUS, IS_DISQ)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        room, partId, lvlNum,
        score, time, status, disq,
        room, partId, name, lvlNum, score, time, status, disq,
      ];
      query(sql, params).catch((err) => console.warn('[Db2] saveResult error:', err.message));
    };

    if (levels.length > 0) {
      for (const lvl of levels) {
        persistLevel(Number(lvl.level || 1), Number(lvl.score || 0), Number(lvl.timeTaken || 0));
      }
    } else {
      persistLevel(
        Number(participant.level || 1),
        Number(participant.score || 0),
        Number(participant.timeTaken || 0)
      );
    }
  } catch (err) {
    console.warn('[Db2] saveResult exception:', err.message);
  }
}

/* --- Read-only helpers ---------------------------------------------------- */

/**
 * Retrieve top scores from Db2 for a room.
 */
async function getLeaderboard(roomId) {
  if (!_ready) return [];
  try {
    const sql = `
      SELECT PARTICIPANT_ID, NAME, SUM(SCORE) AS TOTAL_SCORE, SUM(TIME_TAKEN) AS TOTAL_TIME, MAX(LEVEL_NUM) AS MAX_LEVEL
      FROM RESULTS
      WHERE ROOM_ID = ?
      GROUP BY PARTICIPANT_ID, NAME
      ORDER BY TOTAL_SCORE DESC, TOTAL_TIME ASC
      FETCH FIRST 50 ROWS ONLY
    `;
    const { rows, error } = await query(sql, [String(roomId || '').trim().toUpperCase()]);
    if (error) return [];
    return (rows || []).map((r) => ({
      participantId: r.PARTICIPANT_ID || r.participant_id,
      name: r.NAME || r.name,
      totalScore: Number(r.TOTAL_SCORE || r.total_score || 0),
      totalTime: Number(r.TOTAL_TIME || r.total_time || 0),
      maxLevel: Number(r.MAX_LEVEL || r.max_level || 1),
    }));
  } catch (err) {
    console.warn('[Db2] getLeaderboard error:', err.message);
    return [];
  }
}

/**
 * Retrieve participant count, answer count, and average score for a room from Db2.
 */
async function getStats(roomId) {
  const defaultStats = {
    roomId: String(roomId || '').trim().toUpperCase(),
    participantsCount: 0,
    answersCount: 0,
    averageScore: 0,
  };
  if (!_ready) return defaultStats;

  try {
    const rid = String(roomId || '').trim().toUpperCase();
    const [partRes, ansRes, scoreRes] = await Promise.all([
      query('SELECT COUNT(DISTINCT PARTICIPANT_ID) AS CNT FROM PARTICIPANTS WHERE ROOM_ID = ?', [rid]),
      query('SELECT COUNT(*) AS CNT FROM ANSWERS WHERE ROOM_ID = ?', [rid]),
      query(
        'SELECT AVG(CAST(TOT_SCORE AS DOUBLE)) AS AVG_SCORE FROM (SELECT SUM(SCORE) AS TOT_SCORE FROM RESULTS WHERE ROOM_ID = ? GROUP BY PARTICIPANT_ID)',
        [rid]
      ),
    ]);

    const participantsCount = Number(partRes.rows?.[0]?.CNT || partRes.rows?.[0]?.cnt || 0);
    const answersCount = Number(ansRes.rows?.[0]?.CNT || ansRes.rows?.[0]?.cnt || 0);
    const rawAvg = scoreRes.rows?.[0]?.AVG_SCORE || scoreRes.rows?.[0]?.avg_score || 0;
    const averageScore = Math.round(Number(rawAvg || 0) * 10) / 10;

    return {
      roomId: rid,
      participantsCount,
      answersCount,
      averageScore,
    };
  } catch (err) {
    console.warn('[Db2] getStats error:', err.message);
    return defaultStats;
  }
}

/**
 * Log a security event (failed attempt or lockout) to SECURITY_LOG table.
 * Fire and forget inside try/catch.
 */
function logSecurityEvent(eventType, mobileOrUsername, ip) {
  if (!_ready) return;
  try {
    const id = 'sec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const sql = 'INSERT INTO SECURITY_LOG (ID, EVENT_TYPE, MOBILE_OR_USERNAME, IP) VALUES (?, ?, ?, ?)';
    const params = [
      String(id),
      String(eventType || 'FAILED_ATTEMPT'),
      String(mobileOrUsername || 'unknown').slice(0, 100),
      String(ip || '').slice(0, 100),
    ];
    query(sql, params).catch((err) => console.warn('[Db2] logSecurityEvent error:', err.message));
  } catch (err) {
    console.warn('[Db2] logSecurityEvent exception:', err.message);
  }
}

/**
 * Retrieve the last N security log entries.
 */
async function getSecurityLog(limit = 50) {
  if (!_ready) return [];
  try {
    const sql = `
      SELECT ID, EVENT_TYPE, MOBILE_OR_USERNAME, IP, CREATED_AT
      FROM SECURITY_LOG
      ORDER BY CREATED_AT DESC
      FETCH FIRST ? ROWS ONLY
    `;
    const { rows, error } = await query(sql, [Number(limit) || 50]);
    if (error) return [];
    return (rows || []).map((r) => ({
      id: r.ID || r.id,
      eventType: r.EVENT_TYPE || r.event_type,
      mobileOrUsername: r.MOBILE_OR_USERNAME || r.mobile_or_username,
      ip: r.IP || r.ip || '',
      createdAt: r.CREATED_AT || r.created_at,
    }));
  } catch (err) {
    console.warn('[Db2] getSecurityLog error:', err.message);
    return [];
  }
}

/* --- Exports -------------------------------------------------------------- */

module.exports = {
  DB2_ENABLED,
  initDb2,
  isReady: () => _ready,
  query,
  saveRoom,
  saveParticipant,
  saveAnswers,
  saveResult,
  getLeaderboard,
  getStats,
  logSecurityEvent,
  getSecurityLog,
};
