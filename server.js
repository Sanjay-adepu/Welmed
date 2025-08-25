// server.js

const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 5000;

// Prefer env var; fallback to hardcoded key (discouraged in production)
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyCinlkzHBLh0p214yPkXZP1d1zzYedLIsg";

// -------- Multer config for PDF uploads --------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  },
});

// -------- CORS config --------
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://www.wellmedai.com',
  'https://el-front-umber.vercel.app'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());

// -------- Helpers --------
const toGeminiRole = (role) => (role === 'assistant' ? 'model' : 'user');

async function callGemini(model, { systemText, contents }) {
  const body = {
    system_instruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents,
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    // Provide best-effort detail back to client
    const details =
      data.error?.message ||
      data.promptFeedback?.blockReason ||
      data.candidates?.[0]?.finishReason ||
      'Unknown error';
    const status = response.status || 500;
    throw Object.assign(new Error(details), { status, raw: data });
  }

  return data;
}

// -------- PDF Analysis Endpoint --------
app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const pdfBuffer = req.file.buffer;
    const pdfData = await pdfParse(pdfBuffer);

    res.json({
      success: true,
      text: pdfData.text,
      pages: pdfData.numpages,
      info: pdfData.info,
    });
  } catch (error) {
    console.error('PDF Analysis Error:', error);
    res.status(500).json({ error: 'PDF Analysis Error', details: error.message });
  }
});

// -------- Chat Endpoint (Gemini) --------
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const geminiMessages = messages.map((m) => ({
      role: toGeminiRole(m.role),
      parts: [{ text: m.content ?? '' }],
    }));

    const systemText =
      "You are Wellmed AI, a helpful assistant developed by Chakri. " +
      "You specialize in medical coding and related topics. " +
      "Do not mention OpenAI, GPT, ChatGPT, or your origins. " +
      "Always stay in character as Wellmed AI.";

    const data = await callGemini('gemini-2.0-flash', {
      systemText,
      contents: geminiMessages,
    });

    res.json(data);
  } catch (error) {
    console.error('Gemini API Error:', error.raw || error);
    res
      .status(error.status || 500)
      .json({ error: 'Gemini API Error', details: error.message });
  }
});

// -------- Chat with PDF Context --------
app.post('/api/chat1', async (req, res) => {
  try {
    const { messages = [], pdfContent } = req.body;

    const geminiMessages = messages.map((m) => ({
      role: toGeminiRole(m.role),
      parts: [{ text: m.content ?? '' }],
    }));

    const baseSystem =
      "You are Wellmed AI, a helpful assistant developed by Chakri. " +
      "You specialize in medical coding and related topics. " +
      "Do not mention OpenAI, GPT, ChatGPT, or your origins.";

    const systemText = pdfContent
      ? `${baseSystem}\n\nThe user has provided the following PDF content for reference:\n${pdfContent}`
      : baseSystem;

    const data = await callGemini('gemini-2.0-flash', {
      systemText,
      contents: geminiMessages,
    });

    res.json(data);
  } catch (error) {
    console.error('Gemini API Error:', error.raw || error);
    res
      .status(error.status || 500)
      .json({ error: 'Gemini API Error', details: error.message });
  }
});

// -------- Health Check --------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    environment: process.env.NODE_ENV || 'development',
  });
});

// -------- Start Server --------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 CORS allowed from: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📄 PDF Analysis endpoint: http://localhost:${PORT}/api/analyze-pdf`);
});

module.exports = app;
