import { analyze, normalizeUrl } from '../lib/analyzer.js';

// Workers has no dns/net module, so the guard is pattern-based only. Cloudflare's
// egress will not route a subrequest into a private range regardless.
const BLOCKED_HOST = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
const BLOCKED_SUFFIX = /\.(local|internal|localhost|home|lan)$/i;

function assertPublicHost(hostname) {
  if (BLOCKED_HOST.test(hostname) || BLOCKED_SUFFIX.test(hostname)) {
    throw new Error('Refusing to scan local or private network hosts');
  }
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Per-isolate, best-effort. Cloudflare runs many isolates, so this trims abuse
// rather than enforcing an exact quota; swap in a Durable Object if that matters.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();
  return win.length > 20;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/check') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      if (rateLimited(ip)) return json({ error: 'Too many scans — wait a minute.' }, 429);

      try {
        const body = await request.json();
        const target = normalizeUrl(body?.url);
        assertPublicHost(target.hostname);

        const result = await analyze(target.href);
        if (result.fatal) return json({ error: result.fatal }, 502);
        return json(result);
      } catch (err) {
        return json({ error: err.message }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
