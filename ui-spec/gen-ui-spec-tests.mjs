// Turns a layout spec (the .spec.json written by the local describe + spec tools) into a Playwright test file.
//
//   node scripts/gen-ui-spec-tests.mjs --spec=docs/design/specs/home.spec.json --out=tests/ui-spec/home.spec.ts [options]
//   node scripts/gen-ui-spec-tests.mjs --dir=docs/design/specs --out-dir=tests/ui-spec [options]
//
// Options:
//   --route=/path      page to open (default: the "route" field of the spec json, else /)
//   --attr=data-ui-id  attribute that marks the element for each spec row (default data-ui-id)
//   --slack=1          extra pixels added to every tolerance for sub-pixel rounding (default 1)
//   --textmap=file     home.textmap.local.json from a --redact run; puts the real copy back into the tests
//   --check            only report whether the generated files are up to date (exit 1 if not), write nothing
//
// The output file is plain ASCII, so it passes the repo's text rules. It is generated: never edit it by hand.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const ascii = (s) => s.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const RUNTIME = String.raw`
const TEXTY = /\b(heading|title|text|label|link|caption|paragraph|subtitle|description|count|value|name|nav item)\b/i;
const NOT_TEXTY = /button|badge|chip|tab\b|icon|image|photo|logo/i;
const TEXT_CHECKED = /\b(heading|title|text|label|link|caption|paragraph|subtitle|description|nav item|button)\b/i;

const isDerived = (r: Row) => r.tol === 'derived';
const tolOf = (r: Row) => (typeof r.tol === 'number' ? r.tol : 6) + SLACK;
const isTexty = (r: Row) => TEXTY.test(r.role) && !NOT_TEXTY.test(r.role);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const title = (r: Row) => String(r.id) + ' ' + r.role.replace(/ \(inferred\)$/, '');

async function measure(page: Page, id: string | number) {
  const loc = page.locator('[' + ATTR + '="' + String(id) + '"]');
  const count = await loc.count();
  if (count === 0) return null;
  const m = await loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      pad: [parseFloat(cs.paddingTop), parseFloat(cs.paddingRight), parseFloat(cs.paddingBottom), parseFloat(cs.paddingLeft)],
      display: cs.display, dir: cs.flexDirection, rowGap: parseFloat(cs.rowGap) || 0, colGap: parseFloat(cs.columnGap) || 0,
    };
  });
  return { ...m, count };
}

