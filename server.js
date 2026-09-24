// server.js
// This is the entry point of the whole backend. Running "npm start" runs this file.
// It sets up Express, connects our routes, and serves the frontend HTML/CSS/JS.

const express = require('express');
const cors = require('cors');       // allows the frontend (if served separately) to call this API
const path = require('path');       // built-in Node module for working with file paths
require('dotenv').config();         // load variables from .env into process.env

const app = express(); // create the Express application

app.get('/config.js', (req, res) => {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_your_key_here';
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

  res.type('application/javascript');
  res.send(`
    window.PAYSTACK_PUBLIC_KEY = ${JSON.stringify(publicKey)};
    window.APP_BASE_URL = ${JSON.stringify(baseUrl)};
  `);
});

// ---------------------- MIDDLEWARE ----------------------
app.use(cors());                 // allow cross-origin requests (safe to keep even if same-origin)
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));  // allow large base64 image payloads (student profile photos)

// Serve everything inside the "public" folder directly (home page, login page, dashboards, css, js)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------- API ROUTES ----------------------
// Each of these files defines a group of related endpoints, kept separate for organization.
app.use('/api/auth', require('./routes/authRoutes'));         // login endpoints
app.use('/api/students', require('./routes/studentRoutes'));  // student profile/dashboard data
app.use('/api/teachers', require('./routes/teacherRoutes'));  // teacher profile/class/reports
app.use('/api/reports', require('./routes/reportRoutes'));    // viewing/printing report cards
app.use('/api/payments', require('./routes/paymentRoutes'));  // Paystack fee payments
app.use('/api/announcements', require('./routes/announcementRoutes')); // public school announcements
app.use('/api/admin', require('./routes/adminRoutes'));       // admin panel: manage students/teachers/classrooms

// ---------------------- FALLBACK ROUTE ----------------------
// If someone visits any unknown page, just send them the home page instead of an error.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------- START SERVER ----------------------
const DEFAULT_PORT = Number(process.env.PORT) || 5000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`🚀 School Management System running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on http://localhost:${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('❌ Server failed to start:', error);
    process.exit(1);
  });
}

startServer(DEFAULT_PORT);
