/** Deployment health: says what is configured without leaking any value. */
import { NextResponse } from 'next/server';
import { authConfig } from '../../../lib/auth/db.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = authConfig();
  return NextResponse.json({
    ok: true,
    auth: { configured: cfg.configured, missing: cfg.missing, providers: cfg.providers },
  });
}
