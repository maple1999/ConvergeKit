# ConvergeKit PRD v0.1

**产品定位**：Repo-native Attractor-first Harness for AI Coding Agents  
**中文定位**：让 Claude Code、Codex、DeepSeek、OpenCode、Cline 等 AI coding agent 不只是完成任务，而是持续把项目拉回你定义的长期结构。  
**当前版本**：PRD v0.2（依据竞品调研与可行性审查修订，变更见第 24 节）  
**适用阶段**：开源 MVP / 早期原型 / 研究型产品验证  
**建议执行周期**：8 周  
**核心口号**：AI 可以让测试通过，同时悄悄把架构带偏。ConvergeKit 负责发现这种漂移。  
**探索场景口号**：ConvergeKit 防止 AI 把探索伪装成完成。

---

## 0. 文档摘要

ConvergeKit 是一个面向 AI coding agent 的 repo-native 收敛控制工具。它不试图替代 Claude Code、Codex、OpenCode、Cline 或 DeepSeek-TUI / CodeWhale，而是在这些工具之外建立一个独立的项目级控制层：

```text
Attractor → Plan → Agent Execution → Check → Fresh Audit → Closure → Memory / Handoff
```

它的第一目标不是自动写代码，而是判断：

```text
这次 AI 修改是否真的应该被关闭？
这次修改是否让系统靠近长期目标结构？
这次修改是否只是测试通过，但架构、研究方向或创业探索轨迹被带偏？
```

MVP 的关键能力：

1. 在 repo 中定义 `.converge/attractor.yml`，显式表达项目长期应收敛的结构。
2. 生成标准化 Plan，规定每一轮 AI 扩张如何收口。
3. 基于 git diff、规则和由 converge 亲自执行的验证命令做 `converge check`（不信任外部提供的日志文件）。
4. 通过 fresh audit 避免“同一个 agent 自己实现、自己宣布完成”。
5. 生成 handoff 和 memory，保存跨 session 的轨迹记忆。
6. 编译到 Claude Code / Codex / OpenCode / Cline 的配置入口，例如 `CLAUDE.md`、`AGENTS.md`、skills、hooks。

v0.1 范围约束：只做 product mode。research / venture mode 的模板设计保留在文档中，完整支持移至 v0.3+。

ConvergeKit 的 MVP 成功标准不是功能数量，而是完成一个强 demo：

```text
AI agent 修改了代码，测试通过。
ConvergeKit 检查发现：
- 违反架构边界；或
- 修改超出 Plan 范围；或
- 测试被削弱；或
- closure evidence 不足。

结论：行为可能可运行，但不能 close。
```

---

## 1. 背景

### 1.1 AI coding agent 的现状

Claude Code、Codex、OpenCode、Cline、DeepSeek-TUI / CodeWhale 等工具已经能完成大量 coding agent 工作：

- 读文件；
- 搜索代码；
- 修改多文件；
- 运行 shell；
- 运行测试；
- 生成文档；
- 修复报错；
- 接入 MCP；
- 使用 skills、hooks、subagents；
- 通过 AGENTS.md、CLAUDE.md、rules 等配置项目规则。

这些能力解决的是：

```text
AI 如何行动？
AI 如何调用工具？
AI 如何被约束？
AI 如何在本地或云端完成一个任务？
```

但大型项目、科研项目、创业探索中真正更难的问题是：

```text
AI 做完了一个局部任务，但系统长期方向是否被带偏？
AI 生成的测试、文档和总结是否只是与错误理解自洽？
AI 是否把临时 demo 伪装成有效探索？
AI 是否反复重走已经被证伪的路径？
```

### 1.2 从 Harness-first 到 Attractor-first

普通 harness 关注：

```text
限制动作
验证输出
审计结果
反馈循环
工具权限
```

但这些机制默认了一个前提：系统正确方向已经已知。

如果方向没有先被定义，harness 只是在更高效地约束 AI 执行某套可能错误的基线。ConvergeKit 的基本假设是：

> 先定义系统应向哪里长期收敛，再定义如何验证、审计、关闭和记忆。

这意味着 ConvergeKit 不只是 prompt 管理器，也不只是 agent wrapper，而是一个 repo-native 的收敛协议。

---

## 2. 核心问题

### 2.1 工业产品开发中的问题

在需求明确、架构目标明确的工业项目中，AI 的危险在于：

```text
测试通过，但架构边界被破坏。
功能完成，但职责划分变得混乱。
局部 bug 修好，但引入长期技术债。
文档更新了，但文档只是合理化错误结构。
测试被修改了，但测试从行为验证退化成实现适配。
```

典型例子：

```text
任务：修复登录 bug。
AI 修改：让 UI 层直接访问 database client。
结果：测试通过，登录可用。
问题：UI → DB 的直接依赖违反长期架构方向。
ConvergeKit 结论：不能 close。
```

### 2.2 科研探索中的问题

科研中 AI 最容易端出“像论文但没有贡献”的方案：

```text
提出一个看似新颖的模块名；
拼接已有方法；
做出能跑的实验脚本；
生成漂亮表格；
但没有明确 claim、mechanism、baseline、evidence。
```

典型风险：

```text
工程 feature 被包装成 method contribution。
缺少 baseline，却声称有效。
只在 toy repo 上验证。
没有 failure case。
没有 ablation。
没有证明为什么不是 AGENTS.md / CLAUDE.md 的模板化变体。
```

ConvergeKit 的 research mode 需要阻止这种伪完成。

### 2.3 创业探索中的问题

创业中 AI 容易把探索变成假进展：

```text
快速生成 dashboard；
快速完成 landing page；
快速做出配置市场；
快速拼出 SaaS 外壳；
但没有真实痛点、用户验证、复用场景或付费意愿。
```

典型风险：

```text
完成了产品外壳，但没有验证需求。
做了 demo polish，但没有用户反馈。
做了 marketplace，但没有供给和需求。
做了 automation，但用户没有重复使用动机。
```

ConvergeKit 的 venture mode 需要把“完成东西”和“推进探索”区分开。

---

## 3. 产品目标

### 3.1 MVP 目标

MVP 要实现一条最小闭环：

```text
定义 attractor
→ 创建 plan
→ agent 执行任务
→ converge check 检查 diff
→ fresh audit 重新取证
→ converge close 判断是否关闭
→ memory / handoff 保存轨迹
```

MVP 不要求完整自动化接管 agent，只要求在 agent 外部建立一个独立验收层。

### 3.2 产品目标

ConvergeKit 要让 repo 获得以下能力：

