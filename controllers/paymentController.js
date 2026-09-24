// controllers/paymentController.js
// Handles school fee payments through Paystack.
//
// FLOW:
// 1. Student clicks "Pay Fees" on their dashboard.
// 2. Frontend calls POST /api/payments/initialize -> we ask Paystack to start
//    a transaction and get back an "authorization_url".
// 3. Frontend redirects the student to that Paystack checkout page.
// 4. After paying, Paystack redirects back to our site with a "reference".
// 5. Frontend calls GET /api/payments/verify/:reference -> we ask Paystack to
//    confirm the payment really succeeded, then update the student's balance.
//
// We always verify with Paystack's server before trusting a payment —
// never trust the frontend alone, since that could be faked.

const axios = require('axios'); // used to call Paystack's REST API
const crypto = require('crypto');
const pool = require('../config/db');
require('dotenv').config();

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

async function handlePaystackWebhook(req, res) {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    if (!signature || !rawBody || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ message: 'Invalid webhook payload.' });
    }

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(rawBody)
      .digest('hex');

    const expected = Buffer.from(hash, 'hex');
    const provided = Buffer.from(signature, 'hex');

    if (provided.length !== expected.length || !crypto.timingSafeEqual(expected, provided)) {
      return res.status(401).json({ message: 'Unauthorized webhook request.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    if (!payload || payload.event !== 'charge.success') {
      return res.status(200).json({ received: true, ignored: true });
    }

    const paymentData = payload.data || {};
    const reference = paymentData.reference;
    const amountPaidGhs = Number(paymentData.amount || 0) / 100;
    const email = paymentData.customer?.email || paymentData.email;
    const studentIdFromMetadata = paymentData.metadata?.studentId || paymentData.metadata?.student_id;

    if (!reference || !amountPaidGhs || !email) {
      return res.status(400).json({ message: 'Incomplete Paystack webhook payload.' });
    }

    let studentId = Number(studentIdFromMetadata);
    if (!studentId || Number.isNaN(studentId)) {
      const studentResult = await pool.query('SELECT id FROM students WHERE email = $1 LIMIT 1', [email]);
      if (studentResult.rowCount === 0) {
        return res.status(200).json({ received: true, ignored: true });
      }
      studentId = studentResult.rows[0].id;
    }

    const inserted = await pool.query(
      `INSERT INTO payments (student_id, amount, paystack_reference, status)
       VALUES ($1, $2, $3, 'success')
       ON CONFLICT (paystack_reference) DO NOTHING
       RETURNING id`,
      [studentId, amountPaidGhs, reference]
    );

    if (inserted.rowCount > 0) {
      await pool.query(
        'UPDATE students SET amount_paid = amount_paid + $1 WHERE id = $2',
        [amountPaidGhs, studentId]
      );
    }

    return res.status(200).json({ received: true, status: 'success' });
  } catch (error) {
    console.error('Paystack webhook error:', error.message);
    return res.status(400).json({ message: 'Invalid Paystack webhook payload.' });
  }
}

// ---------------------------------------------------------------
// POST /api/payments/initialize
// Body: { amount }  (amount in Ghana Cedis, e.g. 500.00)
// ---------------------------------------------------------------
async function initializePayment(req, res) {
  try {
    const studentId = req.user.id; // from the verified JWT
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid amount to pay.' });
    }

    // Get the student's email (Paystack requires an email for every transaction)
    const studentResult = await pool.query('SELECT email, full_name FROM students WHERE id = $1', [studentId]);
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    const student = studentResult.rows[0];

    // Paystack amounts are in the SMALLEST currency unit (pesewas, like cents),
    // so we multiply by 100.
    const amountInPesewas = Math.round(amount * 100);

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Ask Paystack to start a new transaction
    const paystackResponse = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email: student.email || `student${studentId}@school.local`, // fallback if no email on file
        amount: amountInPesewas,
        currency: 'GHS', // Ghana Cedis
        metadata: { studentId, fullName: student.full_name },
        // Paystack will send the student back to this page after paying
        callback_url: `${baseUrl}/payment-callback.html`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // proves the request comes from our server
          'Content-Type': 'application/json',
        },
      }
    );

    // Send the checkout URL + reference back to the frontend so it can redirect the student
    res.json({
      authorizationUrl: paystackResponse.data.data.authorization_url,
      reference: paystackResponse.data.data.reference,
    });
  } catch (error) {
    console.error('Paystack initialize error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Could not start payment. Please try again.' });
  }
}

// ---------------------------------------------------------------
// GET /api/payments/verify/:reference
// Confirms with Paystack that the payment actually succeeded, then
// credits the student's account and logs the payment.
// ---------------------------------------------------------------
async function verifyPayment(req, res) {
  try {
    const studentId = req.user.id;
    const { reference } = req.params;

    // Ask Paystack directly whether this transaction really succeeded.
    // This step is essential — never just trust a "success" message from the browser.
    const verifyResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const paymentData = verifyResponse.data.data;

    if (paymentData.status !== 'success') {
      return res.status(400).json({ message: 'Payment was not successful.' });
    }

    const amountPaidGhs = paymentData.amount / 100; // convert back from pesewas to cedis

    // Record the payment in our own database (avoids double-crediting the same reference
    // thanks to the UNIQUE constraint on paystack_reference)
    await pool.query(
      `INSERT INTO payments (student_id, amount, paystack_reference, status)
       VALUES ($1, $2, $3, 'success')
       ON CONFLICT (paystack_reference) DO NOTHING`,
      [studentId, amountPaidGhs, reference]
    );

    // Add the amount to the student's running total
    await pool.query(
      'UPDATE students SET amount_paid = amount_paid + $1 WHERE id = $2',
      [amountPaidGhs, studentId]
    );

    // Return the student's updated balance so the dashboard can refresh instantly
    const updated = await pool.query(
      'SELECT total_fees_due, amount_paid FROM students WHERE id = $1',
      [studentId]
    );

    res.json({
      message: 'Payment verified and recorded successfully.',
      amountPaid: amountPaidGhs,
      newBalance: updated.rows[0].total_fees_due - updated.rows[0].amount_paid,
    });
  } catch (error) {
    console.error('Paystack verify error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Could not verify payment.' });
  }
}

// ---------------------------------------------------------------
// GET /api/payments/history — a student's past payments
// ---------------------------------------------------------------
async function getPaymentHistory(req, res) {
  try {
    const studentId = req.user.id;
    const result = await pool.query(
      'SELECT amount, paystack_reference, status, paid_at FROM payments WHERE student_id = $1 ORDER BY paid_at DESC',
      [studentId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ message: 'Could not load payment history.' });
  }
}

module.exports = { initializePayment, verifyPayment, getPaymentHistory, handlePaystackWebhook };
