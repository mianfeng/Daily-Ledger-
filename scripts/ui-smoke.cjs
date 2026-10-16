// Run against `npm run dev`. Install Playwright or set PLAYWRIGHT_MODULE to an existing package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const baseUrl = process.env.UI_TEST_URL || "http://127.0.0.1:3000";
const taskRoot = fs.existsSync(".trellis/tasks/10-16-kyoto-ui-interactions")
  ? ".trellis/tasks/10-16-kyoto-ui-interactions"
  : ".trellis/tasks/archive/2026-10/10-16-kyoto-ui-interactions";
const out = path.resolve(
  process.env.UI_QA_OUTPUT || path.join(taskRoot, "research/qa"),
);
fs.mkdirSync(out, { recursive: true });
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log("PASS", name);
};

let activeBrowser;
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  activeBrowser = browser;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => {
    errors.push(`Unexpected browser dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.clock.install({ time: new Date("2026-10-20T04:00:00Z") });
  await page.goto(baseUrl);
  const dialog = () => page.getByRole("dialog").last();
  const close = async () => {
    await dialog()
      .getByRole("button", { name: /^(关闭|返回)$/ })
      .click();
  };
  const ledger = () =>
    page.evaluate(() => ({
      daily: JSON.parse(localStorage.getItem("dailyBookData_v5")),
      copper: JSON.parse(localStorage.getItem("coinShopData_v5")),
    }));
  const clearDraft = async () => {
    await close();
    if (await page.getByRole("heading", { name: "放弃未保存输入？" }).count())
      await dialog()
        .getByRole("button", { name: "放弃输入", exact: true })
        .click();
  };
  await page.getByRole("heading", { name: "初始设置", exact: true }).waitFor();
  await page.getByLabel("当前可消费余额", { exact: true }).fill("1000");
  await page.getByLabel("当前缓冲金", { exact: true }).fill("1500");
  await page.getByLabel("当前储备金", { exact: true }).fill("20000");
  await page
    .getByRole("button", { name: "保存生活预算设置", exact: true })
    .click();
  await page.getByRole("heading", { name: "开始你的第一个预算周期" }).waitFor();
  assert.equal((await ledger()).daily.budget.initialized, true);
  record(
    "First-use initialization saves balances and returns to no-cycle state",
  );

  // All fixture data is fabricated and lives in an isolated browser context.
  await page.evaluate(async () => {
    const d = await import("/lib/daily.ts");
    const a = await import("/lib/appData.ts");
    const dates = await import("/lib/date.ts");
    const c = await import("/lib/copper.ts");
    const today = dates.getTodayDate();
    let daily = d.initializeLifeBudget(a.DEFAULT_DAILY_DATA, {
      spendable: 0,
      buffer: 1500,
      reserve: 20000,
      settings: {
        reserveFixedAmount: 1000,
        bufferFixedAmount: 1500,
        minimumWeeklyLiving: 500,
      },
    });
    daily = d.addFixedExpense(daily, {
      name: "演示房租",
      amount: 1200,
      dueDay: 25,
    });
    daily = d.allocateIncome(daily, {
      amount: 8000,
      date: today,
      desc: "演示工资",
      incomeKind: "main",
    });
    daily = d.recordExpense(daily, {
      amount: 38,
      date: today,
      desc: "演示午餐",
      category: "dining",
    });
    let copper = {
      ratios: { liquid: 70, reserve: 30 },
      balances: { liquid: 12920, reserve: 5540 },
      inventoryCost: 10000,
      transactions: [],
    };
    copper = c.applyCopperTransaction(
      copper,
      c.createCopperIncomeTransaction({
        amount: 480,
        cost: 320,
        date: today,
        desc: "演示铜钱套装",
        isPending: true,
        ratios: copper.ratios,
      }),
    );
    localStorage.setItem(a.DAILY_STORAGE_KEY, JSON.stringify(daily));
    localStorage.setItem(a.COPPER_STORAGE_KEY, JSON.stringify(copper));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".life-week-amount").waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.join(out, "daily-light.png"),
    fullPage: true,
  });
  assert.ok(await page.locator(".life-week-column.future").count());
  record("Generated cycle displays future budget weeks");

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await dialog().innerText(), /请输入支出金额/);
  await page.getByLabel("支出金额", { exact: true }).fill("38");
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, "expense-light.png") });
  const beforeExpense = await ledger();
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await ledger()).daily.budget.pockets.spendable,
    beforeExpense.daily.budget.pockets.spendable - 38,
  );
  record("Inline expense validation and normal expense deduction");

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("120");
  await page.getByRole("checkbox", { name: /未来开销/ }).check();
  const beforePrepaid = await ledger();
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const afterPrepaid = await ledger();
  assert.equal(
    afterPrepaid.daily.budget.pockets.buffer,
    beforePrepaid.daily.budget.pockets.buffer - 120,
  );
  assert.equal(
    afterPrepaid.daily.budget.pockets.spendable,
    beforePrepaid.daily.budget.pockets.spendable,
  );
  assert.equal(afterPrepaid.daily.transactions.at(-1).expenseTiming, "prepaid");
  record(
    "Prepaid expense preserves buffer funding and separate reporting date",
  );

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("9");
  await close();
  await page.getByRole("heading", { name: "放弃未保存输入？" }).waitFor();
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await dialog().evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(300);
  const footer = await page
    .getByRole("button", { name: "记录支出", exact: true })
    .boundingBox();
  assert.ok(footer && footer.y + footer.height <= 500 && footer.y >= 0);
  await clearDraft();
  await page.setViewportSize({ width: 390, height: 844 });
  record(
    "Dirty dismissal confirmation, focus trap and shortened viewport footer",
  );

  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog()
    .getByRole("button", { name: /查看提前支付/ })
    .first()
    .click();
  assert.equal(await page.getByRole("dialog").count(), 2);
  assert.match(await dialog().innerText(), /缓冲金/);
  assert.ok(await dialog().locator(".life-flow-calculation").count());
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, "flow-light.png") });
  await close();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await close();
  record("Nested immutable flow details return to history");

  await page.getByRole("button", { name: "固定支出", exact: true }).click();
  await dialog().getByRole("button", { name: "标记已付", exact: true }).click();
  await page.getByRole("heading", { name: "记录固定支出？" }).waitFor();
  await dialog()
    .getByRole("button", { name: "记录并标记已付", exact: true })
    .click();
  await page.getByRole("button", { name: "已支付", exact: true }).waitFor();
  assert.equal((await ledger()).daily.budget.pockets.fixedReserved, 0);
  await close();
  record("Fixed payment confirmation records a real expense");

  await page.getByRole("button", { name: "铜钱生意", exact: true }).click();
  const beforeConfirm = await ledger();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await dialog().getByRole("button", { name: "确认销售", exact: true }).click();
  const afterConfirm = await ledger();
  assert.deepEqual(afterConfirm.copper.balances, beforeConfirm.copper.balances);
  assert.equal(
    afterConfirm.copper.inventoryCost,
    beforeConfirm.copper.inventoryCost,
  );
  assert.equal(
    afterConfirm.copper.transactions.at(-1).confirmationStatus,
    "confirmed",
  );
  record("Confirming a pending sale does not double-book cash or inventory");

  await page.getByRole("button", { name: "记销售", exact: true }).click();
  await page.getByLabel("销售金额", { exact: true }).fill("100");
  await page.getByLabel("销售成本", { exact: true }).fill("60");
  await page.getByRole("button", { name: "记录销售", exact: true }).click();
  await page.getByRole("button", { name: "取消并回滚", exact: true }).click();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "显示已取消", exact: true }).click();
  assert.deepEqual(
    (await ledger()).copper.balances,
    afterConfirm.copper.balances,
  );
  const cancelled = page
    .locator(".business-recent li")
    .filter({ hasText: "已取消" });
  await cancelled.getByRole("button", { name: /删除/ }).click();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  assert.deepEqual(
    (await ledger()).copper.balances,
    afterConfirm.copper.balances,
  );
  record("Pending cancellation and cancelled-record deletion rollback once");

  await page.getByRole("button", { name: /月度经营汇总/ }).click();
  assert.ok(await dialog().locator(".business-month-card").count());
  await close();
  await page.getByRole("button", { name: "铜钱配置", exact: true }).click();
  await page.getByRole("button", { name: "夜间", exact: true }).click();
  await close();
  await page.screenshot({
    path: path.join(out, "business-dark.png"),
    fullPage: true,
  });
  record("Monthly cards and persisted dark theme");

  for (const size of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(size);
    for (const name of ["生活预算", "铜钱生意"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false, `Overflow on ${name} ${size.width}`);
      await page.screenshot({
        path: path.join(
          out,
          `${name === "生活预算" ? "daily" : "business"}-${size.width}-dark.png`,
        ),
      });
    }
  }
  record("360/390/430px root pages have no horizontal overflow");

  await page.getByRole("button", { name: "铜钱配置", exact: true }).click();
  const excelBefore = await ledger();
  const excelDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出铜钱生意", exact: true }).click();
  const exported = await excelDownload;
  await page
    .getByLabel("导入铜钱生意 Excel")
    .setInputFiles(await exported.path());
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /导入成功.*条流水/ })
    .waitFor();
  assert.deepEqual(
    (await ledger()).copper.balances,
    excelBefore.copper.balances,
  );
  // Existing copper Excel format omits IDs and regenerates them on import.
  const withoutIds = (rows) => rows.map(({ id, ...row }) => row);
  assert.deepEqual(
    withoutIds((await ledger()).copper.transactions),
    withoutIds(excelBefore.copper.transactions),
  );
  record(
    "Copper Excel roundtrip preserves ledger values and confirmation metadata (IDs regenerated by existing format)",
  );
  const backup = await ledger();
  await page.getByLabel("恢复整站 JSON 备份").setInputFiles({
    name: "fabricated-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        exportedAt: "2026-10-20T04:00:00Z",
        ...backup,
      }),
    ),
  });
  await page
    .getByRole("heading", { name: "恢复整站备份？", exact: true })
    .waitFor();
  assert.match(
    await dialog().innerText(),
    /生活预算与铜钱生意两个模块当前全部数据都会被覆盖/,
  );
  await dialog()
    .getByRole("button", { name: "覆盖并恢复", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "整站备份恢复成功" })
    .waitFor();
  assert.deepEqual((await ledger()).copper.balances, backup.copper.balances);
  await page.getByLabel("恢复整站 JSON 备份").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await page.getByRole("alert").waitFor();
  assert.deepEqual(
    (await ledger()).daily.budget.pockets,
    backup.daily.budget.pockets,
  );
  await close();
  record(
    "JSON restore clearly names both modules; invalid input preserves balances",
  );

  await page.getByRole("button", { name: "生活预算", exact: true }).click();
  await page.getByRole("button", { name: "预算设置", exact: true }).click();
  const dailyExcelBefore = await ledger();
  const dailyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出生活预算", exact: true }).click();
  const dailyExport = await dailyDownload;
  await page
    .getByLabel("导入生活预算 Excel")
    .setInputFiles(await dailyExport.path());
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /导入成功.*条记录/ })
    .waitFor();
  assert.deepEqual(
    (await ledger()).daily.budget,
    dailyExcelBefore.daily.budget,
  );
  assert.deepEqual(
    (await ledger()).daily.transactions,
    dailyExcelBefore.daily.transactions,
  );
  await close();
  record(
    "Daily Excel roundtrip preserves pockets, cycles, allocation and snapshots",
  );

  // Settings inputs remain drafts until Save; already saved forms close without an extra warning.
  await page.getByRole("button", { name: "预算设置", exact: true }).click();
  const settingsBefore = await ledger();
  await page.getByLabel("储备金最低线覆盖", { exact: true }).fill("2345");
  assert.deepEqual(
    (await ledger()).daily.budget.settings,
    settingsBefore.daily.budget.settings,
  );
  await page
    .getByRole("button", { name: "保存生活预算设置", exact: true })
    .click();
  assert.equal(
    (await ledger()).daily.budget.settings.reserveMinimumOverride,
    2345,
  );
  await close();
  assert.equal(await page.getByRole("dialog").count(), 0);
  record("Settings drafts commit on Save and then close without dirty warning");

  const cycleBefore = (await ledger()).daily.budget.currentCycle.id;
  await page.getByRole("button", { name: "收入分配", exact: true }).click();
  await dialog().getByRole("button", { name: "零散收入", exact: true }).click();
  await page.getByLabel("金额", { exact: true }).fill("50");
  await page.getByRole("button", { name: "确认分配", exact: true }).click();
  assert.equal((await ledger()).daily.budget.currentCycle.id, cycleBefore);
  record("Casual income preserves the current cycle");

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("50000");
  await dialog().getByRole("button", { name: "大额", exact: true }).click();
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog()
    .getByRole("button", { name: /查看大额/ })
    .first()
    .click();
  assert.match(await dialog().innerText(), /未被任何口袋覆盖/);
  assert.ok(await dialog().locator(".life-flow-gap").count());
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, "funding-gap.png") });
  await close();
  await close();
  record(
    "Insufficient-money confirmation exposes the actual uncovered funding gap",
  );

  // Older records with allocations but no snapshots and more than 20 history rows.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("dailyBookData_v5"));
    const sample = d.transactions.find(
      (t) => t.type === "expense" && t.category === "dining",
    );
    d.transactions = Array.from({ length: 25 }, (_, i) => {
      const row = { ...sample, id: 90000 + i, desc: `演示旧记录 ${i}` };
      delete row.balanceBefore;
      delete row.balanceAfter;
      return row;
    });
    localStorage.setItem("dailyBookData_v5", JSON.stringify(d));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "生活预算", exact: true }).click();
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  assert.equal(await dialog().locator(".life-event-row").count(), 20);
  await page.getByRole("button", { name: /加载更多/ }).click();
  assert.equal(await dialog().locator(".life-event-row").count(), 25);
  await dialog()
    .getByRole("button", { name: /查看外食/ })
    .first()
    .click();
  assert.equal(await dialog().locator(".life-flow-calculation").count(), 0);
  assert.match(await dialog().innerText(), /不显示「原余额/);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(out, "legacy-flow.png") });
  await close();
  await close();
  record("20-row pagination and legacy snapshot fallback");

  await page.evaluate(async (fixture) => {
    const d = await import("/lib/daily.ts");
    const dates = await import("/lib/date.ts");
    let daily = structuredClone(fixture.daily);
    daily.budget.pockets.reserve = 100;
    daily.budget.pockets.buffer = 0;
    daily = d.recordExpense(daily, {
      amount: 5000,
      category: "daily",
      date: dates.getTodayDate(),
      desc: "演示超支",
    });
    localStorage.setItem("dailyBookData_v5", JSON.stringify(daily));
  }, backup);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/本周超支/).waitFor();
  assert.ok(await page.locator(".life-week-amount.is-over").count());
  assert.match(await page.locator(".status-dashboard").innerText(), /储备缺口/);
  await page.screenshot({ path: path.join(out, "overspent-reserve-gap.png") });
  record("Overspending, low buffer and reserve-gap presentation");

  await page.evaluate(async () => {
    const d = await import("/lib/daily.ts");
    const a = await import("/lib/appData.ts");
    let daily = d.initializeLifeBudget(a.DEFAULT_DAILY_DATA, {
      spendable: 0,
      buffer: 100,
      reserve: 20000,
      settings: {
        reserveFixedAmount: 1000,
        bufferFixedAmount: 100,
        minimumWeeklyLiving: 100,
      },
    });
    daily = d.allocateIncome(daily, {
      amount: 5000,
      date: "2026-09-20",
      incomeKind: "main",
      desc: "演示上期收入",
    });
    localStorage.setItem("dailyBookData_v5", JSON.stringify(daily));
    localStorage.setItem(
      "coinShopData_v5",
      JSON.stringify({
        ratios: { liquid: 60, reserve: 40 },
        balances: { liquid: 1000, reserve: 0 },
        inventoryCost: 2000,
        transactions: [],
      }),
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /周期.*延长期/ }).waitFor();
  await page.getByRole("button", { name: "固定支出", exact: true }).click();
  assert.match(await dialog().innerText(), /暂无固定支出/);
  await close();
  await page.getByRole("button", { name: "铜钱生意", exact: true }).click();
  assert.match(await page.locator(".business-recent").innerText(), /暂无记录/);
  await page.getByRole("button", { name: "记销售", exact: true }).click();
  await page.getByLabel("销售金额", { exact: true }).fill("20");
  await page.getByLabel("销售成本", { exact: true }).fill("30");
  await page.getByRole("button", { name: "记录销售", exact: true }).click();
  assert.match(
    await page.locator(".business-recent").innerText(),
    /利润 −¥10.00/,
  );
  await page.screenshot({
    path: path.join(out, "loss-sale-dark.png"),
    fullPage: true,
  });
  record("Extended cycle, empty fixed/items and negative-profit sale");

  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("coinShopData_v5"));
    c.transactions[0].date = "2026-10-01";
    c.transactions.push({
      id: 42,
      type: "income",
      date: "2026-10-20",
      amount: 10,
      desc: "演示历史锁定",
    });
    localStorage.setItem("coinShopData_v5", JSON.stringify(c));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "铜钱生意", exact: true }).click();
  assert.equal(
    (await ledger()).copper.transactions[0].confirmationStatus,
    "confirmed",
  );
  const lockedRow = page
    .locator(".business-recent li")
    .filter({ hasText: "演示历史锁定" });
  assert.equal(
    await lockedRow.getByRole("button", { name: /删除/ }).count(),
    0,
  );
  record("Overdue pending auto-confirm and locked legacy delete protection");
  assert.deepEqual(errors, []);
  record("No runtime exceptions or native alert/confirm dialogs");
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await activeBrowser?.close();
  process.exitCode = 1;
});
