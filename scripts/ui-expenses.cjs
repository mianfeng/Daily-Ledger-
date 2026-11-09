// Fabricated ledger only; never connects to the user's browser profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const out =
  process.env.UI_QA_OUTPUT ||
  path.join(require("node:os").tmpdir(), "daily-ledger-expense-qa");
fs.mkdirSync(out, { recursive: true });
let browser;
(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-11-09T04:00:00Z") });
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:3000");
  const checks = await page.evaluate(async () => {
    const { getExpenseDays, getExpenseMonths } =
      await import("/lib/dailyExpenses.ts");
    const tx = (id, date, amount, extra = {}) => ({
      id,
      date,
      amount,
      type: "expense",
      desc: `测试${id}`,
      ...extra,
    });
    const days = getExpenseDays([
      tx(1, "2026-11-01", 0.1),
      tx(2, "2026-11-01", 0.2),
      tx(3, "2026-10-31", 120, {
        expenseTiming: "prepaid",
        effectiveDate: "2026-11-02",
      }),
      tx(4, "2026-11-01", 1000, { type: "income", incomeKind: "refund" }),
      tx(5, "2026-11-01", 500, { type: "transfer" }),
      tx(6, "2026-11-02", 30, { category: "fixed" }),
      tx(7, "2026-11-02", 40, { category: "unrecorded" }),
      tx(8, "2026-12-02", 20),
      tx(9, "2025-12-31", 10),
    ]);
    const months = getExpenseMonths(days, 2026, "2026-11-09");
    return {
      days,
      months,
      oldYear: getExpenseMonths(days, 2025, "2026-11-09"),
      future: getExpenseMonths([], 2027, "2026-11-09"),
    };
  });
  assert.equal(checks.days.find((d) => d.date === "2026-11-01").cents, 30);
  assert.equal(
    checks.days.find((d) => d.date === "2026-11-01").transactions.length,
    2,
  );
  assert.equal(checks.months[9].amount, 120);
  assert.equal(checks.months[10].amount, 70.3);
  assert.equal(checks.months[11].amount, 20); // Future records must not be hidden.
  assert.equal(checks.months[0].amount, 0);
  assert.equal(checks.oldYear[11].amount, 10);
  assert.ok(checks.future.every((m) => m.amount === null));
  assert.equal(checks.days[0].date, "2026-12-02");
  console.log(
    "PASS cents, all expense categories, payment dates, excluded income/transfers, year boundaries and future months",
  );

  await page.evaluate(async () => {
    const d = await import("/lib/daily.ts");
    const a = await import("/lib/appData.ts");
    let data = d.initializeLifeBudget(a.DEFAULT_DAILY_DATA, {
      spendable: 10000,
      buffer: 1000,
      reserve: 20000,
    });
    data = d.allocateIncome(data, {
      amount: 8000,
      date: "2026-10-15",
      incomeKind: "main",
      desc: "测试工资",
    });
    for (let day = 1; day <= 9; day++)
      data = d.recordExpense(data, {
        amount: day,
        date: `2026-11-${String(day).padStart(2, "0")}`,
        category: "daily",
        desc: `测试消费${day}`,
      });
    data = d.recordExpense(data, {
      amount: 120,
      date: "2026-10-31",
      effectiveDate: "2026-11-10",
      expenseTiming: "prepaid",
      category: "other",
      desc: "跨月提前支付",
    });
    localStorage.setItem(a.DAILY_STORAGE_KEY, JSON.stringify(data));
  });
  await page.reload();
  const rootDays = page
    .locator(".expense-summary")
    .first()
    .locator(".expense-day");
  assert.equal(await rootDays.count(), 7);
  assert.match(
    await rootDays.first().innerText(),
    /2026\/11\/9.*1 笔支出.*¥9.00/s,
  );
  const chart = page.getByRole("region", { name: "月度支出统计" });
  assert.match(await chart.locator(".expense-total").innerText(), /¥165.00/);
  await chart.locator("summary").click();
  assert.match(await chart.locator("dl > div").nth(9).innerText(), /¥120.00/);
  assert.match(await chart.locator("dl > div").nth(10).innerText(), /¥45.00/);
  assert.match(await chart.locator("dl > div").nth(11).innerText(), /—/);
  await chart.getByRole("button", { name: "上一年" }).click();
  assert.match(await chart.locator(".expense-total").innerText(), /¥0.00/);
  await chart.getByRole("button", { name: "下一年" }).click();

  const dialog = () => page.getByRole("dialog").last();
  const close = () =>
    dialog().getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  assert.equal(await dialog().locator(".expense-day").count(), 9);
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2026-11",
  );
  await dialog().getByRole("button", { name: "上个月" }).click();
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2026-10",
  );
  assert.match(await dialog().locator(".expense-total").innerText(), /¥120.00/);
  await dialog()
    .getByRole("button", { name: /查看 2026-10-31/ })
    .click();
  assert.match(await dialog().innerText(), /跨月提前支付/);
  await close();
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2026-10",
  );
  await dialog().getByRole("button", { name: "下个月" }).click();
  const scroll = dialog().locator(".ui-dialog-scroll");
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const beforeScroll = await scroll.evaluate((node) => node.scrollTop);
  await dialog()
    .getByRole("button", { name: /查看 2026-11-01/ })
    .click();
  assert.equal(await page.getByRole("dialog").count(), 2);
  assert.match(
    await dialog().locator(".expense-detail-summary").innerText(),
    /¥1.00/,
  );
  await page.waitForTimeout(250); // Let the shared page-in animation settle for visual QA.
  await page.screenshot({ path: path.join(out, "expense-day.png") });
  await dialog()
    .getByRole("button", { name: /资金流向/ })
    .click();
  assert.equal(await page.getByRole("dialog").count(), 3);
  await page.goBack();
  await page.getByRole("heading", { name: "当天支出明细" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 2);
  await close();
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2026-11",
  );
  assert.ok(
    Math.abs((await scroll.evaluate((node) => node.scrollTop)) - beforeScroll) <
      2,
  );
  console.log(
    "PASS seven latest dates, month browsing, nested detail, browser back and scroll retention",
  );

  await dialog()
    .getByRole("button", { name: /查看 2026-11-01/ })
    .click();
  await dialog()
    .getByRole("button", { name: /资金流向/ })
    .click();
  await dialog()
    .getByRole("button", { name: /删除这笔记录/ })
    .click();
  await page.getByRole("heading", { name: /删除/ }).waitFor();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("heading", { name: "当天支出明细" }).waitFor();
  assert.match(await dialog().innerText(), /这一天已无支出记录/);
  await close();
  assert.equal(await dialog().locator(".expense-day").count(), 8);
  assert.match(await dialog().locator(".expense-total").innerText(), /¥44.00/);
  await close();
  assert.match(await chart.locator(".expense-total").innerText(), /¥164.00/);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("dailyBookData_v5")),
  );
  assert.ok(!stored.transactions.some((t) => t.desc === "测试消费1"));
  console.log(
    "PASS deletion refreshes day, month and year totals and removes empty dates",
  );

  // Click the actual chart; it must reveal a value without opening navigation.
  await chart.locator(".recharts-bar-rectangle").first().click({ force: true });
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.match(
    await chart.locator(".recharts-tooltip-wrapper").innerText(),
    /¥120.00/,
  );
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: path.join(out, `expenses-${width}.png`) });
  }
  await page.getByRole("button", { name: "预算设置", exact: true }).click();
  await page.getByRole("button", { name: "夜间", exact: true }).click();
  await close();
  await page.setViewportSize({ width: 390, height: 500 });
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "expenses-dark-short.png") });
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog().getByLabel("选择支出月份").fill("2026-01");
  await dialog().getByRole("button", { name: "上个月" }).click();
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2025-12",
  );
  assert.match(await dialog().innerText(), /这个月暂无支出/);
  await dialog().getByRole("button", { name: "下个月" }).click();
  assert.equal(
    await dialog().getByLabel("选择支出月份").inputValue(),
    "2026-01",
  );
  await close();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("dailyBookData_v5"));
    data.transactions = [];
    localStorage.setItem("dailyBookData_v5", JSON.stringify(data));
  });
  await page.reload();
  assert.match(
    await page.locator(".expense-summary").first().innerText(),
    /暂无支出/,
  );
  assert.equal(await page.locator(".expense-day").count(), 0);
  console.log("PASS empty ledger/month and December-January navigation");
  assert.deepEqual(errors, []);
  console.log(
    "PASS chart click, mobile widths, dark short viewport and no runtime errors",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exit(1);
});
