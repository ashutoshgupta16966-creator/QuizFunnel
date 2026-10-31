'use strict';

const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');
let db2;
try {
  db2 = require('../db2');
} catch {
  db2 = null;
}

// ── In-Memory Stores ────────────────────────────────────────────────────────
// Captcha store: captchaId -> { answer: string, expiresAt: number }
const captchaStore = new Map();

// Lockout store: key (${identifier}:${ip}) -> { failedAttempts: number, lockUntil: number, lastLockoutAt: number, updatedAt: number }
const lockoutStore = new Map();

// OTP Rate limit store: mobile -> [timestamp1, timestamp2, ...]
const otpRateStore = new Map();

// ── Cleanup Interval (every 60s) ────────────────────────────────────────────
const cleanupInterval = setInterval(() => {
  const now = Date.now();

  // 1. Clean expired captchas (TTL: 2 minutes)
  for (const [id, entry] of captchaStore.entries()) {
    if (!entry || now > entry.expiresAt) {
      captchaStore.delete(id);
    }
  }

  // 2. Clean stale lockout records (TTL: 15 minutes of inactivity)
  for (const [key, entry] of lockoutStore.entries()) {
    if (!entry || (now - (entry.updatedAt || 0) > 15 * 60 * 1000 && now > (entry.lockUntil || 0))) {
      lockoutStore.delete(key);
    }
  }

  // 3. Clean stale OTP rate limit records (older than 10 minutes)
  for (const [mobile, timestamps] of otpRateStore.entries()) {
    const valid = (timestamps || []).filter((t) => now - t < 10 * 60 * 1000);
    if (valid.length === 0) {
      otpRateStore.delete(mobile);
    } else {
      otpRateStore.set(mobile, valid);
    }
  }
}, 60 * 1000);

if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

// ── CAPTCHA Helpers ─────────────────────────────────────────────────────────

function isCaptchaEnabled() {
  return (process.env.CAPTCHA_ENABLED || 'true').toLowerCase() !== 'false';
}

/**
 * Generate a 5-character CAPTCHA avoiding confusing characters (0/O, 1/l/I).
 * Stores answer in memory, expires in 2 minutes.
 * Returns { captchaId, svg }.
 */
function generateCaptcha() {
  const captcha = svgCaptcha.create({
    size: 5,
    ignoreChars: '0oO1lI',
    noise: 2,
    color: true,
    background: '#ffffff',
    width: 150,
    height: 48,
    fontSize: 44,
  });

  const captchaId = crypto.randomUUID
    ? crypto.randomUUID()
    : 'cap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes

  captchaStore.set(captchaId, {
    answer: captcha.text,
    expiresAt,
  });

  return {
    captchaId,
    svg: captcha.data,
  };
}

/**
 * Verify CAPTCHA answer.
 * Single use: deletes answer on first check (right or wrong).
 * Compares case-insensitive.
 * Returns { ok: boolean, error?: string }.
 */
function verifyCaptcha(captchaId, captchaAnswer) {
  if (!isCaptchaEnabled()) {
    return { ok: true };
  }

  if (!captchaId || !captchaAnswer) {
    return {
      ok: false,
      error: 'CAPTCHA verification is required. Please enter the characters shown.',
    };
  }

  const record = captchaStore.get(captchaId);

  // Single-use: delete immediately regardless of outcome
  captchaStore.delete(captchaId);

  if (!record || Date.now() > record.expiresAt) {
    return {
      ok: false,
      error: 'CAPTCHA has expired or is invalid. Please try again.',
    };
  }

  const expected = String(record.answer || '').trim().toLowerCase();
  const actual = String(captchaAnswer || '').trim().toLowerCase();

  if (expected !== actual) {
    return {
      ok: false,
      error: 'Incorrect CAPTCHA answer. Please try again.',
    };
  }

  return { ok: true };
}

// ── Client IP & Lockout Key Extraction ──────────────────────────────────────

function getClientIp(req) {
  if (!req) return '127.0.0.1';
  // With app.set('trust proxy', 1), req.ip contains the client's real IP on Render
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
}

function getLockoutKey(identifier, req) {
  const cleanId = String(identifier || 'unknown').trim().toLowerCase();
  const ip = getClientIp(req);
  return `${cleanId}:${ip}`;
}

// ── Db2 Security Logging Helper ─────────────────────────────────────────────

