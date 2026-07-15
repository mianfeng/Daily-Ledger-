# 修复固定预留设置上限

## Goal

修复固定支出预留手动设置只能设置到当前可消费余额的问题。用户在可消费余额很低但缓冲金仍有余额时，应能把缓冲金转入固定预留。

## What I Know

* 固定预留输入框没有显式 `max` 限制。
* 当前 `adjustFixedReserved` 只用 `spendable + fixedReserved` 作为可移动总额。
* 当 `spendable` 为 9 且 `fixedReserved` 为 0 时，任何更大的输入都会被夹到 9。
* 固定预留属于可动用余额的一部分；可动用余额当前定义为 `spendable + buffer + fixedReserved`。

## Requirements

* 手动设置固定预留时，可从缓冲金转入固定预留。
* 设置固定预留不能凭空增加总金额。
* 固定预留减少时，释放金额回到本周可消费余额。
* 不动用储备金。

## Acceptance Criteria

* [x] 当可消费余额为 9、缓冲金足够时，固定预留可以设置为大于 9。
* [x] 固定预留增加时优先扣可消费余额，不足部分扣缓冲金。
* [x] 固定预留减少时差额回到可消费余额。
* [x] 固定预留设置上限为 `spendable + buffer + fixedReserved`。
* [x] `npm run build` passes.

## Technical Approach

* 修改 `adjustFixedReserved`：
  * 可移动总额从 `spendable + fixedReserved` 改为 `spendable + buffer + fixedReserved`。
  * 目标值夹到可移动总额。
  * 如果目标值增加，先消耗 `spendable`，再消耗 `buffer`。
  * 如果目标值减少，释放金额进入 `spendable`。
* 保持组件不直接操作 pocket 细节。
