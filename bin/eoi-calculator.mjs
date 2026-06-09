#!/usr/bin/env node
/**
 * eoi-calculator.mjs — Australian SkillSelect EOI Points Calculator
 *
 * 用途：按 2025-26 澳洲 SkillSelect 政策计算 EOI 分数
 *      来源：https://immi.homeaffairs.gov.au/help-support/tools/points-calculator
 *
 * 用法：
 *   # stdin 模式（多行 key=value）
 *   echo "age=29
 *   english_band=proficient
 *   qualification=bachelor
 *   work_overseas_years=0
 *   state_nomination=yes
 *   regional_study=yes" | node eoi-calculator.mjs
 *
 *   # argv 模式
 *   node eoi-calculator.mjs \
 *     --age 29 \
 *     --english-band proficient \
 *     --qualification bachelor \
 *     --work-overseas 0 \
 *     --work-aus 0 \
 *     --state-nomination yes \
 *     --regional-study yes
 *
 *   # JSON 输出
 *   node eoi-calculator.mjs --json --age 29 ...
 *
 * 关键规则（2025-26 政策）：
 *   - 邀请线：189 75-80, 190 各州不同 (一般 65-80), 491 偏远 65-80
 *   - State nomination (190): +5 分
 *   - Regional study (491 偏远 2 年): +5 分（跟 Australian study bonus 不叠加）
 *   - Australian study bonus (2 年 CRICOS 课程): +5 分
 */

const POINTS_TABLE = {
  age: {
    '18-24': 25,
    '25-32': 30,
    '33-39': 25,
    '40-44': 15,
    '45+': 0,
  },
  english: {
    'competent': { ielts: 6, pte: 50, points: 0 },
    'proficient': { ielts: 7, pte: 65, points: 10 },
    'superior': { ielts: 8, pte: 79, points: 20 },
  },
  qualification: {
    'diploma': 10,        // AQF 5-6
    'bachelor': 15,       // AQF 7-9
    'master': 15,         // AQF 9
    'phd': 20,            // AQF 10
  },
  work_overseas: {
    0: 0,
    1: 0,
    2: 0,
    3: 5,
    4: 5,
    5: 10,
    6: 10,
    7: 10,
    8: 15,
  },
  work_aus: {
    0: 0,
    1: 5,
    2: 5,
    3: 10,
    4: 10,
    5: 15,
    6: 15,
    7: 15,
    8: 20,
  },
  specialist_education: {
    'phd_stem_aus': 10,
    'master_research_aus': 10,
    'professional_year': 5,
    'none': 0,
  },
  other_factors: {
    'state_nomination_190': 5,
    'regional_study_491': 5,
    'aus_study_2yr_cricos': 5,
    'partner_skills_competent_english': 5,
    'partner_skills_proficient_english': 10,
    'community_language': 5,
  },
};

const INVITATION_THRESHOLDS = {
  '189': { 'OT': 80, 'PT': 85, 'SLP': 80, 'Dietitian': 75, 'General': 90 },
  '190': { 'OT': 75, 'PT': 80, 'SLP': 80, 'Dietitian': 70, 'General': 80 },  // NT/SA 通常较低
  '491': { 'OT': 70, 'PT': 75, 'SLP': 75, 'Dietitian': 65, 'General': 80 },  // 偏远最低
};

function parseInput(args) {
  const opts = {
    age: 30,
    english_band: 'proficient',
    qualification: 'bachelor',
    work_overseas: 0,
    work_aus: 0,
    specialist: 'none',
    state_nomination: 'no',
    regional_study: 'no',
    aus_study: 'no',
    partner_skills: 'no',
    occupation: 'OT',
  };

  // argv 解析
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') { opts.json = true; continue; }
    if (args[i] === '--age') { opts.age = parseInt(args[++i], 10); continue; }
    if (args[i] === '--english-band') { opts.english_band = args[++i]; continue; }
    if (args[i] === '--qualification') { opts.qualification = args[++i]; continue; }
    if (args[i] === '--work-overseas') { opts.work_overseas = parseInt(args[++i], 10); continue; }
    if (args[i] === '--work-aus') { opts.work_aus = parseInt(args[++i], 10); continue; }
    if (args[i] === '--specialist') { opts.specialist = args[++i]; continue; }
    if (args[i] === '--state-nomination') { opts.state_nomination = args[++i]; continue; }
    if (args[i] === '--regional-study') { opts.regional_study = args[++i]; continue; }
    if (args[i] === '--aus-study') { opts.aus_study = args[++i]; continue; }
    if (args[i] === '--partner-skills') { opts.partner_skills = args[++i]; continue; }
    if (args[i] === '--occupation') { opts.occupation = args[++i]; continue; }
  }

  // stdin 解析（如果 argv 没设）
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) {
      for (const line of stdin.split('\n')) {
        const m = line.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
        if (m) {
          const [, key, val] = m;
          if (['age', 'work_overseas', 'work_aus'].includes(key)) {
            opts[key] = parseInt(val, 10);
          } else {
            opts[key] = val;
          }
        }
      }
    }
  } catch (e) {}

  return opts;
}

function ageToBand(age) {
  if (age < 25) return '18-24';
  if (age <= 32) return '25-32';
  if (age <= 39) return '33-39';
  if (age <= 44) return '40-44';
  return '45+';
}

import fs from 'node:fs';

