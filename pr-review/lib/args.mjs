// Minimal --flag value / --flag (boolean) argv parser shared by every
// command. Kebab-case flags become camelCase keys: --no-screenshots ->
// noScreenshots, --base-caption "x" -> baseCaption: "x".

function toCamel(key) {
  return key.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = toCamel(tok.slice(2));
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

// `--prs "670 671"` -> [670, 671]. Accepts commas too.
export function parsePrList(value) {
  if (!value) return [];
  return String(value)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n));
}

// `--files a.ts,b.ts` -> ["a.ts", "b.ts"]
export function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
