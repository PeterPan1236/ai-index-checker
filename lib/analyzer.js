const { get, UA_GPTBOT } = require('./fetcher');
const H = require('./html');
const R = require('./robots');

const CATEGORIES = [
  { id: 'access', label: 'Crawler access', weight: 30, blurb: 'Can AI crawlers reach and keep this page at all?' },
  { id: 'content', label: 'Content extractability', weight: 25, blurb: 'Is the substance in the raw HTML, in chunks a model can quote?' },
  { id: 'machine', label: 'Machine-readable signals', weight: 20, blurb: 'Structured data, sitemaps, llms.txt, canonical identity.' },
  { id: 'structure', label: 'Page structure', weight: 15, blurb: 'Semantic HTML that survives text extraction.' },
  { id: 'trust', label: 'Trust & attribution', weight: 10, blurb: 'Signals that make a model willing to cite you by name.' },
];

const FRAMEWORK_MARKERS = [
  ['__NEXT_DATA__', 'Next.js'],
  ['id="root"', 'React/Vite SPA root'],
  ['id="app"', 'Vue/SPA root'],
  ['ng-version', 'Angular'],
  ['data-reactroot', 'React'],
  ['window.__NUXT__', 'Nuxt'],
  ['__remixContext', 'Remix'],
  ['data-svelte', 'SvelteKit'],
];

const USEFUL_SCHEMA = [
  'Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'FAQPage', 'QAPage', 'HowTo',
  'Product', 'Offer', 'Organization', 'LocalBusiness', 'Person', 'BreadcrumbList',
  'WebSite', 'SoftwareApplication', 'Recipe', 'Event', 'Course', 'Dataset', 'VideoObject',
];

// How much work each fix realistically is, used to bucket the closing action plan.
const EFFORT = {
  noindex: 'quick', robots: 'quick', 'robots-ai': 'quick', 'llms-txt': 'quick',
  canonical: 'quick', opengraph: 'quick', lang: 'quick', title: 'quick',
  description: 'quick', alt: 'quick', feed: 'quick', sitemap: 'quick',
  h1: 'quick', about: 'quick', 'link-text': 'quick', dates: 'quick',
  jsonld: 'medium', 'schema-types': 'medium', semantics: 'medium',
  'heading-order': 'medium', chunking: 'medium', answerable: 'medium',
  author: 'medium', citations: 'medium', 'bot-ua-probe': 'medium',
  'ssr-text': 'deep', depth: 'deep', 'text-ratio': 'deep', speed: 'deep',
  'http-status': 'deep', https: 'deep',
};

const TIERS = [
  { id: 'quick', label: 'Do this week', blurb: 'Config and markup edits. Hours of work, no rebuild, no design review.' },
  { id: 'medium', label: 'Next sprint', blurb: 'Template and content changes. Touches how pages are authored or generated.' },
  { id: 'deep', label: 'Bigger project', blurb: 'Rendering, infrastructure or editorial investment. Plan it properly.' },
];

const QUESTION_STARTS = /^(what|how|why|when|where|who|which|can|do|does|is|are|should|will)\b/i;
const QUESTION_CJK = /^(如何|什麼|什么|為什麼|为什么|怎麼|怎么|哪些|是否|可以)/;

function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('URL is required');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https URLs are supported');
  if (!u.hostname.includes('.')) throw new Error(`"${u.hostname}" is not a public hostname`);
  return u;
}

function check(id, category, label, weight, score, detail, fix, evidence) {
  const s = Math.max(0, Math.min(1, score));
  const status = s >= 0.99 ? 'pass' : s >= 0.5 ? 'warn' : 'fail';
  return { id, category, label, weight, score: s, status, detail, fix: s >= 0.99 ? null : fix, evidence };
}