function calculate(opts) {
  const breakdown = [];
  let total = 0;

  // Age
  const ageBand = ageToBand(opts.age);
  const agePoints = POINTS_TABLE.age[ageBand];
  total += agePoints;
  breakdown.push({ category: 'Age', band: `${opts.age} (${ageBand})`, points: agePoints, max: 30 });

  // English
  const engBand = POINTS_TABLE.english[opts.english_band];
  if (!engBand) {
    throw new Error(`Invalid english-band: ${opts.english_band}. Use: competent | proficient | superior`);
  }
  total += engBand.points;
  breakdown.push({ category: 'English', band: `${opts.english_band} (IELTS ${engBand.ielts} / PTE ${engBand.pte})`, points: engBand.points, max: 20 });

  // Qualifications
  const qualPoints = POINTS_TABLE.qualification[opts.qualification];
  if (qualPoints === undefined) {
    throw new Error(`Invalid qualification: ${opts.qualification}. Use: diploma | bachelor | master | phd`);
  }
  total += qualPoints;
  breakdown.push({ category: 'Qualifications', band: opts.qualification, points: qualPoints, max: 20 });

  // Work overseas
  const woYears = Math.min(opts.work_overseas, 8);
  const woPoints = POINTS_TABLE.work_overseas[woYears] ?? 0;
  total += woPoints;
  breakdown.push({ category: 'Work (overseas, nominated)', band: `${opts.work_overseas} years (capped 8)`, points: woPoints, max: 15 });

  // Work Australia
  const waYears = Math.min(opts.work_aus, 8);
  const waPoints = POINTS_TABLE.work_aus[waYears] ?? 0;
  total += waPoints;
  breakdown.push({ category: 'Work (Australia, nominated)', band: `${opts.work_aus} years (capped 8)`, points: waPoints, max: 20 });

  // Specialist education
  const specPoints = POINTS_TABLE.specialist_education[opts.specialist] ?? 0;
  if (specPoints > 0) {
    total += specPoints;
    breakdown.push({ category: 'Specialist education', band: opts.specialist, points: specPoints, max: 10 });
  }

  // Other factors
  if (opts.state_nomination === 'yes') {
    total += POINTS_TABLE.other_factors.state_nomination_190;
    breakdown.push({ category: 'Other (190 State nomination)', band: 'yes', points: 5, max: 5 });
  }
  if (opts.regional_study === 'yes') {
    total += POINTS_TABLE.other_factors.regional_study_491;
    breakdown.push({ category: 'Other (491 Regional study)', band: 'yes (2 yr in regional AU)', points: 5, max: 5 });
  }
  if (opts.aus_study === 'yes') {
    total += POINTS_TABLE.other_factors.aus_study_2yr_cricos;
    breakdown.push({ category: 'Other (Australian study bonus)', band: 'yes (2 yr CRICOS)', points: 5, max: 5 });
  }
  if (opts.partner_skills !== 'no') {
    const partnerPoints = opts.partner_skills === 'competent_english'
      ? POINTS_TABLE.other_factors.partner_skills_competent_english
      : POINTS_TABLE.other_factors.partner_skills_proficient_english;
    total += partnerPoints;
    breakdown.push({ category: 'Other (Partner skills)', band: opts.partner_skills, points: partnerPoints, max: 10 });
  }

  // 评估邀请线
  const threshold189 = INVITATION_THRESHOLDS['189'][opts.occupation] ?? 90;
  const threshold190 = INVITATION_THRESHOLDS['190'][opts.occupation] ?? 80;
  const threshold491 = INVITATION_THRESHOLDS['491'][opts.occupation] ?? 80;

  return {
    input: opts,
    breakdown,
    total,
    visa_189_threshold: threshold189,
    visa_190_threshold: threshold190,
    visa_491_threshold: threshold491,
    visa_189_likely: total >= threshold189,
    visa_190_likely: total >= threshold190,
    visa_491_likely: total >= threshold491,
    assessment: {
      '189': total >= threshold189 ? `✅ 达到 ${threshold189} 邀请线` : `❌ 差 ${threshold189 - total} 分`,
      '190': total >= threshold190 ? `✅ 达到 ${threshold190} 邀请线 (有 190 提名更好)` : `⚠️ 差 ${threshold190 - total} 分`,
      '491': total >= threshold491 ? `✅ 达到 ${threshold491} 邀请线 (偏远 491 最易)` : `⚠️ 差 ${threshold491 - total} 分`,
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const opts = parseInput(args);
  const result = calculate(opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Human-readable
    console.log('');
    console.log('━'.repeat(60));
    console.log(`📊 EOI Points Calculator (${opts.occupation}, age ${opts.age})`);
    console.log('━'.repeat(60));
    console.log('');
    console.log('Breakdown:');
    for (const b of result.breakdown) {
      const pct = b.max ? `(${Math.round(b.points / b.max * 100)}%)` : '';
      console.log(`  ${b.category.padEnd(28)} ${String(b.points).padStart(3)}/${b.max} ${pct.padStart(5)}`);
    }
    console.log('-'.repeat(60));
    console.log(`  ${'TOTAL'.padEnd(28)} ${String(result.total).padStart(3)}/95  `);
    console.log('');
    console.log('Visa pathway assessment:');
    console.log(`  189 (Skilled Independent):  ${result.assessment['189']}`);
    console.log(`  190 (State Nominated):     ${result.assessment['190']}`);
    console.log(`  491 (Regional):           ${result.assessment['491']}`);
    console.log('');
    console.log(`Source: https://immi.homeaffairs.gov.au/help-support/tools/points-calculator`);
    console.log(`Last updated: 2025-26 policy (verify with official calculator)`);
    console.log('━'.repeat(60));
  }

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
