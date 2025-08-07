const express = require('express');    
const cors = require('cors');    
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));    
require('dotenv').config();  
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
    
const app = express();    
const PORT = process.env.PORT || 5000;    
    
// ✅ CORS: allow frontend hosted on Vercel    
const allowedOrigins = [    
  'https://www.wellmedai.com',    
  'http://localhost:5173'    
];    

// Multer config for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});




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


const pdfSessions = {}; // Store parsed PDF text by sessionId
// ✅ In-memory session storage    
const chatSessions = {};    
/**    
✅ Classifies if the message is medical-related using OpenAI    
*/    
    
    
async function isMedicalQuery(messages) {    
  const classificationPrompt = [    
    {    
      role: 'system',    
      content: `You are a strict binary classifier that determines whether the latest user message is related to any medical topic — including implied or indirect references — based on the full conversation history.

Medical topics include:
- Symptoms (e.g., fever, stomach pain, dizziness, fatigue, “not feeling well”)
- Diseases and conditions (e.g., diabetes, typhoid, asthma, cancer)
- Medications or drugs (e.g., paracetamol, antibiotics, dosage, side effects)
- Diagnosis or treatment (e.g., test results, prescriptions, therapy, reports)
- Clinical procedures or scans (e.g., MRI, surgery, CT, biopsy, X-ray)
- Insurance, billing, codes (e.g., CPT, ICD, reimbursements, pre-auths)
- Healthcare services or logistics (e.g., OPD, appointments, telehealth)
- Anatomy and body parts (e.g., heart, liver, joints, nerves)
- Mental health (e.g., depression, anxiety, therapy)
- Medical equipment or vitals (e.g., glucometer, BP monitor, oxygen levels)

However, users often follow up without repeating medical words. You must:
- Treat vague replies as medical if the previous message was medical
- Consider indirect intent or emotional expressions (e.g., “Should I worry?” after a symptom)
- Use full chat history for meaning, not just the current message
- Be generous in interpreting common language that relates to health, wellness, or the body

Examples:
- “What should I do next?” (after “I have chest pain”) → yes  
- “How long will it take?” (after mentioning antibiotics) → yes  
- “Can I still work today?” (after a fever) → yes  
- “Is it okay?” (after a lab report) → yes  
- “What’s your name?” → no  
- “What’s the weather?” → no  

Respond with one word only: **yes** or **no** (no punctuation).`
   },    
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
      model = 'gpt-4o',
      max_tokens = 20000,
      temperature = 0.7,
    } = req.body;

    if (!sessionId || !message || message.role !== 'user') {
      return res.status(400).json({ error: 'Missing or invalid sessionId or message' });
    }

    // Initialize session if not exists
    if (!chatSessions[sessionId]) {
      chatSessions[sessionId] = [
        {
          role: 'system',
          content: 'You are WellMed AI, a helpful assistant specialized in medical coding and healthcare support.'
        }
      ];
    }

    const chatHistory = chatSessions[sessionId];
    const pdfText = pdfSessions[sessionId] || '';

    // Prepare classifier messages
    const classifierMessages = [...chatHistory];

    // ✅ Inject PDF context into classifier messages if not already present
    if (
      pdfText &&
      !classifierMessages.some(m => m.role === 'system' && m.content.includes('PDF:'))
    ) {
      classifierMessages.unshift({
        role: 'system',
        content: `PDF: ${pdfText.slice(0, 2000)}`
      });
    }

    // ✅ Classify with latest message included (fix for vague follow-ups)
    const allowed = await isMedicalQuery([...classifierMessages, message]);

    if (!allowed) {
      const warning = {
        role: 'assistant',
        content: "❌ Sorry, WellMed AI is strictly a medical coding and healthcare assistant. We can't respond to unrelated topics.",
      };
      chatHistory.push(message, warning);
      return res.json({ choices: [{ message: warning }] });
    }

    // ✅ Inject PDF content into main GPT context only once
    if (
      pdfText &&
      !chatHistory.some(m => m.role === 'system' && m.content.includes('PDF:'))
    ) {
      chatHistory.splice(1, 0, {
        role: 'system',
        content: `📄 The user has uploaded a medical document. Here's the content:\n\n${pdfText.slice(0, 3000)}`
      });
    }

    // ✅ Append the current user message to the chat
    chatHistory.push(message);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: chatHistory,
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
      chatHistory.push(assistantReply);
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







// ✅ PDF Analysis Endpoint
app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId; // Frontend must send this with PDF upload

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId in PDF upload' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const pdfBuffer = req.file.buffer;
    const pdfData = await pdfParse(pdfBuffer); // ✅ parse first

    pdfSessions[sessionId] = pdfData.text; // ✅ now safe to access

    res.json({
      success: true,
      text: pdfData.text,
      pages: pdfData.numpages,
      info: pdfData.info,
    });
  } catch (error) {
    console.error('PDF Analysis Error:', error);
    res.status(500).json({
      error: 'PDF Analysis Error',
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
  
