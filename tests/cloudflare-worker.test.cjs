const test = require('node:test');
const assert = require('node:assert/strict');

// Import the worker using ES module import or dynamic import
test('Cloudflare Worker API Routes & Global Campus Cache', async (t) => {
  const workerModule = await import('../backend/cloudflare-worker.js');
  const worker = workerModule.default;

  // In-memory mock for Cloudflare KV Namespace
  class MockKV {
    constructor() {
      this.store = new Map();
    }
    async get(key, type = 'text') {
      const val = this.store.get(key);
      if (val === undefined) return null;
      if (type === 'json') {
        try { return JSON.parse(val); } catch (e) { return null; }
      }
      return val;
    }
    async put(key, value, options = {}) {
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      this.store.set(key, strVal);
    }
    async delete(key) {
      this.store.delete(key);
    }
  }

  const mockKv = new MockKV();
  const mockEnv = {
    GEMINI_API_KEYS: 'AIzaFakeKey1,AIzaFakeKey2',
    PRIMARY_MODEL: 'gemini-3.5-flash-lite',
    FALLBACK_MODEL: 'gemini-3.1-flash-lite',
    UMSPEC_CACHE: mockKv
  };

  // Mock global fetch for Gemini API
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test('GET /api/health returns server status and key count', async () => {
    const req = new Request('https://umspec.internal/api/health', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.keysLoaded, 2);
    assert.equal(data.kvCacheEnabled, true);
  });

  await t.test('GET /api/v1/course/:code/deadlines returns 404 when course is not in cache', async () => {
    const req = new Request('https://umspec.internal/api/v1/course/KAA2001/deadlines?year=2026&sem=1', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.cached, false);
    assert.equal(data.courseCode, 'KAA2001');
  });

  await t.test('POST /api/v1/ingest/course analyzes syllabus and caches for campus', async () => {
    // Mock Gemini API success response
    globalThis.fetch = async (url, options) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        const fakeAiResponse = {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  courseCode: 'KAA2001',
                  courseName: 'Structural Analysis',
                  assessments: [
                    {
                      name: 'Midterm Test',
                      type: 'Exam',
                      weightage: '20%',
                      dueWeek: 'Week 7',
                      estimatedDate: '2026-11-10',
                      description: 'Covers Chapters 1-4'
                    }
                  ],
                  summary: 'Civil Engineering structural mechanics course.'
                })
              }]
            }
          }]
        };
        return new Response(JSON.stringify(fakeAiResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, options);
    };

    const ingestPayload = {
      courseCode: 'KAA2001',
      courseName: 'Structural Analysis',
      academicYear: '2026/2027',
      semester: 1,
      faculty: 'Faculty of Engineering',
      rawText: 'Course Outline: Midterm Test 20% on Week 7.'
    };

    const req = new Request('https://umspec.internal/api/v1/ingest/course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ingestPayload)
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.courseCode, 'KAA2001');
    assert.equal(data.assessments.length, 1);
    assert.equal(data.assessments[0].name, 'Midterm Test');
    assert.equal(data.cached, false);

    // Verify it is now saved in mock KV!
    const cachedRecord = await mockKv.get('course:KAA2001:2026/2027_1', 'json');
    assert.ok(cachedRecord);
    assert.equal(cachedRecord.courseCode, 'KAA2001');
    assert.equal(cachedRecord.assessments[0].weightage, '20%');
  });

  await t.test('GET /api/v1/course/:code/deadlines returns 200 cache hit on subsequent student requests', async () => {
    // Next student requests the same course
    const req = new Request('https://umspec.internal/api/v1/course/KAA2001/deadlines?year=2026%2F2027&sem=1', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.cached, true);
    assert.equal(data.courseCode, 'KAA2001');
    assert.equal(data.assessments[0].name, 'Midterm Test');
  });
});


test('course layout: the AI labels G1/Group 1M as OCCs, bad answers are filtered, and the answer is cached per course page', async t => {
  const worker = (await import('../backend/cloudflare-worker.js')).default;
  const store = new Map();
  const kv = { async get(key, type) { const v = store.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }, async put(key, value) { store.set(key, value); } };
  const env = { GEMINI_API_KEYS: 'AIzaFake', UMSPEC_CACHE: kv };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0, prompt = '';
  globalThis.fetch = async (url, options) => {
    calls++;
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      groupStyle: 'G1 and Group 1M name OCC 1 and 1M',
      activities: [{ id: '11', occ: ['1', '1M'], why: 'title says G1, G1M' }, { id: '12', occ: ['3'] },
        { id: '999', occ: ['2'] }, { id: '13', occ: ['W3-1', '<b>'] }],
      sections: [{ name: 'AP DR MUMTAZ\'S SECTION', occ: ['4', '7'] }, { name: 'Made up section', occ: ['2'] }]
    }) }] } }] });
  };
  const body = { courseId: 25559, courseCode: 'KIG2012', activities: [
    { id: 11, type: 'url', name: 'Online class G1, G1M', section: 'General' },
    { id: 12, type: 'attendance', name: 'Attendance (Occ3)', section: 'General', lock: '' },
    { id: 13, type: 'assign', name: 'Lab Report (Group W3-1 Only)', section: 'General' },
    { id: 14, type: 'resource', name: 'Tutorial 5', section: 'AP DR MUMTAZ\'S SECTION' }] };
  const send = () => worker.fetch(new Request('https://umspec.internal/api/v1/course/layout', { method: 'POST', body: JSON.stringify(body) }), env);
  const first = await (await send()).json();
  assert.deepEqual(first.activities, { 11: { occ: ['1', '1M'], why: 'title says G1, G1M' }, 12: { occ: ['3'], why: '' } }, 'unknown ids and non-OCC values are dropped');
  assert.deepEqual(Object.keys(first.sections), ['AP DR MUMTAZ\'S SECTION'], 'sections must exist in the course');
  assert.equal(first.cached, false);
  assert.match(prompt, /Online class G1, G1M/);
  assert.doesNotMatch(prompt, /tankeat|matric/i);
  const second = await (await send()).json();
  assert.equal(second.cached, true);
  assert.equal(calls, 1, 'the next student gets the cached answer');
  // GIG1013's real answer came wrapped in a list.
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ groupStyle: 'OCC in attendance titles',
    activities: [{ id: '12', occ: ['3'], why: 'title says Occ3' }] }]) }] } }] });
  const wrapped = await (await worker.fetch(new Request('https://umspec.internal/api/v1/course/layout', { method: 'POST',
    body: JSON.stringify({ ...body, courseId: 22233 }) }), env)).json();
  assert.deepEqual(wrapped.activities, { 12: { occ: ['3'], why: 'title says Occ3' } });
  const bad = await worker.fetch(new Request('https://umspec.internal/api/v1/course/layout', { method: 'POST', body: JSON.stringify({ courseId: 'x', activities: [] }) }), env);
  assert.equal(bad.status, 400);
});
