# Redesign Daily Ledger Into Life Budget

## Goal

Replace the current daily-limit ledger with a low-pressure life budget flow. The user should not need to record every day, but should always know:

- how much is left in the current budget week
- whether the buffer can absorb small overspending
- whether reserve money is growing or needs recovery

## Product Scope

### In Scope

- Rename the daily ledger surface to `生活预算`.
- Use virtual money pockets, not payment accounts:
  - `本预算周`
  - `缓冲金`
  - `储备金`
  - `固定支出预留`
- Provide four main actions:
  - `记支出`
  - `收入分配`
  - `余额校准`
  - `固定支出`
- Keep state owned by `App.tsx`; feature components receive state and setters.
- Keep static frontend/localStorage deployment. Do not add backend, login, cookies, server API, or environment variables.
- Preserve legacy daily transactions and allow old data to load.
- Keep Excel import/export available but visually de-emphasized.

### Out of Scope

- Account-level bookkeeping for WeChat, Alipay, bank cards, etc.
- Multi-goal savings.
- Complex charts.
- Daily reminders or daily streak mechanics.

## Budget Rules

- A budget cycle starts when the user records a `主要收入` and chooses/uses the new-cycle flow.
- Expected payday is only a reminder; no new cycle starts until income is recorded.
- A second `主要收入` in the same cycle is merged into the current cycle by default.
- Budget weeks start from the cycle start date and run in 7-day blocks. A final short week uses prorated allowance by day count.
- Income types:
  - `主要收入`: runs full allocation.
  - `零散收入`: goes to buffer by default.
  - `退款报销`: offsets spending and is not counted as real income.
- Allocation priority:
  1. fixed expense reserve
  2. reserve deposit
  3. reserve recovery
  4. cycle spending money
  5. starting buffer
- Savings rate is adjustable, default `20%`.
- Starting buffer defaults to `20%` of weekly allowance.
- Weekly leftover defaults to `70%` reserve and `30%` buffer.
- Reserve minimum defaults to `fixed expenses + 2 weeks of living money`, with manual override.
- If reserve is below minimum, recovery plan defaults to an extra `10%` of main income per new cycle.
- Recovery must not push weekly allowance below the configured minimum weekly living line.

## Spending Rules

- Expense categories:
  - `日常`
  - `外食/外卖`
  - `其他`
  - `计划外`
  - `大额`
- Normal expenses draw automatically from:
  1. current budget week
  2. buffer
  3. next-week advance
  4. reserve, only after confirmation in final-week or insufficient-funds cases
- `计划外` is a normal expense marker and supports optional notes.
- `大额` does not reduce current-week allowance. It affects reserve and reserve recovery.
- Large expense trigger:
  - above `50%` of current weekly allowance: prompt/recommend large-expense handling
  - above `1000`: default large expense
- Large expense feedback must show reserve after purchase, whether it is below minimum, and the recovery gap.

## Calibration And Review

- Balance calibration asks for only one number: `当前可消费余额`.
- Book available balance is `current week remaining + buffer balance`.
- If actual is lower, create `未记录支出`.
- If actual is higher, create `余额修正` into buffer and do not count it as income.
- Fixed expenses do not participate in balance calibration.
- Fixed expenses are generated/kept as `待支付`; only manual `已支付` marks them as actual spending.
- Cycle review is numeric only. Do not ask for feelings, summaries, or notes.
- Main review metric is `储备金净变化`.
- History is de-emphasized: show recent key events by default, not a full bookkeeping-first ledger.

## UX Direction

- Mobile-first.
- First-screen priority:
  1. `本预算周` as the largest block, emphasizing remaining allowance.
  2. `缓冲金` as the second strongest block.
  3. `储备金` and `待处理` as secondary blocks.
- Morandi-inspired low-saturation palette:
  - mist blue for plans and budget
  - sage green for positive reserve/completion
  - terracotta red for overspending/reserve risk
  - warm amber for reminders/advance spending
  - warm stone gray for background, borders, and explanatory text
- Avoid daily-streak language, daily-compliance rewards, and daily pressure.

## Compatibility

- Existing `DailyData` payloads with `dailyLimit` and `transactions` must sanitize successfully.
- New fields should have defaults so existing localStorage and backups keep loading.
- Whole-site JSON backup shape remains versioned and includes `daily`.

## Acceptance Criteria

- `npm run build` succeeds.
- Existing local daily data still opens without crashing.
- New user can initialize budget settings and balances.
- Main income allocation creates a usable current cycle and budget week.
- Normal expenses reduce week/buffer/advance in the expected order.
- Large expenses affect reserve without reducing current-week allowance.
- Balance calibration creates missing spending or buffer correction.
- Fixed expenses can be marked paid and appear in review.
- Mobile first screen makes `本预算周` and `缓冲金` visually dominant.
