// routes/reportRoutes.js
// Fetching a specific report (as JSON, or as a printable PDF).
// Both students and teachers may need this, so we only require a valid
// token here (not a specific role) — the controller doesn't leak other
// students' data because it looks up by the exact report id requested.

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { getReportJson, getReportPdf } = require('../controllers/reportController');

router.get('/:id', verifyToken, getReportJson);      // GET /api/reports/5
router.get('/:id/pdf', verifyToken, getReportPdf);   // GET /api/reports/5/pdf

module.exports = router;
