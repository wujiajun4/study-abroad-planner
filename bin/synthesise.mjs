#!/usr/bin/env node
/**
 * synthesise.mjs — v0.3.1 unified entry point for report generation
 *
 * 问题: 之前 SKILL.md 说"synthesise 前必跑 release-precheck", 但 LLM 实际
 * 写报告时没强制 — 靠自觉. 这个 wrapper 把 gate 变成 code 强制:
 *
 *   LLM 调: node bin/synthesise.mjs --report australia-ot
 *   → 本脚本: ①跑 release-precheck ②根据 exit code 决定放行/拦截
 *            ③写审计日志 logs/synthesise.log
 *            ④(可选) dump data snapshot 到 /tmp 给 LLM 作 input
 *
 * 用法:
 *   node bin/synthesise.mjs --report <name>      # 默认: gate + audit
 *   node bin/synthesise.mjs --report <name> --snapshot   # + dump /tmp/data_snapshot.json
 *   node bin/synthesise.mjs --report <name> --json       # JSON 输出 (CI 用)
 *   node bin/synthesise.mjs --report <name> --force      # 跳过 PII (已知会过)
 *
 * 退出码 (同 release-precheck):
 *   0 = clean, proceed
 *   2 = warnings, proceed WITH staleness footer in report
 *   1 = blocked (PII / tier_5 / error expiry)
 *
 * 关键约束: 任何生成 6 段报告的 LLM 必须先调本脚本读 exit code.
 * 如果 LLM 跳过 synthesise.mjs 直接写报告, 这本身是 policy 违反
 * (skill 框架的"诚实优先" 原则) — 但 LLM 当前没法强制. 这个 wrapper
 * 是把 gate 从"文档约定"升级到"代码入口" 的最低成本修法.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.join(__dirname, '..');
const LOGS_DIR = path.join(SKILL_DIR, 'logs');

// === CLI args ===
const args = process.argv.slice(2);
const REPORT_NAME = args.includes('--report') ? args[args.indexOf('--report') + 1] : 'unspecified';
const SNAPSHOT = args.includes('--snapshot');
const JSON_OUT = args.includes('--json');
const FORCE = args.includes('--force');

// === Ensure logs dir ===
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function runReleasePrecheck() {
  const precheckScript = path.join(__dirname, 'release-precheck.mjs');
  const precheckArgs = ['--json'];
  if (FORCE) precheckArgs.push('--force');
  try {
    const out = execSync(`node "${precheckScript}" ${precheckArgs.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit_code: 0, output: JSON.parse(out) };
  } catch (e) {
    const stdout = e.stdout?.toString() || '';
    try {
      return { exit_code: e.status || 1, output: JSON.parse(stdout) };
    } catch {
      return { exit_code: e.status || 1, output: { error: e.message, raw: stdout } };
    }
  }
}

function dumpSnapshot(releaseOutput) {
  // Load all data files + freshness status into a single snapshot for the LLM
  const dataDir = path.join(SKILL_DIR, 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  const snapshot = {
    timestamp: new Date().toISOString(),
    skill_version: 'v0.3.1',
    release_check: releaseOutput,
    data_files: {},
  };
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      snapshot.data_files[f] = {
        size_bytes: fs.statSync(path.join(dataDir, f)).size,
        last_updated: data.last_updated || null,
        version: data.version || null,
        source_count: countSources(data),
        data_types: collectDataTypes(data),
      };
    } catch (e) {
      snapshot.data_files[f] = { error: e.message };
    }
  }
  const snapshotPath = '/tmp/data_snapshot.json';
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return snapshotPath;
}

function countSources(data) {
  let count = 0;
  function walk(obj) {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (typeof obj === 'object') {
      if (obj.source || obj.source_url || obj.source_url_secondary) count++;
      Object.values(obj).forEach(walk);
    }
  }
  walk(data);
  return count;
}

function collectDataTypes(data) {
  const types = new Set();
  function walk(obj) {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (typeof obj === 'object') {
      if (obj.data_type) {
        if (Array.isArray(obj.data_type)) obj.data_type.forEach(t => types.add(t));
        else types.add(obj.data_type);
      }
      Object.values(obj).forEach(walk);
    }
  }
  walk(data);
  return [...types];
}

function writeAuditLog(reportName, exitCode, releaseOutput) {
  const logFile = path.join(LOGS_DIR, 'synthesise.log');
  const entry = {
    timestamp: new Date().toISOString(),
    report: reportName,
    exit_code: exitCode,
    pii_hits: releaseOutput.pii_scan?.hit_count ?? null,
    val_errors: releaseOutput.source_validator?.summary?.errors ?? null,
    val_warnings: releaseOutput.source_validator?.summary?.warnings ?? null,
    decision: exitCode === 0 ? 'PROCEED' : exitCode === 2 ? 'PROCEED_WITH_CAVEAT' : 'BLOCK',
  };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  return logFile;
}

function main() {
  const startTime = Date.now();
  const releaseResult = runReleasePrecheck();
  const releaseOutput = releaseResult.output || {};
  const exitCode = releaseResult.exit_code;

  // === Audit log ===
  const logFile = writeAuditLog(REPORT_NAME, exitCode, releaseOutput);

  // === Optional snapshot ===
  let snapshotPath = null;
  if (SNAPSHOT && exitCode !== 1) {
    snapshotPath = dumpSnapshot(releaseOutput);
  }

  // === Output ===
  const result = {
    timestamp: new Date().toISOString(),
    report: REPORT_NAME,
    duration_ms: Date.now() - startTime,
    gate: {
      exit_code: exitCode,
      decision: exitCode === 0 ? '✅ PROCEED — clean' :
                exitCode === 2 ? '⚠️  PROCEED WITH CAVEAT — add data_staleness footer' :
                '❌ BLOCK — fix PII / tier / errors before synthesising',
    },
    precheck: {
      pii_hits: releaseOutput.pii_scan?.hit_count ?? null,
      pii_note: releaseOutput.pii_scan?.note ?? null,
      val_errors: releaseOutput.source_validator?.summary?.errors ?? null,
      val_warnings: releaseOutput.source_validator?.summary?.warnings ?? null,
      val_tier1: releaseOutput.source_validator?.summary?.tier_1_count ?? null,
      val_tier4: releaseOutput.source_validator?.summary?.tier_4_count ?? null,
      val_tier5: releaseOutput.source_validator?.summary?.tier_5_count ?? null,
    },
    snapshot_path: snapshotPath,
    audit_log: logFile,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('━'.repeat(70));
    console.log('🛡  study-abroad-planner v0.3.1 Synthesise Gate');
    console.log('━'.repeat(70));
    console.log(`Report: ${REPORT_NAME}`);
    console.log(`Duration: ${result.duration_ms}ms`);
    console.log('');
    console.log('─── Pre-check results ───');
    console.log(`  PII hits: ${result.precheck.pii_hits ?? '?'} (${result.precheck.pii_note ?? ''})`);
    console.log(`  Val errors: ${result.precheck.val_errors ?? '?'} | warnings: ${result.precheck.val_warnings ?? '?'}`);
    console.log(`  Tier distribution: tier_1=${result.precheck.val_tier1} tier_4=${result.precheck.val_tier4} tier_5=${result.precheck.val_tier5}`);
    console.log('');
    console.log('━'.repeat(70));
    console.log(`Decision: ${result.gate.decision}`);
    console.log(`Exit code: ${exitCode}`);
    if (exitCode === 2) {
      console.log('');
      console.log('⚠️  Action required: add this footer to your report:');
      console.log('   > Data staleness: this report was generated with N warnings');
      console.log('   > from release-precheck. Run `node bin/release-precheck.mjs`');
      console.log('   > to see which data_types are past warn threshold.');
    }
    if (exitCode === 1) {
      console.log('');
      console.log('❌ Synthesise blocked. DO NOT generate the report.');
      console.log('   Fix the PII / tier_5 / error-threshold issues first.');
      console.log('   Or use `--force` if you have explicit override authority.');
    }
    if (snapshotPath) {
      console.log('');
      console.log(`📦 Data snapshot: ${snapshotPath}`);
    }
    console.log(`📝 Audit log: ${logFile}`);
    console.log('━'.repeat(70));
  }

  process.exit(exitCode);
}

main();
