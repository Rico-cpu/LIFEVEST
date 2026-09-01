# Veyra

A financial operating system: it models a person's finances, explains what it
sees, proposes actions, and executes only what that person explicitly authorized
within rules they set.

**Veyra is currently a demonstration.** It is not connected to any financial
institution, all figures are fictional sample data, and the executor is a stub —
no code path here can move money. See [LEGAL_STATUS.md](LEGAL_STATUS.md).

## Routes

| Route | What it is |
| --- | --- |
| `/` | Redirects to `/veyra` |
| `/veyra` | The Veyra app — dashboard, plans, scenarios, statements, rules, activity |
| `/signin` | Sign in / create account |
| `/legal` | Terms, privacy notice, automation notice, and the disclosure register |
| `/lifevest` | LifeVest, the earlier prototype. A separate app, untouched. |
| `/api/health` | Reports what is configured, without leaking any value |

## Authentication

Real accounts: email + password with scrypt hashing, sessions as signed JWTs
that are revocable, and rate limiting held in Postgres so it works across
serverless instances.

It needs two environment variables. Without them the sign-in page says so
plainly and offers the demonstration instead — it does not fake a session.

```bash
DATABASE_URL=postgresql://user:pass@host/db   # any Postgres; Neon's free tier is enough
AUTH_SECRET=$(openssl rand -base64 32)
```

Optional, to add Google sign-in: `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### Local development uses a separate database

Production runs on the Neon database `neondb`. Local development runs on
`veyra_dev` on the same Neon project, so development signups, resets and seed
data never touch real user rows.

`lib/auth/db.mjs` refuses to start outside production if `DATABASE_URL` points
at the production database. This is not hypothetical caution: `vercel env pull`
rewrites `.env.local` with the production connection string and says nothing
about it, which is exactly how development ends up writing to live data. If you
re-run it, repoint the database name afterwards:

```bash
sed -i '' 's#/neondb#/veyra_dev#g' .env.local
```

Set `VEYRA_ALLOW_PRODUCTION_DB=1` only for a deliberate one-off.

A Neon *branch* is the better long-term split — separate compute and
copy-on-write storage, resettable independently. Creating one needs a Neon API
key from the Neon console, which is a browser step; a separate database gives
the same data isolation without it.

Apply the schema once (idempotent — every statement is `IF NOT EXISTS`):

```bash
node --env-file=.env.local -e "import('./lib/auth/db.mjs').then(m=>m.migrate()).then(()=>console.log('migrated'))"
```

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000/veyra>.

## Tests

```bash
npm test
```

131 cases, no dependencies, via `node --test`. They cover the financial
arithmetic and the authorization invariants — only a human can approve, an
approval is void if the underlying state moved, execution is idempotent, and a
required disclosure cannot be skipped. If one of those fails, the build is
broken. See [lib/veyra/README.md](lib/veyra/README.md).

## Documentation

| File | Contents |
| --- | --- |
| [lib/veyra/README.md](lib/veyra/README.md) | The decision core: modules, invariants, design decisions |
| [SECURITY.md](SECURITY.md) | Threat model, implemented controls, and why "end-to-end encrypted" cannot mean what it sounds like here |
| [LEGAL_STATUS.md](LEGAL_STATUS.md) | What regulated activity triggers what, and why a Terms page is not a compliance program |
| [docs/VEYRA_BUILD_PROMPT.md](docs/VEYRA_BUILD_PROMPT.md) | Source-of-truth build specification |

## Deployment

Deployed on Vercel. Pushing to `main` on the connected repository deploys to
production.

### The git-author gotcha

Vercel refuses a deployment whose **git author email** is not associated with an
account that has access to the Vercel scope:

```
readyState: BLOCKED
readyStateReason: Git author <email> must have access to the team ... on Vercel
seatBlock: { blockCode: "TEAM_ACCESS_REQUIRED" }
```

This check only applies once a project is git-connected, which makes it
confusing to diagnose: deployments succeed right up until the repository is
connected, then every deployment blocks — CLI ones included, and with no error
code in the deployments list. The reason appears only on the individual
deployment record.

The match is on the **GitHub account**, not the email address — adding the
commit-author email to the Vercel account does not clear it. The block record
names the offending account by id:

```
seatBlock: { blockCode: "TEAM_ACCESS_REQUIRED", gitUserId: <n>, gitProvider: "github" }
```

Adding that account as a Vercel contributor requires a paid plan. On Hobby the
free fix is to author commits as the GitHub account the Vercel project is linked
to:

```bash
git config user.email <id>+<login>@users.noreply.github.com
```

As a last resort, deploying from a copy of the tree with `.git` removed carries
no author and therefore skips the check.