1. **方向表达能力**：显式表达系统、研究或创业探索应长期收敛到哪里。
2. **局部闭合能力**：每次 AI 扩张都有明确 Plan、exit criteria 和 validation checklist。
3. **外部证据能力**：closure 不依赖 agent 自述，而依赖 live repo、diff、测试日志、audit report。
4. **漂移检测能力**：发现测试通过但结构、探索或证据方向被带偏的情况。
5. **跨 session 记忆能力**：保存被证伪前提、发散路径、被推翻 closure、失败原因。
6. **跨 agent 适配能力**：把同一个 attractor 编译到 Claude Code、Codex、OpenCode、Cline 等工具。

### 3.3 非目标

MVP 不做：

```text
不做 Claude Code / Codex / OpenCode 的替代品。
不做完整 AI coding agent。
不做多模型聊天客户端。
不做自动定义 attractor（converge init 只生成需用户确认的草稿）。
不做 SaaS dashboard。
不做 profile marketplace。
不做完整 benchmark 平台。
不做 research / venture mode 的完整支持（v0.1 只做 product mode）。
不自研 import 依赖图分析（复用 dependency-cruiser / import-linter 等成熟工具）。
不承诺自动发现所有架构漂移。
不承诺替代架构师、研究者或创业者判断。
```

---

## 4. 核心概念

### 4.1 Attractor

Attractor 表示系统长期反复应被拉回的稳定结构。它不是边界、不是护栏、不是简单控制目标。

在不同模式中，attractor 含义不同：

```text
Product mode:
系统应长期收敛到什么架构、职责边界、质量标准。

Research mode:
研究应长期收敛到什么问题、机制、证据和可发表贡献。

Venture mode:
产品探索应长期收敛到什么用户痛点、使用场景和验证证据。
```

Attractor 分三层：

```text
结构层：少量高阶不变量。
承载层：版本化、可审计的文档和配置。
实现层：当前代码或当前探索材料中的瞬时投影。
```

ConvergeKit 的 `.converge/attractor.yml` 属于承载层。

### 4.2 Trajectory

Trajectory 是 repo 在多轮 AI、人工、CI、review、文档更新之后真实留下的演化路径。

ConvergeKit 不是只看单次 PR 对不对，而是关心：

```text
过去多次修改是否持续扩大某个错误结构？
测试是否逐渐耦合到旧实现？
某个临时 prototype 是否被不当地提升为 core？
某个被证伪方案是否反复被 AI 重新提出？
```

### 4.3 Harness

Harness 是通过局部信号测量、纠偏、更新轨迹的执行支架。

ConvergeKit 的 harness 包括：

```text
Routing harness
Plan harness
Verification harness
Audit harness
Memory harness
Agent adapter harness
CI closure harness
```

### 4.4 Closure

Closure 是一次 plan 能否被正式关闭的判断。它不能由实现 agent 自己宣布。

Closure 必须依赖：

```text
live repo
active plan
git diff
validation logs
attractor checks
fresh audit
memory / handoff update
```

### 4.5 Fresh Audit

Fresh Audit 是独立审计。基本原则：

```text
不依赖实现 agent 的完成总结。
不把同一上下文的自我解释当作权威证据。
重新读取 live repo、git diff、plan、attractor、test logs、architecture docs。
```

### 4.6 Memory Harness

Memory harness 保存跨 session 的轨迹信息，不只是保存结论。

需要保存：

```text
哪个前提已经被证伪。
哪条路径已经证明会发散。
哪个 closure 后来被推翻。
哪种术语解释会把问题降格。
哪类测试其实是在耦合旧实现。
```

---

## 5. 目标用户

### 5.1 Primary Users

```text
正在使用 Claude Code / Codex / OpenCode / Cline 的开发者。
AI-native indie hacker。
小团队技术负责人。
AI research 工程实践者。
需要审查 AI-generated PR 的工程师。
```

### 5.2 Secondary Users

```text
创业早期探索者。
做科研原型和论文复现的研究者。
维护复杂开源项目的 maintainer。
使用 AI agent 批量处理 issue 的团队。
```

### 5.3 用户痛点

| 用户类型 | 痛点 | ConvergeKit 提供的价值 |
|---|---|---|
| AI coding agent 用户 | agent 做完了，但不知道是否真的可靠 | check + fresh audit + closure report |
| 技术负责人 | AI PR 可能破坏长期架构 | attractor invariants + boundary check |
| 研究者 | AI 快速生成伪 method | research mode 的 claim / baseline / evidence closure |
| 创业者 | AI 快速做出 fake progress | venture mode 的 pain / validation / kill criteria closure |
| 开源 maintainer | agent session 之间丢失上下文 | memory + handoff |

---

## 6. 产品形态

ConvergeKit 不应该只是一个 Claude Skill 或 Codex Skill。

正确形态：

```text
Repo-native core + CLI + agent adapters + CI gate
```

### 6.1 组成

1. **`.converge/` repo spec**  
   存放 attractor、profiles、templates、memory、traces。

2. **`converge` CLI**  
   核心执行层，负责 init、plan、check、audit、close、handoff、compile。

3. **Claude Code adapter**  
   生成 CLAUDE.md、skills、subagents、hooks。

4. **Codex adapter**  
   生成 AGENTS.md、Codex skills、scripts。

5. **OpenCode / Cline adapter**  
   生成对应 instructions、rules、skills。

6. **CI / GitHub Action**  
   作为外部验收层，阻止未通过 closure 的 PR。

7. **MCP server，后续阶段**  
   给 agent 暴露 converge tools。

### 6.2 设计原则

```text
Skill 是入口。
Plugin 是集成。
CLI 是核心。
CI 是权威。
.converge/ 是真相。
```

---

## 7. 仓库结构

MVP 初始化后建议结构：

```text
.converge/
  attractor.yml
  profiles/
    claude.yml
    codex.yml
    deepseek.yml
    local-small.yml
  templates/
    plan.md
    audit.md
    closure.md
    handoff.md
    memory.md
  memory/
    disproven-assumptions/
    divergent-paths/
    overturned-closures/
    terminology-traps/
  traces/
  reports/
  adapters/
    claude/
    codex/
    opencode/
    cline/

docs/
  architecture/
    README.md
    baseline.md
    invariants.md
  plans/
  audits/
  logs/
  decisions/
  research/
  venture/
```

---

## 8. MVP 功能需求

## 8.1 `converge init`

### 8.1.1 用户故事

作为用户，我希望一条命令初始化项目中的 ConvergeKit 结构，从而开始定义 attractor、plan、audit、memory。

### 8.1.2 命令

```bash
converge init
converge init --mode product   # v0.1 默认且唯一支持的 mode
# v0.3+ 计划：converge init --mode research / venture
```

### 8.1.3 行为

生成目录结构之外，还执行 attractor 冷启动推断：扫描 repo 目录结构（如 `src/ui`、`src/db`、`src/service`），自动生成 `dependency_direction` 和 `forbidden_paths` 的草稿 invariants，交由用户确认后写入 attractor.yml，把“写 attractor”的冷启动成本降到接近零。

