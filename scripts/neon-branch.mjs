#!/usr/bin/env node
/**
 * Create a Neon branch for local development and point .env.local at it.
 *
 * A branch is the real split: its own compute endpoint and copy-on-write
 * storage, resettable independently, with zero contention against production.
 * A separate database (what `veyra_dev` is today) isolates the data but shares
 * the endpoint.
 *
 * Requires a Neon API key, which only the Neon console issues:
 *   https://console.neon.tech/app/settings/api-keys
 *
 * Put it in the environment — never on the command line, where it would land
 * in shell history:
 *   export NEON_API_KEY=...           (or add NEON_API_KEY= to .env.local)
 *
 * Then:
 *   node --env-file=.env.local scripts/neon-branch.mjs
 *   node --env-file=.env.local scripts/neon-branch.mjs --reset   # recreate it
 *
 * The script never prints the key or any connection string.
 */

import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://console.neon.tech/api/v2';
const BRANCH_NAME = process.env.NEON_DEV_BRANCH ?? 'dev';
const ENV_FILE = '.env.local';

const key = process.env.NEON_API_KEY;
const projectId = process.env.NEON_PROJECT_ID;

function die(message, hint) {
  console.error(`\n  ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

if (!key) {
  die(
    'NEON_API_KEY is not set.',
    'Create one at https://console.neon.tech/app/settings/api-keys, then\n' +
    '  export NEON_API_KEY=...  (or add it to .env.local)\n' +
    '  Do not pass it as an argument — it would be stored in shell history.'
  );
}
if (!projectId) {
  die('NEON_PROJECT_ID is not set.', 'It comes from the Vercel Neon integration; run `vercel env pull` first.');
}

async function neon(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.message ?? body?.error ?? res.statusText;
    if (res.status === 401) die('Neon rejected the API key (401).', 'Check it was copied whole and has not been revoked.');
    throw new Error(`Neon ${options.method ?? 'GET'} ${path} -> ${res.status}: ${detail}`);
  }
  return body;
}

const reset = process.argv.includes('--reset');

// ---------------------------------------------------------------- branches

const { branches } = await neon(`/projects/${projectId}/branches`);
const primary = branches.find((b) => b.default || b.primary) ?? branches[0];
console.log(`  project   : ${projectId}`);
console.log(`  primary   : ${primary.name} (${primary.id})`);

let branch = branches.find((b) => b.name === BRANCH_NAME);

if (branch && reset) {
  console.log(`  deleting existing "${BRANCH_NAME}" (--reset)`);
  await neon(`/projects/${projectId}/branches/${branch.id}`, { method: 'DELETE' });
  branch = undefined;
}

if (!branch) {
  console.log(`  creating branch "${BRANCH_NAME}" from ${primary.name}…`);
  const created = await neon(`/projects/${projectId}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { name: BRANCH_NAME, parent_id: primary.id },
      // Its own compute, so local work never contends with production.
      endpoints: [{ type: 'read_write' }],
    }),
  });
  branch = created.branch;
} else {
  console.log(`  branch "${BRANCH_NAME}" already exists (${branch.id})`);
}

// Neon provisions asynchronously; wait for the endpoint rather than racing it.
let uri = null;
for (let attempt = 0; attempt < 30 && !uri; attempt++) {
  const { connection_uris: uris } = await neon(
    `/projects/${projectId}/connection_uri?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner&pooled=true`
  ).catch(() => ({ connection_uris: [] }));
  uri = uris?.[0]?.connection_uri ?? null;
  if (!uri) await new Promise((r) => setTimeout(r, 2000));
}
if (!uri) die('The branch was created but no connection string became available.', 'Check the Neon console for its status.');

// ---------------------------------------------------------------- env file

const raw = await readFile(ENV_FILE, 'utf8').catch(() => '');
const POINTED_AT_DB = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NO_SSL'];

const lines = raw.split('\n').filter((l) => {
  const k = l.split('=')[0];
  return !POINTED_AT_DB.includes(k) && k !== 'VEYRA_NEON_BRANCH';
});
lines.push(`VEYRA_NEON_BRANCH=${BRANCH_NAME}`);
for (const k of POINTED_AT_DB) lines.push(`${k}=${JSON.stringify(uri)}`);

await writeFile(ENV_FILE, lines.filter(Boolean).join('\n') + '\n');

const host = new URL(uri.replace('postgresql://', 'https://')).host;
console.log(`  branch id : ${branch.id}`);
console.log(`  endpoint  : ${host.split('@').pop()}`);
console.log(`  ${ENV_FILE} now points at the "${BRANCH_NAME}" branch.`);
console.log('\n  Next: apply the schema to it —');
console.log("    node --env-file=.env.local -e \"import('./lib/auth/db.mjs').then(m=>m.migrate()).then(()=>console.log('migrated'))\"");