function logSecurityEventToDb2(eventType, mobileOrUsername, ip) {
  if (!db2 || !db2.DB2_ENABLED) return;
  try {
    if (typeof db2.logSecurityEvent === 'function') {
      db2.logSecurityEvent(eventType, mobileOrUsername, ip);
    }
  } catch (err) {
    // Fire and forget
    console.warn('[Db2 Security Log Warning]:', err.message);
  }
}

// ── Lockout Helpers ─────────────────────────────────────────────────────────

/**
 * Check if a lockout key is currently locked.
 * Returns { locked: boolean, retryAfter: number }.
 */
function checkLockout(key) {
  if (!key) return { locked: false, retryAfter: 0 };
  const record = lockoutStore.get(key);
  if (!record) return { locked: false, retryAfter: 0 };

  const now = Date.now();
  if (record.lockUntil && record.lockUntil > now) {
    const retryAfter = Math.ceil((record.lockUntil - now) / 1000);
    return { locked: true, retryAfter };
  }

  return { locked: false, retryAfter: 0 };
}

/**
 * Record a failed attempt for key.
 * Locks after 3 wrong attempts for 15s.
 * If locked again within 10 minutes, locks for 30s (max 30s).
 * Logs failed attempt and lockout to Db2 if enabled.
 * Returns { locked: boolean, retryAfter: number, attemptsRemaining: number }.
 */
function recordFailedAttempt(key, eventType, mobileOrUsername, ip) {
  const now = Date.now();
  const cleanId = String(mobileOrUsername || 'unknown');
  const clientIp = String(ip || '127.0.0.1');

  // Log failed attempt event to Db2
  logSecurityEventToDb2(eventType || 'FAILED_ATTEMPT', cleanId, clientIp);

  let record = lockoutStore.get(key);
  if (!record) {
    record = {
      failedAttempts: 1,
      lockUntil: 0,
      lastLockoutAt: 0,
      updatedAt: now,
    };
    lockoutStore.set(key, record);
    return { locked: false, retryAfter: 0, attemptsRemaining: 2 };
  }

  record.failedAttempts = (record.failedAttempts || 0) + 1;
  record.updatedAt = now;

  if (record.failedAttempts >= 3) {
    // Check if locked again within 10 minutes of previous lockout
    const isRelockedWithin10Min = record.lastLockoutAt > 0 && now - record.lastLockoutAt < 10 * 60 * 1000;
    const lockDurationSec = isRelockedWithin10Min ? 30 : 15;

    record.lockUntil = now + lockDurationSec * 1000;
    record.lastLockoutAt = now;
    record.failedAttempts = 0; // Reset counter for next cycle

    // Log lockout event to Db2
    logSecurityEventToDb2('LOCKOUT', cleanId, clientIp);

    return { locked: true, retryAfter: lockDurationSec, attemptsRemaining: 0 };
  }

  return {
    locked: false,
    retryAfter: 0,
    attemptsRemaining: Math.max(0, 3 - record.failedAttempts),
  };
}

/**
 * Reset lockout state on successful authentication.
 */
function resetLockout(key) {
  if (key) {
    lockoutStore.delete(key);
  }
}

// ── SMS / Forgot PIN OTP Rate Limiting ──────────────────────────────────────

/**
 * Check if a mobile number has exceeded 3 OTP requests in 10 minutes.
 * Returns { allowed: boolean, retryAfter?: number }.
 */
function checkOtpRateLimit(mobile) {
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!cleanMobile) return { allowed: true };

  const now = Date.now();
  const timestamps = (otpRateStore.get(cleanMobile) || []).filter((t) => now - t < 10 * 60 * 1000);

  if (timestamps.length >= 3) {
    const oldest = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + 10 * 60 * 1000 - now) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Record an OTP request for a mobile number.
 */
function recordOtpRequest(mobile) {
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!cleanMobile) return;

  const now = Date.now();
  const timestamps = (otpRateStore.get(cleanMobile) || []).filter((t) => now - t < 10 * 60 * 1000);
  timestamps.push(now);
  otpRateStore.set(cleanMobile, timestamps);
}

module.exports = {
  isCaptchaEnabled,
  generateCaptcha,
  verifyCaptcha,
  getClientIp,
  getLockoutKey,
  checkLockout,
  recordFailedAttempt,
  resetLockout,
  checkOtpRateLimit,
  recordOtpRequest,
  logSecurityEventToDb2,
};

