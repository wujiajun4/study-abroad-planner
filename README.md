# 🛫 Study Abroad Planner

> A privacy-first Claude skill that turns your profile into a structured
> study abroad + immigration pathway — school shortlist, EOI/visa pathway,
> cost breakdown, and a concrete next-steps list.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status: v0.3.0](https://img.shields.io/badge/status-v0.3.0-blueviolet)](#roadmap)
[![Privacy: First--Class](https://img.shields.io/badge/privacy-first--class-success)](#-privacy)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

---

## ✨ What it does

You give it 6 things about yourself. It gives you a multi-year plan.

**Input (collected via conversation, never stored):**

| # | Field | Example |
|---|---|---|
| 1 | Age at graduation | `27` |
| 2 | English test + score | `PTE 65 (60, 65, 60, 65)` |
| 3 | Highest education + GPA | `Bachelor in Engineering, GPA 3.5/4.0` |
| 4 | Total budget | `500000 RMB` |
| 5 | Target country + field | `Australia, Master of OT` |
| 6 | Constraints (optional) | `Prefer regional area for PR points` |

**Output: a 6-section markdown report**

1. Profile snapshot
2. Shortlist (3-5 schools, sorted by fit, not prestige)
3. Visa pathway (EOI / points / state nomination / timeline)
4. Cost & cashflow (with budget gap called out explicitly)
5. Risk register (3-5 risks, each with mitigation)
6. Recommended next actions (this week, with verifiable outcomes)

---

## 🆕 v0.3.1 — Freshness Policy + Synthesise Gate (2026-06-10)

**v0.3.0 had a single 180-day freshness threshold for all data. v0.3.1 fixes that with a per-data-type policy table + override mechanism + gate wrapper:**

| Tool | Use it for |
|------|-----------|
| `bin/release-precheck.mjs` | Pre-push orchestrator: PII scrub + source-validator in one call (100ms) |
| `bin/synthesise.mjs` | **The gate every LLM must call before writing a report.** Reads release-precheck exit code, decides proceed/caveat/block, writes audit log |
| `data/freshness-policy.json` | 9 `data_type` thresholds (e.g. `eoi_threshold` 7d warn / 30d error; `english_standard` 30d / 60d) |
| `data/known-stale.json` | Official override mechanism — mark data as "best-available, intentionally not refreshed" with audit trail |
| `data/source-tiers.json` | Now includes `domain_tiers` block (45 domains mapped; was hardcoded in .mjs) |

**Why it matters**: when AHPRA ELS / DHA SkillSelect / state nomination rules change (which happens yearly), the v0.3.0 validator wouldn't catch it until 180 days passed. v0.3.1 catches the same change in 7-30 days **automatically** — no code change. The override mechanism also means known-stale historical data (e.g. SkillSelect round archive) doesn't block pushes.

---

## 🆕 v0.3.0 — Honesty Pipeline + Source Validator (2026-06-10)

**v0.2.0 shipped CLI tools. v0.3.0 adds a 5-step honesty pipeline so the report says what it doesn't know, not what looks plausible:**

| Stage | What it does |
|-------|--------------|
| **validate** | `bin/source-validator.mjs` scans all `data/*.json` for source tier (1-5, social media banned) + freshness periods + warning markers |
| **gate** | Hard eligibility gate (e.g. AHPRA ELS 3 English gates, PTE/Age/Prereq) — binding constraints called out explicitly |
| **analyse** | Tier-based PR pathway comparison (高/中/低) — no fabricated precision percentages |
| **synthesise** | 6-section report grounded in the same data the validator just approved |
| **self-check** | 5-item honesty checklist before output: source tier, freshness, confidence stated, fabricated numbers, mismatch with audit |

**New in v0.3.0:**

| File | Purpose |
|------|---------|
| `bin/source-validator.mjs` | 5-tier source classifier + freshness periods + tier_5 (Reddit/Facebook) ban |
| `data/source-tiers.json` | Domain → tier mapping (tier_1: gov/university, tier_4: aggregator, tier_5: social media) |
| `data/ahpra-english-standard.json` | 3 English gates (CDU entry 65/58 · AHPRA ELS 65/65 · EOI superior 79/79) + 4 ELS exemption pathways |
| `data/seven-school-pr-pathway-comparison.json` | 7 OT schools ranked by PR pathway, with explicit "real grant-by-school data not public" note |
| `data/cdu-ot-fieldwork-compliance.json` | 1000h placement breakdown + 6-item compliance checklist (police / WWCC / immunisation / NDIS screening) |
| `data/australian-courses.json` | Now 11 courses (Monash added) + La Trobe Bendigo → Bundoora correction + IELTS separate fields + PTE Academic test type verified |

**Why it matters:** v0.2.0 reported "85% PR conversion" for the top school. v0.3.0 reports "高" with confidence + basis + the explicit caveat that AHPRA does not publish school-of-graduation data. Same conclusion, no false precision.

---

## 🆕 v0.2.0 — CLI Helpers + Structured Data (2026-06-09)

**v0.1 was static markdown docs. v0.2.0 adds a CLI toolset and a queryable JSON dataset:**

| Tool | Use it for |
|------|-----------|
| `bin/eoi-calculator.mjs` | EOI points breakdown by age / English / qualification / state nomination — *10 seconds, no mental math* |
| `bin/aus-course-filter.mjs` | Filter 10 courses by PTE / budget / regional / profession / path / prerequisites — *1 second, no grep* |
| `data/australian-courses.json` | 10 courses × 12 fields (CDU / La Trobe / UTAS / Flinders / UniSA / CQU / UniMelb / USyd) — *queryable, version-controlled* |

**Why it matters**: a privacy-first skill that *only* outputs markdown would still need the user (or agent) to manually re-derive EOI math, or grep through dozens of web pages. v0.2.0 ships the data + tools so the 6-section report is grounded in the same source the user can audit.

**Live data sources** (instead of hand-quoted values that go stale):

- MLTSSL occupation list → https://www.anzscosearch.com/mltssl/
- QILT course + employment → https://qilt.edu.au/comparED
- Skilled occupation list 2026 → https://www.australianvisaonline.com/occupations/skilled-occupation-list-sol-2026
- Home Affairs points calculator → https://immi.homeaffairs.gov.au/help-support/tools/points-calculator

The skill's `references/australia.md` and `references/data-sources.md` now point at these live sources for any value that changes annually.

---

## 🛡️ Privacy

**This skill contains zero personal data and stores nothing.** It is safe to
publish to a public repository.

- ❌ Never bakes a real name, age, score, university, or salary into the skill
- ❌ Never reads `user-profile.json` from disk unless you explicitly pass a path
- ❌ Never echoes your data into skill logs or telemetry
- ✅ Every example uses `<placeholder>` syntax — copy-paste safe
- ✅ The skill always collects your profile fresh at invocation time

> If you generate a report for a real person, save it **outside** the skill
> directory and **never commit** that report alongside the skill.

---

## 📦 Install

### Claude Code (recommended)

Drop the skill folder into your Claude skills directory:

```bash
# Clone the repo
git clone https://github.com/<owner>/study-abroad-planner.git

# Or copy manually
cp -r study-abroad-planner ~/.claude/skills/study-abroad-planner

# Verify it shows up in your skills list
ls ~/.claude/skills/study-abroad-planner/
# SKILL.md  LICENSE  README.md  .gitignore  references/  examples/
```

Restart Claude Code. The skill is now active and will auto-trigger on
keywords like *留学*, *study abroad*, *EOI*, *189*, *PR pathway*, etc.

### Claude.ai (Cowork)

Upload `SKILL.md` and the `references/` folder as a project skill. The
exact upload UI varies; refer to Anthropic's current skill documentation.

### Other agents (Codex, Cursor, Aider)

The skill is pure markdown + reference files. Any agent that supports the
`SKILL.md`-with-frontmatter convention can use it. Point the agent at the
`SKILL.md` file.

---

## 🚀 Usage

Just ask Claude anything that sounds like study-abroad planning. The skill
fires automatically.

**Triggers (English):**

> "Help me plan a master's in Australia"
> "What's my EOI score for 189?"
> "I want to study OT in the UK"
> "Compare universities for nursing in New Zealand"
> "PR pathway for software engineers in Canada"

**Triggers (Chinese):**

> "帮我规划一下澳洲留学"
> "189 签证 EOI 怎么打分"
> "我想去英国读 OT 硕士"
> "新西兰护理专业选哪所大学"
> "加拿大软件工程师 PR 路径"

**Trigger-then-flow:**

The skill first asks you the 6 questions. You answer. It confirms the
profile in one short table. You confirm or correct. It then generates the
full report.

---

## 🌍 Country support

| Country | Status | Reference |
|---|---|---|
| Australia 🇦🇺 | ✅ Full (189 / 190 / 491 + EOI + QILT) | [`references/australia.md`](./references/australia.md) |
| United Kingdom 🇬🇧 | 🟡 Stub (Graduate Route + Skilled Worker) | [`references/countries.md`](./references/countries.md#-united-kingdom) |
| New Zealand 🇳🇿 | 🟡 Stub (SMC + Green List) | [`references/countries.md`](./references/countries.md#-new-zealand) |
| Canada 🇨🇦 | 🟡 Stub (Express Entry + PNP) | [`references/countries.md`](./references/countries.md#-canada) |
| Others | ❌ Not covered | — |

To add a new country: drop a `references/<country>.md` that follows the
same structure as the existing references (visa subclasses, points table,
occupation lists, skills assessment bodies, recommended reading order).
Open a PR.

---

## 📁 File structure

```
study-abroad-planner/
├── SKILL.md                 # Main entry — frontmatter + pipeline + output template
├── README.md                # This file
├── LICENSE                  # MIT
├── .gitignore               # Excludes eval workspaces + any user-data files
├── bin/
│   ├── eoi-calculator.mjs       # EOI points breakdown CLI
│   ├── aus-course-filter.mjs    # Course filter by PTE/budget/regional/prereq
│   ├── source-validator.mjs     # 5-tier source classifier + freshness-by-policy check
│   ├── release-precheck.mjs     # v0.3.1 — orchestrator: PII + validator in one call
│   └── synthesise.mjs           # v0.3.1 — gate wrapper (LLM must call before writing report)
├── data/
│   ├── australian-courses.json            # 11 courses × ~15 fields
│   ├── source-tiers.json                  # 5-tier definitions + 45 domain mappings
│   ├── freshness-policy.json              # v0.3.1 — 9 data_type thresholds
│   ├── known-stale.json                   # v0.3.1 — official override mechanism
│   ├── ahpra-english-standard.json        # 3 gates + 4 ELS exemptions
│   ├── ahpra-ot-registration-pathway.json # OTBA Pathway A + OTC migration
│   ├── seven-school-pr-pathway-comparison.json  # tiered honest format
│   ├── cdu-ot-fieldwork-compliance.json   # 1000h + 6-item checklist
│   └── skillselect-ot-invitations.json    # Historical SkillSelect data
├── references/
│   ├── australia.md         # Full AU 189/190/491 + EOI + QILT
│   ├── countries.md         # UK / NZ / CA short pathways
│   └── data-sources.md      # Authoritative public links per country
└── examples/
    └── sample-output.md     # Sample report with placeholder values
```

---

## 🧪 Test cases

The skill ships with one worked example in `examples/sample-output.md`. To
add more coverage, add new test profiles (all `<placeholder>` values) to
the same folder and run them through Claude with the skill loaded.

---

## 🛠️ Development

```bash
# Edit SKILL.md
$EDITOR ~/.claude/skills/study-abroad-planner/SKILL.md

# Restart Claude Code to pick up the change
# (skills are loaded at session start)

# Run a test invocation
claude "Help me plan study in Australia"
```

For full eval/benchmark workflows (assertion-based testing, blind
comparisons, description optimization), see Anthropic's
[`skill-creator`](https://github.com/anthropics/skills) skill.

---

## 🤝 Contributing

PRs welcome. Two specific ways to help:

1. **Add a country reference** — write `references/<country>.md` following
   the same structure as `references/australia.md`. Include: visa
   subclasses, points table, occupation lists, skills assessment bodies,
   recommended reading order.
2. **Improve the output template** — the 6-section template is in
   `SKILL.md`. Make the risk register sharper, or the next-actions list
   more verifiable, etc.

### Pre-PR checks

Run all four before `git push`:

```bash
# 1. PII grep — replace patterns with ones matching your own PII
grep -rE "<suspicious-pattern>" \
  ~/.claude/skills/study-abroad-planner/ || echo "OK no PII"

# 2. Placeholder audit — every example value must be <wrapped>
grep -hroE "[^<a-z_<>][a-z_]+[0-9]?[^a-z_<>]*" \
  ~/.claude/skills/study-abroad-planner/examples/ \
  | grep -v "^<" || echo "OK all placeholders"

# 3. Frontmatter check
head -3 ~/.claude/skills/study-abroad-planner/SKILL.md

# 4. No fabricated URLs
grep -rhE "https?://[^ )]+" ~/.claude/skills/study-abroad-planner/ | wc -l
```

---

## ⚠️ What this skill does NOT do

- It does not file visa applications, draft statements, or contact
  universities on your behalf.
- It does not guarantee admission or visa grant.
- It does not replace a licensed migration agent. If your case is
  non-trivial (e.g. dependent family, prior refusals, complex work
  history), consult a MARA-registered agent (AU) / OISC-regulated
  adviser (UK) / ICCRC consultant (CA) for the legal step. Planning is
  free; the legal step is not.

---

## 📜 License

[MIT](./LICENSE) © 2026 study-abroad-planner contributors

---

## 🗺️ Roadmap

- [ ] UK / NZ / CA references expanded to full (currently stubs)
- [ ] Multi-language UI for the conversation flow (currently EN + ZH
      keywords only)
- [ ] Optional `user-profile.json` support with explicit consent
- [ ] Eval suite with 3+ realistic test profiles
- [ ] GitHub Action that runs the preflight checks on every PR

---

---

# 🇨🇳 中文版

## 🆕 v0.3.1 — 保鲜期政策 + 报告守门 (2026-06-10)

**v0.3.0 所有数据共用 180 天保鲜期，v0.3.1 改成按 data_type 分级 + override + 守门 wrapper：**

| 工具 | 用途 |
|------|------|
| `bin/release-precheck.mjs` | 发布前编排：PII 扫描 + 源校验一键（100ms）|
| `bin/synthesise.mjs` | **LLM 写报告前必调的守门**。读 release-precheck 退出码，决定 proceed/caveat/block，写审计日志 |
| `data/freshness-policy.json` | 9 个 `data_type` 阈值（如 `eoi_threshold` 7d warn / 30d error；`english_standard` 30d / 60d）|
| `data/known-stale.json` | 官方 override 机制 — 标"明知过期但用这个"并留审计痕迹 |
| `data/source-tiers.json` | 新增 `domain_tiers` 块（45 个域名映射；之前硬编码在 .mjs）|

**为什么重要**：当 AHPRA ELS / DHA SkillSelect / 州担保规则变更（每年都会发生），v0.3.0 validator 要 180 天才察觉。v0.3.1 **7-30 天自动捕获**——不用改代码。Override 机制也让已知过期的历史数据（如 SkillSelect 归档轮次）不再 block push。

---

## 🆕 v0.3.0 — 诚实 Pipeline + 源校验器 (2026-06-10)

**v0.2.0 出了 CLI 工具。v0.3.0 加了 5 步诚实 pipeline，让报告说"不知道"而不是"看着像承诺"：**

| 步骤 | 做什么 |
|------|--------|
| **validate** | `bin/source-validator.mjs` 扫所有 `data/*.json` 检查源 tier (1-5，社媒禁) + 保鲜期 + 警告标记 |
| **gate** | 硬性资格门槛（如 AHPRA ELS 3 道英语门）— 显式标出 binding constraint |
| **analyse** | 分级 PR 路径对比 (高/中/低) — 不编造精确百分比 |
| **synthesise** | 6 段报告，用刚才 validator 批准的数据 |
| **self-check** | 5 项诚实清单：源 tier / 保鲜期 / 信心度 / 假数据 / 与审计不一致 |

**v0.3.0 新增**：

- `bin/source-validator.mjs` — 5 级源分类 + 保鲜期 + tier_5 社媒禁入
- `data/source-tiers.json` — domain → tier 映射（tier_1: gov/uni，tier_5: 社媒）
- `data/ahpra-english-standard.json` — 3 道英语门（CDU 65/58 · ELS 65/65 · EOI superior 79/79）+ 4 豁免路径
- `data/seven-school-pr-pathway-comparison.json` — 7 校 PR 路径分级 + 显式"真实 grant-by-school 数据不公开"标注
- `data/cdu-ot-fieldwork-compliance.json` — 1000h 实习拆解 + 6 项合规清单
- `data/australian-courses.json` — 11 校（新增 Monash） + La Trobe Bendigo→Bundoora 修正 + IELTS 字段 + PTE Academic 验证

---

## ✨ 它做什么

给它 6 个关于你的信息，**它会给你一个多年计划**。

**输入（通过对话收集，永不存储）：**

| # | 字段 | 示例 |
|---|---|---|
| 1 | 毕业时年龄 | `27` |
| 2 | 英语考试 + 分数 | `PTE 65 (60, 65, 60, 65)` |
| 3 | 最高学历 + GPA | `Bachelor in Engineering, GPA 3.5/4.0` |
| 4 | 总预算 | `500000 RMB` |
| 5 | 目标国家 + 专业 | `Australia, Master of OT` |
| 6 | 约束（可选）| `倾向偏远地区加分` |

**输出：6 段 markdown 报告**

1. Profile 速览
2. 候选学校（3-5 所，按适配度而非排名排序）
3. 签证路径（EOI / 打分 / 州担保 / 时间线）
4. 成本 & 现金流（明确指出预算缺口）
5. 风险登记册（3-5 项，每项有缓解措施）
6. 这周可执行的下一步（每项有可验证的产出）

---

## 🛡️ 隐私

**这个 skill 包含 0 真实个人信息，不存任何东西。** 可以放心发到公开仓库。

- ❌ 绝不把真实姓名、年龄、分数、学校、薪资写进 skill
- ❌ 绝不读 `user-profile.json`，除非你显式传路径
- ❌ 绝不在 skill 日志或 telemetry 里 echo 你的数据
- ✅ 所有示例都用 `<placeholder>` 语法
- ✅ 每次调用都现场收集你的 profile

> 如果你为真人生成报告，**保存到 skill 目录外**，**绝不要 commit** 这份报告。

---

## 📦 安装

### Claude Code（推荐）

把 skill 文件夹扔到你的 skills 目录：

```bash
git clone https://github.com/<owner>/study-abroad-planner.git
cp -r study-abroad-planner ~/.claude/skills/study-abroad-planner
ls ~/.claude/skills/study-abroad-planner/
```

重启 Claude Code。Skill 就激活了，关键词自动触发。

---

## 🚀 使用

直接问 Claude 任何听起来像"留学规划"的问题，skill 自动触发。

**触发词（中文）：**

> "帮我规划澳洲留学"
> "189 签证 EOI 怎么打分"
> "我想去英国读 OT 硕士"
> "新西兰护理专业选哪所"
> "加拿大软件工程师 PR 路径"

**触发流程：**

skill 先问你 6 个问题。你回答。它用 1 个简短表格确认。你确认或更正。然后生成完整报告。

---

## 📁 文件结构

```
study-abroad-planner/
├── SKILL.md                 # 主入口 — frontmatter + pipeline + 输出模板
├── README.md                # 这个文件
├── LICENSE                  # MIT
├── .gitignore
├── bin/
│   ├── eoi-calculator.mjs       # EOI 打分 CLI
│   ├── aus-course-filter.mjs    # 按 PTE/预算/偏远/前置 筛选课程
│   ├── source-validator.mjs     # 5 级源分类 + 按政策检查保鲜期
│   ├── release-precheck.mjs     # v0.3.1 — 编排器：PII + validator 一键跑
│   └── synthesise.mjs           # v0.3.1 — 守门 wrapper（LLM 写报告前必调）
├── data/
│   ├── australian-courses.json            # 11 校 × 15 字段
│   ├── source-tiers.json                  # 5 级定义 + 45 域名映射
│   ├── freshness-policy.json              # v0.3.1 — 9 个 data_type 阈值
│   ├── known-stale.json                   # v0.3.1 — 官方 override 机制
│   ├── ahpra-english-standard.json        # 3 道英语门 + 4 豁免路径
│   ├── ahpra-ot-registration-pathway.json # OTBA Pathway A + OTC 移民评估
│   ├── seven-school-pr-pathway-comparison.json  # 分级诚实格式
│   ├── cdu-ot-fieldwork-compliance.json   # 1000h + 6 项合规清单
│   └── skillselect-ot-invitations.json    # SkillSelect 历史数据
├── references/
│   ├── australia.md         # 完整 AU 189/190/491 + EOI + QILT
│   ├── countries.md         # UK / NZ / CA 短路径
│   └── data-sources.md      # 各国公开权威源
└── examples/
    └── sample-output.md     # 占位符示例报告
```

---

## ⚠️ skill 不做什么

- 不代办签证申请、文书、联系大学
- 不保证录取或签证获批
- 不替代持牌移民律师。复杂案例（家庭随行、有拒签史、复杂工作史）请咨询 MARA（澳洲）/ OISC（英国）/ ICCRC（加拿大）持牌顾问。规划免费，法律那一步不免费。

---

## 📜 许可

[MIT](./LICENSE) © 2026 study-abroad-planner contributors
