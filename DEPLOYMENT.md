# Q-BioVision — Fixing the `404` on “Encode & Analyze”

## Why you were getting a 404

Q-BioVision is **Vite + React** (frontend) **+ FastAPI** (backend) — *not* a Next.js app.
That matters, because:

* There is **no `pages/api` or `app/api` folder**, so Vercel never created any serverless
  function. Vercel was only serving the static `dist/` build.
* The browser called `POST /api/preprocess` → Vercel had no such route → it fell through to
  the SPA/static handler → **404**.
* `NEXT_PUBLIC_*` variables do nothing here. Vite only exposes vars prefixed **`VITE_`**.

Two real bugs were also in the code:

| Bug | Fix |
|---|---|
| `client.js` hardcoded `baseURL: '/'`, ignoring any env var — so a deployed frontend could never reach an external backend. | `baseURL` now resolves from `VITE_API_URL`. |
| `DiagnosticStudio.jsx` sent form fields `dataset` + `use_sample`, but the backend parameter is `dataset_name` — a 400/422 even when the route was reachable. | Frontend now sends `dataset_name`; the backend also accepts `dataset` as an alias. |

---

## What changed

### Backend — `backend/app.py`
* **`POST /api/encode`** — the canonical encoding route (`/api/preprocess` kept as a legacy alias, so old clients don't break).
* **`POST /api/analyze`** — one-shot *encode + classify* for the “Encode & Analyze” button. If classification fails it still returns the encoding with a `prediction_error` field instead of failing the whole request.
* **`GET /api/health`** — liveness probe under the `/api` prefix (used by Render's health check and the frontend's `checkHealth()`).
* **Helpful 404 handler** — any unmatched `/api/*` call now returns the list of routes that *do* exist instead of a bare 404:
  ```json
  { "detail": "No API route matches GET /api/nope",
    "available_routes": ["/api/analyze", "/api/encode", "/api/health", ...] }
  ```

### Backend — `backend/config.py`
* `CORS_ORIGINS` is now extendable via env (`CORS_ORIGINS=https://your-app.vercel.app`).
* `CORS_ORIGIN_REGEX` defaults to `https://.*\.vercel\.app` so **every Vercel preview deployment** is allowed automatically.
* `API_PORT` reads `$PORT` (required by Render/Railway/Fly).

### Frontend — `src/api/client.js`
* `baseURL` ← `VITE_API_URL`, normalised (strips trailing `/` and an accidental trailing `/api`).
* Exports `encodeImage`, `analyzeImage`, `checkHealth`, `API_BASE_URL`.
* Error interceptor now explains 404s, `ERR_NETWORK` (CORS/down) and timeouts in plain language instead of “Request failed with status code 404”.

### Config files
`vite.config.js` (proxy + `allowedHosts`), `vercel.json`, `.env.example`, `backend/.env.example`, `backend/Dockerfile`, `render.yaml`, `.gitignore`.

---

## Choose ONE of two wiring strategies

### ✅ Option A — `vercel.json` rewrites (recommended)

The browser only ever talks to your Vercel origin; Vercel proxies `/api/*` to the backend.
**No CORS at all**, and no API URL baked into the JS bundle.

Leave `VITE_API_URL` **empty**, and edit `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://q-biovision-api.onrender.com/api/:path*" },
    { "source": "/(.*)",       "destination": "/index.html" }
  ]
}
```

> Order matters — the `/api` rule must come **before** the SPA catch-all, otherwise every
> API call gets swallowed by `index.html` (that's the classic 404/“got HTML instead of JSON”).

### Option B — direct cross-origin calls

Set in **Vercel → Settings → Environment Variables**:

```
VITE_API_URL = https://q-biovision-api.onrender.com
```

Origin only — **no trailing `/api`**, no trailing slash. Then set on the backend:

```
CORS_ORIGINS = https://q-biovision.vercel.app
```

⚠️ Vite inlines env vars **at build time** — after changing `VITE_API_URL` you must
**redeploy** (Deployments → ⋯ → Redeploy, *uncheck* “Use existing build cache”).

---

## Step-by-step

### 1. Deploy the backend (it cannot run on Vercel)

Qiskit + Torch + WeasyPrint blow past Vercel's serverless size/time limits, so host the API
on Render (config included):

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (it reads `render.yaml`), or
   **New → Web Service → Docker**, root directory `backend`.
3. Env vars: `DEMO_MODE=true`, `RELOAD=0`, `CORS_ORIGINS=https://<your-app>.vercel.app`.
4. Verify: `curl https://<backend>/api/health` → `{"status":"ok",...}`

### 2. Point the frontend at it

Edit the `destination` in `vercel.json` to your real backend host (Option A),
**or** set `VITE_API_URL` in Vercel (Option B).

### 3. Deploy the frontend

Vercel → Import project. Framework **Vite**, build `npm run build`, output `dist`.

### 4. Verify

```bash
curl -i https://<your-app>.vercel.app/api/health          # expect 200 JSON, not HTML
curl -X POST https://<your-app>.vercel.app/api/encode \
     -F "file=@backend/demo_data/breakhis_sample.png" -F "n_qubits=4"
```

If `/api/health` returns HTML, the rewrite isn't applied — check rule order in `vercel.json`.

---

## Local development

```bash
# terminal 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py                      # http://localhost:8000  (docs at /docs)

# terminal 2 — frontend
npm install
cp .env.example .env.local         # leave VITE_API_URL empty
npm run dev                        # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8000`, so dev matches production exactly.
Override the target with `VITE_DEV_API_PROXY` if your backend runs elsewhere.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 404, response body is HTML | Rewrite missing or placed after the SPA catch-all in `vercel.json`. |
| 404 JSON with `available_routes` | Request reached the backend but the path is wrong — use a listed route. |
| `ERR_NETWORK` / CORS error | Add your Vercel domain to `CORS_ORIGINS` on the backend. |
| Works locally, 404 in prod | `VITE_API_URL` set at runtime instead of build time → redeploy without cache. |
| Double `/api/api/...` | You set `VITE_API_URL=https://host/api`. Use the origin only (the client auto-strips this anyway). |
| First request times out | Render free tier cold start (~50s). Client timeout is already raised to 120s. |
