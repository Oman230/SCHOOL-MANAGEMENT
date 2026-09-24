// controllers/reportController.js
// Builds the full terminal report (student info + all subject scores)
// and streams it back to the browser as a downloadable/printable PDF,
// styled like a standard Ghana Education Service terminal report.

const pool = require('../config/db');
const PDFDocument = require('pdfkit'); // library that draws PDF documents
require('dotenv').config();

// ---------------------------------------------------------------
// Shared helper: fetches everything needed to render one report
// (used by both the JSON endpoint and the PDF endpoint)
// ---------------------------------------------------------------
async function fetchFullReport(reportId) {
  // Get the report + student + classroom details in one query
  const reportResult = await pool.query(
    `SELECT r.*, s.full_name AS student_name, s.student_id_number,
            c.name AS classroom_name, c.level AS classroom_level,
            t.full_name AS teacher_name
     FROM reports r
     JOIN students s ON r.student_id = s.id
     LEFT JOIN classrooms c ON s.classroom_id = c.id
     LEFT JOIN teachers t ON r.teacher_id = t.id
     WHERE r.id = $1`,
    [reportId]
  );

  if (reportResult.rows.length === 0) return null;
  const report = reportResult.rows[0];

  // Get every subject score that belongs to this report
  const scoresResult = await pool.query(
    `SELECT rs.*, sub.name AS subject_name
     FROM report_scores rs
     JOIN subjects sub ON rs.subject_id = sub.id
     WHERE rs.report_id = $1
     ORDER BY sub.name ASC`,
    [reportId]
  );

  report.scores = scoresResult.rows; // attach the list of subject scores
  return report;
}

// ---------------------------------------------------------------
// GET /api/reports/:id  — plain JSON version (used if the frontend wants to
// show the report on-screen before printing)
// ---------------------------------------------------------------
async function getReportJson(req, res) {
  try {
    const report = await fetchFullReport(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    res.json(report);
  } catch (error) {
    console.error('Get report JSON error:', error);
    res.status(500).json({ message: 'Could not load report.' });
  }
}

// ---------------------------------------------------------------
// GET /api/reports/:id/pdf — generates and streams a PDF report card
// ---------------------------------------------------------------
async function getReportPdf(req, res) {
  try {
    const report = await fetchFullReport(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });

    // Tell the browser this response is a PDF file it can display/download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${report.student_name.replace(/\s+/g, '_')}_${report.term}_report.pdf"`
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' }); // start a new PDF page
    doc.pipe(res); // stream the PDF straight to the browser as it's built

    // ---------- HEADER: school logo + school name, address, phone ----------
    const logoPath = require('path').join(__dirname, '..', 'assets', 'logo.png');

    try {
      doc.image(logoPath, 40, 35, { width: 52, height: 52 });
    } catch (error) {
      doc.save();
      doc.fillColor('#1d4ed8').roundedRect(40, 35, 52, 52, 12).fill();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('SIS', 48, 48, {
        width: 36,
        align: 'center',
      });
      doc.restore();
    }

    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(process.env.SCHOOL_NAME || 'Sunrise International School', 110, 50);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(process.env.SCHOOL_ADDRESS || '123 School Road, Accra', 110, 78)
      .text(`Tel: ${process.env.SCHOOL_PHONE || '+233 24 000 0000'}`, 110, 94);

    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('TERMINAL REPORT', { align: 'center' });
    doc.moveDown(1);

    // ---------- STUDENT INFO BLOCK ----------
    doc.fontSize(11).font('Helvetica');
    doc.text(`Name: ${report.student_name}`, { continued: true });
    doc.text(`      Student ID: ${report.student_id_number}`, { align: 'right' });
    doc.text(`Class: ${report.classroom_name || '-'}`, { continued: true });
    doc.text(`      Academic Year: ${report.academic_year}`, { align: 'right' });
    doc.text(`Term: ${report.term}`, { continued: true });
    doc.text(`      Attendance: ${report.attendance || '-'}`, { align: 'right' });
    doc.moveDown(1);

    // ---------- SCORES TABLE ----------
    // Draw simple table headers
    const tableTop = doc.y;
    const col = { subject: 40, classScore: 220, examScore: 300, total: 380, grade: 440, remark: 490 };

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Subject', col.subject, tableTop);
    doc.text('Class Score', col.classScore, tableTop);
    doc.text('Exam Score', col.examScore, tableTop);
    doc.text('Total', col.total, tableTop);
    doc.text('Grade', col.grade, tableTop);
    doc.text('Remark', col.remark, tableTop);

    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke(); // header underline

    let rowY = tableTop + 22;
    doc.font('Helvetica').fontSize(10);

    // Loop through every subject and print its row
    report.scores.forEach((score) => {
      doc.text(score.subject_name, col.subject, rowY);
      doc.text(String(score.class_score), col.classScore, rowY);
      doc.text(String(score.exam_score), col.examScore, rowY);
      doc.text(String(score.total_score), col.total, rowY);
      doc.text(score.grade || '-', col.grade, rowY);
      doc.text(score.subject_remark || '-', col.remark, rowY);
      rowY += 20; // move down for the next subject row
    });

    doc.moveTo(40, rowY).lineTo(555, rowY).stroke(); // bottom border of the table
    rowY += 20;

    // ---------- OVERALL SUMMARY ----------
    const totalScores = report.scores.map((s) => Number(s.total_score));
    const average = totalScores.length
      ? (totalScores.reduce((a, b) => a + b, 0) / totalScores.length).toFixed(1)
      : '0';

    doc.font('Helvetica-Bold').text(`Overall Average: ${average}`, 40, rowY);
    rowY += 30;

    // ---------- REMARKS ----------
    doc.font('Helvetica-Bold').text('Class Teacher\'s Remark:', 40, rowY);
    doc.font('Helvetica').text(report.class_teacher_remark || '-', 40, rowY + 15, { width: 500 });
    rowY += 55;

    doc.font('Helvetica-Bold').text('Head Teacher\'s Remark:', 40, rowY);
    doc.font('Helvetica').text(report.headteacher_remark || '-', 40, rowY + 15, { width: 500 });
    rowY += 60;

    // ---------- SIGNATURE LINES ----------
    doc.text('_____________________', 40, rowY);
    doc.text('Class Teacher\'s Signature', 40, rowY + 15);
    doc.text('_____________________', 320, rowY);
    doc.text('Head Teacher\'s Signature', 320, rowY + 15);

    doc.end(); // finalize the PDF — this triggers the stream to finish sending
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ message: 'Could not generate PDF report.' });
  }
}

module.exports = { getReportJson, getReportPdf };
