// `routes`: walks the TS/TSX import graph (via the TypeScript compiler
// API) from a set of changed files to find every route that could be
// affected. `sweep`: turns a curated route list into page-load-only
// capture-plan scenarios. See README.md's "routes" / "sweep" sections.

import path from 'node:path';
import fs from 'node:fs/promises';
import { parseList } from './lib/args.mjs';

const GLOBAL_ENTRY_PATTERN = /(^|\/)(main|index|App)\.(t|j)sx?$/;
const PAGE_DIR_PATTERN = /(^|\/)(pages|routes)\//;
const SOURCE_EXT = /\.(t|j)sx?$/;
const NON_ROUTE_FILE = /\.(test|spec|stories|d)\.(t|j)sx?$|\.gen\.(t|j)sx?$/;

async function loadTypescript() {
  try {
    return (await import('typescript')).default;
  } catch {
    return null;
  }
}

// Path segments below the pages/routes directory, with the extension and any
// ".lazy" marker removed: "src/routes/posts.$id.lazy.tsx" -> ["posts", "$id"].
function routeSegments(filePath) {
  const match = filePath.match(/(^|\/)(pages|routes)\/(.+)$/);
  if (!match) return null;
  return match[3]
    .replace(SOURCE_EXT, '')
    .replace(/\.lazy$/, '')
    .split('/')
    .flatMap((part) => (part.startsWith('[') ? [part] : part.split('.')));
}

// A route file is a page the router can render. Helper files that live in a
// routes directory are not: "-private" style folders and files, generated
// route trees, tests, stories, and __root (handled as global elsewhere).
export function isRouteFile(filePath) {
  if (!PAGE_DIR_PATTERN.test(filePath) || !SOURCE_EXT.test(filePath) || NON_ROUTE_FILE.test(filePath)) return false;
  const segments = filePath.split('/');
  const below = segments.slice(segments.findIndex((x) => x === 'pages' || x === 'routes') + 1);
  if (below.some((part) => part.startsWith('-'))) return false;
  return !path.basename(filePath).startsWith('__root');
}

// Layouts wrap other routes, so a change to one affects its whole subtree:
// route.tsx, _layout.tsx and _app (directory layouts), _auth style pathless
// layouts, and a flat "posts.tsx" that has "posts.$id.tsx" siblings.
function layoutKind(filePath, routeFiles) {
  const stem = path.basename(filePath).replace(SOURCE_EXT, '').replace(/\.lazy$/, '');
  if (['route', 'layout', '_layout', '_app'].includes(stem)) return 'directory';
  const dir = path.dirname(filePath);
  const hasFlatChildren = routeFiles.some(
    (g) => g !== filePath && (g.startsWith(`${dir}/${stem}/`) || (path.dirname(g) === dir && path.basename(g).startsWith(`${stem}.`)))
  );
  return hasFlatChildren ? 'flat' : null;
}

export function layoutSubtree(filePath, routeFiles) {
  const kind = layoutKind(filePath, routeFiles);
  if (!kind) return [];
  const dir = path.dirname(filePath);
  const stem = path.basename(filePath).replace(SOURCE_EXT, '').replace(/\.lazy$/, '');
  return routeFiles.filter((g) => {
    if (g === filePath) return false;
    if (kind === 'directory') return g.startsWith(`${dir}/`);
    return g.startsWith(`${dir}/${stem}/`) || (path.dirname(g) === dir && path.basename(g).startsWith(`${stem}.`));
  });
}

// "src/routes/posts.$id.tsx" -> "/posts/:id". Handles TanStack Router file
// naming ($param, $ splat, _pathless layouts, trailing _ escapes, -private
// folders, index, route, .lazy), Next and Remix style [id] and [...slug], and
// (group) folders. Returns null for a pathless layout, which has no URL.
export function routeFromPagePath(filePath) {
  const parts = routeSegments(filePath);
  if (!parts) return null;
  const out = [];
  for (const raw of parts) {
    if (raw === 'index' || raw === 'route' || raw === 'layout') continue;
    if (raw.startsWith('_') || (raw.startsWith('(') && raw.endsWith(')'))) continue;
    const part = raw.endsWith('_') ? raw.slice(0, -1) : raw;
    if (part === '$') out.push('*');
    else if (part.startsWith('$')) out.push(`:${part.slice(1)}`);
    else if (part.startsWith('[...') && part.endsWith(']')) out.push('*');
    else if (part.startsWith('[') && part.endsWith(']')) out.push(`:${part.slice(1, -1)}`);
    else if (part) out.push(part);
  }
  const stem = parts[parts.length - 1];
  if (out.length === 0 && stem !== 'index' && stem.startsWith('_')) return null;
  return `/${out.join('/')}`;
}