生成：

```text
.converge/attractor.yml
.converge/profiles/*.yml
.converge/templates/*.md
.converge/memory/
docs/architecture/
docs/plans/
docs/audits/
docs/logs/
docs/decisions/
```

### 8.1.4 验收标准

```text
运行 converge init 后，repo 中出现完整目录结构。
生成 product mode 的 attractor.yml starter template。
能从目录结构推断草稿 invariants，并要求用户确认后写入。
如果目录已存在，需要提示用户 merge / overwrite / skip。
```

---

## 8.2 `converge plan`

### 8.2.1 用户故事

作为用户，我希望为一次 AI agent 任务创建标准 plan，明确目标、非目标、退出条件和验证证据。

### 8.2.2 命令

```bash
converge plan "fix auth bug without changing architecture"
converge plan --type bugfix "fix failing login test"
# v0.3+ 计划：--type research / --type venture
```

### 8.2.3 生成文件

```text
docs/plans/PLAN-001-fix-auth-bug.md
```

### 8.2.4 Product Plan Template

```markdown
# PLAN-001: <title>

## Status
Draft | Active | Implemented | Audited | Closed | Blocked

## Current Baseline
Describe current behavior, architecture, known constraints.

## Goal
What should this plan achieve?

## Non-goals
What must not be changed in this plan?

## Expected Attractor Movement
Which attractor invariants should this plan reinforce?

## Risk Level
Low | Medium | High

## Files / Areas Likely Affected
- ...

## Exit Criteria
- [ ] ...

## Validation Checklist
- [ ] lint
- [ ] unit tests
- [ ] focused test
- [ ] typecheck
- [ ] boundary check

## Closure Evidence Required
- git diff
- test logs
- converge check report
- fresh audit report

## Notes
...
```

### 8.2.5 Research Plan Template（v0.3+，模板设计先行保留）

```markdown
# RESEARCH-PLAN-001: <title>

## Research Question

## Hypothesis

## Claim Under Test

## Mechanism

## Baselines

## Evidence Required

## Non-goals

## False Progress Risks

## Exit Criteria

## Failure Cases To Record
```

### 8.2.6 Venture Plan Template（v0.3+，模板设计先行保留）

```markdown
# VENTURE-PLAN-001: <title>

## Target User

## Pain Hypothesis

## Alternative Workflow

## Smallest Validation

## Fake Progress Risks

## Kill Criteria

## Continue Criteria

## Evidence Required
```

### 8.2.7 验收标准

```text
能生成 plan 文件。
能自动编号。
能标记 active plan。
能根据 plan type 生成模板（v0.1 仅 product 类模板）。
```

---

## 8.3 `converge check`

### 8.3.1 用户故事

作为用户，我希望在 AI 修改代码后检查当前 diff 是否违反 attractor、plan 范围或 closure 要求。

plan 是推荐而非强制：没有 active plan 时，converge check 按 attractor 默认策略执行（跳过 plan scope 检查），降低日常使用摩擦。

### 8.3.2 命令

```bash
converge check
converge check --plan PLAN-001
converge check --json
converge check --strict
```

### 8.3.3 输入

```text
.converge/attractor.yml
active plan
git diff
changed files
configured verification commands
memory records
```

### 8.3.4 MVP 检查项

#### A. Forbidden Path Check

检查是否修改禁止路径。

示例：

```yaml
forbidden_paths:
  - ".env"
  - "secrets/**"
  - "src/generated/**"
```

#### B. Dependency Direction Check

检查 import 依赖方向。

示例：

```yaml
dependency_direction:
  - from: "src/ui/**"
    cannot_import: "src/db/**"
  - from: "src/service/**"
    cannot_import: "src/ui/**"
```

#### C. Diff Scope Check

检查改动范围是否超出 plan。

规则：

```text
bugfix 默认不应大规模重构。
diff 超过阈值触发 warning / blocker。
修改 plan non-goals 涉及区域触发 blocker。
```

#### D. Test Integrity Check

检查测试是否被削弱。核心手段是 test-revert-rerun，而不是文本启发式。

P0 检查（blocker 级）：test-revert-rerun

```text
1. 检测 diff 中被修改或删除的测试文件。
2. 将测试文件改动 revert 回基线版本（源代码改动保留）。
3. 重跑测试。
4. 若当前版本测试通过、revert 后测试失败，
   说明实现依赖“被修改后的测试”才能通过 → blocker。
```

该判定标准源自 reward hacking 检测研究（EvilGenie、OpenAI CoT monitoring）的公认做法，可靠性远高于文本启发式。

P1 启发式（advisory 级，仅提示不阻断）：

```text
测试文件被修改 → advisory。
删除 expect/assert → advisory。
删除 test/it block → advisory。
snapshot 被大幅更新 → advisory。
把 strict assertion 改成 loose assertion → advisory。
```

启发式规则跨语言、跨测试框架的误报率高，v0.1 一律降为 advisory，不进入 closure blocker。

#### E. Validation Execution Check

验证证据必须由 converge 亲自产生，不信任 repo 中已存在的日志文件（agent 可以伪造日志，closure gate 的可信度不允许被绕过）。

MVP 规则：

```text
converge check 直接执行 attractor.yml 中 verification.before_close 定义的命令。
记录：命令、退出码、stdout/stderr 摘要、输出内容哈希、执行时间戳。
写入 .converge/reports/<PLAN>/evidence/，作为唯一合法的 validation evidence。
外部提供的 log 文件只能作为 advisory 参考，不能满足 closure 要求。
required 命令未执行或未通过 → closure blocked，plan 只能停留在 status=Implemented。
```

### 8.3.5 输出示例

```text
Converge Check Report

Plan: PLAN-001-fix-auth-bug
Mode: product

Behavior Evidence (executed by converge):
- lint: not run (required) → blocker
- test: passed, exit 0, evidence recorded
- typecheck: not run (optional)

Attractor Checks:
- no-ui-db-access: FAILED
  src/ui/auth.ts imports src/db/client.ts
- no-generated-edit: PASSED
- test-revert-rerun: PASSED
- test-heuristics: ADVISORY
  tests/auth.test.ts modified; 2 assertions removed

Plan Scope:
- diff lines: 342
- changed files: 7
- plan type: bugfix
- result: WARNING, broad change for bugfix

Closure:
BLOCKED

Blockers:
1. UI layer directly imports DB layer.
2. Required lint command not executed.
```

### 8.3.6 JSON 输出

```json
{
  "status": "blocked",
  "plan": "PLAN-001",
  "checks": [
    {
      "id": "no-ui-db-access",
      "severity": "error",
      "result": "failed",
      "evidence": "src/ui/auth.ts imports src/db/client.ts"
    }
  ],
  "closure": {
    "allowed": false,
    "blockers": ["dependency direction violated"]
  }
}
```

