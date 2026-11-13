require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Validate environment variables
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.warn('⚠️ WARNING: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing in .env file!');
}

// Initialize Razorpay SDK instance
const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET
});

// Provide public configuration (Key ID only - NEVER expose Secret)
app.get('/api/config', (req, res) => {
  res.json({
    key_id: process.env.RAZORPAY_KEY_ID || ''
  });
});

/**
 * STEP 1: BACKEND - Create Order
 * Endpoint: POST /api/create-order
 * Request: { amount (in paise), currency, receipt }
 * Return: { order_id, amount, currency }
 */
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;

    // Validate amount
    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount < 100) {
      return res.status(400).json({
        error: 'Invalid amount. Minimum amount is 100 paise (₹1.00).'
      });
    }

    if (!KEY_ID || !KEY_SECRET) {
      return res.status(401).json({
        error: 'Razorpay API credentials not configured on server.'
      });
    }

    const options = {
      amount: parsedAmount, // amount in paise
      currency: currency.toUpperCase(),
      receipt: receipt || `rcpt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    if (error.statusCode === 401 || (error.error && error.error.code === 'BAD_REQUEST_ERROR' && error.error.description?.includes('auth'))) {
      return res.status(401).json({
        error: 'Razorpay authentication failed. Please check your Key ID and Key Secret.'
      });
    }
    return res.status(error.statusCode || 500).json({
      error: error.error?.description || error.message || 'Failed to create Razorpay order'
    });
  }
});

/**
 * STEP 3: BACKEND - Verify Signature
 * Endpoint: POST /api/verify-payment
 * Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
 */
app.post('/api/verify-payment', (req, res) => {
  try {
    const order_id = req.body.razorpay_order_id || req.body.order_id;
    const payment_id = req.body.razorpay_payment_id || req.body.payment_id;
    const signature = req.body.razorpay_signature || req.body.signature;

    // Validate presence of all three fields
    if (!order_id || !payment_id || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.'
      });
    }

    if (!KEY_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: Key Secret missing.'
      });
    }

    // Generate expected HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', KEY_SECRET);
    hmac.update(`${order_id}|${payment_id}`);
    const generatedSignature = hmac.digest('hex');

    // Secure timing-safe string comparison
    const bufGenerated = Buffer.from(generatedSignature, 'utf-8');
    const bufReceived = Buffer.from(signature, 'utf-8');
    const isMatch = (bufGenerated.length === bufReceived.length) && crypto.timingSafeEqual(bufGenerated, bufReceived);

    if (isMatch) {
      return res.status(200).json({
        success: true,
        message: 'Payment signature verified successfully',
        order_id,
        payment_id
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment signature. Payment verification failed.'
      });
    }
  } catch (error) {
    console.error('Error verifying payment signature:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error during signature verification'
    });
  }
});

// Admin panel route
app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`⚡ SPIDEY COLLECTIONS server running on http://localhost:${PORT}`);
  console.log(`💳 Razorpay Checkout endpoints ready:`);
  console.log(`   - POST http://localhost:${PORT}/api/create-order`);
  console.log(`   - POST http://localhost:${PORT}/api/verify-payment`);
});
