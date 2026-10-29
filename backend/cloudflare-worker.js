/**
 * UmSpec - Cloudflare Worker Free Edge Serverless Proxy with Global Caching
 * 
 * Features:
 * - 100,000 free requests/day on Cloudflare Free Tier
 * - Global Campus Cache for all Universiti Malaya (UM) courses
 * - Decentralized "Waze-style" syllabus crowdsourcing & ingestion
 * - Multi-Project Gemini API Key Pool with 429 quota rotation and fallback cascade
 * - Zero Gemini quota consumed for previously analyzed courses on campus
 * 
 * KV Setup for 90-day Persistent Storage:
 * 1. Cloudflare Dashboard -> Workers & Pages -> KV -> Create Namespace "UMSPEC_CACHE"
 * 2. In your Worker -> Settings -> Variables and Secrets -> KV Namespace Bindings:
 *    - Variable name: UMSPEC_CACHE
 *    - KV Namespace: UMSPEC_CACHE
 */

async function computeHash(str) {
  const buffer = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getKeyPool(env) {
  const raw = env.GEMINI_API_KEYS || '';
  return raw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Execute Multi-Key Load Balanced Request to Gemini with Model Cascade
 */
async function callGemini(keys, prompt, pdfBase64, primaryModel, fallbackModel) {
  const modelsToTry = [primaryModel, fallbackModel, 'gemini-2.0-flash', 'gemini-1.5-flash']
    .filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];

    for (let k = 0; k < keys.length; k++) {
      const apiKey = keys[k];
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
            return {
              text,
              modelUsed: currentModel,
              keyIndexUsed: k
            };
          }
        }

        if (geminiRes.status === 429) {
          lastError = new Error(`Key #${k + 1} hit quota (429) on ${currentModel}`);
          continue; // Rotate to next key
        }

        if (geminiRes.status === 404 || geminiRes.status === 400) {
          lastError = new Error(`Model ${currentModel} returned ${geminiRes.status}`);
          break; // Cascade to next model
        }

        const errText = await geminiRes.text();
        lastError = new Error(`HTTP ${geminiRes.status}: ${errText.slice(0, 100)}`);
      } catch (callErr) {
        lastError = callErr;
      }
    }
  }

  throw (lastError || new Error('All Gemini models and API keys exhausted.'));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ==========================================
    // 1. Health Check Endpoint
    // ==========================================
    if (url.pathname === '/api/health' || url.pathname === '/') {
      const keys = getKeyPool(env);
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'UmSpec Campus Cloud Edge',
        keysLoaded: keys.length,
        primaryModel: env.PRIMARY_MODEL || 'gemini-3.5-flash-lite',
        fallbackModel: env.FALLBACK_MODEL || 'gemini-3.1-flash-lite',
        kvCacheEnabled: !!env.UMSPEC_CACHE,
        timestamp: new Date().toISOString()
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // ==========================================
    // 2. Campus Cache Lookup (GET /api/v1/course/:code/deadlines)
    // ==========================================
    const courseDeadlinesMatch = url.pathname.match(/^\/api\/v1\/course\/([A-Za-z0-9_-]+)\/deadlines\/?$/);
    if (courseDeadlinesMatch && request.method === 'GET') {
      const courseCode = courseDeadlinesMatch[1].toUpperCase();
      const year = url.searchParams.get('year') || 'CURRENT';
      const sem = url.searchParams.get('sem') || '1';

      if (env.UMSPEC_CACHE) {
        try {
          const exactKey = `course:${courseCode}:${year}_${sem}`;
          const latestKey = `course:${courseCode}:LATEST`;

          let cached = await env.UMSPEC_CACHE.get(exactKey, 'json');
          if (!cached) {
            cached = await env.UMSPEC_CACHE.get(latestKey, 'json');
          }

          if (cached) {
            return new Response(JSON.stringify({
              ...cached,
              cached: true
            }), {
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT-KV' }
            });
          }
        } catch (kvErr) {
          console.warn('[UmSpec] KV Cache read error:', kvErr);
        }
      }

      return new Response(JSON.stringify({
        cached: false,
        courseCode,
        message: 'Course not yet indexed in campus cache. Submit proforma via /api/v1/ingest/course.'
      }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
      });
    }

    // ==========================================
    // 3. Decentralized Ingestion (POST /api/v1/ingest/course)
    // ==========================================
    if (url.pathname === '/api/v1/ingest/course' && request.method === 'POST') {
      const keys = getKeyPool(env);
      if (keys.length === 0) {
        return new Response(JSON.stringify({
          error: 'GEMINI_API_KEYS secret not set in Cloudflare Worker environment variables.'
        }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const {
        courseCode,
        courseName,
        academicYear = 'CURRENT',
        semester = 1,
        faculty = '',
        rawText = '',
        pdfBase64 = null
      } = body;

      if (!courseCode || (!rawText && !pdfBase64)) {
        return new Response(JSON.stringify({
          error: 'Missing required parameters: courseCode and either rawText or pdfBase64 required.'
        }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      const cleanCode = courseCode.toUpperCase().trim();
      const primary = body.primaryModel || env.PRIMARY_MODEL || 'gemini-3.5-flash-lite';
      const fallback = body.fallbackModel || env.FALLBACK_MODEL || 'gemini-3.1-flash-lite';
      const cacheKey = `course:${cleanCode}:${academicYear}_${semester}`;

      // Check if another student already indexed it while payload was traveling
      if (env.UMSPEC_CACHE) {
        const existing = await env.UMSPEC_CACHE.get(cacheKey, 'json');
        if (existing) {
          return new Response(JSON.stringify({
            ...existing,
            cached: true
          }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT-KV' }
          });
        }
      }

      // Build structured academic analysis prompt
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

      try {
        const aiResult = await callGemini(keys, prompt, pdfBase64, primary, fallback);
        let parsed = null;
        try {
          const cleanJson = aiResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (jsonErr) {
          console.warn('[UmSpec] Failed to parse AI JSON:', jsonErr, aiResult.text);
        }

        const courseRecord = {
          courseCode: cleanCode,
          courseName: parsed?.courseName || courseName || cleanCode,
          academicYear,
          semester,
          faculty,
          assessments: Array.isArray(parsed?.assessments) ? parsed.assessments : [],
          summary: parsed?.summary || '',
          modelUsed: aiResult.modelUsed,
          lastUpdated: new Date().toISOString(),
          cached: false
        };

        // Cache in KV for 90 days (full semester)
        if (env.UMSPEC_CACHE) {
          try {
            await env.UMSPEC_CACHE.put(cacheKey, JSON.stringify(courseRecord), {
              expirationTtl: 60 * 60 * 24 * 90
            });
            await env.UMSPEC_CACHE.put(`course:${cleanCode}:LATEST`, JSON.stringify(courseRecord), {
              expirationTtl: 60 * 60 * 24 * 90
            });
          } catch (putErr) {
            console.warn('[UmSpec] KV Cache write error:', putErr);
          }
        }

        return new Response(JSON.stringify(courseRecord), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ==========================================
    // 4. Legacy Proforma Analysis (POST /api/analyze-proforma)
    // ==========================================
    if (url.pathname === '/api/analyze-proforma' && request.method === 'POST') {
      const keys = getKeyPool(env);
      if (keys.length === 0) {
        return new Response(JSON.stringify({
          error: 'GEMINI_API_KEYS secret not set in Cloudflare Worker environment variables.'
        }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const { prompt, pdfBase64, primaryModel, fallbackModel } = body;
      const primary = primaryModel || env.PRIMARY_MODEL || 'gemini-3.5-flash-lite';
      const fallback = fallbackModel || env.FALLBACK_MODEL || 'gemini-3.1-flash-lite';

      const cacheHash = await computeHash(pdfBase64 || prompt || '');
      const cacheKey = `proforma_${cacheHash}`;

      if (env.UMSPEC_CACHE) {
        try {
          const cachedJson = await env.UMSPEC_CACHE.get(cacheKey, 'json');
          if (cachedJson && cachedJson.text) {
            return new Response(JSON.stringify({
              text: cachedJson.text,
              modelUsed: `${cachedJson.modelUsed || primary} (Cloudflare KV Cache)`,
              cached: true
            }), {
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'HIT-KV' }
            });
          }
        } catch (kvErr) {
          console.warn('[UmSpec] KV read error:', kvErr);
        }
      }

      try {
        const aiResult = await callGemini(keys, prompt, pdfBase64, primary, fallback);

        if (env.UMSPEC_CACHE) {
          env.UMSPEC_CACHE.put(cacheKey, JSON.stringify({
            text: aiResult.text,
            modelUsed: aiResult.modelUsed
          }), { expirationTtl: 60 * 60 * 24 * 90 }).catch(() => {});
        }

        return new Response(JSON.stringify({
          text: aiResult.text,
          modelUsed: aiResult.modelUsed,
          keyIndexUsed: aiResult.keyIndexUsed,
          cached: false
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};
