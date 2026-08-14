const form = document.getElementById('scan-form');
const input = document.getElementById('url');
const go = document.getElementById('go');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const introEl = document.getElementById('intro');

const themeBtn = document.getElementById('theme');

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const activeTheme = () =>
  document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

function labelTheme() {
  themeBtn.querySelector('.label').textContent = activeTheme() === 'dark' ? 'Dark' : 'Light';
}

themeBtn.addEventListener('click', () => {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  labelTheme();
});

// Follow the OS while the user has not made an explicit choice.
systemDark.addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) labelTheme();
});
labelTheme();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colorFor = (pct) => (pct >= 80 ? 'var(--pass)' : pct >= 55 ? 'var(--warn)' : 'var(--fail)');

document.querySelectorAll('.chip').forEach((c) =>
  c.addEventListener('click', () => {
    input.value = c.dataset.url;
    form.requestSubmit();
  }),
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  go.disabled = true;
  resultEl.hidden = true;
  introEl.hidden = true;
  statusEl.hidden = false;
  statusEl.className = 'status';
  statusEl.textContent = `Fetching ${url} plus /robots.txt, /llms.txt, /sitemap.xml, and re-requesting as GPTBot…`;

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    statusEl.hidden = true;
    render(data);
  } catch (err) {
    statusEl.className = 'status error';
    statusEl.textContent = err.message;
    introEl.hidden = false;
  } finally {
    go.disabled = false;
  }
});

function verdictText(d) {
  const worst = d.categories.slice().sort((a, b) => a.score - b.score)[0];
  if (d.score >= 88) return `This page is in good shape for AI retrieval. Weakest area is ${worst.label.toLowerCase()} at ${worst.score}%.`;
  if (d.score >= 70) return `Indexable, with real gaps. ${worst.label} scores ${worst.score}% and is holding the page back most.`;
  if (d.score >= 58) return `An AI crawler can read this page but will struggle to use it confidently. ${worst.label} (${worst.score}%) is the first thing to fix.`;
  return `This page is largely invisible or unusable to AI answer engines. Start with ${worst.label.toLowerCase()} — it scores ${worst.score}%.`;
}

function dial(score, gradeLabel) {
  const r = 74, c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return `
    <div class="dial">
      <svg width="170" height="170" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r="${r}" fill="none" stroke="var(--panel-2)" stroke-width="12"/>
        <circle cx="85" cy="85" r="${r}" fill="none" stroke="${colorFor(score)}" stroke-width="12"
                stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="val">
        <div class="num" style="color:${colorFor(score)}">${score}</div>
        <div class="grade">GRADE ${esc(gradeLabel)}</div>
      </div>
    </div>`;
}

function plan(d) {
  const s = d.suggestions;
  if (!s) return '';

  const tiers = s.tiers.map((t) => `
    <div class="tier">
      <header>
        <h4>${esc(t.label)}</h4>
        <span class="gain">+${t.points} pts</span>
      </header>
      <p class="blurb">${esc(t.blurb)}</p>
      <ol>
        ${t.items.map((i) => `<li><b>${esc(i.label)}</b><span>${esc(i.action)}</span></li>`).join('')}
      </ol>
    </div>`).join('');

  return `
    <h3 class="section">Where to go from here${s.recoverable ? ` — ${s.recoverable} points on the table` : ''}</h3>
    ${tiers ? `<div class="plan">${tiers}</div>` : ''}
    <div class="notes">
      ${s.notes.map((n) => `<p>${esc(n)}</p>`).join('')}
      ${s.strengths.length ? `<p class="keep">Already solid, keep it that way: ${esc(s.strengths.join(' · '))}</p>` : ''}
    </div>`;
}

function render(d) {
  const s = d.summary;
  const facts = [
    `HTTP ${d.status}`,
    `${d.ms}ms`,
    `${s.words} words rendered`,
    `${s.headings} headings`,
    `${s.sizeKb}KB HTML`,
    s.robotsFound ? 'robots.txt found' : 'no robots.txt',
    s.llmsTxt ? 'llms.txt found' : 'no llms.txt',
    s.sitemap ? 'sitemap found' : 'no sitemap',
    s.schemaTypes.length ? `schema: ${s.schemaTypes.slice(0, 4).join(', ')}` : 'no schema types',
    ...(s.frameworks.length ? [`client framework: ${s.frameworks.join(', ')}`] : []),
  ];

  const byCat = {};
  d.checks.forEach((k) => (byCat[k.category] ||= []).push(k));

  resultEl.innerHTML = `
    <div class="scorecard">
      ${dial(d.score, d.grade)}
      <div class="headline">
        <h2>${esc(d.finalUrl)}</h2>
        <div class="sub">scanned ${new Date(d.fetchedAt).toLocaleString()}</div>
        <p class="verdict">${esc(verdictText(d))}</p>
        <div class="cats">
          ${d.categories.map((c) => `
            <div class="cat">
              <span class="name" title="${esc(c.blurb)}">${esc(c.label)} <span style="opacity:.55">· ${c.weight}%</span></span>
              <span class="bar"><i style="width:${c.score}%;background:${colorFor(c.score)}"></i></span>
              <span class="pct" style="color:${colorFor(c.score)}">${c.score}</span>
            </div>`).join('')}
        </div>
        <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
      </div>
    </div>

    ${d.priority.length ? `
    <h3 class="section">Fix these first — ranked by impact on the score</h3>
    <div class="fixes">
      ${d.priority.map((p, i) => `
        <div class="fix">
          <div class="rank">${String(i + 1).padStart(2, '0')}</div>
          <div>
            <h4>${esc(p.label)}</h4>
            <div class="detail">${esc(p.detail)}</div>
            <p class="how">${esc(p.fix)}</p>
          </div>
        </div>`).join('')}
    </div>` : '<h3 class="section">No issues found — every check passed.</h3>'}

    <h3 class="section">AI crawler access, evaluated against this exact path</h3>
    <div class="bots">
      ${d.crawlers.map((b) => `
        <div class="bot">
          <span class="dot ${b.allowed ? 'pass' : 'fail'}"></span>
          <span>
            <span class="ua">${esc(b.ua)}</span>
            <div class="why">${esc(b.owner)} · ${esc(b.purpose)}${b.rule ? ` · matched ${esc(b.rule.type)}: ${esc(b.rule.path)}` : ''}</div>
          </span>
          <span class="verdict-tag ${b.allowed ? 'ok' : 'no'}">${b.allowed ? 'allowed' : 'blocked'}</span>
        </div>`).join('')}
    </div>

    ${d.categories.map((c) => `
      <h3 class="section">${esc(c.label)} — ${c.score}%</h3>
      <div class="checks">
        ${(byCat[c.id] || []).map((k) => `
          <div class="check">
            <span class="dot ${k.status}"></span>
            <span>
              <div class="label">${esc(k.label)}</div>
              <div class="detail">${esc(k.detail)}</div>
            </span>
            <span class="w">weight ${k.weight}</span>
          </div>`).join('')}
      </div>`).join('')}

    ${plan(d)}
  `;
  resultEl.hidden = false;
}
