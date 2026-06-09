---
name: study-abroad-planner
version: "0.2.0"
description: >-
  Plan a study abroad + immigration pathway end-to-end. Collects the user's
  profile through conversation (age, English test score, education level,
  budget, target country, target field) and produces a structured report
  covering school recommendations with entry requirements, visa pathway
  (EOI / points test / state nomination / PR route), realistic timeline,
  cost breakdown, and key risks. Make sure to use this skill whenever the
  user mentions 留学 / study abroad / 选校 / 选专业 / 留学规划 / 留学移民 /
  EOI / 189 / 190 / 491 / 移民路径 / PR pathway / overseas university /
  postgraduate admission — even if the user does not explicitly ask for
  a "plan", only mentions one component (e.g. "EOI 打分" or "PTE 多少分
  能上 X 大学"). v0.2.0 adds bin/ CLI tools (eoi-calculator, aus-course-filter)
  + data/ structured JSON for queryable school data. Privacy-first: the
  skill contains ZERO personal data; every value is provided by the user
  at invocation time.
---

# Study Abroad Planner

A privacy-first planner that turns a user's profile into a structured study
abroad + immigration pathway. The skill is **country-agnostic** by design;
it ships with Australia as a worked example and stub references for the UK,
NZ, and Canada. Add new countries by dropping a `references/<country>.md`.

## Privacy contract (READ FIRST)

This skill MUST NOT contain personal data. Follow these rules every time:

| Rule | Why |
|---|---|
| Never bake a real name, age, score, university, or salary into the skill | The skill may be published; PII must not leak |
| Use `<placeholder>` syntax in all examples and references (`<user_age>`, `<english_score>`, `<target_country>`) | Keeps examples copy-paste safe |
| Never read a `user-profile.json` from disk unless the user explicitly passes a path | Privacy by default |
| Never echo back profile data in skill logs or telemetry | Audit hygiene |
| Before any push to git, run the privacy audit in §"Pre-release checks" | Last line of defence |

If the user wants their saved profile used, ask them to paste a path or
inline a JSON object — never read silently.

## When to read which reference

| Country the user mentions | Read this reference first |
|---|---|
| Australia / 澳洲 / AU / 189 / 190 / 491 / EOI | `references/australia.md` |
| UK / 英国 / UCAS / Russell Group | `references/countries.md` → UK section |
| New Zealand / 新西兰 / NZ / SMC | `references/countries.md` → NZ section |
| Canada / 加拿大 / IRCC / PNP | `references/countries.md` → Canada section |
| Anything else | Ask the user to clarify; do not guess |

If the user mentions a country you have no reference for, be honest:
"sorry, this skill does not cover <country> yet — here is the data-source
template you can use to research it yourself" (see `references/data-sources.md`).

## Conversation flow

Ask the user for profile data in this order. Each question is required;
do not skip. If the user already answered some of these in earlier turns
of the same conversation, reuse the values and confirm.

| # | Question | Why we need it | Example valid answer |
|---|---|---|---|
| 1 | What is your current age (or age at planned graduation)? | Drives EOI points and visa age cut-offs | "27" or "30" |
| 2 | What is your English test score? Format: `<test> <overall> (<listening>, <reading>, <writing>, <speaking>)` | Entry requirement + visa points | "PTE <65> (<60>, <65>, <60>, <65>)" or "IELTS <7.0> (<6.5>, <7.0>, <6.5>, <7.0>)" |
| 3 | What is your highest education level + GPA / average? | Entry requirement + visa points | "Bachelor in <Engineering>, GPA <3.5>/4.0" |
| 4 | What is your total budget in your home currency (including tuition + 2 years living)? | Filters affordable schools | "500000 RMB" or "AUD 100000" |
| 5 | Target country + target field of study? | Routes to the right reference + visa subclass | "Australia, Master of Occupational Therapy" |
| 6 (optional) | Any constraints? (e.g. regional preference, family in destination, work rights) | Lets the plan bias toward 491 / 190 over 189 | "Prefer regional area for PR points" |

After collecting the profile, **confirm it back to the user in a single
short table** and ask "looks right, or want to correct anything?" before
proceeding. This is the single biggest source of mistakes.

## Output template

Produce ONE markdown report with the following sections in this order.
Keep it scannable — the user is choosing a multi-year path, not reading
a thesis.

```markdown
# 🛫 Study Abroad Pathway — <target_country> / <target_field>

> Generated: <YYYY-MM-DD> · Inputs: <one-line summary of profile>

## 1. Profile snapshot
| Field | Value |
|---|---|
| Age at graduation | <value> |
| English | <test> <overall> (<sub-scores>) |
| Education | <degree> in <major>, GPA <value> |
| Budget | <value> <currency> (tuition + 2yr living) |
| Target | <country>, <field> |
| Constraints | <list or "none"> |

## 2. Shortlist (3-5 schools)
For each school, give: name, location, tuition/year, duration, entry
requirements, ranking signal (QS / THE / local), and one-line "why it
fits you". Sort by fit, not by prestige.

## 3. Visa pathway
Visa subclass(es) the user is eligible for, with EOI / points score
breakdown, expected invitation round competitiveness, and timeline
(sketch milestones: enrolment → graduation → skills assessment → EOI
→ invitation → grant).

## 4. Cost & cashflow
Tuition per year + living per week + total. Show the gap to the user's
budget explicitly. Flag any "hidden" costs (skills assessment fee,
English retake, registration with professional body).

## 5. Risk register
3-5 risks specific to this profile, with severity (low/med/high) and a
mitigation. Common risks:
- English score below entry requirement
- Occupation not on the relevant skilled list
- Quota changes mid-application cycle
- Skills assessment body requires additional supervised practice
- PR points threshold rises faster than expected

## 6. Recommended next actions
A numbered list of 3-7 concrete next steps the user can do THIS WEEK.
Order by leverage. Each action should have a verifiable outcome
("book PTE exam by <date>", not "study harder").
```

## Country routing rules

- If the user mentions a country twice in the same conversation, assume
  the first one and confirm.
- If the user names a specific school (e.g. "Charles Darwin University"),
  still produce the full pathway — the school is a strong signal of
  preference but not the whole plan.
- If the user asks only about one slice (e.g. "EOI 打分怎么算"), answer
  that slice and offer the full plan as a follow-up. Do not force the
  full report on a focused question.

## Data sources (no scraping — just point the user)

Always link to authoritative public sources, never to scraped copies.
See `references/data-sources.md` for the canonical list per country.

| Need | Source |
|---|---|
| AU occupation list (MLTSSL / STSOL) | https://immi.homeaffairs.gov.au/visas/working-in-australia/skill-occupation-list |
| AU EOI / SkillSelect | https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skilled-independent-189 |
| AU QILT (course quality + employment) | https://www.qilt.edu.au/ |
| UK UCAS tariff | https://www.ucas.com/undergraduate/applying-to-university/entry-requirements |
| NZ Skilled Migrant Category | https://www.immigration.govt.nz/work-visas/skilled-migrant-category |
| Canada Express Entry | https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html |

## Pre-release checks (run before publishing this skill)

This is the publish gate. Run all four before any `git push` or share.

1. **PII grep** — search the skill directory for common PII patterns. Use
   generic patterns, never user-specific values:
   ```bash
   # Generic check — replace with patterns matching your own PII
   grep -rE "<suspicious-pattern>" \
     ~/.claude/skills/study-abroad-planner/ || echo "OK no PII"
   ```
   If anything matches, scrub it. The examples in the skill use
   generic `<placeholder>` syntax — no real scores, no real names.

2. **Placeholder audit** — every example value must be wrapped in
   `<angle_brackets>`. Real values are forbidden in examples.

3. **Frontmatter check** — `name` matches the directory name;
   `description` is "pushy" enough that it would trigger on realistic
   user queries (see skill-creator guidance).

4. **No fabricated URLs** — every link in this skill must point to a
   public authoritative source, not a placeholder. If you are unsure
   a link resolves, drop it.

5. **Human review gate** — show the publish checklist to the user
   and wait for explicit "push" / "发" / "好的" before any push.

## What this skill does NOT do

- It does not file visa applications, draft statements, or contact
  universities on the user's behalf.
- It does not guarantee admission or visa grant.
- It does not replace a licensed migration agent. If the user's case
  is non-trivial (e.g. dependent family, prior refusals, complex work
  history), recommend they consult a MARA-registered agent (AU) /
  OISC-regulated adviser (UK) / ICCRC consultant (CA) for the legal
  step. Planning is free; the legal step is not.

## Reference index

- `references/australia.md` — full AU 189 / 190 / 491 + EOI breakdown
- `references/countries.md` — UK / NZ / Canada short pathways
- `references/data-sources.md` — canonical public sources per country
- `examples/sample-output.md` — sample report with placeholder values
