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

// ---------- Course layout reading (POST /api/v1/course/layout) ----------
// Each course labels its class groups its own way ("OCC 3", "G1", "Group 1M", "Kumpulan 2", lab groups "W3-1").
// The extension sends only the course's structure (activity titles, types, section names and lock text); the AI
// says which OCC each activity is for. One answer per course page version is cached for every student.
const LAYOUT_LIMITS = { activities: 400, name: 140, section: 120, lock: 160 };
const OCC_TOKEN = /^[0-9]{1,2}[A-Z]?$/;
const clipText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanLayoutRequest(body) {
  const courseId = String(body?.courseId ?? '');
  if (!/^[1-9]\d{0,9}$/.test(courseId)) throw new Error('courseId must be a Spectrum course number.');
  const list = Array.isArray(body?.activities) ? body.activities : [];
  if (!list.length || list.length > LAYOUT_LIMITS.activities) throw new Error('Send between 1 and ' + LAYOUT_LIMITS.activities + ' activities.');
  const seen = new Set();
  const activities = [];
  for (const raw of list) {
    const id = String(raw?.id ?? '');
    if (!/^[1-9]\d{0,9}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    activities.push({ id, type: clipText(raw.type, 30).toLowerCase(), name: clipText(raw.name, LAYOUT_LIMITS.name),
      section: clipText(raw.section, LAYOUT_LIMITS.section), lock: clipText(raw.lock, LAYOUT_LIMITS.lock) });
  }
  if (!activities.length) throw new Error('No valid activities.');
  return { courseId, courseCode: clipText(body.courseCode, 20).toUpperCase(), activities };
}

function layoutPrompt(request) {
  const rows = request.activities.map(a => [a.id, a.type, a.name, a.section, a.lock].join(' | ')).join('\n');
  return `You read the course page structure of a Universiti Malaya SPeCTRUM (Moodle) course ${request.courseCode || ''}.
Students are split into class occurrences (OCC). Lecturers label them in many ways: "OCC 3", "Occ_2", "OCCs 1, 2, 4",
"Kumpulan 2", "G1", "G1M", "Group 1M", or Moodle groups such as "GROUP 3 2026/2027_1" (that number is the OCC).
"Group" can also mean a lab group ("W3-1") or a project team, which are NOT OCCs.
A "lock" such as "Not available unless: You belong to GROUP 7 2026/2027_1" means the activity is only for OCC 7.
A section may belong to one lecturer who teaches certain OCCs; use the OCC-labelled activities inside it as evidence.

Activities (id | type | title | section | lock):
${rows}

Return STRICTLY this JSON, listing ONLY activities meant for some OCCs (leave out activities for everyone):
{"groupStyle":"short note on how this course labels OCCs",
 "activities":[{"id":"123","occ":["1","1M"],"why":"title says G1, G1M"}],
 "sections":[{"name":"exact section name","occ":["4","7"],"why":"its tutorials are labelled OCC4 and OCC7"}]}
Rules: OCC values are numbers with an optional letter ("1", "1M"). Never guess an OCC without evidence in the titles,
sections or locks. Lab groups and project teams are not OCCs.`;
}

// Models sometimes answer with keyed objects ({"123": {...}}) instead of lists, or with "OCC 1, 1M" as one string;
// both shapes are accepted, and anything that is not a known activity, section or OCC number is dropped.
function entriesOf(value, keyName) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => ({ [keyName]: key, ...(Array.isArray(item) ? { occ: item } : item) }));
  return [];
}
function cleanLayoutResult(parsed, request) {
  // The answer is sometimes wrapped in a list ([{ "activities": ... }]); its first object is the answer.
  if (Array.isArray(parsed)) parsed = parsed.find(item => item && typeof item === 'object' && (item.activities || item.sections)) || {};
  const ids = new Set(request.activities.map(a => a.id));
  const sectionNames = new Set(request.activities.map(a => a.section));
  const tokens = list => [...new Set((Array.isArray(list) ? list : String(list ?? '').split(/[,;/&]|\band\b/i))
    .map(t => String(t).toUpperCase().replace(/^\s*(?:OCC|G|GROUP|KUMPULAN)\s*[-_]?\s*/, '').trim().replace(/^0+(?=\d)/, ''))
    .filter(t => OCC_TOKEN.test(t)))].slice(0, 20);
  const activities = {};
  for (const item of entriesOf(parsed?.activities, 'id')) {
    const id = String(item?.id ?? item?.activityId ?? item?.cmid ?? ''), occ = tokens(item?.occ ?? item?.occs);
    if (ids.has(id) && occ.length) activities[id] = { occ, why: clipText(item.why, 120) };
  }
  const sections = {};
  for (const item of entriesOf(parsed?.sections, 'name')) {
    const name = clipText(item?.name ?? item?.section, LAYOUT_LIMITS.section), occ = tokens(item?.occ ?? item?.occs);
    if (sectionNames.has(name) && occ.length) sections[name] = { occ, why: clipText(item.why, 120) };
  }
  return { version: 1, courseId: request.courseId, groupStyle: clipText(parsed?.groupStyle, 200), activities, sections };
}

async function handleCourseLayout(request, env) {
  const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra } });
  let clean;
  try { clean = cleanLayoutRequest(await request.json()); } catch (error) { return json({ error: error.message || 'Invalid JSON payload' }, 400); }
  const cacheKey = 'layout:v3:' + clean.courseId + ':' + await computeHash(JSON.stringify(clean.activities));
  if (env.UMSPEC_CACHE) {
    try {
      const cached = await env.UMSPEC_CACHE.get(cacheKey, 'json');
      if (cached) return json({ ...cached, cached: true }, 200, { 'X-Cache': 'HIT-KV' });
    } catch (kvErr) { console.warn('[UmSpec] KV read error:', kvErr); }
  }
  const keys = getKeyPool(env);
  if (!keys.length) return json({ error: 'GEMINI_API_KEYS secret not set in Cloudflare Worker environment variables.' }, 500);
  try {
    const ai = await callGemini(keys, layoutPrompt(clean), null, env.PRIMARY_MODEL || 'gemini-3.5-flash-lite', env.FALLBACK_MODEL || 'gemini-3.1-flash-lite');
    let parsed = null;
    try { parsed = JSON.parse(ai.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()); } catch {}
    if (!parsed) return json({ error: 'The AI answer was not valid JSON.' }, 502);
    const result = { ...cleanLayoutResult(parsed, clean), modelUsed: ai.modelUsed, analysedAt: new Date().toISOString() };
    // An empty answer may just mean the course labels nothing by OCC, but it is retried after a day in case the model slipped.
    const empty = !Object.keys(result.activities).length && !Object.keys(result.sections).length;
    if (empty) result.rawStart = clipText(ai.text, 300);
    if (env.UMSPEC_CACHE) await env.UMSPEC_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * (empty ? 1 : 90) }).catch(() => {});
    return json({ ...result, cached: false }, 200, { 'X-Cache': 'MISS' });
  } catch (err) {
    return json({ error: err.message }, 502);
  }
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

    if (url.pathname === '/api/v1/course/layout' && request.method === 'POST') return handleCourseLayout(request, env);

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
