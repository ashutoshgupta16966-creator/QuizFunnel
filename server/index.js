require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const morgan = require('morgan');
const { Server } = require('socket.io');

const studentsRouter = require('./routes/students');
const quizRouter = require('./routes/quiz');
const adminRouter = require('./routes/admin');
const feedbackRouter = require('./routes/feedback');
const roomsRouter = require('./routes/rooms');
const { initRoomSocket } = require('./socket/roomSocket');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────────────────────────────
// Parse allowed origins from env (comma-separated)
const allowedOrigins = (process.env.CLIENT_URL || '*').split(',').map((s) => s.trim());

const corsOptions = {
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*'
    ? '*'
    : (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Student-Mobile'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Socket.io Setup ──────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length === 1 && allowedOrigins[0] === '*' ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
  },
});
app.set('io', io);
initRoomSocket(io);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/students', studentsRouter);
app.use('/api/quiz',     quizRouter);
app.use('/api/admin',    adminRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/rooms',    roomsRouter);

// AI Question Generation Top-Level Route
const { generateAndPopulateQuestions } = require('./controllers/aiQuestionController');
app.post('/api/generate-questions', async (req, res, next) => {
  try {
    const { topic, difficultyLevel, level, count } = req.body;
    const result = await generateAndPopulateQuestions({
      topic,
      difficultyLevel: difficultyLevel || level || 1,
      count: count || 5,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

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
    server.listen(PORT, () => {
      console.log(`🚀  Server listening on port ${PORT} with Socket.io enabled`);
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
