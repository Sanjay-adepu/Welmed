
          
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 5000;

// Gemini API key (direct usage, no env file)
const GEMINI_API_KEY = "AIzaSyBTQfMY_Vpdin_5DWTbw12zOGg2bzFwQdE";

// Multer config for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  },
});

// CORS config
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

// ✅ PDF Analysis Endpoint
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

// ✅ Chat Endpoint (Gemini)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    // Convert messages into Gemini format
    const geminiMessages = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // Inject system prompt
    geminiMessages.unshift({
      role: "system",
      parts: [{
        text: "You are Wellmed AI, a helpful assistant developed by Chakri. You specialize in medical coding and related topics. Do not mention OpenAI, GPT, ChatGPT, or your origins. Always stay in character as Wellmed AI."
      }]
    });

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: geminiMessages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);
      return res.status(response.status).json({ error: "Gemini API Error", details: data.error?.message || "Unknown error" });
    }

    res.json(data);
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// ✅ Chat with PDF Context
app.post('/api/chat1', async (req, res) => {
  try {
    const { messages, pdfContent } = req.body;

    const geminiMessages = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // System prompt
    const systemPrompt = {
      role: "system",
      parts: [{
        text: "You are Wellmed AI, a helpful assistant developed by Chakri. You specialize in medical coding and related topics. Do not mention OpenAI, GPT, ChatGPT, or your origins."
      }]
    };

    // Context injection
    const contextPrompt = pdfContent
      ? { role: "system", parts: [{ text: `The user has provided the following PDF content for reference:\n${pdfContent}` }] }
      : null;

    const finalMessages = contextPrompt
      ? [systemPrompt, contextPrompt, ...geminiMessages]
      : [systemPrompt, ...geminiMessages];

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: finalMessages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);
      return res.status(response.status).json({ error: "Gemini API Error", details: data.error?.message || "Unknown error" });
    }

    res.json(data);
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// ✅ Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running', environment: process.env.NODE_ENV || 'development' });
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 CORS allowed from: https://www.wellmedai.com`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📄 PDF Analysis endpoint: http://localhost:${PORT}/api/analyze-pdf`);
});

module.exports = app;
