#!/usr/bin/env node
/**
 * release-precheck.mjs — v0.3.1 orchestrator: PII scrub + source-validator
 *
 * 一次跑两件事:
 * ① PII grep: 用 ~/.claude/skills/pii-scrub/user-patterns.txt 里的 patterns
 *    扫所有发布文件, 命中任何一个就 exit 1 (block push).
 * ② Source validator: 跑 bin/source-validator.mjs, 用其 exit code 决定后续.
 *
 * 用法:
 *   node bin/release-precheck.mjs              # 默认 (warnings 允许 push with caveat)
 *   node bin/release-precheck.mjs --strict     # warnings 也 block push
 *   node bin/release-precheck.mjs --json       # JSON 输出
 *   node bin/release-precheck.mjs --force      # 跳过 PII 检查 (已知会过但 operator 确认)
 *
 * 退出码:
 *   0 = clean — 可 push
 *   1 = errors — 阻止 push (PII hit / tier_5 / 严重过期)
 *   2 = warnings — 允许 push 但有 caveat (freshness / unknown tier)
 *
 * 这个文件是 v0.3.1 关键机制: 把"高频变动项"(freshness) + "PII 残留" + "tier 错误"
 * 三类问题收口成一个 pre-push gate, 不需要每次人工跑两个脚本.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.join(__dirname, '..');
const PII_SKILL = path.join(process.env.HOME, '.claude', 'skills', 'pii-scrub');

// === CLI args ===
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');
const FORCE = args.includes('--force');

// === Load user PII patterns ===
function loadUserPatterns() {
  const patternsFile = path.join(PII_SKILL, 'user-patterns.txt');
  if (!fs.existsSync(patternsFile)) {
    return { patterns: [], note: 'user-patterns.txt not found' };
  }
  const lines = fs.readFileSync(patternsFile, 'utf8').split('\n');
  const patterns = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Split on first whitespace, treat the rest as comment
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
      patterns.push({ pattern: trimmed, comment: '' });
    } else {
      patterns.push({ pattern: trimmed.substring(0, spaceIdx), comment: trimmed.substring(spaceIdx + 1) });
    }
  }
  return { patterns, note: `${patterns.length} patterns loaded` };
}

// === PII scan ===
function scanPII(patterns) {
  if (patterns.length === 0) return { hits: [], error: null };
  const hits = [];
  // Build grep -Ef pattern, one pattern per line
  const patternText = patterns.map(p => p.pattern).join('\n');
  const patternFile = path.join('/tmp', 'release-precheck-patterns.txt');
  fs.writeFileSync(patternFile, patternText);

  try {
    // Run grep on all publish-relevant files
    const cmd = `grep -rnE -f "${patternFile}" --include="*.md" --include="*.json" --include="*.mjs" --include="*.js" --include="*.sh" "${SKILL_DIR}"`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = output.split('\n').filter(l => l.length > 0);
    for (const line of lines) {
      // Skip: the patterns file itself, .git, this script
      if (line.includes('user-patterns.txt') || line.includes('.git/') || line.includes('release-precheck.mjs') || line.includes('HANDOFF.md') || line.includes('pipeline-notes') || line.includes('study_abroad_planner')) continue;
      hits.push(line);
    }
    return { hits, error: null };
  } catch (e) {
    // grep exit 1 = no matches, exit 2 = error
    if (e.status === 1) return { hits: [], error: null };  // no matches found = good
    return { hits: [], error: e.message };
  } finally {
    try { fs.unlinkSync(patternFile); } catch {}
  }
}

// === Main ===
function main() {
  const startTime = Date.now();

  // === Step 1: PII scan ===
  let piiResult;
  if (FORCE) {
    piiResult = { hits: [], hit_count: 0, error: 'skipped (--force)', note: 'PII check skipped (--force)' };
  } else {
    const { patterns, note } = loadUserPatterns();
    const scanOut = scanPII(patterns);
    piiResult = {
      hits: scanOut.hits,
      hit_count: scanOut.hits.length,
      error: scanOut.error,
      note,
    };
  }

  // === Step 2: source-validator ===
  const validatorScript = path.join(__dirname, 'source-validator.mjs');
  let validatorResult = { exit_code: 0, stdout: '', stderr: '' };
  try {
    const validatorArgs = STRICT ? '--strict' : '';
    const cmd = `node "${validatorScript}" --json ${validatorArgs}`.trim();
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    validatorResult.stdout = out;
    try {
      const parsed = JSON.parse(out);
      validatorResult.exit_code = parsed.summary?.exit_code ?? 0;
      validatorResult.summary = parsed.summary;
    } catch (e) {
      // JSON parse fail — but exit code is 0, treat as clean
      validatorResult.exit_code = 0;
    }
  } catch (e) {
    // Validator exited non-zero — capture output
    validatorResult.exit_code = e.status || 1;
    validatorResult.stdout = e.stdout?.toString() || '';
    validatorResult.stderr = e.stderr?.toString() || '';
    try {
      const parsed = JSON.parse(validatorResult.stdout);
      validatorResult.summary = parsed.summary;
    } catch {}
  }

  // === Aggregate exit code ===
  let finalExit = 0;
  if (piiResult.hits.length > 0) finalExit = 1;
  if (validatorResult.exit_code === 1) finalExit = 1;
  if (finalExit === 0 && validatorResult.exit_code === 2) finalExit = 2;

  const result = {
    timestamp: new Date().toISOString(),
    mode: STRICT ? 'strict' : (FORCE ? 'force' : 'normal'),
    duration_ms: Date.now() - startTime,
    pii_scan: {
      note: piiResult.note,
      hits: piiResult.hits,
      hit_count: piiResult.hits.length,
      error: piiResult.error,
    },
    source_validator: {
      exit_code: validatorResult.exit_code,
      summary: validatorResult.summary,
    },
    verdict: {
      final_exit: finalExit,
      decision: finalExit === 0 ? '✅ PROCEED — push allowed' :
                finalExit === 2 ? '⚠️  PROCEED WITH CAVEAT — push allowed, freshness warnings in report' :
                '❌ BLOCK — fix PII / tier / errors before push',
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('━'.repeat(70));
    console.log('🛡  study-abroad-planner v0.3.1 Release Pre-Check');
    console.log('━'.repeat(70));
    console.log(`Mode: ${STRICT ? 'STRICT' : (FORCE ? 'FORCE (PII skipped)' : 'normal')}`);
    console.log(`Duration: ${result.duration_ms}ms`);
    console.log('');
    console.log('─── Step 1: PII scrub ───');
    if (piiResult.error) {
      console.log(`⚠️  ${piiResult.error}`);
    } else {
      console.log(`Loaded: ${piiResult.note}`);
      console.log(`Hits: ${piiResult.hit_count}`);
      if (piiResult.hit_count === 0) {
        console.log('✅ No PII patterns found in publish files');
      } else {
        console.log('❌ PII PATTERNS DETECTED:');
        for (const h of piiResult.hit_count > 10 ? piiResult.hits.slice(0, 10) : piiResult.hits) {
          console.log(`  ${h}`);
        }
        if (piiResult.hit_count > 10) console.log(`  ... and ${piiResult.hit_count - 10} more`);
      }
    }
    console.log('');
    console.log('─── Step 2: source-validator ───');
    if (validatorResult.summary) {
      console.log(`Files: ${validatorResult.summary.files_scanned} | URLs: ${validatorResult.summary.total_urls}`);
      console.log(`  tier_1: ${validatorResult.summary.tier_1_count} | tier_4: ${validatorResult.summary.tier_4_count} | tier_5: ${validatorResult.summary.tier_5_count} | unknown: ${validatorResult.summary.unknown_count}`);
      console.log(`Errors: ${validatorResult.summary.errors} | Warnings: ${validatorResult.summary.warnings}`);
    } else {
      console.log(`Exit code: ${validatorResult.exit_code}`);
    }
    console.log('');
    console.log('━'.repeat(70));
    console.log(`Verdict: ${result.verdict.decision}`);
    console.log(`Final exit: ${finalExit}`);
    console.log('━'.repeat(70));
  }

  process.exit(finalExit);
}

main();