### 8.3.7 验收标准

```text
能读取 attractor.yml。
能解析 git diff。
能检测 forbidden paths。
能通过 dependency-cruiser adapter 检测 import boundary（JS/TS）。
能执行 test-revert-rerun 并阻断测试削弱。
能亲自执行 verification 命令并记录 evidence。
能输出 human-readable report 和 JSON。
```

---

## 8.4 `converge audit --fresh`

### 8.4.1 用户故事

作为用户，我希望在实现 agent 完成任务后，用新的上下文重新读取 repo 证据，判断是否真的可以 close。

### 8.4.2 命令

```bash
converge audit --fresh
converge audit --fresh --plan PLAN-001
converge audit --fresh --llm claude
converge audit --fresh --llm codex
converge audit --fresh --no-llm
```

LLM 语义审计是 MVP 核心能力（可调用 `claude -p` 或 API）——确定性检查已由 `converge check` 完成，audit 环节的增量价值在语义判断（如“这个改动是否合理化了错误结构”）。`--no-llm` 是 CI 降级模式，只输出确定性检查汇总与结构化审计模板。

### 8.4.3 Evidence Pack

Fresh audit 生成 evidence pack：

```text
.converge/reports/PLAN-001/evidence-pack.md
.converge/reports/PLAN-001/evidence-pack.json
```

包含：

```text
repo metadata
current commit hash
git diff
changed files
active plan
attractor.yml relevant sections
architecture docs references
validation logs
converge check results
related memory records
```

### 8.4.4 Fresh Audit 规则

审计不能把实现 agent 的总结作为权威证据。

分级：

```text
authoritative:
  live repo
  git diff
  test logs
  architecture docs
  plan exit criteria

advisory:
  implementation notes
  agent final summary
  self-reported reasoning
```

### 8.4.5 Audit Prompt 模板

```markdown
# Fresh Audit Task

You are auditing an AI-generated code change.
Do not trust the implementer's completion summary as evidence.
Use only the live repo evidence, git diff, plan, attractor spec, test logs, and prior memory.

Your goal is not to confirm completion.
Your goal is to find reasons this plan should not be closed.

Check:
1. Did the implementation satisfy the plan goal?
2. Did it violate non-goals?
3. Did it move the repo away from the attractor?
4. Were tests weakened or coupled to implementation details?
5. Are validation logs sufficient?
6. Is the change scope appropriate?
7. Is a human decision required?

Output:
- Evidence reviewed
- Closure blockers
- Warnings
- False positive risks
- Final judgment: Closed / Not Closed / Needs Human Decision
```

### 8.4.6 输出示例

```markdown
# Fresh Audit Report: PLAN-001

## Evidence Reviewed
- git diff: yes
- active plan: yes
- attractor.yml: yes
- validation logs: partial

## Behavior Status
The login bug appears fixed in the focused test.

## Attractor Status
Failed. UI layer now imports database client directly.

## Closure Blockers
1. Violates invariant no-ui-db-access.
2. Required lint command not executed by converge.
3. Test assertions were removed without plan justification.

## Final Judgment
Not Closed.

## Required Next Action
Rework patch so UI calls API/service layer instead of DB client.
Restore or justify removed assertions.
Run required verification commands via converge.
```

### 8.4.7 验收标准

```text
能生成 evidence pack。
能基于 evidence pack 生成 audit report。
能在 llm 模式下调用外部模型完成语义审计（MVP 核心能力）。
能在 no-llm 模式下输出确定性检查汇总与结构化审计模板（CI 降级模式）。
LLM audit 必须引用 evidence pack，不得只依据 agent summary。
```

---

## 8.5 `converge close`

### 8.5.1 用户故事

作为用户，我希望 ConvergeKit 根据 check、audit、plan exit criteria 和 evidence 判断一个 plan 是否可以关闭。

### 8.5.2 命令

```bash
converge close PLAN-001
converge close PLAN-001 --force
converge close PLAN-001 --human-approved
```

### 8.5.3 Closure 状态机

```text
Draft
→ Active
→ Implemented
→ Checked
→ Audited
→ Closed

失败分支：
→ Blocked
→ Needs Human Decision
→ Needs Rework
```

### 8.5.4 Closure 条件

默认要求：

```text
active plan exists
exit criteria checked
converge check passed or warnings accepted
fresh audit passed
required verification commands executed by converge and passed
handoff updated
memory updated if new failure/decision exists
```

### 8.5.5 输出示例

```text
Cannot close PLAN-001.

Blockers:
1. converge check failed: no-ui-db-access.
2. fresh audit judgment: Not Closed.
3. required lint command not executed by converge.

Status updated: Needs Rework.
```

成功输出：

```text
PLAN-001 closed.

Closure evidence:
- Check report: .converge/reports/PLAN-001/check.md
- Audit report: docs/audits/PLAN-001-fresh-audit.md
- Validation logs: .converge/reports/PLAN-001/logs/
- Handoff updated: .converge/handoff.md
```

### 8.5.6 验收标准

```text
不能在 blocker 存在时 close。
可以生成 closure report。
可以更新 plan status。
可以允许 human-approved override，但必须记录原因。
```

---

## 8.6 `converge handoff`

### 8.6.1 用户故事

作为用户，我希望在下一次 AI session 开始前快速了解当前项目方向、活动 plan、未解决风险、最近审计和已证伪路径。

### 8.6.2 命令

```bash
converge handoff
converge handoff --plan PLAN-001
converge handoff --for claude
converge handoff --for codex
```

### 8.6.3 输出

```markdown
# ConvergeKit Handoff

## Current Attractor Summary

## Active Plans

## Last Closed Plans

## Open Risks

## Recent Audit Findings

## Disproven Assumptions

## Divergent Paths

## Recommended Next Step

## Agent Instructions
```

### 8.6.4 验收标准

```text
能读取 attractor、plans、audits、memory。
能生成当前 handoff。
能面向 Claude / Codex 生成不同格式摘要。
```

---

## 8.7 `converge memory add`

### 8.7.1 用户故事

作为用户，我希望把被证伪前提、发散路径、被推翻 closure 等轨迹信息保存下来，避免 AI 后续 session 重复走错路。

### 8.7.2 命令

```bash
converge memory add --type disproven-assumption
converge memory add --type divergent-path
converge memory add --type overturned-closure
converge memory add --type terminology-trap
```

### 8.7.3 模板

```markdown
# Memory: <type>

## Summary

## Context

## What Was Assumed

## What Disproved It

## Evidence

## Future Instruction

## Related Plans

## Created At
```

### 8.7.4 示例