test.describe('ui-spec ' + SCREEN, () => {
  test.use({ viewport: CANVAS });

  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}' });
  });

  test('canvas has no horizontal overflow', async ({ page }) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, 'page is wider than the ' + CANVAS.width + ' px canvas').toBeLessThanOrEqual(CANVAS.width + SLACK);
  });

  for (const r of ROWS) {
    if (r.id === 'page') continue;

    test('geometry ' + title(r), async ({ page }) => {
      const m = await measure(page, r.id);
      test.skip(m === null && isDerived(r), 'optional inferred group has no element');
      expect(m, 'no element with ' + ATTR + '="' + String(r.id) + '" (' + r.role + ')').not.toBeNull();
      if (!m) return;
      expect.soft(m.count, 'more than one element has ' + ATTR + '="' + String(r.id) + '"').toBe(1);
      const tol = tolOf(r);
      const want = [r.x, r.y, r.x + Number(r.w), r.y + r.h];
      const got = [m.x, m.y, m.x + m.w, m.y + m.h];
      const names = ['left', 'top', 'right', 'bottom'];
      // Text boxes in the spec follow the line box, so only the left and top edges are checked for text.
      // A width of "fill" means the element fills its parent, so the right edge is not a fixed number.
      const edges = isTexty(r) ? [0, 1] : [0, 1, 2, 3];
      for (const i of edges) {
        if (r.w === 'fill' && i === 2) continue;
        expect.soft(Math.abs(got[i] - want[i]), title(r) + ' ' + names[i] + ': page has ' + got[i].toFixed(1) + ', spec says ' + want[i] + ' (+/- ' + tol + ')').toBeLessThanOrEqual(tol);
      }
    });

    if (r.text && !/^\[T\d+\]$/.test(r.text) && TEXT_CHECKED.test(r.role) && !isDerived(r)) {
      test('text ' + title(r), async ({ page }) => {
        const m = await measure(page, r.id);
        expect(m, 'no element with ' + ATTR + '="' + String(r.id) + '"').not.toBeNull();
        if (!m) return;
        expect(norm(m.text)).toContain(norm(r.text));
      });
    }

    const wantsStyle = !isDerived(r) && ((r.padding && r.padding.some((v) => v !== null)) || r.gap !== null || r.layout);
    if (wantsStyle) {
      test('layout ' + title(r), async ({ page }) => {
        const m = await measure(page, r.id);
        expect(m, 'no element with ' + ATTR + '="' + String(r.id) + '"').not.toBeNull();
        if (!m) return;
        const tol = tolOf(r);
        const sides = ['top', 'right', 'bottom', 'left'];
        (r.padding || []).forEach((v, i) => {
          if (v === null) return; // not measurable from the design: free
          expect.soft(Math.abs(m.pad[i] - v), title(r) + ' padding-' + sides[i] + ': page has ' + m.pad[i] + ', spec says ' + v + ' (+/- ' + tol + ')').toBeLessThanOrEqual(tol);
        });
        const flexy = m.display === 'flex' || m.display === 'inline-flex' || m.display === 'grid' || m.display === 'inline-grid';
        const axis = r.layout ? (r.layout.startsWith('row') ? 'row' : r.layout.startsWith('column') ? 'column' : '') : '';
        // The layout words are hints. They are only checked when the element really is a flex or grid container.
        if (flexy && axis && (m.display === 'flex' || m.display === 'inline-flex')) {
          expect.soft(m.dir.startsWith('row') ? 'row' : 'column', title(r) + ' direction').toBe(axis);
        }
        if (flexy && r.gap !== null && axis && !/far-side/.test(r.layout || '')) {
          const got = axis === 'row' ? m.colGap : m.rowGap;
          expect.soft(Math.abs(got - r.gap), title(r) + ' gap: page has ' + got + ', spec says ' + r.gap + ' (+/- ' + tol + ')').toBeLessThanOrEqual(tol);
        }
      });
    }
  }
});
`;

export function generate(spec, { route, attr, slack, textmap, source }) {
  const rows = spec.rows.map((r) => {
    const text = textmap && /^\[T\d+\]$/.test(r.text || '') && textmap[r.text.slice(1, -1)] ? textmap[r.text.slice(1, -1)] : r.text || '';
    return { id: r.id, parent: r.parent, role: r.role, text, x: r.x, y: r.y, w: String(r.w), h: r.h, padding: r.padding ?? null, layout: r.layout ?? null, gap: r.gap ?? null, tol: r.tol === '' ? '' : r.tol };
  });
  const screen = String(spec.image ?? 'screen').replace(/\.[^.]+$/, '');
  const head = [
    `// GENERATED by scripts/gen-ui-spec-tests.mjs from ${source}. Do not edit: regenerate instead.`,
    '// Each spec row is found through its data-ui-id attribute. See 05-ui-context.md, section Layout specs.',
    "import { expect, test } from '@playwright/test';",
    "import type { Page } from '@playwright/test';",
    '',
    'type Row = {',
    '  id: string | number;',
    '  parent: string | number | null;',
    '  role: string;',
    '  text: string;',
    '  x: number;',
    '  y: number;',
    '  w: string;',
    '  h: number;',
    '  padding: (number | null)[] | null;',
    '  layout: string | null;',
    '  gap: number | null;',
    "  tol: number | string;",
    '};',
    '',
    `const SCREEN = ${JSON.stringify(screen)};`,
    `const ROUTE = ${JSON.stringify(route)};`,
    `const CANVAS = { width: ${Math.round(spec.cssWidth)}, height: ${Math.round(spec.cssHeight)} };`,
    `const ATTR = ${JSON.stringify(attr)};`,
    `const SLACK = ${slack};`,
    'const ROWS: Row[] = [',
    ...rows.map((r) => `  ${JSON.stringify(r)},`),
    '];',
  ].join('\n');
  return ascii(`${head}\n${RUNTIME}`).replace(/[ \t]+$/gm, '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slack = Number(arg('slack', 1)), attr = arg('attr', 'data-ui-id');
  const textmap = arg('textmap') ? JSON.parse(fs.readFileSync(arg('textmap'), 'utf8')) : null;
  const jobs = [];
  if (arg('dir')) {
    const dir = arg('dir'), outDir = arg('out-dir', 'tests/ui-spec');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.spec.json'))) jobs.push({ spec: path.join(dir, f), out: path.join(outDir, f.replace(/\.spec\.json$/, '.spec.ts')) });
  } else if (arg('spec') && arg('out')) jobs.push({ spec: arg('spec'), out: arg('out') });
  else { console.error('usage: node scripts/gen-ui-spec-tests.mjs --spec=<screen>.spec.json --out=<screen>.spec.ts   or   --dir=<dir> --out-dir=<dir>'); process.exit(1); }
  let stale = 0;
  for (const j of jobs) {
    const spec = JSON.parse(fs.readFileSync(j.spec, 'utf8'));
    const text = generate(spec, { route: arg('route', spec.route ?? '/'), attr, slack, textmap, source: j.spec.replace(/\\/g, '/') });
    if (flag('check')) {
      const have = fs.existsSync(j.out) ? fs.readFileSync(j.out, 'utf8') : '';
      if (have !== text) { stale++; console.log(`stale: ${j.out}`); }
      continue;
    }
    fs.mkdirSync(path.dirname(j.out), { recursive: true });
    fs.writeFileSync(j.out, text);
    const n = spec.rows.length - 1;
    console.log(`wrote ${j.out} (${n} spec rows)`);
  }
  if (flag('check')) { console.log(stale ? `${stale} generated test file(s) out of date` : 'generated tests are up to date'); process.exit(stale ? 1 : 0); }
}