// Closing action plan: failing checks bucketed by effort, each carrying the points it wins back.
function buildSuggestions(checks, categories, summary) {
  const failing = checks
    .filter((k) => k.status !== 'pass')
    .map((k) => {
      const cat = categories.find((c) => c.id === k.category);
      const catWeightSum = checks
        .filter((x) => x.category === k.category)
        .reduce((n, x) => n + x.weight, 0);
      // Points of the final 100 recoverable by taking this single check to full marks.
      const points = ((k.weight * (1 - k.score)) / catWeightSum) * cat.weight;
      return { ...k, points: Math.round(points * 10) / 10, effort: EFFORT[k.id] || 'medium' };
    })
    .sort((a, b) => b.points - a.points);

  const tiers = TIERS.map((t) => ({
    ...t,
    points: Math.round(failing.filter((f) => f.effort === t.id).reduce((n, f) => n + f.points, 0) * 10) / 10,
    items: failing
      .filter((f) => f.effort === t.id)
      .map((f) => ({ id: f.id, label: f.label, detail: f.detail, action: f.fix, points: f.points })),
  })).filter((t) => t.items.length);

  const strengths = checks
    .filter((k) => k.status === 'pass' && k.weight >= 4)
    .map((k) => k.label);

  const notes = [];
  if (summary.frameworks.length && summary.words < 400) {
    notes.push(
      `The page ships a ${summary.frameworks.join('/')} bundle and only ${summary.words} words of server-rendered text. Every other fix on this list is worth less than fixing that — a crawler that does not run JavaScript sees close to an empty document.`,
    );
  }
  if (!summary.schemaTypes.length) {
    notes.push(
      'With no structured data at all, a model has to infer what this page is from prose alone. One JSON-LD block is usually the cheapest single jump in this score.',
    );
  }
  if (summary.llmsTxt) {
    notes.push('llms.txt is already published — keep it in sync when the site structure changes, a stale index is worse than none.');
  }
  notes.push(
    'Re-scan after each change: the score is computed live, so you can watch a fix land rather than guessing at its effect.',
  );

  return { tiers, strengths, notes, recoverable: Math.round(failing.reduce((n, f) => n + f.points, 0)) };
}

function grade(score) {
  if (score >= 95) return 'A+';
  if (score >= 88) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 58) return 'D';
  return 'F';
}