```markdown
# Memory: Disproven Assumption

## Summary
Local array editor mirror is not harmless.

## What Was Assumed
Keeping a local mirror in array editor was acceptable if tests passed.

## What Disproved It
Removing the mirror exposed tests coupled to old timing behavior.

## Future Instruction
Do not preserve local mirror just to satisfy old tests.
First check whether tests encode obsolete implementation timing.
```

### 8.7.5 验收标准

```text
能创建 memory 记录。
能在 handoff 中引用 memory。
能在 fresh audit evidence pack 中包含相关 memory。
```

---

## 8.8 `converge compile`

### 8.8.1 用户故事

作为用户，我希望把 `.converge/attractor.yml` 和 profiles 编译成 Claude Code、Codex、OpenCode、Cline 可读取的配置，从而让不同 agent 共享同一套方向约束。

### 8.8.2 命令

```bash
converge compile --target claude
converge compile --target codex
converge compile --target opencode
converge compile --target cline
converge compile --all
```

### 8.8.3 Claude 输出

MVP：

```text
CLAUDE.md
.claude/skills/converge-plan/SKILL.md
.claude/skills/converge-audit/SKILL.md
.claude/skills/converge-close/SKILL.md
```

第二阶段：

```text
.claude/agents/fresh-auditor.md
.claude/agents/architecture-reviewer.md
.claude/hooks/
```

### 8.8.4 Codex 输出

MVP：

```text
AGENTS.md
.codex/skills/converge-plan/SKILL.md
.codex/skills/converge-audit/SKILL.md
.codex/skills/converge-close/SKILL.md
```

### 8.8.5 编译原则

```text
attractor.yml 是源文件。
CLAUDE.md / AGENTS.md 是编译产物。
用户应优先修改 attractor.yml，而不是手工分叉多个 agent 配置。
```

### 8.8.6 验收标准

```text
能输出 CLAUDE.md。
能输出 AGENTS.md。
能输出 basic SKILL.md。
能在文件头标记 generated by ConvergeKit。
能保留用户手写区块，避免覆盖。
```

---

## 9. 模式设计

## 9.1 Product Mode

适合已有产品或工程项目。v0.1 唯一支持的 mode。

### 9.1.1 Attractor 内容

```text
architecture boundaries
module dependency direction
quality standards
security constraints
forbidden paths
anti-patterns
closure rules
```

### 9.1.2 Closure 问题

```text
功能是否落地？
是否违反架构边界？
是否修改超出 plan 范围？
是否通过削弱测试来完成？
是否有足够验证日志？
```

### 9.1.3 Starter Template

```yaml
mode: product

attractor:
  invariants:
    - id: no-ui-db-access
      rule: "UI layer must not directly access database."
      check: import-boundary
    - id: no-generated-edit
      rule: "Generated files must not be manually edited."
      check: forbidden-path

  anti_patterns:
    - "business logic inside UI components"
    - "direct SQL in route handlers"
    - "broad refactor during bugfix"
```

---

## 9.2 Research Mode（v0.3+）

适合科研方向、论文方法、实验探索。设计先行保留，不进入 v0.1 MVP 范围——其 closure 条件（ablation、baseline 等）本质上无法机器检查，依赖 LLM audit 成熟后再落地。

### 9.2.1 Attractor 内容

```text
research question
hypothesis
claim
mechanism
baselines
evidence required
ablation plan
failure cases
forbidden shortcuts
```

### 9.2.2 Closure 问题

```text
验证了哪个 hypothesis？
claim 是否比 baseline 更清楚？
有没有 evidence？
有没有 ablation？
有没有 failure case？
这个工作是否只是工程 feature？
```

### 9.2.3 Starter Template

```yaml
mode: research

research:
  question: "Can repo-native attractor specs reduce false closure in coding-agent workflows?"

  hypotheses:
    - id: H1
      claim: "Fresh audit catches false closure missed by tests."
      evidence_required:
        - "At least 10 AI-generated patches."
        - "At least 3 test-pass but closure-blocked cases."
        - "Manual confirmation for real drift cases."

  baselines:
    - "AGENTS.md only"
    - "CLAUDE.md only"
    - "prompt-only architecture instruction"
    - "tests-only closure"

  forbidden_shortcuts:
    - "Do not claim novelty from YAML schema alone."
    - "Do not evaluate only on toy repos."
    - "Do not skip baselines."
```

---

## 9.3 Venture Mode（v0.3+）

适合创业项目、产品探索、需求验证。设计先行保留，不进入 v0.1 MVP 范围。

### 9.3.1 Attractor 内容

```text
target user
pain hypothesis
alternative workflow
validation evidence
fake progress patterns
kill criteria
continue criteria
```

### 9.3.2 Closure 问题

```text
是否验证了真实用户痛点？
是否有用户反馈？
是否只是 demo polish？
是否只是另一个 dashboard？
是否有 repeated use case？
是否满足继续投入标准？
```

### 9.3.3 Starter Template

```yaml
mode: venture

venture:
  target_users:
    - "developers using Claude Code or Codex in real repos"
    - "small teams reviewing AI-generated PRs"

  pain_hypotheses:
    - id: P1
      claim: "Teams cannot trust AI-generated PR closure without independent evidence."
      validation_required:
        - "5 users run ConvergeKit on their own repos."
        - "3 users say they would add it to CI."
        - "2 real false-closure cases found."

  fake_progress:
    - "landing page without user interviews"
    - "dashboard without repeated use case"
    - "profile marketplace without validated profiles"

  kill_criteria:
    - "Users only find it intellectually interesting."
    - "Users do not run it after first demo."
    - "It cannot find issues beyond tests."
```

---

## 10. `.converge/attractor.yml` Schema v0.1

