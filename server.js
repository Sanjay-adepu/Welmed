const express = require('express');    
const cors = require('cors');    
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));    
require('dotenv').config();    
    
const app = express();    
const PORT = process.env.PORT || 5000;    
    
// ✅ CORS: allow frontend hosted on Vercel    
const allowedOrigins = [    
  'https://www.wellmedai.com',    
  'http://localhost:5173'    
];    
    
app.use(cors({    
  origin: function (origin, callback) {    
    // Allow requests with no origin (e.g. curl or mobile apps)    
    if (!origin || allowedOrigins.includes(origin)) {    
      callback(null, true);    
    } else {    
      callback(new Error('Not allowed by CORS'));    
    }    
  },    
  credentials: true    
}));    
    
app.use(express.json());    
// ✅ In-memory session storage    
const chatSessions = {};    
/**    
✅ Classifies if the message is medical-related using OpenAI    
*/    
    
    
async function isMedicalQuery(messages) {    
  const classificationPrompt = [    
    {    
      role: 'system',    
      content: `You are a strict binary classifier that determines if the latest user message — possibly a follow-up — is related to any medical topic, even if phrased indirectly.

Relevant medical topics include:
- Symptoms (e.g., fever, dizziness, stomach pain)
- Illnesses or diagnoses (e.g., cold, flu, cancer, diabetes)
- Medications or dosages (e.g., paracetamol, ibuprofen)
- Recovery or duration questions (e.g., "how long will it last", "how long does it take to go away", "when will I get better", "how long will this fever last")
- Tests and procedures (e.g., X-ray, MRI, surgery)
- Treatments or therapies
- Mental health
- Any healthcare-related concern

Important:
- Treat vague follow-ups as medical if the prior message was medical (e.g., "how long does it take to go away?" right after "I have a fever").
- Be generous in interpreting intent — users may phrase things differently but still mean the same.
- Consider the full conversation for context.
- If the latest message is related to medicine, health, body, symptoms, treatments, or follow-up to such — return "yes".

Respond only with one word: "yes" or "no" — no punctuation.`   },    
    ...messages    
  ];    
    
  const response = await fetch('https://api.openai.com/v1/chat/completions', {    
    method: 'POST',    
    headers: {    
      'Content-Type': 'application/json',    
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,    
    },    
    body: JSON.stringify({    
      model: 'gpt-4o',    
      messages: classificationPrompt,    
      max_tokens: 1,    
      temperature: 0,    
    }),    
  });    
    
  const data = await response.json();    
  const classification = data.choices?.[0]?.message?.content?.trim().toLowerCase();    
  return classification === 'yes';    
}    
      
/**    
✅ Proxy endpoint for OpenAI API    
Filters non-medical requests using the classifier before forwarding    
*/    
    
app.post('/api/chat', async (req, res) => {    
  try {    
    const {    
      sessionId,    
      message, // { role: 'user', content: '...' }    
      model = 'gpt-4o-mini',    
      max_tokens = 1000,    
      temperature = 0.7,    
    } = req.body;    
    
    if (!sessionId || !message || message.role !== 'user') {    
      return res.status(400).json({ error: 'Missing or invalid sessionId or message' });    
    }    
    
    if (!chatSessions[sessionId]) {    
      chatSessions[sessionId] = [    
        { role: 'system', content: 'You are WellMed AI, a helpful assistant specialized in medical coding and healthcare support.' }    
      ];    
    }    
    
    chatSessions[sessionId].push(message);    
    
    const allowed = await isMedicalQuery(chatSessions[sessionId]);    
    
    if (!allowed) {    
      const warning = {    
        role: 'assistant',    
        content: "❌ Sorry, WellMed AI is strictly a medical coding and healthcare assistant. We can't respond to unrelated topics.",    
      };    
      chatSessions[sessionId].push(warning);    
      return res.json({    
        choices: [{ message: warning }]    
      });    
    }    
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {    
      method: 'POST',    
      headers: {    
        'Content-Type': 'application/json',    
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,    
      },    
      body: JSON.stringify({    
        model,    
        messages: chatSessions[sessionId],    
        max_tokens,    
        temperature,    
      }),    
    });    
    
    const data = await response.json();    
    
    if (!response.ok) {    
      console.error('OpenAI API Error:', data);    
      return res.status(response.status).json({    
        error: 'OpenAI API Error',    
        details: data.error?.message || 'Unknown error',    
      });    
    }    
    
    const assistantReply = data.choices?.[0]?.message;    
    if (assistantReply) {    
      chatSessions[sessionId].push(assistantReply);    
    }    
    
    res.json(data);    
  } catch (error) {    
    console.error('Server Error:', error);    
    res.status(500).json({    
      error: 'Internal Server Error',    
      details: error.message,    
    });    
  }    
});    
    
    
    
    
/**    
✅ Health check endpoint    
*/    
app.get('/api/health', (req, res) => {    
  res.json({    
    status: 'OK',    
    message: 'Server is running',    
    environment: process.env.NODE_ENV || 'development',    
  });    
});    
    
// ✅ Start the server    
app.listen(PORT, () => {    
  console.log(`✅ Server running on port ${PORT}`);    
  console.log(`🌐 CORS allowed from: ${allowedOrigins.join(', ')}`);    
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);    
});    
    
module.exports = app;  
  
