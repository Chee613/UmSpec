# UmSpec AI Backend Proxy & Chrome Web Store Security Guide

## 🔒 Why You Should NOT Put API Keys in the Extension (`.env`)

If you place an `.env` file inside a Chrome extension package or hardcode API keys in `content.js`:
1. **Anyone can extract it**: Chrome extensions run 100% on the user's browser. Anyone who installs the extension can right-click, unpack the `.crx` file, and steal all your Gemini API keys in under 10 seconds.
2. **Google Chrome Web Store Review Rejection**: When uploading to the Chrome Web Store, Google's automated scanners scan the entire bundle. Exposed API keys, secrets, or prompt tokens frequently trigger warnings or get extensions rejected for security violations.
3. **The Recommended Architecture**:
   - Store your Gemini API keys in an `.env` file on a **backend server** or as an encrypted secret in a serverless edge worker (like Cloudflare Workers or Render).
   - The Chrome extension simply makes a `POST /api/analyze-proforma` request to your backend URL.
   - The backend handles the round-robin key load balancing, 429 quota rotation, and fallback model cascade.
   - You can update keys or rotate them at any time **without having to republish a new version of the extension to Google!**

---

## Option 1: Free 1-Click Serverless Edge (Recommended - Cloudflare Workers)
> **Cost:** 100% Free (100,000 requests/day, zero servers to manage)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) and click **Workers & Pages** -> **Create Application**.
2. Click **Create Worker**, name it `umspec-ai-proxy`, and click **Deploy**.
3. Click **Edit code**, select all text, and paste the code from [`backend/cloudflare-worker.js`](./cloudflare-worker.js).
4. Click **Deploy**.
5. Go to **Settings** -> **Variables and Secrets** -> **Add**:
   - Variable Name: `GEMINI_API_KEYS`
   - Value: `AIzaSyA_key1,AIzaSyB_key2,AIzaSyC_key3` (comma-separated keys)
   - Click **Encrypt** (Secret).
6. Copy your Worker URL (e.g. `https://umspec-ai-proxy.yourname.workers.dev`).
7. In `content/content.js`, set `DEFAULT_BACKEND_URL` to your live Worker URL:
   ```javascript
   const DEFAULT_BACKEND_URL = 'https://umspec-ai.tankeat0613.workers.dev';
   ```
   All students will now automatically connect to your backend when toggling the AI switch!

8. *(90-Day Global Campus Cache & Bulk Pre-Seeding)*:
   - In Cloudflare Dashboard -> **Storage & Databases** -> **KV** -> Namespace named `UMSPEC_CACHE`.
   - Namespace ID: `411def965f894fca9d02ffd15104b6ce`
   - *Once enabled, any syllabus analyzed once on campus is cached for 90 days with 0 API calls!*
   - **(Optional - 1-Click Pre-Seed Campus Catalog)**:
     To populate 550+ courses across all 16 UM faculties instantly:
     ```bash
     npx wrangler kv bulk put --namespace-id=411def965f894fca9d02ffd15104b6ce ../output/cloudflare_kv_bulk_seed.json
     ```
     All 30,000 UM students will now get instant cache hits for faculty core courses without making any AI calls!

---

## 📡 REST API Specifications

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health status, loaded key count, and KV cache status. |
| `GET` | `/api/v1/course/:code/deadlines` | Fast 5ms cache lookup for course assessment dates & deadlines. |
| `POST` | `/api/v1/ingest/course` | Decentralized syllabus ingestion (analyzes via Gemini, saves to KV for campus). |
| `POST` | `/api/analyze-proforma` | Legacy proforma analysis endpoint with SHA-256 caching. |

---

## Option 2: Local Node.js / Express Server (Development)
If you want to test on your own machine:

1. Open your terminal in this directory:
   ```bash
   cd backend
   npm install
   ```

2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. Open `.env` and paste your Gemini API keys:
   ```env
   GEMINI_API_KEYS=AIzaSyA_key1,AIzaSyB_key2,AIzaSyC_key3
   PRIMARY_MODEL=gemini-3.5-flash-lite
   FALLBACK_MODEL=gemini-3.1-flash-lite
   PORT=3000
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. The extension connects to `http://localhost:3000` by default. Simply toggle the **AI PROFORMA & DEADLINE ENGINE** switch ON in UmSpec!

---

## Verification
Test health anytime in your browser or terminal:
```bash
curl http://localhost:3000/api/health
```
It returns: `{"status":"ok","keysLoaded":3,"primaryModel":"gemini-3.5-flash-lite",...}`
