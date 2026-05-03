# LIFEVEST

A small marketing site for LIFEVEST with a local sign-up / log-in flow backed by SQLite. Dark aquatic translucent theme.

## Run locally

```
python3 server.py
```

Then open <http://localhost:9999/index.html>.

`server.py` does two jobs:

1. Serves the static pages and assets from this directory.
2. Handles `POST /login` and `POST /register` against a SQLite database.

The database lives at `./userdata.db` by default. To put it on your Desktop instead:

```
LIFEVEST_DB_PATH=~/Desktop/lifevest.db python3 server.py
```

To change the port:

```
PORT=8080 python3 server.py
```

## Pages

- `index.html` — landing
- `about.html` — what we do
- `contact.html` — contact form (UI only — submission is acknowledged client-side)
- `plans.html` — pricing tiers
- `Login.html` — side-by-side log-in and sign-up

## Theme

Shared in `style.css`:

- Animated radial gradients drifting under a deep ocean background
- Floating bubbles + faint caustic grid overlay
- Glassmorphism cards (`backdrop-filter: blur(...)`) with cyan accent glows
- Inter for typography, gradient-clipped headings

## File map

```
index.html  about.html  contact.html  plans.html  Login.html
style.css   Login.css
server.py
gradient (1).png
```
