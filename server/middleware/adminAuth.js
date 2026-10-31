/**
 * adminAuth middleware
 * Checks the Authorization header for: "Bearer <ADMIN_PASSWORD>"
 * Set ADMIN_PASSWORD in your .env file.
 */
const { checkLockout, recordFailedAttempt, getLockoutKey } = require('../utils/security');

module.exports = function adminAuth(req, res, next) {
  const lockoutKey = getLockoutKey('admin', req);
  const lockoutStatus = checkLockout(lockoutKey);
  if (lockoutStatus.locked) {
    return res.status(429).json({
      success: false,
      error: `Too many attempts. Try again in ${lockoutStatus.retryAfter}s`,
      retryAfter: lockoutStatus.retryAfter,
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.ADMIN_PASSWORD) {
    const failResult = recordFailedAttempt(lockoutKey, 'ADMIN_AUTH_FAIL', 'admin', req.ip);
    if (failResult.locked) {
      return res.status(429).json({
        success: false,
        error: `Too many attempts. Try again in ${failResult.retryAfter}s`,
        retryAfter: failResult.retryAfter,
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized — invalid or missing admin password.',
    });
  }

  next();
};
