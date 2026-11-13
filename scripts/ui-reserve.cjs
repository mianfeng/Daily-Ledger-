// Fabricated data in an isolated browser; run against the Vite dev server.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const out = process.env.UI_QA_OUTPUT || path.join(require("node:os").tmpdir(), "daily-ledger-reserve-qa");
fs.mkdirSync(out, { recursive: true });
let browser;
(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-11-13T04:00:00Z") });
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:3000");
  const checks = await page.evaluate(async () => {
    const d = await import("/lib/daily.ts");
    const a = await import("/lib/appData.ts");
    const same = (actual, expected, name) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    };
    const base = d.initializeLifeBudget(a.DEFAULT_DAILY_DATA, {
      spendable: 0, buffer: 3000, reserve: 20000,
      settings: { reserveFixedAmount: 1000, bufferFixedAmount: 1500, minimumWeeklyLiving: 500 },
    });
    const main = { amount: 8000, date: "2026-11-13", desc: "测试工资", incomeKind: "main" };
    const first = d.allocateIncome(base, main);
    same(first.budget.pockets.buffer, 4500, "Keep initialized buffer on first income");
    const second = d.allocateIncome(first, main);
    same(second.budget.pockets.buffer, 6000, "Keep previous cycle buffer");
    same(second.budget.pockets.reserve, 22000, "No 40% reserve transfer");
    same(second.transactions.filter(t => t.transferKind === "cycleRollover").length, 0, "No new cycle transfer");
    same(d.deleteDailyTransaction(second, second.transactions.at(-1).id).budget.pockets, first.budget.pockets, "Undo cycle-opening income");
    const third = d.allocateIncome(second, main);
    same(third.budget.pockets.buffer, 6000, "Buffer cap preserved");
    same(third.budget.pockets.reserve, 24500, "Overflow still goes to reserve");
    const rollover = d.applyDueBudgetRollovers(first, "2026-11-20");
    const weekly = rollover.transactions.find(t => t.transferKind === "weeklyRollover");
    same(weekly.allocation.reserve, Math.round(weekly.amount * 0.4 * 100) / 100, "Weekly 40% rule unchanged");
    same(weekly.allocation.buffer, Math.round(weekly.amount * 0.6 * 100) / 100, "Weekly buffer allocation unchanged");
    const deposit = { amount: 1234.56, date: "2026-11-13", desc: "公积金提取", incomeKind: "reserve" };
    for (const original of [base, first]) {
      const added = d.allocateIncome(original, deposit);
      same(added.budget.pockets, { ...original.budget.pockets, reserve: original.budget.pockets.reserve + 1234.56 }, "Deposit affects reserve only");
      same(added.budget.currentCycle, original.budget.currentCycle, "Deposit does not open/change cycle");
      const tx = added.transactions.at(-1);
      same(tx.balanceBefore.reserve, original.budget.pockets.reserve, "Before snapshot");
      same(tx.balanceAfter.reserve, added.budget.pockets.reserve, "After snapshot");
      same(d.deleteDailyTransaction(added, tx.id).budget.pockets, original.budget.pockets, "Deposit deletion rollback");
      const restored = a.sanitizeBackup(JSON.parse(JSON.stringify({ daily: added, copper: a.DEFAULT_COPPER_DATA }))).daily;
      same(restored.transactions.at(-1).incomeKind, "reserve", "JSON backup kind preserved");
      same(restored.budget.pockets, added.budget.pockets, "JSON backup balances preserved");
    }
    const added = d.allocateIncome(first, deposit);
    const before = d.getBudgetCycleSummaries(first)[0];
    const after = d.getBudgetCycleSummaries(added)[0];
    same(after.reserveChange, before.reserveChange + 1234.56, "Cycle reserve growth includes deposit");
    same(after.budget, before.budget, "Deposit does not increase daily budget");
    const legacy = { id: 123, type: "transfer", date: "2026-11-13", amount: 100, desc: "旧周期结转", transferKind: "cycleRollover", allocation: { week: 0, buffer: -100, advance: 0, reserve: 100, fixed: 0 } };
    const old = d.sanitizeDailyData({ ...first, transactions: [...first.transactions, legacy] }, a.DEFAULT_DAILY_DATA);
    same(old.transactions.at(-1).transferKind, "cycleRollover", "Historical transfer preserved");
    localStorage.setItem(a.DAILY_STORAGE_KEY, JSON.stringify(first));
    localStorage.setItem(a.COPPER_STORAGE_KEY, JSON.stringify(a.DEFAULT_COPPER_DATA));
    return "Cycle preservation, cap, weekly rollover, reserve income, snapshots, rollback, summaries and JSON compatibility";
  });
  console.log("PASS", checks);
  await page.reload();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("dailyBookData_v5")));
  const before = await stored();
  await page.getByRole("button", { name: "收入分配", exact: true }).click();
  const dialog = () => page.getByRole("dialog").last();
  await dialog().getByRole("button", { name: "存入储备金", exact: true }).click();
  await page.getByLabel("金额", { exact: true }).fill("1000+234.56");
  await page.getByLabel("备注", { exact: true }).fill("公积金提取");
  for (const [width, height] of [[360, 780], [390, 500], [430, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await dialog().getByRole("button", { name: "确认存入", exact: true }).isVisible(), true);
    await page.screenshot({ path: path.join(out, `reserve-${width}x${height}.png`) });
  }
  await dialog().getByRole("button", { name: "确认存入", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const added = await stored();
  assert.equal(added.budget.pockets.reserve, before.budget.pockets.reserve + 1234.56);
  assert.equal(added.transactions.at(-1).incomeKind, "reserve");
  await page.reload();
  assert.equal((await stored()).transactions.at(-1).incomeKind, "reserve");
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(async () => {
    const e = await import("/utils/excel.ts");
    e.exportDailyToExcel(JSON.parse(localStorage.getItem("dailyBookData_v5")), 2026, 11);
  });
  const download = await downloadPromise;
  const file = path.join(out, "reserve-backup.xlsx");
  await download.saveAs(file);
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(file);
  const restored = await page.evaluate(async workbook => {
    const e = await import("/utils/excel.ts");
    const a = await import("/lib/appData.ts");
    return e.parseDailyImportWorkbook(workbook, a.DEFAULT_DAILY_DATA);
  }, workbook);
  assert.deepEqual(restored.budget.pockets, added.budget.pockets);
  assert.equal(restored.transactions.at(-1).incomeKind, "reserve");
  await page.getByRole("button", { name: "全部流水", exact: true }).click();
  await dialog().getByRole("button", { name: "更多操作 公积金提取", exact: true }).click();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  assert.deepEqual((await stored()).budget.pockets, before.budget.pockets);
  assert.deepEqual(errors, []);
  console.log("PASS UI deposit, mobile layouts, persistence, Excel roundtrip and deletion");
  await browser.close();
})().catch(async error => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
