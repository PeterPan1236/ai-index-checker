// AI crawlers that matter for being cited / trained / retrieved.
const AI_AGENTS = [
  { ua: 'GPTBot', owner: 'OpenAI', purpose: 'training', weight: 1 },
  { ua: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'ChatGPT search index', weight: 2 },
  { ua: 'ChatGPT-User', owner: 'OpenAI', purpose: 'live fetch on user request', weight: 2 },
  { ua: 'ClaudeBot', owner: 'Anthropic', purpose: 'training', weight: 1 },
  { ua: 'Claude-SearchBot', owner: 'Anthropic', purpose: 'Claude search index', weight: 2 },
  { ua: 'Claude-User', owner: 'Anthropic', purpose: 'live fetch on user request', weight: 2 },
  { ua: 'PerplexityBot', owner: 'Perplexity', purpose: 'search index', weight: 2 },
  { ua: 'Perplexity-User', owner: 'Perplexity', purpose: 'live fetch on user request', weight: 2 },
  { ua: 'Google-Extended', owner: 'Google', purpose: 'Gemini / AI Overviews grounding', weight: 2 },
  { ua: 'Googlebot', owner: 'Google', purpose: 'base index behind AI Overviews', weight: 2 },
  { ua: 'Bingbot', owner: 'Microsoft', purpose: 'base index behind Copilot', weight: 2 },
  { ua: 'Applebot-Extended', owner: 'Apple', purpose: 'Apple Intelligence', weight: 1 },
  { ua: 'meta-externalagent', owner: 'Meta', purpose: 'Meta AI', weight: 1 },
  { ua: 'Amazonbot', owner: 'Amazon', purpose: 'Alexa / Rufus', weight: 1 },
  { ua: 'CCBot', owner: 'Common Crawl', purpose: 'corpus most LLMs train on', weight: 1 },
];

function parse(text) {
  const groups = [];
  let current = null;
  const sitemaps = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) continue;
      current.rules.push({ type: field, path: value });
    } else if (field === 'crawl-delay') {
      if (current) current.crawlDelay = Number(value);
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

function matchLength(pattern, path) {
  if (pattern === '') return -1;
  // Minimal wildcard support ("*" and "$"), per the robots spec.
  const hasWild = pattern.includes('*') || pattern.endsWith('$');
  if (!hasWild) return path.startsWith(pattern) ? pattern.length : -1;
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\$$/, '$'),
  );
  return re.test(path) ? pattern.length : -1;
}

// Returns { allowed, rule, groupAgents } for a user-agent + path.
function isAllowed(parsed, uaToken, path) {
  const ua = uaToken.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.includes(ua));
  if (!group) group = parsed.groups.find((g) => g.agents.some((a) => a !== '*' && ua.startsWith(a)));
  let matchedBy = group ? 'exact' : null;
  if (!group) {
    group = parsed.groups.find((g) => g.agents.includes('*'));
    matchedBy = group ? 'wildcard' : null;
  }
  if (!group) return { allowed: true, rule: null, matchedBy: 'none', crawlDelay: null };

  let best = null;
  for (const rule of group.rules) {
    const len = matchLength(rule.path, path);
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && rule.type === 'allow')) {
      best = { ...rule, len };
    }
  }
  if (!best) return { allowed: true, rule: null, matchedBy, crawlDelay: group.crawlDelay };
  return { allowed: best.type === 'allow', rule: best, matchedBy, crawlDelay: group.crawlDelay };
}

module.exports = { AI_AGENTS, parse, isAllowed };
