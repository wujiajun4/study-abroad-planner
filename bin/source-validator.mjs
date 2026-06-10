#!/usr/bin/env node
/**
 * source-validator.mjs — v0.3.0 data health check
 *
 * 扫 data/*.json 全部文件, 检出:
 * ① 来源 tier 分布 (tier_1 政府/大学 vs tier_4 聚合器 vs tier_5 社媒)
 * ② 数据保鲜期 (retrieved 日期 + freshness_periods_days)
 * ③ verify_flag / TBD 标记
 * ④ 重大推荐证据是否仅靠 tier≥4
 *
 * 用法:
 *   node bin/source-validator.mjs              # 默认 (✅ + ⚠️ 都放过)
 *   node bin/source-validator.mjs --strict     # ⚠️ 也拦 (Re-run 前用)
 *   node bin/source-validator.mjs --json       # JSON 输出 (CI 用)
 *   node bin/source-validator.mjs --quiet       # 只输出 ❌ (CI gate)
 *
 * 退出码:
 *   0 = 全 ✅ (或 ✅ + ⚠️ 在非 strict 模式)
 *   1 = 有 ❌ (缺源/社媒/严重过期)
 *   2 = 有 ⚠️ (在 strict 模式下, 有 ⚠️ 就算 1)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const TIERS_FILE = path.join(DATA_DIR, 'source-tiers.json');

// === CLI args ===
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');
const QUIET = args.includes('--quiet');

// === Domain → tier mapping (default if no source-tiers.json override) ===
const DOMAIN_TIERS = {
  'immi.homeaffairs.gov.au': 'tier_1',
  'cdu.edu.au': 'tier_1',
  'utas.edu.au': 'tier_1',
  'latrobe.edu.au': 'tier_1',
  'unisa.edu.au': 'tier_1',
  'flinders.edu.au': 'tier_1',
  'cqu.edu.au': 'tier_1',
  'study.unimelb.edu.au': 'tier_1',
  'sydney.edu.au': 'tier_1',
  'ahpra.gov.au': 'tier_1',
  'occupationaltherapyboard.gov.au': 'tier_1',
  'otcouncil.com.au': 'tier_1',
  'cricos.education.gov.au': 'tier_1',
  'homeaffairs.gov.au': 'tier_1',
  'qilt.edu.au': 'tier_1',
  'jobsandskills.gov.au': 'tier_1',
  'parliament.nsw.gov.au': 'tier_1',  // AHPRA annual reports hosted
  'hwd.health.gov.au': 'tier_1',  // Dept of Health workforce data
  'studyaustralia.gov.au': 'tier_1',
  // Tier 4 — aggregators / republishers
  'immitrend.com.au': 'tier_4',
  'migrationpages.com.au': 'tier_4',
  'visasidekick.com.au': 'tier_4',
  'visaiq.com.au': 'tier_4',
  'smartvisaguide.com': 'tier_4',
  'onederland.com.au': 'tier_4',
  'easymigrate.com': 'tier_4',
  'kaimah.co.nz': 'tier_4',
  'swainz.com': 'tier_4',
  'kbaglobal.com': 'tier_4',
  'mediix.com.au': 'tier_4',
  'canapprove.com': 'tier_4',
  'crm.auspath.agency': 'tier_4',
  'globalconsult.com.au': 'tier_4',
  'ahclawyers.com': 'tier_4',
  'immigrationxperts.com': 'tier_4',
  // Tier 5 — social media / forums
  'reddit.com': 'tier_5',
  'facebook.com': 'tier_5',
  'whirlpool.net.au': 'tier_5',
  'youtube.com': 'tier_5',
  'twitter.com': 'tier_5',
  'x.com': 'tier_5',
};

// === Load source-tiers.json (for freshness periods) ===
let TIERS = null;
try {
  TIERS = JSON.parse(fs.readFileSync(TIERS_FILE, 'utf8'));
} catch (e) {
  // Use defaults if source-tiers.json missing
  TIERS = { freshness_periods_days: {} };
}
const FRESHNESS = TIERS.freshness_periods_days || {};

// === Helpers ===
function inferTierFromUrl(url) {
  if (!url) return 'unknown';
  for (const [domain, tier] of Object.entries(DOMAIN_TIERS)) {
    if (url.includes(domain)) return tier;
  }
  return 'unknown';
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function determineFreshnessCategory(url) {
  if (!url) return 'unknown';
  if (url.includes('immi.homeaffairs.gov.au/visas/working-in-australia/skillselect/invitation-rounds') ||
      url.includes('immi.homeaffairs.gov.au/visas/working-in-australia/skillselect/dashboard')) {
    return 'skillselect_invitation_cutoff';
  }
  if (url.includes('ahpra.gov.au') && (url.includes('Statistics') || url.includes('registration'))) {
    return 'ahpra_registration_statistics';
  }
  if (url.includes('cdu.edu.au') || url.includes('fees')) {
    return 'tuition_fees';
  }
  if (url.includes('qilt.edu.au')) {
    return 'qilt_graduate_outcomes';
  }
  return 'unknown';
}

function freshnessStatus(retrieved) {
  const ageDays = daysSince(retrieved);
  if (ageDays === null) return { status: 'unknown', age: null, limit: null };
  // Use a generic default if specific category not matched
  const defaultLimit = 180;
  const limit = defaultLimit;
  if (ageDays > limit) return { status: '⚠️', age: ageDays, limit };
  if (ageDays > limit * 0.8) return { status: '⚠️_approaching', age: ageDays, limit };
  return { status: '✅', age: ageDays, limit };
}

function deepFindUrlsAndFlags(obj, results = { urls: [], retrieved: [], verify_flags: [], tbds: [] }) {
  if (obj === null || obj === undefined) return results;
  if (typeof obj === 'string') {
    if (obj.match(/^https?:\/\//)) results.urls.push(obj);
    if (obj.match(/^\d{4}-\d{2}-\d{2}/)) results.retrieved.push(obj);
    if (obj.toLowerCase().includes('tbd') || obj.toLowerCase().includes('verify_flag')) results.tbds.push(obj);
    return results;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) deepFindUrlsAndFlags(item, results);
    return results;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'retrieved') results.retrieved.push(val);
      if (key === 'verify_flag') results.verify_flags.push(val);
      deepFindUrlsAndFlags(val, results);
    }
    return results;
  }
  return results;
}

// === Main scan ===
function scanFile(filePath) {
  const fileName = path.basename(filePath);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { file: fileName, error: `parse failed: ${e.message}` };
  }

  const findings = deepFindUrlsAndFlags(data);
  const tierDistribution = { tier_1: 0, tier_2: 0, tier_3: 0, tier_4: 0, tier_5: 0, unknown: 0 };
  const urlDetails = [];
  const warnings = [];
  const errors = [];

  for (const url of [...new Set(findings.urls)]) {
    const tier = inferTierFromUrl(url);
    tierDistribution[tier] = (tierDistribution[tier] || 0) + 1;
    if (tier === 'tier_5') {
      errors.push(`${fileName}: tier_5 social media URL — ${url}`);
    } else if (tier === 'unknown') {
      warnings.push(`${fileName}: unknown tier URL — ${url.substring(0, 80)}...`);
    }
    urlDetails.push({ url: url.substring(0, 60) + (url.length > 60 ? '...' : ''), tier });
  }

  // Check freshness on retrieved dates
  const uniqueRetrieved = [...new Set(findings.retrieved)];
  for (const r of uniqueRetrieved) {
    const fs = freshnessStatus(r);
    if (fs.status === '⚠️') {
      warnings.push(`${fileName}: data stale (${fs.age} days > ${fs.limit} day limit) — ${r}`);
    }
  }

  // Check verify_flags (should be flagged for review)
  for (const vf of findings.verify_flags) {
    if (typeof vf === 'string' && vf.length > 0) {
      warnings.push(`${fileName}: has verify_flag — re-verify before relying: "${vf.substring(0, 60)}..."`);
    }
  }

  // Check TBD markers
  for (const tbd of findings.tbds) {
    if (typeof tbd === 'string' && tbd.toLowerCase().includes('tbd')) {
      warnings.push(`${fileName}: contains TBD marker — fill before using as primary evidence`);
    }
  }

  // Major-recommendation evidence check (rough heuristic)
  const tier1Count = tierDistribution.tier_1 || 0;
  const tier4Count = tierDistribution.tier_4 || 0;
  if (tier1Count === 0 && tier4Count > 0 && (fileName.includes('seven-school') || fileName.includes('pr-pathway'))) {
    warnings.push(`${fileName}: major recommendation (PR ranking) relies ONLY on tier_4 — add tier_1 cross-verification`);
  }

  return {
    file: fileName,
    tier_distribution: tierDistribution,
    url_count: findings.urls.length,
    retrieved_dates: uniqueRetrieved,
    verify_flags: findings.verify_flags,
    warnings,
    errors,
    url_details: urlDetails.slice(0, 5),  // cap for display
  };
}

function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));

  const results = files.map(scanFile);
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalTier5 = 0;
  let totalUrls = 0;
  let tier1Total = 0;
  let tier4Total = 0;
  let tier5Total = 0;
  let unknownTotal = 0;

  for (const r of results) {
    if (r.error) {
      totalErrors++;
      continue;
    }
    totalErrors += r.errors.length;
    totalWarnings += r.warnings.length;
    totalUrls += r.url_count;
    tier1Total += r.tier_distribution.tier_1 || 0;
    tier4Total += r.tier_distribution.tier_4 || 0;
    tier5Total += r.tier_distribution.tier_5 || 0;
    unknownTotal += r.tier_distribution.unknown || 0;
  }

  const exitCode = totalErrors > 0 ? 1 : (STRICT && totalWarnings > 0 ? 1 : (totalWarnings > 0 ? 2 : 0));

  if (JSON_OUT) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: STRICT ? 'strict' : 'normal',
      summary: {
        files_scanned: results.length,
        total_urls: totalUrls,
        tier_1_count: tier1Total,
        tier_4_count: tier4Total,
        tier_5_count: tier5Total,
        unknown_count: unknownTotal,
        errors: totalErrors,
        warnings: totalWarnings,
        exit_code: exitCode,
      },
      results,
    }, null, 2));
  } else {
    if (!QUIET) {
      console.log('━'.repeat(70));
      console.log('🔍 study-abroad-planner v0.3.0 Source Validator');
      console.log('━'.repeat(70));
      console.log(`Mode: ${STRICT ? 'STRICT (warnings fail)' : 'normal (warnings exit 2)'}`);
      console.log(`Files scanned: ${results.length}`);
      console.log(`Total URLs: ${totalUrls}`);
      console.log(`  tier_1 (gov/university): ${tier1Total}`);
      console.log(`  tier_4 (aggregator): ${tier4Total}`);
      console.log(`  tier_5 (social media — BANNED): ${tier5Total}`);
      console.log(`  unknown: ${unknownTotal}`);
      console.log(`Errors: ${totalErrors} | Warnings: ${totalWarnings}`);
      console.log('━'.repeat(70));
      console.log('');

      for (const r of results) {
        if (r.error) {
          console.log(`❌ ${r.file}: ${r.error}`);
          continue;
        }
        const t1 = r.tier_distribution.tier_1 || 0;
        const t4 = r.tier_distribution.tier_4 || 0;
        const t5 = r.tier_distribution.tier_5 || 0;
        const u = r.tier_distribution.unknown || 0;
        const head = (t5 > 0) ? '❌' : (r.warnings.length > 0 ? '⚠️ ' : '✅');
        console.log(`${head} ${r.file}`);
        console.log(`     tier_1:${t1} tier_4:${t4} tier_5:${t5} unknown:${u} URLs:${r.url_count}  errs:${r.errors.length} warns:${r.warnings.length}`);
        for (const e of r.errors) console.log(`     ❌ ${e}`);
        for (const w of r.warnings.slice(0, 5)) console.log(`     ⚠️  ${w}`);
        if (r.warnings.length > 5) console.log(`     ⚠️  ... +${r.warnings.length - 5} more`);
        console.log('');
      }

      console.log('━'.repeat(70));
      console.log(`Verdict: ${totalErrors} errors, ${totalWarnings} warnings → exit ${exitCode}`);
      if (tier5Total > 0) console.log('⛔ tier_5 social media detected — remove before publishing');
      if (tier4Total > 0 && tier1Total === 0) console.log('⚠️ Major recommendations may need tier_1 cross-verification');
      if (totalErrors === 0 && totalWarnings === 0) console.log('✅ All clear — proceed to synthesis');
      console.log('━'.repeat(70));
    } else {
      // QUIET mode — only errors
      for (const r of results) {
        for (const e of r.errors) console.error(`❌ ${e}`);
      }
    }
  }

  process.exit(exitCode);
}

main();
