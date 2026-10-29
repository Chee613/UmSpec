/**
 * UmSpec - SPeCTRUM Course Exporter AI Proxy Server
 * 
 * Secure backend service that keeps Gemini API keys safe in .env,
 * provides automatic round-robin key pool load balancing,
 * handles 429 quota rotation, and cascades to fallback models.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Local in-memory cache for analyzed proformas and courses
const proformaCache = new Map();
const courseCache = new Map();

// Enable CORS for Chrome Extension requests & local testing
app.use(cors({
  origin: '*', // Allows Chrome extensions (chrome-extension://*) and local dev
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));

// Parse Key Pool from .env
function getKeyPool() {
  const raw = process.env.GEMINI_API_KEYS || '';
  return raw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
}

let currentKeyIndex = 0;

// Health check endpoint
app.get('/api/health', (req, res) => {
  const keys = getKeyPool();
  res.json({
    status: 'ok',
    keysLoaded: keys.length,
    primaryModel: process.env.PRIMARY_MODEL || 'gemini-3.5-flash-lite',
    fallbackModel: process.env.FALLBACK_MODEL || 'gemini-3.1-flash-lite',
    cachedProformas: proformaCache.size,
    timestamp: new Date().toISOString()
  });
});

// Campus Cache Lookup (GET /api/v1/course/:code/deadlines)
app.get('/api/v1/course/:code/deadlines', (req, res) => {
  const courseCode = req.params.code.toUpperCase();
  const year = req.query.year || 'CURRENT';
  const sem = req.query.sem || '1';

  const exactKey = `course:${courseCode}:${year}_${sem}`;
  const latestKey = `course:${courseCode}:LATEST`;

  const cached = courseCache.get(exactKey) || courseCache.get(latestKey);
  if (cached) {
    return res.json({
      ...cached,
      cached: true
    });
  }

  return res.status(404).json({
    cached: false,
    courseCode,
    message: 'Course not yet indexed in campus cache. Submit proforma via /api/v1/ingest/course.'
  });
});

// Decentralized Course Ingestion (POST /api/v1/ingest/course)
app.post('/api/v1/ingest/course', async (req, res) => {
  const keys = getKeyPool();
  if (keys.length === 0) {
    return res.status(500).json({
      error: 'No Gemini API keys configured on server. Please add GEMINI_API_KEYS to your .env file.'
    });
  }

  const {
    courseCode,
    courseName,
    academicYear = 'CURRENT',
    semester = 1,
    faculty = '',
    rawText = '',
    pdfBase64 = null,
    primaryModel,
    fallbackModel
  } = req.body;

  if (!courseCode || (!rawText && !pdfBase64)) {
    return res.status(400).json({
      error: 'Missing required parameters: courseCode and either rawText or pdfBase64 required.'
    });
  }

  const cleanCode = courseCode.toUpperCase().trim();
  const cacheKey = `course:${cleanCode}:${academicYear}_${semester}`;

  if (courseCache.has(cacheKey)) {
    return res.json({
      ...courseCache.get(cacheKey),
      cached: true
    });
  }

  const prompt = `You are an academic analysis assistant for Universiti Malaya (UM).
Analyze this official Course Proforma / Syllabus / Outline for "${cleanCode} - ${courseName || cleanCode}".
${rawText ? `Content:\n${rawText}\n` : ''}
Extract:
1. Continuous assessment components (Assignments, Quizzes, Lab Tests, Mid-Terms, Presentations, Final Examination).
2. Weightage percentage (e.g. "10%", "20%").
3. Due week (e.g. "Week 6", "Week 14") and estimated date if specified.
4. Brief description of requirements.
5. High-level course summary.

Output STRICTLY a JSON object with this exact structure:
{
  "courseCode": "${cleanCode}",
  "courseName": "${courseName || cleanCode}",
  "assessments": [
    {
      "name": "Assignment 1",
      "type": "Assignment",
      "weightage": "15%",
      "dueWeek": "Week 6",
      "estimatedDate": "2026-11-15",
      "description": "Short description of deliverable"
    }
  ],
  "summary": "Brief 1-2 sentence overview of the course scope and objectives"
}`;

  const primary = primaryModel || process.env.PRIMARY_MODEL || 'gemini-3.5-flash-lite';
  const fallback = fallbackModel || process.env.FALLBACK_MODEL || 'gemini-3.1-flash-lite';
  const modelsToTry = [primary, fallback, 'gemini-2.0-flash', 'gemini-1.5-flash']
    .filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];

    for (let k = 0; k < keys.length; k++) {
      const keyIndex = (currentKeyIndex + k) % keys.length;
      const apiKey = keys[keyIndex];

      const parts = [{ text: prompt }];
      if (pdfBase64) {
        parts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64
          }
        });
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const geminiRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        });

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (text) {
            let parsed = null;
            try {
              const cleanJson = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
              parsed = JSON.parse(cleanJson);
            } catch (e) {
              console.warn('[UmSpec Proxy] JSON parse warning:', e.message);
            }

            const courseRecord = {
              courseCode: cleanCode,
              courseName: parsed?.courseName || courseName || cleanCode,
              academicYear,
              semester,
              faculty,
              assessments: Array.isArray(parsed?.assessments) ? parsed.assessments : [],
              summary: parsed?.summary || '',
              modelUsed: currentModel,
              lastUpdated: new Date().toISOString(),
              cached: false
            };

            courseCache.set(cacheKey, courseRecord);
            courseCache.set(`course:${cleanCode}:LATEST`, courseRecord);
            currentKeyIndex = (keyIndex + 1) % keys.length;

            return res.json(courseRecord);
          }
        }

        if (geminiRes.status === 429) {
          lastError = new Error(`Key #${keyIndex + 1} hit quota (429) on ${currentModel}`);
          continue;
        }

        if (geminiRes.status === 404 || geminiRes.status === 400) {
          lastError = new Error(`Model ${currentModel} returned ${geminiRes.status}`);
          break;
        }

        const errText = await geminiRes.text();
        lastError = new Error(`HTTP ${geminiRes.status}: ${errText.slice(0, 100)}`);
      } catch (err) {
        lastError = err;
      }
    }
  }

  return res.status(502).json({
    error: lastError ? lastError.message : 'All Gemini models and API keys exhausted.'
  });
});

// Proforma Deadline Analysis Endpoint
app.post('/api/analyze-proforma', async (req, res) => {
  const keys = getKeyPool();
  if (keys.length === 0) {
    return res.status(500).json({
      error: 'No Gemini API keys configured on server. Please add GEMINI_API_KEYS to your .env file.'
    });
  }

  const { prompt, pdfBase64, primaryModel, fallbackModel } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt parameter in request body.' });
  }

  // Check cache for identical proforma document
  const cacheHash = crypto.createHash('sha256').update(pdfBase64 || prompt || '').digest('hex');
  if (proformaCache.has(cacheHash)) {
    const cached = proformaCache.get(cacheHash);
    console.log(`[UmSpec Proxy] Cache HIT (${cacheHash.slice(0, 8)}). Returning cached analysis.`);
    return res.json({
      text: cached.text,
      modelUsed: `${cached.modelUsed} (Server Cache)`,
      cached: true
    });
  }

  const primary = primaryModel || process.env.PRIMARY_MODEL || 'gemini-3.5-flash-lite';
  const fallback = fallbackModel || process.env.FALLBACK_MODEL || 'gemini-3.1-flash-lite';

  const modelsToTry = [primary, fallback, 'gemini-2.0-flash', 'gemini-1.5-flash']
    .filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  console.log(`[UmSpec Proxy] Cache MISS. Querying Gemini cascade: ${modelsToTry.join(' -> ')}, Key Pool: ${keys.length} keys`);

  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    let consecutive429Count = 0;

    for (let k = 0; k < keys.length; k++) {
      const keyIndex = (currentKeyIndex + k) % keys.length;
      const apiKey = keys[keyIndex];

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const parts = [{ text: prompt }];
        if (pdfBase64) {
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64
            }
          });
        }

        const requestBody = {
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 40000);

        const geminiRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          currentKeyIndex = (keyIndex + 1) % keys.length;
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty text content received from Gemini API');

          console.log(`[UmSpec Proxy] Success on model '${currentModel}' using Key #${keyIndex + 1}`);
          proformaCache.set(cacheHash, {
            text,
            modelUsed: currentModel,
            cachedAt: new Date().toISOString()
          });

          return res.json({
            text,
            modelUsed: currentModel,
            keyIndexUsed: keyIndex,
            cached: false
          });
        }

        if (geminiRes.status === 429) {
          consecutive429Count++;
          console.warn(`[UmSpec Proxy] 429 Quota reached on Key #${keyIndex + 1} for ${currentModel}. Rotating to next key...`);
          lastError = new Error(`Key #${keyIndex + 1} hit quota (429) on ${currentModel}`);
          continue;
        }

        if (geminiRes.status === 404 || geminiRes.status === 400) {
          const errText = await geminiRes.text();
          console.warn(`[UmSpec Proxy] Model '${currentModel}' rejected (HTTP ${geminiRes.status}): ${errText.slice(0, 100)}. Cascading to next model...`);
          lastError = new Error(`Model ${currentModel} returned ${geminiRes.status}`);
          break; // Cascade to next model immediately
        }

        const errText = await geminiRes.text();
        console.warn(`[UmSpec Proxy] Request error HTTP ${geminiRes.status}: ${errText.slice(0, 100)}`);
        lastError = new Error(`HTTP ${geminiRes.status}: ${errText.slice(0, 100)}`);
      } catch (err) {
        console.warn(`[UmSpec Proxy] Network error on Key #${keyIndex + 1} for ${currentModel}:`, err.message);
        lastError = err;
      }
    }

    if (consecutive429Count >= keys.length) {
      console.warn(`[UmSpec Proxy] All ${keys.length} keys hit quota on ${currentModel}. Cascading to fallback model...`);
    }
  }

  return res.status(502).json({
    error: lastError ? lastError.message : 'All Gemini models and API keys exhausted.'
  });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 UmSpec Secure AI Backend Proxy running on port ${PORT}`);
  console.log(`🔑 Loaded ${getKeyPool().length} Gemini API Key(s) from .env`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`====================================================`);
});
