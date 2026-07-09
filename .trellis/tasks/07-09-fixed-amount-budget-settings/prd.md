# 固定金额预算分配设置

## Goal

将生活预算设置中的储备比例、缓冲比例从百分比设置改为固定金额设置，并在设置界面显示固定预留，让主要收入分配流程更接近“先处理固定预留，再按固定金额进入缓冲/储备，剩余均分到预算周”的心智模型。

## What I Already Know

* 用户希望把设置里的“缓冲比例”和“储存/储备比例”改为固定数目设置。
* 用户希望固定预留也显示在设置里。
* 用户想确认当前流程是不是“先扣固定预留、缓冲、储存，然后均分到每周”。
* 用户确认储备固定金额和缓冲固定金额按每个预算周期设置。
* 用户确认主要收入不足时的削减优先级为：固定预留 → 储备固定金额 → 最低每周生活线 → 缓冲固定金额。
* 用户确认默认固定金额：储备 10000，缓冲 1500，每周最低生活线 500。
* 用户当前收入参考：基本工资 20000，绩效约 5000。
* 用户当前固定支出参考：房租 2900、网费 39、管理费 300、GPT 140、咖啡豆 100、话费 50，合计 3529。
* 用户确认绩效收入作为零散收入处理，不开启新预算周期。
* 用户确认绩效/零散收入沿用现有规则：先进缓冲金，缓冲金超过上限后进入储备金。
* 当前代码里设置字段是 `savingsRate` 和 `bufferRate`，均为比例。
* 当前新周期主要收入分配在 `lib/daily.ts` 的 `allocateIncome` 中：
  * 如果当前固定预留为 0，会先按固定支出清单自动预留固定支出。
  * 然后按 `savingsRate` 计算储备金存入。
  * 再按储备最低线缺口和 `reserveRecoveryRate` 计算储备补回。
  * 再预留最低每周生活线容量，剩余金额按 `bufferRate` 和预算周数量反推每周额度与起始缓冲金。
* 当前设置 UI 在 `components/DailyLedger.tsx` 中显示“储备比例 %”和“缓冲比例 %”，固定预留主要显示在固定支出面板和周期详情中。
* 当前固定预留规则已经是：主要收入开启新周期时，若 `fixedReserved` 为 0 才自动预留；已有固定预留时不会重复新增。

## Assumptions (Temporary)

* “储存比例”按上下文理解为“储备比例”。
* 固定金额设置应影响之后的新收入分配，不重算已经生成的预算周。
* 旧数据里的比例字段需要安全迁移到新的固定金额默认值，或者继续兼容读取。

## Open Questions

* None. User confirmed the final requirements.

## Requirements (Evolving)

* 设置界面将储备比例改为储备固定金额设置。
* 设置界面将缓冲比例改为缓冲固定金额设置。
* 储备固定金额和缓冲固定金额按每个预算周期应用，而不是按每周应用。
* 默认储备固定金额为 10000，默认缓冲固定金额为 1500，默认最低每周生活线为 500。
* 主要收入不足时，按固定预留、储备固定金额、最低每周生活线、缓冲固定金额的顺序分配；后面的项目在金额不足时削减。
* 绩效收入作为零散收入进入现有周期，不触发固定金额储备/缓冲分配，不开启新周期。
* 绩效/零散收入沿用现有零散收入规则：先进缓冲金，缓冲金超过上限后进入储备金。
* 设置界面展示当前固定预留余额。
* 主要收入开启新周期时，分配流程应清晰体现固定预留、储备、缓冲和每周预算的先后关系。
* 旧数据要能继续加载。

## Acceptance Criteria (Evolving)

* [ ] 设置里不再以百分比作为用户主要输入来设置储备/缓冲。
* [ ] 固定预留余额能在预算设置里看到。
* [ ] 新主要收入按确认后的固定金额规则分配。
* [ ] 已有旧数据加载时不会丢失设置或预算状态。
* [ ] `npm run build` passes.

## Definition of Done

* Build/typecheck passes through `npm run build`.
* Settings UI copy matches the new fixed-amount semantics.
* Budget calculation and rollback metadata remain compatible with existing transaction history.

## Out of Scope

* 不重做固定支出清单管理。
* 不改变大额支出扣款顺序。
* 不改变周结转和周期缓冲金 50/50 结转规则。

## Technical Notes

* Likely impacted files: `types.ts`, `lib/daily.ts`, `components/DailyLedger.tsx`, possibly `utils/excel.ts`.
* Current new-cycle allocation computes `fixedReserved`, `reserveDeposit`, `reserveRecovery`, `weeklyAllowance`, and `startingBuffer` in `allocateIncome`.
* Current within-cycle main income still uses proportional `savingsRate` / `bufferRate`; this may need a separate rule from new-cycle income.

## Technical Approach

* Add fixed amount settings `reserveFixedAmount` and `bufferFixedAmount`, defaulting to 10000 and 1500.
* Keep legacy `savingsRate` and `bufferRate` in the stored settings shape for backward compatibility, but remove them from the main settings UI.
* For a main income that opens a new cycle, allocate in this order:
  1. fixed expense reserve, only when current fixed reserve is zero
  2. reserve fixed amount
  3. minimum weekly living pool
  4. buffer fixed amount, capped by buffer cap with overflow to reserve
  5. remaining weekly pool distributed across budget weeks
* Treat main income entered inside an already-active cycle as extra spendable money, avoiding duplicate fixed-amount deductions.
* Show current fixed reserve in the budget settings panel.

## Decision (ADR-lite)

**Context**: Percentage settings made the income allocation hard to reason about and did not match the user's desired fixed monthly savings/buffer plan.

**Decision**: Move the user-facing setup to fixed cycle amounts while keeping old percentage fields as compatibility-only settings.

**Consequences**: New income allocation is easier to predict. Old stored data continues to load, but future UI and main-cycle allocation should use fixed amounts.
