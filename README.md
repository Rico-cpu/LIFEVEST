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
| `/veyra` | The Veyra app — dashboard, plans, scenarios, statements, rules, activity |
| `/legal` | Terms, privacy notice, automation notice, and the disclosure register |
| `/` | LifeVest, the earlier prototype, untouched |

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

If it happens, either add the commit-author email to the Vercel account, or set
the repository's author to one already on it:

```bash
git config user.email <email-on-the-vercel-account>
```

As a last resort, deploying from a copy of the tree with `.git` removed carries
no author and therefore skips the check.