async function analyze(inputUrl) {
  const u = normalizeUrl(inputUrl);
  const origin = u.origin;
  const path = u.pathname + u.search;

  const [page, robotsRes, llmsRes, sitemapRes, botProbe] = await Promise.all([
    get(u.href),
    get(origin + '/robots.txt'),
    get(origin + '/llms.txt'),
    get(origin + '/sitemap.xml', { method: 'HEAD' }),
    get(u.href, { ua: UA_GPTBOT, method: 'GET' }),
  ]);

  if (!page.ok) {
    return { fatal: `Could not fetch ${u.href} — ${page.error}`, url: u.href };
  }

  const html = page.body || '';
  const headers = page.headers || {};
  const checks = [];

  // ---------- crawler access ----------
  const reachable = page.status >= 200 && page.status < 300;
  checks.push(
    check('http-status', 'access', 'Page returns a success status', 6,
      reachable ? 1 : page.status < 400 ? 0.5 : 0,
      `HTTP ${page.status} in ${page.ms}ms${page.finalUrl !== u.href ? ` (redirected to ${page.finalUrl})` : ''}`,
      'A crawler that gets a non-2xx response indexes nothing. Fix the status or the redirect chain.',
      { status: page.status, finalUrl: page.finalUrl }),
  );

  const robotsText = robotsRes.ok && robotsRes.status === 200 ? robotsRes.body : null;
  const parsedRobots = robotsText ? R.parse(robotsText) : { groups: [], sitemaps: [] };

  const crawlers = R.AI_AGENTS.map((a) => {
    const verdict = robotsText ? R.isAllowed(parsedRobots, a.ua, path) : { allowed: true, rule: null, matchedBy: 'no-robots' };
    return { ...a, allowed: verdict.allowed, rule: verdict.rule, matchedBy: verdict.matchedBy };
  });

  const totalW = crawlers.reduce((n, c) => n + c.weight, 0);
  const allowedW = crawlers.filter((c) => c.allowed).reduce((n, c) => n + c.weight, 0);
  const blocked = crawlers.filter((c) => !c.allowed);
  checks.push(
    check('robots-ai', 'access', 'robots.txt lets AI crawlers in', 8, allowedW / totalW,
      blocked.length
        ? `Blocked: ${blocked.map((b) => b.ua).join(', ')}`
        : robotsText ? 'All 15 tracked AI crawlers are allowed on this path' : 'No robots.txt found — everything is allowed by default',
      `Remove the Disallow rules for ${blocked.map((b) => b.ua).join(', ') || 'AI user-agents'} in /robots.txt, or scope them to paths you truly want withheld. Blocking a retrieval bot (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Google-Extended) removes you from answers, not just from training.`,
      { robotsFound: !!robotsText, blocked: blocked.map((b) => b.ua) }),
  );

  const probeBlocked = botProbe.ok && botProbe.status !== page.status && botProbe.status >= 400;
  const probeText = botProbe.ok ? H.stripTags(botProbe.body || '') : '';
  const wafHit = /just a moment|checking your browser|attention required|cf-ray|access denied|enable javascript and cookies/i.test(probeText.slice(0, 800));
  checks.push(
    check('bot-ua-probe', 'access', 'Server serves the page to a bot user-agent', 6,
      probeBlocked ? 0 : wafHit ? 0.3 : 1,
      probeBlocked
        ? `Same URL returns HTTP ${botProbe.status} when requested as GPTBot (browser UA got ${page.status})`
        : wafHit
          ? 'Bot-UA request hit a JavaScript/bot interstitial instead of the page'
          : `Bot-UA request returned HTTP ${botProbe.status || page.status}, same as a browser`,
      'Your CDN/WAF is filtering by user-agent. Allowlist the verified AI crawler ranges in Cloudflare/Akamai bot management, or the page is invisible no matter what robots.txt says.',
      { browserStatus: page.status, botStatus: botProbe.status || null }),
  );

  const metaRobots = (H.metaByName(html, 'name', 'robots') || '').toLowerCase();
  const xRobots = (headers['x-robots-tag'] || '').toLowerCase();
  const noindex = /noindex|none/.test(metaRobots) || /noindex|none/.test(xRobots);
  const nosnippet = /nosnippet|max-snippet\s*:\s*0/.test(metaRobots + ' ' + xRobots);
  checks.push(
    check('noindex', 'access', 'No noindex / nosnippet directive', 6,
      noindex ? 0 : nosnippet ? 0.4 : 1,
      noindex ? `noindex found (meta: "${metaRobots}", header: "${xRobots}")`
        : nosnippet ? 'nosnippet or max-snippet:0 set — AI answers cannot quote this page'
          : 'No indexing restrictions',
      'Drop noindex/nosnippet if you want this page quoted. `max-snippet:-1` explicitly permits full-length snippets.',
      { metaRobots, xRobots }),
  );

  const isHttps = new URL(page.finalUrl).protocol === 'https:';
  checks.push(
    check('https', 'access', 'Served over HTTPS', 2, isHttps ? 1 : 0,
      isHttps ? 'HTTPS' : 'Plain HTTP',
      'Serve over HTTPS. Several crawlers deprioritise or skip plain HTTP entirely.'),
  );

  const speedScore = page.ms < 800 ? 1 : page.ms < 2000 ? 0.7 : page.ms < 5000 ? 0.4 : 0.1;
  checks.push(
    check('speed', 'access', 'Responds quickly', 2, speedScore,
      `${page.ms}ms to first full response`,
      'Live-fetch bots (ChatGPT-User, Claude-User, Perplexity-User) run tight timeouts. Slow responses get dropped from the answer.'),
  );

  // ---------- content extractability ----------
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const text = H.stripTags(bodyHtml);
  const words = H.wordCount(text);
  const markers = FRAMEWORK_MARKERS.filter(([m]) => html.includes(m)).map(([, name]) => name);
  const scriptBytes = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join('').length;

  const ssrScore = words >= 400 ? 1 : words >= 200 ? 0.7 : words >= 60 ? 0.35 : 0;
  checks.push(
    check('ssr-text', 'content', 'Content is in the raw HTML (no JS needed)', 9, ssrScore,
      `${words} words of text in the server response${markers.length ? ` · client framework detected: ${markers.join(', ')}` : ''}`,
      'Most AI crawlers do not execute JavaScript. Server-render or pre-render the main content — an empty shell hydrated on the client reads as a blank page.',
      { words, markers, scriptBytes }),
  );

  const depthScore = words >= 1200 ? 1 : words >= 600 ? 0.85 : words >= 300 ? 0.6 : words >= 120 ? 0.3 : 0.1;
  checks.push(
    check('depth', 'content', 'Enough substance to be worth citing', 4, depthScore,
      `${words} words`,
      'Thin pages lose to competitors covering the same question in depth. Aim for 600+ words of genuine, specific content per topic page.'),
  );

  const hs = H.headings(html);
  const listCount = H.findTags(bodyHtml, 'ul').length + H.findTags(bodyHtml, 'ol').length;
  const tableCount = H.findTags(bodyHtml, 'table').length;
  const questionHeads = hs.filter((h) => /\?|？/.test(h.text) || QUESTION_STARTS.test(h.text) || QUESTION_CJK.test(h.text)).length;
  const jsonLd = H.jsonLdBlocks(html);
  const types = H.schemaTypes(jsonLd);
  const hasFaq = types.includes('FAQPage') || types.includes('QAPage');
  let answerScore = 0;
  if (hasFaq) answerScore += 0.4;
  if (questionHeads >= 2) answerScore += 0.3;
  else if (questionHeads === 1) answerScore += 0.15;
  if (listCount >= 2) answerScore += 0.2;
  if (tableCount >= 1) answerScore += 0.1;
  checks.push(
    check('answerable', 'content', 'Content is shaped like an answer', 4, Math.min(1, answerScore),
      `${questionHeads} question-style heading(s), ${listCount} list(s), ${tableCount} table(s)${hasFaq ? ', FAQ/QA schema present' : ''}`,
      'Models lift self-contained passages. Use question-form headings answered directly in the first sentence below them, plus lists and comparison tables for specs and steps.',
      { questionHeads, listCount, tableCount, hasFaq }),
  );

  const chunkRatio = hs.length ? words / hs.length : words;
  const chunkScore = hs.length === 0 ? 0 : chunkRatio <= 300 ? 1 : chunkRatio <= 600 ? 0.7 : chunkRatio <= 1000 ? 0.4 : 0.2;
  checks.push(
    check('chunking', 'content', 'Broken into retrievable chunks', 3, chunkScore,
      hs.length ? `${hs.length} headings, ~${Math.round(chunkRatio)} words per section` : 'No headings at all',
      'Retrieval works on chunks. Add a heading roughly every 150–300 words so each section stands alone when pulled out of context.'),
  );

  const ratio = html.length ? text.length / html.length : 0;
  checks.push(
    check('text-ratio', 'content', 'Healthy text-to-markup ratio', 2,
      ratio >= 0.15 ? 1 : ratio >= 0.08 ? 0.7 : ratio >= 0.03 ? 0.4 : 0.15,
      `${(ratio * 100).toFixed(1)}% of the response bytes are visible text (${Math.round(html.length / 1024)}KB total, ${Math.round(scriptBytes / 1024)}KB of it script)`,
      'Heavy markup and inline script dilute the page. Extractors truncate long documents — front-load the real content.'),
  );

  // ---------- machine-readable ----------
  const badJson = jsonLd.filter((b) => !b.ok).length;
  checks.push(
    check('jsonld', 'machine', 'JSON-LD structured data present', 6,
      jsonLd.length === 0 ? 0 : badJson ? 0.4 : 1,
      jsonLd.length === 0 ? 'No JSON-LD blocks found'
        : `${jsonLd.length} block(s)${badJson ? `, ${badJson} failed to parse` : ''} · types: ${types.join(', ') || 'none declared'}`,
      'Add schema.org JSON-LD. It is the least ambiguous way to tell a model what this page IS — entity, author, date, price, answer.',
      { count: jsonLd.length, invalid: badJson, types }),
  );

  const useful = types.filter((t) => USEFUL_SCHEMA.includes(t));
  checks.push(
    check('schema-types', 'machine', 'Uses schema types models actually consume', 3,
      useful.length >= 2 ? 1 : useful.length === 1 ? 0.6 : 0,
      useful.length ? `Recognised: ${useful.join(', ')}` : 'No high-value schema types declared',
      'Pair a page-type schema (Article / Product / FAQPage / HowTo) with Organization and BreadcrumbList so the page has both content meaning and entity context.'),
  );

  const llmsOk = llmsRes.ok && llmsRes.status === 200 && /^#|\bllms\b|\]\(/im.test(llmsRes.body || '');
  checks.push(
    check('llms-txt', 'machine', '/llms.txt exists', 2, llmsOk ? 1 : 0,
      llmsOk ? `Found, ${Math.round((llmsRes.body || '').length / 1024)}KB` : 'Not found at /llms.txt',
      'Optional and not yet honoured by every vendor, but cheap: a markdown index at /llms.txt pointing to your canonical docs gives agents a curated map of the site.'),
  );

  const sitemapDeclared = parsedRobots.sitemaps.length > 0;
  const sitemapLive = sitemapRes.ok && sitemapRes.status === 200;
  checks.push(
    check('sitemap', 'machine', 'XML sitemap available', 3,
      sitemapDeclared && sitemapLive ? 1 : sitemapDeclared || sitemapLive ? 0.6 : 0,
      `${sitemapLive ? '/sitemap.xml responds 200' : '/sitemap.xml not found'}; ${sitemapDeclared ? `${parsedRobots.sitemaps.length} sitemap(s) declared in robots.txt` : 'none declared in robots.txt'}`,
      'Publish an XML sitemap with accurate <lastmod> and declare it in robots.txt. It is how crawlers find new pages and decide what to re-fetch.',
      { sitemaps: parsedRobots.sitemaps.slice(0, 5) }),
  );

  const canonicalTag = H.findTags(html, 'link').find((t) => (H.attr(t, 'rel') || '').toLowerCase() === 'canonical');
  const canonical = canonicalTag ? H.attr(canonicalTag, 'href') : null;
  let canonicalScore = 0;
  if (canonical) {
    try {
      canonicalScore = new URL(canonical, page.finalUrl).href.replace(/\/$/, '') === page.finalUrl.replace(/\/$/, '') ? 1 : 0.6;
    } catch { canonicalScore = 0.4; }
  }
  checks.push(
    check('canonical', 'machine', 'Canonical URL declared', 3, canonicalScore,
      canonical ? `rel=canonical → ${canonical}` : 'No rel=canonical',
      'Declare one canonical URL per piece of content. Duplicates split the citation signal across variants and none of them wins.'),
  );

  const ogTitle = H.metaProp(html, 'og:title');
  const ogDesc = H.metaProp(html, 'og:description');
  const ogImage = H.metaProp(html, 'og:image');
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  checks.push(
    check('opengraph', 'machine', 'Open Graph metadata', 2, ogCount / 3,
      `${ogCount}/3 core OG tags (title, description, image)`,
      'Fill in og:title, og:description and og:image — they are the fallback summary many agents and chat surfaces show when they link you.'),
  );

  const feed = H.findTags(html, 'link').some((t) => /rss|atom/i.test(H.attr(t, 'type') || ''));
  checks.push(
    check('feed', 'machine', 'RSS/Atom feed advertised', 1, feed ? 1 : 0,
      feed ? 'Feed link found' : 'No feed link',
      'Advertise a feed with <link rel="alternate" type="application/rss+xml">. Cheap freshness signal for anything that publishes regularly.'),
  );

  // ---------- structure ----------
  const h1s = hs.filter((h) => h.level === 1);
  checks.push(
    check('h1', 'structure', 'Exactly one H1', 3,
      h1s.length === 1 ? 1 : h1s.length === 0 ? 0 : 0.5,
      h1s.length === 1 ? `H1: "${h1s[0].text.slice(0, 90)}"` : `${h1s.length} H1 elements`,
      'One H1 stating what the page is about. Extractors use it as the document title when <title> is generic.'),
  );

  let skips = 0;
  for (let i = 1; i < hs.length; i++) if (hs[i].level - hs[i - 1].level > 1) skips++;
  checks.push(
    check('heading-order', 'structure', 'Heading levels do not skip', 2,
      hs.length === 0 ? 0 : skips === 0 ? 1 : skips <= 2 ? 0.6 : 0.3,
      hs.length ? `${hs.length} headings, ${skips} level skip(s)` : 'No headings',
      'Do not jump H2 → H4. Chunkers rebuild document outline from heading levels; skips merge unrelated sections.'),
  );

  const landmarks = ['main', 'article', 'header', 'nav', 'footer', 'section'].filter((t) => H.findTags(bodyHtml, t).length);
  checks.push(
    check('semantics', 'structure', 'Semantic landmarks used', 3,
      landmarks.includes('main') || landmarks.includes('article') ? Math.min(1, 0.6 + landmarks.length * 0.1) : landmarks.length * 0.15,
      landmarks.length ? `Found: ${landmarks.join(', ')}` : 'Div soup — no semantic landmarks',
      'Wrap the real content in <main> or <article> and the chrome in <nav>/<footer>. Boilerplate-removal algorithms use these to decide what to keep.'),
  );

  const imgs = H.findTags(bodyHtml, 'img');
  const withAlt = imgs.filter((t) => (H.attr(t, 'alt') || '').trim().length > 0).length;
  const altRatio = imgs.length ? withAlt / imgs.length : 1;
  checks.push(
    check('alt', 'structure', 'Images have alt text', 2, altRatio,
      imgs.length ? `${withAlt}/${imgs.length} images have alt text` : 'No images',
      'Alt text is the only way a text-only crawler perceives an image. Describe the content, not the filename.'),
  );

  const langTag = html.match(/<html\b[^>]*>/i);
  const lang = langTag ? H.attr(langTag[0], 'lang') : null;
  checks.push(
    check('lang', 'structure', 'Language declared', 2, lang ? 1 : 0,
      lang ? `lang="${lang}"` : 'No lang attribute on <html>',
      'Set <html lang="…">. It routes your page to the right language model queries and prevents mis-tokenised extraction.'),
  );

  const anchors = H.findBlocks(bodyHtml, 'a');
  const vague = anchors.filter((a) => {
    const t = H.stripTags(a.inner).toLowerCase();
    return t && (/^(click here|read more|here|more|link|learn more|this)$/.test(t) || /^https?:\/\//.test(t));
  }).length;
  const vagueRatio = anchors.length ? vague / anchors.length : 0;
  checks.push(
    check('link-text', 'structure', 'Descriptive link text', 1,
      vagueRatio <= 0.05 ? 1 : vagueRatio <= 0.15 ? 0.6 : 0.3,
      anchors.length ? `${vague}/${anchors.length} links use vague or bare-URL anchor text` : 'No links',
      'Anchor text is how a model labels the destination. "Click here" tells it nothing about the linked page.'),
  );

  // ---------- trust ----------
  const titleBlock = H.findBlocks(html, 'title')[0];
  const title = titleBlock ? H.stripTags(titleBlock.inner) : '';
  checks.push(
    check('title', 'trust', 'Descriptive <title>', 3,
      !title ? 0 : title.length < 15 ? 0.5 : title.length > 70 ? 0.8 : 1,
      title ? `"${title}" (${title.length} chars)` : 'No <title>',
      'Write a specific 30–65 character title. It is the strongest single label for what the page is.'),
  );

  const desc = H.metaByName(html, 'name', 'description') || '';
  checks.push(
    check('description', 'trust', 'Meta description', 2,
      !desc ? 0 : desc.length < 50 ? 0.6 : desc.length > 200 ? 0.8 : 1,
      desc ? `${desc.length} chars` : 'No meta description',
      'A 120–160 character summary that answers the page question directly. It is frequently reused verbatim as the citation snippet.'),
  );

  const authorMeta = H.metaByName(html, 'name', 'author');
  const authorSchema = jsonLd.some((b) => b.ok && JSON.stringify(b.data).includes('"author"'));
  const bylineText = /\b(by|written by|作者)\s+[A-Z一-鿿]/.test(text.slice(0, 4000));
  const authorScore = (authorMeta ? 0.4 : 0) + (authorSchema ? 0.4 : 0) + (bylineText ? 0.2 : 0);
  checks.push(
    check('author', 'trust', 'Author identified', 2, Math.min(1, authorScore),
      [authorMeta && 'meta author', authorSchema && 'schema author', bylineText && 'visible byline'].filter(Boolean).join(', ') || 'No author signal',
      'Name a real author with a bio or Person schema. Attribution is a large part of why a model picks one source over an identical one.'),
  );

  const dateSchema = jsonLd.some((b) => b.ok && /"date(Published|Modified)"/.test(JSON.stringify(b.data)));
  const dateMeta = !!(H.metaProp(html, 'article:published_time') || H.metaProp(html, 'article:modified_time') || H.metaProp(html, 'date'));
  const timeTag = H.findTags(bodyHtml, 'time').some((t) => H.attr(t, 'datetime'));
  const dateScore = (dateSchema ? 0.5 : 0) + (dateMeta ? 0.3 : 0) + (timeTag ? 0.2 : 0);
  checks.push(
    check('dates', 'trust', 'Publish / update date exposed', 2, Math.min(1, dateScore),
      [dateSchema && 'schema dates', dateMeta && 'meta date', timeTag && '<time datetime>'].filter(Boolean).join(', ') || 'No machine-readable date',
      'Expose datePublished and dateModified in schema and a <time datetime> in the markup. Undated pages get treated as stale and skipped for anything time-sensitive.'),
  );

  let host;
  try { host = new URL(page.finalUrl).hostname.replace(/^www\./, ''); } catch { host = ''; }
  const outbound = anchors.filter((a) => {
    const href = H.attr(a.outer, 'href') || '';
    if (!/^https?:\/\//i.test(href)) return false;
    try { return !new URL(href).hostname.replace(/^www\./, '').endsWith(host); } catch { return false; }
  }).length;
  checks.push(
    check('citations', 'trust', 'Cites outside sources', 1,
      outbound >= 3 ? 1 : outbound >= 1 ? 0.6 : 0.2,
      `${outbound} outbound link(s) to other domains`,
      'Link out to primary sources. Pages that cite get cited — corroboration raises the odds a model treats you as reliable.'),
  );

  const hasAbout = anchors.some((a) => /about|contact|team|關於|聯絡/i.test(H.stripTags(a.inner) + ' ' + (H.attr(a.outer, 'href') || '')));
  checks.push(
    check('about', 'trust', 'About / contact reachable', 1, hasAbout ? 1 : 0,
      hasAbout ? 'About or contact link present' : 'No about/contact link found on this page',
      'Link to an about or contact page. It is a standard organisational-legitimacy signal and feeds Organization entity resolution.'),
  );

  // ---------- scoring ----------
  const categories = CATEGORIES.map((c) => {
    const own = checks.filter((k) => k.category === c.id);
    const w = own.reduce((n, k) => n + k.weight, 0);
    const got = own.reduce((n, k) => n + k.weight * k.score, 0);
    return { ...c, score: w ? Math.round((got / w) * 100) : 0, checkCount: own.length };
  });

  const score = Math.round(
    categories.reduce((n, c) => n + (c.score * c.weight) / 100, 0),
  );

  const priority = checks
    .filter((k) => k.status !== 'pass')
    .map((k) => ({ ...k, impact: k.weight * (1 - k.score) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);

  const summary = {
    words,
    headings: hs.length,
    schemaTypes: types,
    robotsFound: !!robotsText,
    llmsTxt: llmsOk,
    sitemap: sitemapLive || sitemapDeclared,
    title,
    frameworks: markers,
    sizeKb: Math.round(html.length / 1024),
  };

  return {
    url: u.href,
    finalUrl: page.finalUrl,
    host,
    fetchedAt: new Date().toISOString(),
    ms: page.ms,
    status: page.status,
    score,
    grade: grade(score),
    categories,
    checks,
    priority,
    crawlers,
    summary,
    suggestions: buildSuggestions(checks, categories, summary),
  };
}

module.exports = { analyze, normalizeUrl, CATEGORIES };
