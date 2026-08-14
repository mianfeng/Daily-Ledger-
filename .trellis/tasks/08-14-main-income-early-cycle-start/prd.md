# 主要收入提前开启新周期

## Goal

当用户在当前预算周期尚未结束时记录一笔主要收入，系统应支持把它当作新一期收入来开启新预算周期，而不是静默追加到当前周期，避免发薪提前或提前录入工资时账本周期不更新。

## What I Already Know

* 用户遇到的问题：当前周期未结束时记录主要收入后，没有开启新周期。
* 现有 `allocateIncome` 在 `lib/daily.ts` 中明确存在一个分支：如果主要收入日期落在当前周期 `startDate..plannedEndDate` 内，就追加到当前周期。
* 新周期创建逻辑已经存在：当主要收入日期不在当前周期内时，会归档旧周期、生成新 `currentCycle`、创建必要的周期缓冲金结转流水，并保存 `previousCycle` / `previousPockets` 用于删除回滚。
* UI 当前文案没有区分这两种行为，仍可能提示“主要收入会开启新的预算周期”。
* 生活预算状态由 `App.tsx` 持有，业务计算应继续放在 `lib/daily.ts`。

## Assumptions (Temporary)

* “主要收入”代表一次新的工资/主收入到账；用户选择主要收入时通常期待开启新周期。
* “提前开启新周期”应该复用已有的新周期创建逻辑，而不是另写一套分配规则。
* 零散收入、退款报销、余额修正不在本任务范围内。

## Open Questions

* None.

## Requirements (Evolving)

* 当前周期未结束时，主要收入不能再静默追加到当前周期而不给提示。
* 用户选择“主要收入”时，总是开启新预算周期；即使当前周期尚未结束，也提前结束当前周期并归档。
* 主要收入开启新周期时，沿用现有主收入分配规则：固定预留、储备固定金额、最低每周生活线、缓冲固定金额、预算周生成。
* 预计发薪日固定按每月 15 日计算；如果 15 日是周六或周日，则提前到最近的工作日。
* 例如 2026-08-15 是周六，则本月发薪日按 2026-08-14 处理。
* 开启新周期时继续保留可删除回滚所需的 `previousCycle` / `previousPockets` 审计信息。
* UI 文案必须准确说明当前记录会追加当前周期还是开启新周期。

## Acceptance Criteria (Evolving)

* [ ] 在当前周期未结束时记录主要收入，会直接开启新周期。
* [ ] 新周期生成后，旧周期进入归档，新的 `currentCycle.startDate` 等于收入日期。
* [ ] 新周期收入流水有 `previousCycle` 和 `previousPockets`，删除该流水可以恢复前一周期。
* [ ] 固定预留、缓冲金、储备金、预算周分配仍符合现有规则。
* [ ] UI 提示不再错误暗示“会开启新周期”但实际不发生。
* [ ] 发薪日按每月 15 日计算，遇周六/周日提前到周五或前一个工作日。
* [ ] `npx tsc --noEmit` 和 `npm run build` 通过。

## Definition of Done

* Type-check and production build pass.
* Relevant business behavior is covered by focused regression checks or executable assertions.
* `.trellis/spec/` is updated if the product rule changes from prior documented behavior.
* Changes are committed separately from the prior 60/40 rollover commit.

## Out of Scope

* 不改变零散收入、退款报销、余额修正。
* 不处理“已结转周再补记消费”的修正规则。
* 不重做收入表单整体 UI。
* 不改变 Excel 完整备份格式，除非代码改动直接需要。

## Technical Notes

* Likely files:
  * `lib/daily.ts` — `allocateIncome` 当前周期内主要收入分支和新周期创建逻辑。
  * `components/DailyLedger.tsx` — 收入面板提示、可能的确认交互。
  * `.trellis/spec/frontend/state-management.md` — 若规则确定为主要收入提前开新周期，需要同步契约。
* Existing branch to revisit:
  * `budget.currentCycle && normalizedDate >= startDate && normalizedDate <= plannedEndDate`
* Existing new-cycle path already handles:
  * `previousCycle`
  * `previousPockets`
  * cycle rollover transfer
  * archived cycle insertion

## Decision (ADR-lite)

**Context**: 用户选择“主要收入”时，产品语义是新一期工资/主收入到账。现有代码在日期仍处于当前周期时把主要收入追加到当前周期，和用户预期冲突。

**Decision**: 主要收入总是开启新周期；预计发薪日固定按每月 15 日推算，遇周末提前到最近工作日。

**Consequences**: 提前发薪能正确切换周期；如果用户想记录非周期性收入，应选择零散收入或退款报销，而不是主要收入。
