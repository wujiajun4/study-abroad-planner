#!/usr/bin/env node
/**
 * aus-course-filter.mjs — 澳洲课程筛选 CLI
 *
 * 用途：按 PTE / 预算 / 偏远 / 专业 / GPA / 路径（2y vs 4y） 筛选 data/australian-courses.json
 *
 * 用法：
 *   # argv 模式
 *   node aus-course-filter.mjs \
 *     --pte 70 --pte-each-band 65 --budget-aud 110000 \
 *     --regional-only --profession OT --no-prereq
 *
 *   # stdin 模式
 *   echo "pte=70
 *   budget_aud=110000
 *   regional_only=yes
 *   profession=OT
 *   no_prereq=yes" | node aus-course-filter.mjs
 *
 *   # JSON 输出
 *   node aus-course-filter.mjs --json --pte 70 ...
 *
 * 数据源：data/australian-courses.json (v0.3.0) — 每条 course 都带 source 字段
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'australian-courses.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    process.stderr.write(`❌ data file not found: ${DATA_FILE}\n`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function parseInput(args) {
  const opts = {
    pte: null,
    pte_each_band: null,
    budget_aud: null,
    gpa: null,
    regional_only: false,
    profession: null,
    path_filter: null,         // '2y' | '4y' | null (any)
    no_prereq: false,
    scholarship_min_pct: 0,
    intake_month: null,
    sort_by: 'tuition_total',  // 'tuition_total' | 'qilt_employment_ft_pct' | 'scholarship_max_pct' | 'gpa_min_7scale'
    ascending: true,
    show_source: false,        // v0.2.1+ — print per-course `source` block (URL + retrieved date)
    json: false,
  };

  // argv
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') { opts.json = true; continue; }
    if (args[i] === '--pte') { opts.pte = parseInt(args[++i], 10); continue; }
    if (args[i] === '--pte-each-band') { opts.pte_each_band = parseInt(args[++i], 10); continue; }
    if (args[i] === '--budget-aud') { opts.budget_aud = parseInt(args[++i], 10); continue; }
    if (args[i] === '--gpa') { opts.gpa = parseFloat(args[++i]); continue; }
    if (args[i] === '--regional-only') { opts.regional_only = true; continue; }
    if (args[i] === '--profession') { opts.profession = args[++i]; continue; }
    if (args[i] === '--path') { opts.path_filter = args[++i]; continue; }
    if (args[i] === '--no-prereq') { opts.no_prereq = true; continue; }
    if (args[i] === '--scholarship-min-pct') { opts.scholarship_min_pct = parseInt(args[++i], 10); continue; }
    if (args[i] === '--intake-month') { opts.intake_month = parseInt(args[++i], 10); continue; }
    if (args[i] === '--sort-by') { opts.sort_by = args[++i]; continue; }
    if (args[i] === '--desc') { opts.ascending = false; continue; }
    if (args[i] === '--show-source') { opts.show_source = true; continue; }
  }

  // stdin (only fills missing fields, doesn't overwrite argv)
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) {
      for (const line of stdin.split('\n')) {
        const m = line.match(/^\s*([\w-]+)\s*=\s*(.+?)\s*$/);
        if (m) {
          const [, key, val] = m;
          if (['pte', 'pte_each_band', 'budget_aud', 'gpa', 'scholarship_min_pct', 'intake_month'].includes(key)) {
            if (opts[key] === null || opts[key] === 0) opts[key] = parseFloat(val);
          } else if (['regional_only', 'no_prereq', 'json', 'show_source'].includes(key)) {
            if (!opts[key]) opts[key] = (val === 'yes' || val === 'true');
          } else {
            if (!opts[key]) opts[key] = val;
          }
        }
      }
    }
  } catch (e) {}

  return opts;
}

function matches(course, opts) {
  // PTE
  if (opts.pte !== null) {
    if (opts.pte < course.pte_overall_min) return { ok: false, why: `PTE overall ${opts.pte} < ${course.pte_overall_min}` };
    if (opts.pte_each_band !== null) {
      if (opts.pte_each_band < course.pte_each_band_min) {
        return { ok: false, why: `PTE band ${opts.pte_each_band} < ${course.pte_each_band_min}` };
      }
    }
  }
  // GPA
  if (opts.gpa !== null) {
    if (opts.gpa < course.gpa_min_7scale) return { ok: false, why: `GPA ${opts.gpa} < ${course.gpa_min_7scale}` };
  }
  // Budget (compute total cost for the duration)
  if (opts.budget_aud !== null) {
    const totalCost = course.tuition_total_aud_2y ?? course.tuition_total_aud_4y ?? 0;
    if (totalCost > opts.budget_aud) return { ok: false, why: `Total cost $${totalCost.toLocaleString()} > budget $${opts.budget_aud.toLocaleString()}` };
  }
  // Regional
  if (opts.regional_only && !course.regional) return { ok: false, why: 'non-regional' };
  // Profession
  if (opts.profession && course.profession !== opts.profession) return { ok: false, why: `profession ${course.profession} != ${opts.profession}` };
  // Path (2y vs 4y)
  if (opts.path_filter === '2y' && course.duration_years !== 2) return { ok: false, why: 'not 2-year path' };
  if (opts.path_filter === '4y' && course.duration_years !== 4) return { ok: false, why: 'not 4-year path' };
  // No prereq
  if (opts.no_prereq && course.prereq && course.prereq.length > 0) {
    return { ok: false, why: `prereq: ${course.prereq.join('; ')}` };
  }
  // Scholarship min
  if (opts.scholarship_min_pct > 0 && (course.scholarship_max_pct || 0) < opts.scholarship_min_pct) {
    return { ok: false, why: `scholarship ${course.scholarship_max_pct || 0}% < ${opts.scholarship_min_pct}%` };
  }
  // Intake month
  if (opts.intake_month !== null) {
    if (!course.intake_months.includes(opts.intake_month)) {
      return { ok: false, why: `no intake in month ${opts.intake_month}` };
    }
  }
  return { ok: true };
}

function sortCourses(courses, by, ascending) {
  const sorted = [...courses];
  sorted.sort((a, b) => {
    let av, bv;
    if (by === 'tuition_total') {
      av = a.tuition_total_aud_2y ?? a.tuition_total_aud_4y ?? 999999;
      bv = b.tuition_total_aud_2y ?? b.tuition_total_aud_4y ?? 999999;
    } else if (by === 'qilt_employment_ft_pct') {
      av = a.qilt_employment_ft_pct ?? 0;
      bv = b.qilt_employment_ft_pct ?? 0;
    } else if (by === 'scholarship_max_pct') {
      av = a.scholarship_max_pct ?? 0;
      bv = b.scholarship_max_pct ?? 0;
    } else if (by === 'gpa_min_7scale') {
      av = a.gpa_min_7scale ?? 99;
      bv = b.gpa_min_7scale ?? 99;
    } else {
      return 0;
    }
    return ascending ? av - bv : bv - av;
  });
  return sorted;
}

function main() {
  const args = process.argv.slice(2);
  const opts = parseInput(args);
  const data = loadData();

  // Filter
  const results = data.courses.map(c => {
    const m = matches(c, opts);
    return { course: c, ...m };
  });
  const passing = results.filter(r => r.ok);

  // Sort passing
  const sortedPassing = sortCourses(passing.map(r => r.course), opts.sort_by, opts.ascending);

  if (opts.json) {
    console.log(JSON.stringify({
      filters: opts,
      total_courses: data.courses.length,
      passing: passing.length,
      results: sortedPassing,
      failing: results.filter(r => !r.ok).map(r => ({
        course: `${r.course.school} ${r.course.course}`,
        reason: r.why,
      })),
      data_source: {
        schema_version: data.version,
        last_updated: data.last_updated,
        schema_note: data.schema_note,
      },
    }, null, 2));
  } else {
    console.log('');
    console.log('━'.repeat(70));
    console.log('🔍 Australian Course Filter');
    console.log('━'.repeat(70));
    console.log('');
    console.log('Filters:');
    if (opts.pte) console.log(`  PTE ≥ ${opts.pte} (each band ≥ ${opts.pte_each_band || 'N/A'})`);
    if (opts.gpa) console.log(`  GPA ≥ ${opts.gpa}/7.0`);
    if (opts.budget_aud) console.log(`  Budget ≤ $${opts.budget_aud.toLocaleString()} AUD`);
    if (opts.regional_only) console.log('  Regional only ✓');
    if (opts.profession) console.log(`  Profession: ${opts.profession}`);
    if (opts.path_filter) console.log(`  Path: ${opts.path_filter}`);
    if (opts.no_prereq) console.log('  No prerequisites ✓');
    if (opts.scholarship_min_pct > 0) console.log(`  Scholarship ≥ ${opts.scholarship_min_pct}%`);
    if (opts.intake_month) console.log(`  Intake in month ${opts.intake_month}`);
    console.log('');
    console.log(`📊 ${passing.length}/${data.courses.length} courses pass (sorted by ${opts.sort_by})`);
    console.log('');

    if (passing.length === 0) {
      console.log('❌ No courses pass all filters. Try loosening constraints.');
      console.log('');
      console.log('Failing courses + reasons:');
      for (const r of results) {
        if (!r.ok) {
          const c = r.course;
          console.log(`  - ${c.school.padEnd(20)} ${c.course.padEnd(40)} (${r.why})`);
        }
      }
    } else {
      for (const c of sortedPassing) {
        const totalCost = c.tuition_total_aud_2y ?? c.tuition_total_aud_4y;
        const regionalFlag = c.regional ? '🟢Regional' : '⚪Metro';
        const prereqFlag = (c.prereq && c.prereq.length > 0) ? '⚠️Prereq' : '✅No prereq';
        const scholarship = c.scholarship_max_pct ? ` 🎓${c.scholarship_max_pct}%` : '';
        console.log(`${regionalFlag} | ${prereqFlag} | ${c.school.padEnd(20)} | ${c.course}`);
        console.log(`         ${c.campus} | ${c.duration_years}y | $${c.tuition_aud_per_year.toLocaleString()}/y ($${totalCost.toLocaleString()} total)${scholarship}`);
        console.log(`         PTE ≥ ${c.pte_overall_min} (each ≥ ${c.pte_each_band_min}) | GPA ≥ ${c.gpa_min_7scale}/7.0`);
        if (c.qilt_employment_ft_pct) {
          console.log(`         QILT FT employment: ${c.qilt_employment_ft_pct}%`);
        }
        if (c.note) {
          console.log(`         Note: ${c.note}`);
        }
        if (c.prereq_match_user) {
          console.log(`         Prereq match (you): ${c.prereq_match_user}`);
        }
        console.log(`         → ${c.url}`);
        if (opts.show_source && c.source) {
          console.log(`         📚 Source: ${c.source.course_page}`);
          console.log(`             Retrieved: ${c.source.retrieved}`);
          if (c.source.verified_by) {
            console.log(`             Verified: ${c.source.verified_by}`);
          }
          if (c.source.verify_flag) {
            console.log(`             ⚠️  Verify: ${c.source.verify_flag}`);
          }
        }
        console.log('');
      }
    }
    console.log('━'.repeat(70));
  }

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
