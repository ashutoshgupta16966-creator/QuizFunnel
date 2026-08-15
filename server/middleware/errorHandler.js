/**
 * Global error handler — must be the LAST middleware in index.js.
 * Catches any error passed via next(err) in route handlers.
 */
module.exports = function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.message || err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, error: messages.join(', ') });
  }

  // Mongoose duplicate key (unique index violation)
  if (err.code === 11000) {
    return res.status(409).json({ success: false, error: 'Duplicate entry — record already exists.' });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'Invalid ID format.' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: status === 500 ? 'Internal server error' : err.message,
  });
};
