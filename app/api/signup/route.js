/**
 * Account creation.
 *
 * Separate from Auth.js because sign-up is a write with its own rules: policy
 * enforcement, rate limiting, and a response that must not reveal whether an
 * email is already registered.
 */

import { NextResponse } from 'next/server';
import { query, logAuthEvent, authConfig } from '../../../lib/auth/db.mjs';
import { postgresStore } from '../../../lib/auth/store.mjs';
import { hashPassword, validatePassword, normalizeEmail, validEmail } from '../../../lib/auth/password.mjs';
import { consume, LIMITS } from '../../../lib/auth/ratelimit.mjs';

export const runtime = 'nodejs';

function sourceAddress(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request) {
  const cfg = authConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: 'Authentication is not configured on this deployment.', missing: cfg.missing },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : null;
  const source = sourceAddress(request);

  if (!validEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const policy = validatePassword(password);
  if (!policy.ok) {
    return NextResponse.json({ error: policy.reason }, { status: 400 });
  }

  const store = postgresStore();
  const budget = await consume(store, `signup:${source}`, LIMITS.signup);
  if (!budget.allowed) {
    await logAuthEvent({ event: 'SIGNUP_RATE_LIMITED', identifier: email, source });
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(budget.retryAfterMs / 1000)) } }
    );
  }

  try {
    const password_hash = await hashPassword(password);

    // The unique index on LOWER(email) is what actually prevents duplicates —
    // a SELECT-then-INSERT would race. Let the database arbitrate.
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (LOWER(email)) DO NOTHING
       RETURNING id`,
      [email, name, password_hash]
    );

    if (rows.length === 0) {
      // Address already registered. Respond exactly as for success: telling a
      // stranger which emails have accounts is an enumeration oracle.
      await logAuthEvent({ event: 'SIGNUP_DUPLICATE', identifier: email, source });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    await logAuthEvent({ event: 'SIGNUP_SUCCESS', userId: rows[0].id, identifier: email, source });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[auth] signup failed:', err.message);
    return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 });
  }
}
