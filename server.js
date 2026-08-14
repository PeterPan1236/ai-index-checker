const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const { analyze, normalizeUrl } = require('./lib/analyzer');

const PORT = Number(process.env.PORT) || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// --- SSRF guard: refuse anything that resolves into the local network. ---
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

async function assertPublicHost(hostname) {
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) {
    throw new Error('Refusing to scan local network hosts');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('Refusing to scan private IP addresses');
  }
  if (net.isIP(hostname)) return;
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`DNS lookup failed for "${hostname}" — check the domain`);
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('Refusing to scan hosts that resolve to a private IP');
  }
}

// --- crude in-memory rate limit ---
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = hits.get(ip)?.filter((t) => now - t < 60_000) || [];
  win.push(now);
  hits.set(ip, win);
  return win.length > 20;
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  const rel = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/check') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) return json(res, 429, { error: 'Too many scans — wait a minute.' });

    try {
      const { url } = JSON.parse((await readBody(req)) || '{}');
      const parsed = normalizeUrl(url);
      await assertPublicHost(parsed.hostname);

      const result = await analyze(parsed.href);
      if (result.fatal) return json(res, 502, { error: result.fatal });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`AI Index Checker running at http://localhost:${PORT}`);
});
