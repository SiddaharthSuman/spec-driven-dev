// `prepare` — run once by the orchestrator, before any pr-reviewer agent
// launches. Resolves git refs, allocates ports, and emits one fully-formed
// agent prompt per PR. See README.md's "prepare" section for the contract.

import path from 'node:path';
import fs from 'node:fs/promises';
import { parsePrList } from './lib/args.mjs';
import {
  fetchPr,
  fetchBaseBranch,
  revParse,
  mergeBase,
  remoteNameWithOwner,
  prMeta,
  checkIgnored,
} from './lib/git.mjs';

const BASE_PORT = 5300;

async function alreadyReviewedAt(outDir, headSha) {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(outDir, 'meta.json'), 'utf8'));
    return meta.headSha === headSha;
  } catch {
    return false; // no prior run recorded — never a reason to skip
  }
}

async function ensureReviewsIgnored(repo) {
  const ignored = await checkIgnored(repo, '.reviews/x');
  if (ignored) return null;
  const excludePath = path.join(repo, '.git', 'info', 'exclude');
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    // .git/info/exclude may not exist yet — that's fine, we create it below
  }
  if (!current.includes('.reviews/')) {
    await fs.appendFile(excludePath, `${current.endsWith('\n') || current === '' ? '' : '\n'}.reviews/\n`);
  }
  return 'Added .reviews/ to .git/info/exclude (it was not already git-ignored).';
}

export async function prepare(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const prs = parsePrList(args.prs);
  const notices = [];

  if (prs.length === 0) {
    console.log(JSON.stringify({ launch: [], skipped: [], notices: ['No PR numbers given.'] }));
    process.exitCode = 1;
    return;
  }

  const notice = await ensureReviewsIgnored(repo);
  if (notice) notices.push(notice);

  const toolRoot =
    process.env.CLAUDE_PLUGIN_ROOT
      ? `${process.env.CLAUDE_PLUGIN_ROOT}/pr-review`
      : path.dirname(new URL(import.meta.url).pathname);

  const repoName = await remoteNameWithOwner(repo);
  const screenshots = args.noScreenshots ? 'off' : 'on';

  const launch = [];
  const skipped = [];

  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    try {
      const meta = await prMeta(repo, pr);
      const { headRef, mergeRef } = await fetchPr(repo, pr);
      const baseRef = await fetchBaseBranch(repo, pr, meta.baseRefName);

      const headSha = await revParse(repo, headRef);
      const outDir = path.join(repo, '.reviews', `pr-${pr}`);

      if (!args.force && (await alreadyReviewedAt(outDir, headSha))) {
        skipped.push({ pr, reason: `already reviewed at head ${headSha.slice(0, 8)}` });
        continue;
      }

      const mode = mergeRef ? 'merge' : 'head-only';
      const mergeSha = mergeRef ? await revParse(repo, mergeRef) : 'none';
      const toSha = mode === 'merge' ? mergeSha : headSha;
      const baseBranchSha = await revParse(repo, baseRef);
      const baseSha = await mergeBase(repo, baseBranchSha, toSha);

      const portBase = BASE_PORT + i * 2;
      const portHead = portBase + 1;

      await fs.mkdir(outDir, { recursive: true });

      const promptLines = [
        `PR=${pr}`,
        `REPO=${repoName}`,
        `MAIN_REPO=${repo}`,
        `TOOL=${toolRoot}`,
        `OUT=${outDir}`,
        `PORT_BASE=${portBase}`,
        `PORT_HEAD=${portHead}`,
        `BASE_SHA=${baseSha}`,
        `HEAD_SHA=${headSha}`,
        `MERGE_SHA=${mergeSha}`,
        `BASE_BRANCH=${meta.baseRefName}`,
        `MODE=${mode}`,
        `SCREENSHOTS=${screenshots}`,
      ];

      launch.push({
        PR: pr,
        prompt: promptLines.join('\n'),
        repo: repoName,
        outDir,
        portBase,
        portHead,
      });
    } catch (err) {
      skipped.push({ pr, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(JSON.stringify({ launch, skipped, notices }, null, 2));
}
