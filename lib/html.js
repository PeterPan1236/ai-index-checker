const VOID_TEXT_TAGS = /<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;

function stripTags(html) {
  return html
    .replace(VOID_TEXT_TAGS, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  if (!text) return 0;
  // CJK has no spaces: count CJK chars individually, latin runs as words.
  const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9'’-]+/g) || [])
    .length;
  return cjk + latin;
}

function attr(tagHtml, name) {
  const m = tagHtml.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

function findTags(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return html.match(re) || [];
}

function findBlocks(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push({ outer: m[0], inner: m[1] });
  return out;
}

function metaByName(html, key, value) {
  for (const tag of findTags(html, 'meta')) {
    const got = attr(tag, key);
    if (got && got.toLowerCase() === value.toLowerCase()) return attr(tag, 'content') || '';
  }
  return null;
}

// Open Graph should use property=, but plenty of sites emit name= instead.
function metaProp(html, value) {
  return metaByName(html, 'property', value) ?? metaByName(html, 'name', value);
}

function headings(html) {
  const out = [];
  for (let lvl = 1; lvl <= 6; lvl++) {
    for (const b of findBlocks(html, `h${lvl}`)) {
      out.push({ level: lvl, text: stripTags(b.inner) });
    }
  }
  // Re-sort by document order.
  const order = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) order.push({ level: Number(m[1]), text: stripTags(m[2]) });
  return order.length ? order : out;
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try {
      out.push({ ok: true, data: JSON.parse(raw) });
    } catch {
      out.push({ ok: false, raw: raw.slice(0, 200) });
    }
  }
  return out;
}

function schemaTypes(blocks) {
  const types = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const t = node['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  blocks.filter((b) => b.ok).forEach((b) => walk(b.data));
  return [...types];
}

module.exports = {
  stripTags,
  wordCount,
  attr,
  findTags,
  findBlocks,
  metaByName,
  metaProp,
  headings,
  jsonLdBlocks,
  schemaTypes,
};
