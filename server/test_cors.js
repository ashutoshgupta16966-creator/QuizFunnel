const http = require('http');

// Test the express app with supertest or native http
const express = require('express');
const cors = require('cors');

const allowedOrigins = ['*'];
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Student-Mobile'],
};

const app = express();
app.use(cors(corsOptions));
app.get('/api/quiz/questions/:level', (req, res) => {
  res.json({ ok: true });
});

const server = app.listen(5099, () => {
  // Test OPTIONS request with x-room-code
  const req = http.request('http://localhost:5099/api/quiz/questions/1', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-student-mobile, x-room-code',
    },
  }, (res) => {
    console.log('OPTIONS status:', res.statusCode);
    console.log('Access-Control-Allow-Headers:', res.headers['access-control-allow-headers']);
    console.log('Access-Control-Allow-Origin:', res.headers['access-control-allow-origin']);
    
    if (!res.headers['access-control-allow-headers']?.toLowerCase().includes('x-room-code')) {
      console.log('❌ CORS BUG CONFIRMED: x-room-code was REJECTED by CORS preflight!');
    } else {
      console.log('✅ CORS allowed x-room-code');
    }
    server.close();
  });

  req.end();
});