function collectImportSpecifiers(ts, sourceFile) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && node.moduleReference && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) specifiers.push(expr.text);
    }
    // import('./x') and React.lazy(() => import('./x'))
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

export async function routes(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const changedFiles = parseList(args.files);

  const ts = await loadTypescript();
  if (!ts || changedFiles.length === 0) {
    console.log(
      JSON.stringify({
        global: true,
        reason: ts ? 'no changed files given' : 'typescript is not installed in this checkout',
        paths: [],
      })
    );
    return;
  }

  const configPath = ts.findConfigFile(repo, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    console.log(JSON.stringify({ global: true, reason: 'no tsconfig.json found', paths: [] }));
    return;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

  // reverse[imported] = Set(importers): "who depends on this file"
  const reverse = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const fromPath = path.relative(repo, sourceFile.fileName);
    if (/\.gen\.(t|j)sx?$/.test(fromPath)) continue; // generated route tree only wires routes up
    for (const spec of collectImportSpecifiers(ts, sourceFile)) {
      const resolved = ts.resolveModuleName(spec, sourceFile.fileName, parsed.options, ts.sys);
      const resolvedPath = resolved.resolvedModule?.resolvedFileName;
      if (!resolvedPath) continue;
      const toPath = path.relative(repo, resolvedPath);
      if (!reverse.has(toPath)) reverse.set(toPath, new Set());
      reverse.get(toPath).add(fromPath);
    }
  }

  // Files the app's router can render, from every source file in the program.
  const routeFiles = program
    .getSourceFiles()
    .filter((f) => !f.isDeclarationFile)
    .map((f) => path.relative(repo, f.fileName))
    .filter(isRouteFile);

  // Walk importers outward from the changed files, but stop at route files.
  // A route file is a leaf of the impact: whoever imports it (the router
  // config, or the generated routeTree.gen.ts in TanStack Router) only wires
  // it up, and walking on would reach main.tsx from every page and report
  // every change as global.
  const visited = new Set();
  const affectedRouteFiles = new Set();
  const queue = [...changedFiles];
  let global = false;
  const globalHits = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    if (path.basename(current).startsWith('__root.')) {
      global = true;
      globalHits.push(current);
      continue;
    }
    if (isRouteFile(current)) {
      affectedRouteFiles.add(current);
      for (const child of layoutSubtree(current, routeFiles)) affectedRouteFiles.add(child);
      continue;
    }
    if (GLOBAL_ENTRY_PATTERN.test(current) && !PAGE_DIR_PATTERN.test(current)) {
      global = true;
      globalHits.push(current);
    }
    for (const importer of reverse.get(current) ?? []) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  const routePaths = [...affectedRouteFiles].map(routeFromPagePath).filter((p) => p !== null);

  console.log(
    JSON.stringify({
      global,
      globalHits,
      paths: [...new Set(routePaths)].sort(),
      routeFiles: [...affectedRouteFiles].sort(),
      filesTouched: [...visited],
    })
  );
}

export async function sweep(args) {
  const { max } = args;
  const limit = max ? Number.parseInt(max, 10) : 12;
  let routesData;
  try {
    routesData = JSON.parse(await fs.readFile(path.resolve(args.routes), 'utf8'));
  } catch (err) {
    console.error(`sweep: could not read --routes file: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // A path with a parameter or a splat needs a real value to load, which the
  // route list cannot know. Those are reported, not guessed, so the agent
  // can supply a concrete URL (or say it could not).
  const rawPaths = Array.isArray(routesData) ? routesData : (routesData.paths ?? []);
  const allPaths = rawPaths.map((entry) => (typeof entry === 'string' ? entry : entry?.path)).filter((route) => typeof route === 'string');
  const concrete = allPaths.filter((route) => !/[:*]/.test(route));
  const skipped = allPaths
    .filter((route) => /[:*]/.test(route))
    .map((route) => ({ route, reason: 'needs a concrete parameter value to load' }));
  const paths = concrete.slice(0, limit);
  const notSwept = concrete.slice(limit).map((route) => ({ route, reason: `over the --max limit of ${limit}` }));
  const scenarios = paths.map((route) => ({
    name: `sweep-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}`,
    route,
    steps: [
      { type: 'goto' },
      { type: 'waitFor', selector: 'body' },
      { type: 'shot' },
    ],
  }));

  console.log(JSON.stringify({ scenarios, skipped: [...skipped, ...notSwept] }));
}
