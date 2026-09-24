require('dotenv').config();
const crypto = require('crypto');

const payload = {
  event: 'charge.success',
  data: {
    id: 1234567890,
    reference: `SIS-${Date.now()}`,
    amount: 50000,
    currency: 'GHS',
    status: 'success',
    email: 'student1@example.com',
    customer: {
      email: 'student1@example.com',
      id: 999,
    },
    metadata: {
      studentId: 1,
      fullName: 'Kwame Mensah',
    },
  },
};

const raw = JSON.stringify(payload);
const secret = process.env.PAYSTACK_SECRET_KEY || 'test_secret';
const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');

fetch('http://localhost:5010/api/payments/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-paystack-signature': signature,
  },
  body: raw,
})
  .then(async (response) => {
    const text = await response.text();
    console.log('status:', response.status);
    console.log('response:', text);
  })
  .catch((error) => {
    console.error('Webhook test failed:', error.message);
    process.exit(1);
  });
