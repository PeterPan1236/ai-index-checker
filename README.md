# AI Index Checker

Paste a URL, get a 0–100 score for how well AI answer engines (ChatGPT, Claude, Perplexity, Gemini, Copilot) can crawl, extract, and cite that page.

This is not a Google SEO auditor. The checks target the things that decide whether a model can *use* a page: bot access at the CDN and robots.txt layer, whether the content exists in the raw HTML without JavaScript, whether the page is chunked into retrievable sections, and whether it carries the machine-readable claims (schema, canonical, dates, authorship) that make a model willing to quote it by name.

Zero dependencies. Node 20+ (uses the built-in `fetch`).

## Run

```
cd ai-index-checker
npm start          # http://localhost:4000
npm run dev        # auto-restart on file changes
```

`PORT` overrides the default 4000.

## What a scan does

For each request the server issues five parallel fetches:

| Request | Purpose |
| --- | --- |
| `GET <url>` with a browser UA | The page itself — HTML, headers, timing |
| `GET <url>` with a GPTBot UA | Detects CDN/WAF filtering that robots.txt does not reveal |
| `GET /robots.txt` | Parsed with wildcard and longest-match precedence, evaluated per user-agent against this exact path |
| `GET /llms.txt` | Presence of the agent-facing site index |
| `HEAD /sitemap.xml` | Sitemap availability |

## Scoring

28 checks across five weighted categories:

| Category | Weight | Covers |
| --- | --- | --- |
| Crawler access | 30% | HTTP status, robots.txt per AI agent, bot-UA probe, `noindex`/`nosnippet`, HTTPS, latency |
| Content extractability | 25% | Server-rendered word count, client-framework shell detection, depth, answer-shaped content, chunk size, text-to-markup ratio |
| Machine-readable signals | 20% | JSON-LD validity and types, `llms.txt`, sitemap, canonical, Open Graph, feeds |
| Page structure | 15% | Single H1, heading hierarchy, semantic landmarks, image alt coverage, `lang`, anchor text |
| Trust & attribution | 10% | Title, meta description, author, publish/update dates, outbound citations, about/contact |

Each check returns a 0–1 score and its own weight; the category score is the weighted mean, and the total is the weighted mean of categories. Grades: A+ ≥95, A ≥88, B ≥80, C ≥70, D ≥58, else F.

The **Fix these first** panel ranks failing checks by `weight × (1 − score)`, so the list is ordered by how many points each fix is actually worth.

## Closing action plan

Every report ends with **Where to go from here** — the same failing checks, re-bucketed by how much work they are rather than by category:

| Tier | Meaning |
| --- | --- |
| Do this week | Config and markup edits — robots.txt, canonical, meta, `llms.txt`, dates |
| Next sprint | Template and content changes — JSON-LD, semantics, authorship, answer-shaped copy |
| Bigger project | Rendering, infra or editorial investment — server-side rendering, content depth, latency |

Each tier shows the points it wins back, converted to the final 100-point scale (`check weight ÷ category weight sum × category weight`), so the three tier totals plus the current score add up to 100. Below the tiers, contextual notes call out the dominant problem — a JS-only shell outranks everything else on the list — and the high-weight checks already passing that are worth not regressing.

## Theming

Light and dark both ship. The page follows the OS via `prefers-color-scheme` until the toggle in the header is used; after that the choice is stored in `localStorage` and applied by an inline script in `<head>` before first paint, so a stored light theme never flashes dark on load. `data-theme` on `<html>` overrides the media query in both directions. Every colour is a CSS custom property — the two palettes are the only place colours are defined, and the accent shifts from lime to a darker green in light mode to keep contrast on white.

## Crawlers tracked

GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Googlebot, Bingbot, Applebot-Extended, meta-externalagent, Amazonbot, CCBot.

Retrieval bots (`*-SearchBot`, `*-User`, `Google-Extended`) are weighted double the training-only crawlers — blocking those is what removes you from answers today.

## Limits

- No JavaScript execution. That is deliberate: it mirrors what most AI crawlers see. A page that scores badly on `ssr-text` genuinely reads as near-empty to them.
- HTML is parsed with regex, not a full DOM. Fine for the tag-level signals checked here; it will misread deliberately malformed markup.
- Single page per scan, no crawl.
- `llms.txt` is not yet honoured by every vendor; it is scored low-weight for that reason.

## Safety

The server refuses `localhost`, `.local`/`.internal`, literal private IPs, and any hostname that resolves into a private range, so it cannot be used to probe an internal network. Requests are `GET`/`HEAD` only, capped at 3MB and 15s, and rate limited to 20 scans per minute per IP.
