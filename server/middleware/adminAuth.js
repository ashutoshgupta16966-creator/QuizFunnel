/**
 * adminAuth middleware
 * Checks the Authorization header for: "Bearer <ADMIN_PASSWORD>"
 * Set ADMIN_PASSWORD in your .env file.
 */
module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized — invalid or missing admin password.',
    });
  }

  next();
};
