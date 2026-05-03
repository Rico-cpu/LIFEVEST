# LIFEVEST

Static marketing site for LIFEVEST plus a small auth API (`/api/login`, `/api/register`) backed by Vercel KV.

## Deploy to Vercel

1. Push this branch to GitHub.
2. In Vercel, **New Project → Import** the `Rico-cpu/LIFEVEST` repo.
3. Framework preset: **Other** (no build step). Output directory: leave default.
4. In the project's **Storage** tab, create a **KV** store and link it. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
5. Hit **Deploy**.

Without a KV store, the static pages still load fine — login/register just return a 503 with a message explaining KV isn't configured.

## Local layout

- `index.html`, `about.html`, `contact.html`, `plans.html`, `Login.html` — static pages
- `style.css`, `Login.css`, `gradient (1).png`, `Images/` — assets
- `api/login.py`, `api/register.py` — Vercel Python serverless functions
- `api/_kv.py` — thin Upstash/Vercel KV REST client (stdlib only)
- `vercel.json` — pins the Python runtime
