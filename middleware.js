/**
 * Security headers, applied to every HTML document.
 *
 * The interesting one is the Content-Security-Policy. Next emits inline
 * hydration scripts, so a strict `script-src 'self'` alone would break the app;
 * the standard fix is a per-request nonce. Next reads the nonce out of the
 * request-side CSP header and stamps it onto its own script tags, so the policy
 * needs no `'unsafe-inline'` for scripts at all.
 *
 * `'strict-dynamic'` lets those trusted scripts load their own chunks while
 * still refusing anything an injection would introduce.
 *
 * Trade-off worth stating plainly: middleware runs per request, so HTML is no
 * longer served straight from the CDN as static content. For a page that will
 * eventually render someone's financial position behind a login, HTML should
 * not be edge-cached anyway — but it is a real cost, not a free win.
 */

import { NextResponse } from 'next/server';

/** Base64 nonce from the platform CSPRNG. Never Math.random(). */
function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function middleware(request) {
  const nonce = makeNonce();
  const dev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // Turbopack's dev client needs eval; production never does.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Google Fonts is the one external origin the LifeVest page uses.
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    // No third-party telemetry, analytics, or beacons. Same-origin only.
    `connect-src 'self'${dev ? ' ws: http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ');

  // Next reads the nonce back out of this request header.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  // Two years, subdomains included, preload-eligible.
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // frame-ancestors covers modern browsers; this is for the stragglers.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()'
  );
  // Isolate the browsing context: no cross-origin window handles, no hotlinking.
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // COEP is deliberately omitted: require-corp would break the Google Fonts
  // fetch, and cross-origin isolation buys nothing until we use SharedArrayBuffer.
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  return response;
}

export const config = {
  // Documents only. Static assets are immutable and hashed; running middleware
  // over them costs money and protects nothing.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
