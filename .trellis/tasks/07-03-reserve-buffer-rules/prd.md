# 储备金目标与缓冲金机制调整

## Goal

调整生活预算里的储备金与缓冲金机制：储备金展示从单纯余额改为“当前储备金 / 攒钱目标”，目标可在设置中维护；大额消费改为优先从缓冲金扣；每周与月度/周期结余按 50% 进入缓冲金、50% 进入储备金的规则沉淀，并引入缓冲金上限 6000，超出部分进入储备金。

## What I Already Know

* 用户希望“储备金那一栏”显示为 `x/A`，其中 `A` 是攒钱目标。
* 攒钱目标需要能在设置中设置。
* 大额消费需要从“缓存金/缓冲金”里扣。
* 用户描述的新机制：每周余额 50% 进入本月缓冲金，50% 进入储备金；本月缓冲金余额 50% 进入下月缓冲金，50% 进入储备金。
* 用户确认上限 6000 指的是缓冲金上限：缓冲金超过 6000 的部分进入储备金。
* 用户确认“本月/下月”按预算周期理解：从一次主要收入开始，到下一次主要收入前结束。
* 用户确认每周余额应在进入下一周时自动结转：已结束预算周的未花完余额按 50% 进入本周期缓冲金、50% 进入储备金，并且同一周只能结转一次。
* 用户确认自动结转需要显示为系统流水，方便追踪缓冲金/储备金变化。
* 用户确认储备金目标只用于 `x/A` 进度展示，不参与收入分配、补回或提醒逻辑；旧的储备金最低线逻辑继续保留。
* 用户确认储备金目标默认值为 50000。
* 用户确认周期缓冲金结转在下一次主要收入开启新预算周期时执行。
* 用户确认大额支出扣款顺序为：缓冲金优先，不足部分从当前可消费余额扣，不动储备金。
* 用户确认周自动结转按“到下周第一天后首次打开生活预算页时补做结转”执行；流水日期记为下一周第一天。
* 用户确认自动结转是钱袋内部转移，只显示为“系统结转”，不计入收入/支出统计。
* 当前代码中大额支出 `category === 'large'` 在 `lib/daily.ts` 优先扣 `budget.pockets.reserve`，不会扣缓冲金。
* 当前设置结构 `LifeBudgetSettings` 已有 `savingsRate`、`bufferRate`、`reserveRecoveryRate`、`weeklyRolloverReserveRate`、`reserveMinimumOverride` 等字段，但 UI 只暴露了储备比例、缓冲比例、最低每周生活线、储备金最低线覆盖。
* 当前储备金概览在 `components/DailyLedger.tsx` 的设置面板中展示储备金余额、最低线、净变化、缺口；主周期卡片中也有“储备金”余额展示。

## Assumptions (Temporary)

* “缓存金”按上下文理解为“缓冲金”。
* `x/A` 的 `x` 是当前储备金余额，`A` 是设置中的储备金目标。
* 新的储备金目标用于 `x/A` 展示；当前“储备金最低线”概念是否保留待确认。
* “本月”对应当前代码中的预算周期 `BudgetCycle`，而不是自然月。

## Open Questions

* None. User confirmed the final requirements.

## Requirements (Evolving)

* 设置里可以维护储备金攒钱目标。
* 储备金攒钱目标默认值为 50000。
* 储备金展示应包含当前余额和目标值，例如 `1234/6000`。
* 大额消费应优先从缓冲金扣除，缓冲金不足部分从当前可消费余额扣除，不扣储备金。
* 周余额结转规则目标为 50% 缓冲金、50% 储备金。
* 周期/月度缓冲金结转规则目标为 50% 留到下月缓冲金、50% 进入储备金。
* 缓冲金上限为 6000；分配或结转后超过 6000 的缓冲金溢出部分进入储备金。
* “本月/下月”结转按预算周期执行，不按自然月执行。
* 到下一周第一天后，首次打开生活预算页时自动补做已结束预算周的余额结转；同一周不能重复结转。
* 周结转流水日期记为下一周第一天，即实际应结算的日期，而不是用户打开页面的日期。
* 自动结转流水应作为单独的系统结转/内部转移记录展示，不计入收入或支出统计。
* 自动结转应创建可见系统流水，例如“第 N 周余额结转”，记录进入缓冲金和储备金的金额。
* 储备金目标只负责展示进度，不改变当前储备金最低线、缺口、补回逻辑。
* 下一次主要收入开启新预算周期时，上一周期缓冲金余额按 50% 进入新周期缓冲金、50% 进入储备金。

## Technical Approach

* Extend life budget settings with `reserveGoal` defaulting to `50000` and `bufferCap` defaulting to `6000`.
* Add a system-transfer transaction category for automatic rollovers so they are visible in history but excluded from income/expense and spending summaries.
* Track weekly rollover completion per budget cycle/week so opening the page after a week boundary can create each rollover once.
* Apply buffer-cap overflow through shared allocation logic: whenever money is allocated to buffer, cap buffer at `bufferCap` and move overflow to reserve.
* Change large-expense allocation to deduct from buffer first and spendable second, never reserve.
* When a main income opens a new cycle, split the previous cycle buffer balance 50/50 into new cycle buffer and reserve before applying the new cycle allocation.

## Decision (ADR-lite)

**Context**: The feature changes persisted budget settings and automatic money movement, so the behavior must remain traceable and backward-compatible.

**Decision**: Store the reserve goal as display-only settings, represent automatic rollovers as visible system-transfer transactions, and keep existing reserve minimum/shortfall logic unchanged.

**Consequences**: Users can audit automatic changes in the record list without polluting income/expense totals. The implementation must carefully exclude system transfers from spending summaries and avoid duplicate rollover creation.

## Acceptance Criteria (Evolving)

* [ ] 设置面板能设置并保存储备金目标。
* [ ] 缓冲金上限 6000 生效，超出部分转入储备金。
* [ ] 储备金相关展示能显示当前储备金 / 目标值。
* [ ] 大额支出记录后优先减少缓冲金，缓冲金不足部分减少当前可消费余额，不减少储备金。
* [ ] 新结转机制在进入下一周时自动执行，并有明确、可测试的分配结果。
* [ ] 同一预算周的余额不会被重复结转。
* [ ] 自动结转在最近流水/历史流水中可追踪。
* [ ] 自动结转不污染收入、支出、周消费、周期消费统计。
* [ ] 旧数据在没有新设置字段时能使用安全默认值。

## Definition of Done

* Tests added/updated where appropriate, or build/typecheck verifies the behavior in this repo's current test setup.
* `npm run build` passes.
* Import/export or persisted local data compatibility is handled if settings schema changes.
* Settings copy and affected UI labels reflect the new meaning.

## Out of Scope (Explicit)

* 不重做整个生活预算 UI。
* 不改变铜钱小店模块。
* 不改变固定支出、提前支付的核心语义，除非它们与缓冲金/储备金扣款顺序直接冲突。

## Technical Notes

* Likely impacted files: `types.ts`, `lib/daily.ts`, `components/DailyLedger.tsx`, possibly `utils/excel.ts` for backup/import/export compatibility.
* Current defaults are in `DEFAULT_LIFE_BUDGET_SETTINGS` in `lib/daily.ts`.
* Current large expense allocation in `recordExpense` deducts from reserve only.
* 生活预算 Excel 导出包含“完整状态”JSON，新的 budget 设置会随完整状态保存；本任务主要需要更新 sanitize/default 逻辑，旧版明细导入可继续回退到默认 budget。
* There is no separate test script in `package.json`; available verification is currently `npm run build`.