```yaml
version: 0.1
mode: product # v0.1 仅支持 product；research / venture 计划于 v0.3+

project:
  name: convergekit-demo
  mission: "Prevent AI coding agents from drifting project architecture."

authority:
  architecture:
    - docs/architecture/README.md
    - docs/architecture/baseline.md
  decisions:
    - docs/decisions/
  logs:
    - docs/logs/
  plans:
    - docs/plans/
  audits:
    - docs/audits/

attractor:
  invariants:
    - id: no-ui-db-access
      rule: "UI layer must not directly access database."
      severity: error
      check: import-boundary
    - id: no-test-weakening
      rule: "Tests must not be weakened to match implementation."
      severity: error
      check: test-revert-rerun

  dependency_direction:
    - id: ui-cannot-import-db
      from: "src/ui/**"
      cannot_import: "src/db/**"
      severity: error
    - id: service-cannot-import-ui
      from: "src/service/**"
      cannot_import: "src/ui/**"
      severity: error

  forbidden_paths:
    - path: ".env"
      severity: error
    - path: "secrets/**"
      severity: error
    - path: "src/generated/**"
      severity: warning

  anti_patterns:
    - id: business-logic-in-ui
      description: "Business logic inside UI components."
      severity: warning
    - id: broad-refactor-during-bugfix
      description: "Broad refactor during bugfix task."
      severity: warning

verification:
  executed_by: converge        # 验证命令必须由 converge 亲自执行；外部日志仅 advisory
  evidence_dir: ".converge/reports/${plan}/evidence/"
  record: [command, exit_code, output_hash, timestamp]
  before_close:
    - id: lint
      command: "npm run lint"
      required: true
    - id: test
      command: "npm run test"
      required: true
    - id: typecheck
      command: "npm run typecheck"
      required: false

closure:
  require_fresh_audit: true
  require_plan_exit_criteria: true
  require_validation_logs: true
  allow_human_override: true

agent_policy:
  default:
    require_plan_first: true
    require_read_before_edit: true
    block_close_without_audit: true

  bugfix:
    edit_scope: minimal
    require_focused_test: true
    max_diff_lines_warning: 300
    max_diff_lines_blocker: 800

  refactor:
    require_plan_first: true
    require_human_approval_if_diff_over: 500

  security:
    default_mode: read_only
    require_human_close: true
```

---

## 11. Agent Adapter 设计

## 11.1 Claude Code Adapter

### 11.1.1 生成文件

```text
CLAUDE.md
.claude/skills/converge-plan/SKILL.md
.claude/skills/converge-check/SKILL.md
.claude/skills/converge-audit/SKILL.md
.claude/skills/converge-close/SKILL.md
```

### 11.1.2 CLAUDE.md 内容结构

```markdown
# Project ConvergeKit Rules

This file is generated from .converge/attractor.yml.
Do not edit generated sections manually. Edit .converge/attractor.yml instead.

## Project Mission

## Authority Order

## Attractor Invariants

## Anti-patterns

## Plan / Closure Protocol

## Required Commands

## Agent Behavior Policy

## When To Use ConvergeKit Skills
```

### 11.1.3 Skill: converge-audit

```markdown
---
name: converge-audit
description: Use when a task implementation appears complete and needs independent closure audit.
---

# Converge Fresh Audit

Run:

```bash
converge audit --fresh
```

Do not treat the implementer's final summary as authoritative evidence.
Use live repo, git diff, plan, attractor, and validation logs.
```

---

## 11.2 Codex Adapter

### 11.2.1 生成文件

```text
AGENTS.md
.codex/skills/converge-plan/SKILL.md
.codex/skills/converge-check/SKILL.md
.codex/skills/converge-audit/SKILL.md
.codex/skills/converge-close/SKILL.md
```

### 11.2.2 AGENTS.md 内容结构

```markdown
# ConvergeKit Project Guidance

Generated from .converge/attractor.yml.

## Authority

## Current Attractor

## Plan Protocol

## Closure Protocol

## Validation Commands

## Prohibited Shortcuts

## Use ConvergeKit
Before claiming completion, run or request:
- converge check
- converge audit --fresh
- converge close <PLAN_ID>
```

---

## 11.3 OpenCode / Cline Adapter

MVP 可以只输出通用 rules 文件：

```text
.opencode/instructions.md
.clinerules
```

内容同样从 attractor 编译而来。

---

## 12. CI / GitHub Action 设计

### 12.1 目标

CI 是避免 agent 自我审查的重要外部关口。

### 12.2 GitHub Action 示例

```yaml
name: ConvergeKit Check

on:
  pull_request:

jobs:
  converge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install ConvergeKit
        run: npm install -g convergekit
      - name: Run Converge Check
        run: converge check --strict
      - name: Run Fresh Audit Without LLM
        run: converge audit --fresh --no-llm
      - name: Closure Status
        run: converge closure-status
```

### 12.3 CI 策略

MVP：

```text
error 级别 blocker 导致 CI fail。
warning 级别输出 report，不 fail。
advisory 级别只记录。
```

---

## 13. Check Engine 技术设计

### 13.1 输入

```text
attractor.yml
active plan
git diff
file tree
package metadata
validation logs
```

### 13.2 输出

```text
check report markdown
check report json
closure status
```

### 13.3 模块

```text
DiffParser
PathMatcher
BoundaryCheckAdapter    # 封装 dependency-cruiser（JS/TS）/ import-linter（Python），不自研 import 图分析
TestRevertRunner        # test-revert-rerun：revert 测试改动后重跑
TestDiffHeuristics      # advisory 级文本启发式
PlanScopeChecker
VerificationRunner      # 亲自执行验证命令并记录 evidence
ReportGenerator
```

语言支持策略：JS/TS 为一等公民（dependency-cruiser），Python 可选（import-linter），其他语言进入 roadmap。check engine 定位为规则编排层，不重造依赖解析。

### 13.4 检查优先级

```text
P0:
- forbidden path
- dependency direction（boundary tool adapter）
- validation execution（converge 亲自执行）
- test-revert-rerun
- diff scope

P1（advisory）:
- test weakening heuristic
- generated file edit
- anti-pattern regex

P2:
- LLM semantic drift audit
- historical trajectory trend
```

---

## 14. Fresh Audit 技术设计

### 14.1 目标

Fresh audit 不是确认 agent 是否做完，而是寻找不能 close 的理由。

### 14.2 审计输入分级

```text
Authoritative:
- live repo
- git diff
- test logs
- plan
- attractor.yml
- architecture docs

Advisory:
- implementation summary
- agent messages
- natural language explanation
```

### 14.3 审计输出结构

```json
{
  "judgment": "not_closed",
  "blockers": [],
  "warnings": [],
  "evidence_reviewed": [],
  "false_positive_risks": [],
  "next_actions": []
}
```

### 14.4 LLM 使用原则

MVP 必须支持 LLM audit（`--no-llm` 仅为 CI 降级模式），但必须保持：

```text
deterministic checks 优先。
LLM audit 不拥有最终权威。
LLM audit 必须引用 evidence pack。
LLM audit 不能只看 agent summary。
```

---

## 15. Exploration Mode 设计

ConvergeKit 不应只支持工业开发。它还要支持探索型工作。

### 15.1 Exploration Attractor

探索阶段的 attractor 不定义最终产品形态，而定义探索纪律：

```text
什么问题值得探索？
什么证据才算有效？
什么方案属于伪创新？
什么 demo 不能算完成？
什么时候必须放弃一条路线？
什么时候可以从 explore 进入 core？
```

### 15.2 Workspace Zones

建议支持：

```text
explore/
core/
archive/
```

#### explore/

允许快速试错，但必须记录 hypothesis 和 evidence。

#### core/

只有通过 closure 的内容才能进入。

#### archive/

保存失败路径，不直接删除。

### 15.3 Promotion Protocol

