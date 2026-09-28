// `routes` — walks the TS/TSX import graph (via the TypeScript compiler
// API) from a set of changed files to find every route that could be
// affected. `sweep` — turns a curated route list into page-load-only
// capture-plan scenarios. See README.md's "routes" / "sweep" sections.

import path from 'node:path';
import fs from 'node:fs/promises';
import { parseList } from './lib/args.mjs';

const GLOBAL_ENTRY_PATTERN = /(^|\/)(main|index|App)\.(t|j)sx?$/;
const PAGE_DIR_PATTERN = /(^|\/)(pages|routes)\//;

async function loadTypescript() {
  try {
    return (await import('typescript')).default;
  } catch {
    return null;
  }
}

function routeFromPagePath(filePath) {
  const match = filePath.match(/(^|\/)(pages|routes)\/(.+?)(\/index)?\.(t|j)sx?$/);
  if (!match) return null;
  const routePart = match[3]
    .replace(/\[([^\]]+)\]/g, ':$1') // [id] -> :id
    .toLowerCase();
  return `/${routePart}`.replace(/\/+/g, '/');
}

function collectImportSpecifiers(ts, sourceFile) {
  const specifiers = [];
  ts.forEachChild(sourceFile, (node) => {
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
  });
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

  // reverse[imported] = Set(importers) — "who depends on this file"
  const reverse = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const fromPath = path.relative(repo, sourceFile.fileName);
    for (const spec of collectImportSpecifiers(ts, sourceFile)) {
      const resolved = ts.resolveModuleName(spec, sourceFile.fileName, parsed.options, ts.sys);
      const resolvedPath = resolved.resolvedModule?.resolvedFileName;
      if (!resolvedPath) continue;
      const toPath = path.relative(repo, resolvedPath);
      if (!reverse.has(toPath)) reverse.set(toPath, new Set());
      reverse.get(toPath).add(fromPath);
    }
  }

  const visited = new Set();
  const queue = [...changedFiles];
  let global = false;
  const globalHits = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    // A file named main/index/App.tsx still isn't a "global" entry point if
    // it's a page's own index file (src/pages/reports/index.tsx) — only
    // one living outside any pages/routes directory counts.
    if (GLOBAL_ENTRY_PATTERN.test(current) && !PAGE_DIR_PATTERN.test(current)) {
      global = true;
      globalHits.push(current);
    }
    for (const importer of reverse.get(current) ?? []) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  const routePaths = [...visited]
    .filter((f) => PAGE_DIR_PATTERN.test(f))
    .map(routeFromPagePath)
    .filter(Boolean);

  console.log(
    JSON.stringify({
      global,
      globalHits,
      paths: [...new Set(routePaths)],
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

  const paths = (routesData.paths ?? []).slice(0, limit);
  const scenarios = paths.map((route) => ({
    name: `sweep-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
    route,
    steps: [
      { type: 'goto' },
      { type: 'waitFor', selector: 'body' },
      { type: 'shot' },
    ],
  }));

  console.log(JSON.stringify({ scenarios }));
}
