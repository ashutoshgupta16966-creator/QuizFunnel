require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const morgan = require('morgan');

const studentsRouter = require('./routes/students');
const quizRouter = require('./routes/quiz');
const adminRouter = require('./routes/admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────────────────────────────
// Parse allowed origins from env (comma-separated)
const allowedOrigins = (process.env.CLIENT_URL || '*').split(',').map((s) => s.trim());

app.use(cors({
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*'
    ? '*'
    : (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error(`CORS: origin ${origin} not allowed`));
      },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Student-Mobile'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/students', studentsRouter);
app.use('/api/quiz',     quizRouter);
app.use('/api/admin',    adminRouter);

// Health check — useful for Render's uptime monitoring
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found.' }));

// Global error handler — must be last
app.use(errorHandler);

// ── Database & Server Startup ────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅  Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀  Server listening on port ${PORT}`);
      console.log(`    Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });

// Handle unhandled promise rejections gracefully
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
