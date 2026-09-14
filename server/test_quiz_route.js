require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');

async function testRoute() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const quizRouter = require('./routes/quiz');
  const app = express();
  app.use(express.json());
  app.use('/api/quiz', quizRouter);

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server error caught:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  });

  const server = app.listen(5098, () => {
    // Test 1: Fetch questions for active student in ROOM61
    const req = http.request('http://localhost:5098/api/quiz/questions/1', {
      method: 'GET',
      headers: {
        'x-student-mobile': '7697371585',
        'x-room-code': 'ROOM61',
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Response body:', body.slice(0, 500));
        server.close();
        mongoose.disconnect();
      });
    });

    req.on('error', (e) => {
      console.error('Req error:', e);
      server.close();
      mongoose.disconnect();
    });

    req.end();
  });
}

testRoute();