从 explore 进入 core，需要满足：

```text
hypothesis 明确；
evidence 充分；
failure cases 记录；
fresh audit 通过；
manual approval 可选。
```

---

## 16. 8 周执行路线

### Week 1: Schema + Init

产物：

```text
项目 repo 初始化
TypeScript CLI scaffold
attractor.yml JSON schema
converge init
product starter template
目录结构扫描与 invariant 草稿推断
```

验收：

```text
npm link 后可以运行 converge init。
生成完整 .converge/ 和 docs/ 结构。
```

### Week 2: Plan Harness

产物：

```text
converge plan
plan auto-numbering
active plan tracking
product plan templates（bugfix / feature / refactor）
```

验收：

```text
能创建 PLAN-001。
能读取 active plan。
能在 plan 中记录 goals / non-goals / exit criteria。
```

### Week 3: Check Engine v0

产物：

```text
converge check
git diff parser
forbidden path check
dependency direction check（dependency-cruiser adapter）
diff scope check
verification runner（亲自执行验证命令并记录 evidence）
markdown + json report
```

验收：

```text
构造一个 UI import DB 的 demo，converge check 能 fail。
```

### Week 4: Test Integrity Check

产物：

```text
test-revert-rerun runner（P0 blocker）
test file modified detector（advisory）
assertion deletion heuristic（advisory）
snapshot broadening heuristic（advisory）
```

验收：

```text
构造一个“削弱测试后才能通过”的 demo，test-revert-rerun 能 block。
```

### Week 5: Fresh Audit

产物：

```text
evidence pack generator
converge audit --fresh --llm claude（MVP 核心）
converge audit --fresh --no-llm（CI 降级模式）
audit report template
```

验收：

```text
能生成 evidence-pack.md 和 fresh-audit.md。
LLM audit 能引用 evidence pack 完成语义审计。
```

### Week 6: Compile Adapters

产物：

```text
converge compile --target claude
converge compile --target codex
CLAUDE.md generator
AGENTS.md generator
basic skill generator
```

验收：

```text
Claude Code / Codex 能读到生成配置。
```

### Week 7: Memory + Handoff

产物：

```text
converge memory add
converge handoff
memory templates
handoff generator
```

验收：

```text
被证伪前提能写入 memory，并出现在 handoff 中。
```

### Week 8: Demo + Release

产物：

```text
README
example repo
demo gif/video
npm package
GitHub release v0.1.0
```

验收：

```text
演示：AI 修改通过测试，但 ConvergeKit 阻止 closure。
```

---

## 17. 开源发布策略

### 17.1 README 首屏

```markdown
# ConvergeKit

AI agents can pass tests while drifting your architecture.
ConvergeKit catches that.

ConvergeKit is a repo-native Attractor-first Harness for Claude Code, Codex, OpenCode, Cline, and other coding agents.

It helps you:
- define where your repo should converge;
- create plans with closure criteria;
- check AI-generated diffs for drift;
- run fresh audits using live repo evidence;
- prevent agents from self-declaring completion;
- generate CLAUDE.md and AGENTS.md from the same source.
```

### 17.2 Demo 标题

```text
Tests passed. Closure blocked.
```

### 17.3 Demo 流程

```text
1. Run Claude/Codex on a bug.
2. Agent modifies code and tests pass.
3. Run converge check.
4. ConvergeKit finds UI → DB dependency violation.
5. Run converge audit --fresh.
6. Closure blocked.
```

### 17.4 文档结构

```text
Quickstart
Why not just prompt?
Why not just tests?
How is this different from Spec Kit / dependency-cruiser / CodeRabbit?
Core concepts
Attractor.yml
Plan protocol
Fresh audit
Claude Code integration
Codex integration
Research mode
Venture mode
Examples
Roadmap
```

### 17.5 竞品定位对比

用户的第一个问题一定是“这和 X 有什么区别”。README 与文档必须直接回答：

| 工具 | 它管什么 | ConvergeKit 的区别 |
|---|---|---|
| GitHub Spec Kit / OpenSpec / Kiro | 开工前：spec → plan → 实现 | ConvergeKit 管完工后：check → fresh audit → closure。constitution 定义方向，ConvergeKit 验证方向没有被带偏 |
| dependency-cruiser / ArchUnit / import-linter | 单点架构规则检查 | ConvergeKit 是 closure 编排层，底层复用这些工具，把结果汇入“能否关闭”的判断 |
| CodeRabbit / Greptile / Qodo | AI PR review，找 bug 与质量问题 | ConvergeKit 不找 bug，只回答“这次修改能否 close”，且不信任实现 agent 的自述 |
| Beads / claude-mem / Claude Code 原生 Tasks | 任务状态与上下文记忆 | ConvergeKit memory 记录方向性教训：被证伪前提、发散路径、被推翻的 closure |

一句话定位：

```text
Spec 工具管“该做什么”，review 工具管“代码好不好”，
ConvergeKit 管“这件事是否真的可以宣布完成”。
```

---

## 18. 风险与缓解

### 18.1 风险：概念过重

缓解：

```text
对外先讲“架构漂移检测”和“AI closure gate”。
高级文档再讲 attractor、trajectory、control。
```

### 18.2 风险：退化成模板工具

缓解：

```text
必须有 check engine。
必须有 closure blocking。
必须有 evidence pack。
```

### 18.3 风险：审计仍然自我确认

缓解：

```text
fresh audit 不使用原上下文作为权威。
CLI / CI 作为外部判断层。
实现者总结只能 advisory。
```

### 18.4 风险：误报太多

缓解：

```text
分 error / warning / advisory。
文本启发式一律 advisory，blocker 只来自确定性证据（revert-rerun、boundary、命令执行结果）。
允许 human override，但必须记录。
第一版只承诺显式规则检测。
```

### 18.5 风险：用户不知道如何写 attractor

缓解：

```text
提供 starter templates。
提供 examples。
converge init 从目录结构推断 invariant 草稿，冷启动成本接近零。
后续提供 converge attractor draft。
```

### 18.6 风险：和现有工具竞争不清楚

缓解：

```text
明确不替代 Claude Code / Codex。
ConvergeKit 是它们外部的 closure and drift layer。
```

### 18.7 风险：平台原生功能吸收

Claude Code / Codex 正在快速原生化相关能力：native tasks / memory、hooks、subagent auditor；Spec Kit 的 constitution 已覆盖 attractor 的结构层概念。护城河窗口可能只有一到两个产品迭代周期。

缓解：

```text
聚焦 CI 侧 closure gate —— 平台方最不可能替用户做的位置。
保持跨 agent 中立：同一 attractor 编译到所有主流 agent。
把不可伪造的 evidence（converge 亲自执行 + test-revert-rerun）做成核心壁垒。
差异化在 closure 协议整合，而非任何单项检查能力。
```

