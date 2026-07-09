# 固定支出删除功能

## Goal

给生活预算的固定支出清单添加删除功能，解决当前固定支出项只能添加、不能移除的问题。

## What I Already Know

* 用户反馈固定支出预留项目前只能添加不能删除。
* 固定支出清单在 `LifeBudgetState.fixedExpenses` 中保存，每项已有 `isActive` 字段。
* 固定支出付款流水会保存 `fixedExpenseId`，删除固定支出清单项不应删除历史付款流水。
* 当前 UI 在 `components/DailyLedger.tsx` 的固定支出面板中直接渲染 `budget.fixedExpenses.map(...)`。
* 当前预算计算只统计 `isActive` 的固定支出，因此可以用软删除/停用方式实现删除。

## Requirements

* 固定支出列表中每个项目提供删除入口。
* 删除前需要二次确认。
* 删除固定支出项后，不再显示在固定支出清单中。
* 删除固定支出项后，不再参与新周期固定预留计算。
* 删除固定支出项不删除已有历史付款流水。

## Acceptance Criteria

* [x] 固定支出面板中每个固定支出项可以删除。
* [x] 删除操作有确认提示。
* [x] 删除后该固定支出项从列表消失。
* [x] 删除后该固定支出项不再计入 active fixed expense total。
* [x] 历史流水不被删除。
* [x] `npm run build` passes.

## Definition of Done

* Build/typecheck passes through `npm run build`.
* UI behavior matches existing fixed expense panel patterns.
* State mutation remains in `lib/daily.ts`; component only calls a helper.

## Out of Scope

* 不增加编辑固定支出功能。
* 不增加恢复已删除固定支出功能。
* 不删除或重写历史固定支出付款流水。

## Technical Approach

* Add `deleteFixedExpense(data, fixedExpenseId)` in `lib/daily.ts`.
* Implement deletion as soft delete by setting `isActive: false`, preserving item metadata for historical rollback references.
* Update fixed expense list UI to show active items only.
* Add a trash/delete button beside each active fixed expense item with confirmation.

## Decision (ADR-lite)

**Context**: Fixed payment transactions store `fixedExpenseId`, so hard-deleting fixed expense metadata can weaken rollback/history behavior.

**Decision**: Use soft delete (`isActive: false`) and hide inactive fixed expenses from the management list.

**Consequences**: Deleted items no longer affect future reservations, while historical payment transactions remain intact.
