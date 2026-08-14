const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const UA_GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot';

const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024;

async function get(url, { ua = UA_BROWSER, method = 'GET' } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': ua, accept: '*/*', 'accept-language': 'en;q=0.9' },
    });

    let body = '';
    if (method !== 'HEAD') {
      const buf = await res.arrayBuffer();
      const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
      body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      bytes: body.length,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { get, UA_BROWSER, UA_GPTBOT };