---

## 19. v0.1 验收标准

v0.1 发布必须满足：

```text
1. 可以 npm install 或 npm link 使用。
2. 可以 converge init。
3. 可以创建 attractor.yml。
4. 可以 converge plan 创建 plan。
5. 可以 converge check 检查 git diff。
6. 可以检测 forbidden path。
7. 可以检测 dependency direction（dependency-cruiser adapter，JS/TS）。
8. 可以通过 test-revert-rerun 阻断测试削弱（文本启发式为 advisory）。
9. 验证命令由 converge 亲自执行并记录 evidence，不信任外部日志。
10. 可以生成 evidence pack。
11. 可以生成 fresh audit report（含 LLM 语义审计）。
12. 可以 converge close 阻断有 blocker 的 plan。
13. 可以 converge handoff。
14. 可以生成 CLAUDE.md。
15. 可以生成 AGENTS.md。
16. 有一个完整 demo repo。
17. README 能在 3 分钟内让用户理解使用理由，并回答“与 Spec Kit / dependency-cruiser / CodeRabbit 的区别”。
```

---

## 20. 后续版本路线

### v0.2

```text
Claude Code plugin with hooks。
Codex skills scripts。
GitHub Action。
MCP server alpha。
holdout test 支持（更强 test weakening detection）。
Python 支持（import-linter adapter）。
```

### v0.3

```text
Research / Venture mode 完整支持。
Trace recorder。
Agent session report。
Profile compiler。
多模型 audit 策略。
```

### v0.4

```text
Trajectory-to-memory。
Trajectory-to-skill。
Profile benchmark。
```

### v0.5

```text
Profile registry。
Community templates。
Verified attractor packs。
```

---

## 21. 最小开发任务拆分

### CLI 基础

```text
[ ] TypeScript CLI scaffold
[ ] Command parser
[ ] Config loader
[ ] YAML parser
[ ] Markdown template renderer
[ ] File writer with safe overwrite
```

### Schema

```text
[ ] attractor.yml JSON schema
[ ] product mode template
[ ] invariant 草稿推断（目录扫描）
[ ] schema validation
[ ] error messages
```

### Plan

```text
[ ] plan numbering
[ ] active plan tracking
[ ] product templates（bugfix / feature / refactor）
```

### Check

```text
[ ] git diff parser
[ ] changed file detector
[ ] forbidden path checker
[ ] boundary check adapter（dependency-cruiser / import-linter）
[ ] diff line counter
[ ] test revert runner（test-revert-rerun）
[ ] test diff heuristics（advisory）
[ ] verification runner（执行命令 + 记录 evidence）
[ ] report generator
```

### Audit

```text
[ ] evidence pack generator
[ ] LLM audit interface（claude -p / API，MVP 核心）
[ ] no-llm audit template（CI 降级）
[ ] audit report writer
```

### Close

```text
[ ] closure status reader
[ ] blocker evaluator
[ ] plan status updater
[ ] human override record
```

### Memory / Handoff

```text
[ ] memory add command
[ ] memory templates
[ ] handoff generator
[ ] memory inclusion in evidence pack
```

### Compile

```text
[ ] CLAUDE.md generator
[ ] AGENTS.md generator
[ ] skill generator
[ ] preserve manual sections
```

### Release

```text
[ ] README
[ ] demo repo
[ ] demo script
[ ] npm package
[ ] GitHub Action example
```

---

## 22. 关键产品判断

ConvergeKit 第一版必须克制。

不要先做：

```text
完整 agent runner
复杂 UI
自动模型适配
marketplace
SaaS dashboard
多 repo 管理
复杂 semantic analysis
research / venture mode
自研 import 依赖图分析
```

先做一条能跑通的核心链路：

```text
attractor.yml → plan → check → audit → close → handoff
```

第一版只要证明：

> ConvergeKit 能发现“测试通过但不应 close”的 AI 修改。

这个证明成立，就可以继续扩展 Claude/Codex adapters、CI gate、trace recorder 和 exploration mode。

---

## 23. 最终执行建议

执行顺序：

1. 先写 demo repo，而不是先写框架。
2. 在 demo repo 中设计一个故意违规的 AI patch：测试通过，但 UI import DB。
3. 写最小 `attractor.yml`。
4. 实现 `converge check`，让它能抓到这个违规。
5. 再补 `plan`、`audit`、`close`。
6. 最后做 `compile --target claude/codex`。

最小可传播 demo：

```text
Claude Code fixed the bug.
Tests passed.
ConvergeKit blocked closure because the patch violated the repo attractor.
```

这比“支持很多模型”更容易让用户理解，也更接近项目的真实差异。

---

## 24. v0.2 变更记录

依据 2026-07 的竞品调研与可行性审查，v0.2 相对 v0.1 的主要修改：

1. **MVP 范围收窄到 product mode**：research / venture mode 的模板设计保留在文档中，完整支持移至 v0.3+（它们的 closure 条件本质上无法机器检查，会稀释 v0.1 的交付质量）。
2. **验证证据不可伪造化**：废弃“检查 log 文件是否存在”的规则（agent 可伪造日志），改为 converge 亲自执行 verification 命令并记录退出码、输出哈希与时间戳；外部日志一律降为 advisory。
3. **Test Integrity 升级为 test-revert-rerun**：revert 测试改动后重跑测试作为 P0 blocker（借鉴 EvilGenie / OpenAI CoT monitoring 等 reward hacking 检测研究的公认判定标准）；原文本启发式（数 assertion 增删）误报率高，一律降为 advisory。
4. **不自研 import 图分析**：check engine 定位为规则编排层，dependency direction 检查通过 dependency-cruiser（JS/TS）/ import-linter（Python）adapter 实现；v0.1 语言支持明确为 JS/TS 一等公民。
5. **LLM fresh audit 提升为 MVP 核心能力**：确定性检查已由 converge check 覆盖，audit 的增量价值在语义判断；`--no-llm` 降级为 CI fallback 模式。
6. **降低采用摩擦**：converge init 从目录结构推断 invariant 草稿（用户确认后写入）；plan 改为推荐而非强制，无 active plan 时 check 按默认策略执行。
7. **新增 17.5 竞品定位对比**：直接回答“与 Spec Kit / OpenSpec / dependency-cruiser / CodeRabbit / Beads 的区别”，并加入 README 文档结构。
8. **新增 18.7 平台原生功能吸收风险**：Claude Code / Codex 原生化 tasks、memory、hooks、subagent auditor 的威胁，缓解策略是聚焦 CI 侧 gate、跨 agent 中立、不可伪造 evidence。
9. 8 周路线（Week 1/2/3/4/5）、v0.1 验收标准、任务拆分、后续版本路线随上述变更同步更新。
