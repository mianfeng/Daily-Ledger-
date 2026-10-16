// New UI behaviors, tested with fabricated data in an isolated browser context.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const task = fs.existsSync(".trellis/tasks/10-16-kyoto-ui-interactions")
  ? ".trellis/tasks/10-16-kyoto-ui-interactions"
  : ".trellis/tasks/archive/2026-10/10-16-kyoto-ui-interactions";
const out = path.resolve(
  process.env.UI_QA_OUTPUT || `${task}/research/interactions`,
);
fs.mkdirSync(out, { recursive: true });
let browser;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
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
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    errors.push(d.message());
    void d.dismiss();
  });
  await page.clock.install({ time: new Date("2026-10-20T04:00:00Z") });
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:3000");
  await page.getByRole("heading", { name: "初始设置", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    const a = await import("/lib/appData.ts");
    const d = await import("/lib/daily.ts");
    const c = await import("/lib/copper.ts");
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
    daily = d.allocateIncome(daily, {
      amount: 8000,
      date: "2026-10-20",
      incomeKind: "main",
      desc: "演示工资",
    });
    daily = d.recordExpense(daily, {
      amount: 25,
      date: "2026-10-20",
      category: "dining",
      desc: "演示午餐",
    });
    daily = d.recordExpense(daily, {
      amount: 120,
      date: "2026-10-20",
      effectiveDate: "2026-10-28",
      category: "other",
      expenseTiming: "prepaid",
      desc: "演示预付交通",
    });
    daily = d.recordExpense(daily, {
      amount: 80,
      date: "2026-10-20",
      category: "unplanned",
      desc: "演示修理",
    });
    const copper = {
      ...a.DEFAULT_COPPER_DATA,
      ratios: { liquid: 70, reserve: 30 },
      balances: { liquid: 12000, reserve: 4000 },
      inventoryCost: 1000,
      transactions: [],
    };
    localStorage.setItem(a.DAILY_STORAGE_KEY, JSON.stringify(daily));
    localStorage.setItem(a.COPPER_STORAGE_KEY, JSON.stringify(copper));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const dialog = () => page.getByRole("dialog").last();
  const ledger = () =>
    page.evaluate(() => ({
      daily: JSON.parse(localStorage.getItem("dailyBookData_v5")),
      copper: JSON.parse(localStorage.getItem("coinShopData_v5")),
    }));
  const noDialog = () => page.getByRole("dialog").waitFor({ state: "hidden" });
  const close = async () => {
    await dialog()
      .getByRole("button", { name: /^(关闭|返回)$/ })
      .click();
  };
  const discard = async () => {
    await close();
    await page.getByRole("heading", { name: "放弃未保存输入？" }).waitFor();
    await dialog()
      .getByRole("button", { name: "放弃输入", exact: true })
      .click();
    await noDialog();
  };
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  };
  const calculators = await page.evaluate(async () => {
    const { evaluateMoneyExpression: e } = await import(
      "/components/ui/money.ts"
    );
    return {
      sum: e("38+12-5"),
      discount: e("128-15"),
      decimals: e("0.1+0.2"),
      leading: e(".5+1.25"),
      negative: e("5-10"),
      invalid: [
        "1++2",
        "1e3",
        "2*3",
        "alert(1)",
        "NaN",
        "Infinity",
        "2.345",
        "99999999999999999",
        "1-",
      ].map(e),
    };
  });
  assert.deepEqual(calculators, {
    sum: 45,
    discount: 113,
    decimals: 0.3,
    leading: 1.75,
    negative: -5,
    invalid: Array(9).fill(null),
  });

  const comparisons = await page.evaluate(async () => {
    const { compareBackup } = await import("/components/ui/Backup.tsx");
    const current = {
      daily: JSON.parse(localStorage.getItem("dailyBookData_v5")),
      copper: JSON.parse(localStorage.getItem("coinShopData_v5")),
    };
    const older = structuredClone(current.daily);
    older.transactions = older.transactions.map((row) => ({
      ...row,
      date: "2020-01-01",
    }));
    return {
      olderDate: compareBackup(current, { daily: older }, "daily").older,
      same: compareBackup(current, { daily: current.daily }, "daily").older,
      unaffectedModule: compareBackup(
        current,
        {
          daily: current.daily,
          copper: { ...current.copper, transactions: [] },
        },
        "daily",
      ).older,
    };
  });
  assert.deepEqual(comparisons, {
    olderDate: true,
    same: false,
    unaffectedModule: false,
  });
  pass(
    "Restricted decimal calculator handles arithmetic, cents and invalid input without eval",
  );
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("38+12-5");
  assert.match(await dialog().locator("output").innerText(), /45.00/);
  const untouched = await ledger();
  await page.getByLabel("备注", { exact: true }).fill("演示算式记账");
  assert.deepEqual(await ledger(), untouched);
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  await noDialog();
  assert.equal((await ledger()).daily.transactions.at(-1).amount, 45);
  pass(
    "Expression preview is non-mutating and submit records the evaluated amount",
  );

  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("38");
  await dialog().getByRole("button", { name: "+¥10", exact: true }).click();
  await dialog().getByRole("button", { name: "−¥5", exact: true }).click();
  assert.equal(
    Number(await page.getByLabel("支出金额", { exact: true }).inputValue()),
    43,
  );
  const beforeInvalid = await ledger();
  await page.getByLabel("支出金额", { exact: true }).fill("1++2");
  await page.getByRole("button", { name: "记录支出", exact: true }).click();
  assert.deepEqual(await ledger(), beforeInvalid);
  assert.equal((await ledger()).daily.transactions.at(-1).amount, 45);
  await page.getByLabel("支出金额", { exact: true }).fill("88");
  await page.getByLabel("备注", { exact: true }).fill("保留草稿");
  await discard();
  await page.evaluate(() => window.scrollTo(0, 450));
  await page.getByRole("button", { name: "铜钱生意", exact: true }).click();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.getByRole("button", { name: "生活预算", exact: true }).click();
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - 450) < 3);
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  assert.equal(
    Number(await page.getByLabel("支出金额", { exact: true }).inputValue()),
    88,
  );
  assert.equal(
    await page.getByLabel("备注", { exact: true }).inputValue(),
    "保留草稿",
  );
  await close();
  await noDialog(); // No new edits in this reopened draft.
  pass(
    "Quick chips, invalid-expression guard, module draft and scroll keep-alive",
  );

  // Native back closes the top overlay, including nested pages and dirty prompts.
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog()
    .getByRole("button", { name: /查看.*演示算式记账/ })
    .click();
  await page.goBack();
  await page.getByRole("heading", { name: "历史流水", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.goBack();
  await noDialog();
  assert.match(page.url(), /127\.0\.0\.1|localhost/);
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("99");
  await page.goBack();
  await page.getByRole("heading", { name: "放弃未保存输入？" }).waitFor();
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(
    Number(await page.getByLabel("支出金额", { exact: true }).inputValue()),
    99,
  );
  await page.goBack();
  await page.getByRole("heading", { name: "放弃未保存输入？" }).waitFor();
  await dialog().getByRole("button", { name: "放弃输入", exact: true }).click();
  await noDialog();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#root").evaluate((e) => e.inert), false);
  pass(
    "Browser back closes nested views and dirty cancellation preserves both history and input",
  );

  const drag = async () => {
    const area = await dialog()
      .getByRole("group", { name: "向下拖动关闭弹层" })
      .boundingBox();
    assert.ok(area);
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      area.x + area.width / 2,
      area.y + area.height / 2 + 120,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.waitForTimeout(300);
  await drag();
  await noDialog();
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  await page.getByLabel("支出金额", { exact: true }).fill("11");
  await page.waitForTimeout(300);
  await drag();
  await page.getByRole("heading", { name: "放弃未保存输入？" }).waitFor();
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    await dialog().evaluate((e) => e.style.transform),
    "translateY(0px)",
  );
  await close();
  await dialog().getByRole("button", { name: "放弃输入", exact: true }).click();
  await noDialog();
  pass(
    "Pointer drag dismisses clean sheets and routes dirty sheets through confirmation",
  );

  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await dialog().getByRole("button", { name: "提前支付", exact: true }).click();
  assert.equal(await dialog().locator(".life-event-row").count(), 1);
  assert.match(await dialog().innerText(), /演示预付交通/);
  await dialog()
    .getByRole("button", { name: "动用缓冲/储备", exact: true })
    .click();
  assert.ok((await dialog().locator(".life-event-row").count()) >= 1);
  await dialog()
    .getByRole("button", { name: "大额/计划外", exact: true })
    .click();
  assert.match(await dialog().innerText(), /演示修理/);
  await dialog().getByRole("button", { name: "全部", exact: true }).click();
  await page.getByLabel("搜索流水备注或类别").fill("外食");
  assert.equal(await dialog().locator(".life-event-row").count(), 1);
  await page.getByLabel("搜索流水备注或类别").fill("不存在的演示关键词");
  assert.match(await dialog().innerText(), /暂无匹配记录/);
  await page.getByLabel("搜索流水备注或类别").fill("演示算式记账");
  const beforeDelete = await ledger();
  await dialog()
    .getByRole("button", { name: "更多操作 演示算式记账", exact: true })
    .click();
  assert.match(await dialog().innerText(), /涉及口袋/);
  assert.deepEqual(await ledger(), beforeDelete);
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await dialog()
    .getByRole("button", { name: "更多操作 演示算式记账", exact: true })
    .click();
  await dialog().getByRole("button", { name: "确认", exact: true }).click();
  assert.equal(
    (await ledger()).daily.transactions.length,
    beforeDelete.daily.transactions.length - 1,
  );
  await close();
  await noDialog();
  pass(
    "History filters/search and two-stage allocation-aware rollback deletion",
  );

  await page.getByRole("button", { name: "铜钱生意", exact: true }).click();
  await page.getByRole("button", { name: "铜钱配置", exact: true }).click();
  await page.getByLabel("流动库 %", { exact: true }).fill("35");
  assert.equal(
    Number(await page.getByLabel("存储库 %", { exact: true }).inputValue()),
    65,
  );
  await page.getByLabel("存储库 %", { exact: true }).fill("40");
  assert.equal(
    Number(await page.getByLabel("流动库 %", { exact: true }).inputValue()),
    60,
  );
  await page.getByRole("slider", { name: "流动库利润比例" }).fill("75");
  assert.equal(
    Number(await page.getByLabel("存储库 %", { exact: true }).inputValue()),
    25,
  );
  await page.getByRole("button", { name: "70:30 常规", exact: true }).click();
  await page.getByRole("button", { name: "保存比例", exact: true }).click();
  await noDialog();
  assert.deepEqual((await ledger()).copper.ratios, { liquid: 70, reserve: 30 });
  pass("Ratio slider, paired fields and presets keep the 100% invariant");

  await page.getByRole("button", { name: "记销售", exact: true }).click();
  await page.getByLabel("销售金额", { exact: true }).fill("100+20");
  await page.getByLabel("销售成本", { exact: true }).fill("80");
  assert.match(
    await dialog().locator(".sale-profit-preview").innerText(),
    /40.00/,
  );
  assert.match(
    await dialog().locator(".sale-profit-preview").innerText(),
    /28.00/,
  );
  assert.match(
    await dialog().locator(".sale-profit-preview").innerText(),
    /12.00/,
  );
  const beforeSale = await ledger();
  await page.getByLabel("销售成本", { exact: true }).fill("1001");
  assert.equal(
    await page
      .getByRole("button", { name: "记录销售", exact: true })
      .isDisabled(),
    true,
  );
  assert.match(await dialog().innerText(), /销售成本超过当前库存成本/);
  assert.deepEqual(await ledger(), beforeSale);
  await page.getByLabel("销售成本", { exact: true }).fill("80");
  await shot("sale-light");
  await page.getByRole("button", { name: "记录销售", exact: true }).click();
  await noDialog();
  assert.equal((await ledger()).copper.transactions.at(-1).amount, 120);
  assert.equal((await ledger()).copper.inventoryCost, 920);
  pass(
    "Sale math/profit split preview and live inventory bound use unchanged financial helpers",
  );

  await page.getByRole("button", { name: "记进货", exact: true }).click();
  await page.getByLabel("进货金额", { exact: true }).fill("50+25");
  await page.getByRole("button", { name: "记录进货", exact: true }).click();
  await noDialog();
  assert.equal((await ledger()).copper.transactions.at(-1).amount, 75);
  await page.getByRole("button", { name: "生活预算", exact: true }).click();
  await page.getByRole("button", { name: "收入分配", exact: true }).click();
  await dialog().getByRole("button", { name: "零散收入", exact: true }).click();
  await page.getByLabel("金额", { exact: true }).fill("100-10");
  await page.getByRole("button", { name: "确认分配", exact: true }).click();
  await noDialog();
  assert.equal((await ledger()).daily.transactions.at(-1).amount, 90);
  pass("Purchase and income principal amount fields accept arithmetic too");

  await page.getByRole("button", { name: "预算设置", exact: true }).click();
  assert.match(await dialog().innerText(), /尚未导出备份/);
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出整站", exact: true }).click();
  await backupDownload;
  assert.ok(
    await page.evaluate(
      () => Number(localStorage.getItem("daily_ledger_last_backup_at")) > 0,
    ),
  );
  assert.match(await dialog().innerText(), /距离上次备份已 0 天/);
  const saved = await ledger();
  await page
    .getByLabel("导入生活预算 Excel")
    .setInputFiles({
      name: "invalid.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("unrecognized demo workbook"),
    });
  await page
    .getByRole("alert")
    .filter({ hasText: "未识别到生活预算备份" })
    .waitFor();
  assert.deepEqual(await ledger(), saved);
  await page.getByLabel("恢复整站 JSON 备份").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await page.getByRole("alert").filter({ hasText: "备份恢复失败" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.deepEqual(await ledger(), saved);
  const reduced = structuredClone(saved);
  reduced.daily.transactions = [];
  await page.getByLabel("恢复整站 JSON 备份").setInputFiles({
    name: "older.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, ...reduced })),
  });
  await page.getByRole("heading", { name: "恢复整站备份？" }).waitFor();
  assert.match(await dialog().innerText(), /备份记录更少/);
  assert.equal(
    await dialog()
      .getByRole("checkbox", { name: "先自动导出当前整站备份，再执行恢复" })
      .isChecked(),
    true,
  );
  assert.deepEqual(await ledger(), saved);
  await shot("backup-preview");
  const safetyDownload = page.waitForEvent("download");
  await dialog()
    .getByRole("button", { name: "覆盖并恢复", exact: true })
    .click();
  const safety = await safetyDownload;
  const safetyData = JSON.parse(fs.readFileSync(await safety.path(), "utf8"));
  assert.equal(
    safetyData.daily.transactions.length,
    saved.daily.transactions.length,
  );
  assert.equal((await ledger()).daily.transactions.length, 0);
  const canonicalCopper = (value) => ({
    ...value,
    transactions: value.transactions.map((row) => ({
      ...row,
      isLegacyLocked: Boolean(row.isLegacyLocked),
    })),
  });
  assert.deepEqual(
    canonicalCopper((await ledger()).copper),
    canonicalCopper(saved.copper),
  );
  await close();
  await noDialog();
  pass(
    "Backup freshness, parse-before-confirm, stale-file warning and safety snapshot precede restore",
  );

  await page.waitForTimeout(150);
  await page.evaluate(() =>
    localStorage.setItem(
      "daily_ledger_last_backup_at",
      String(Date.now() - 9 * 86400000),
    ),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(
    await page.locator(".module-panel:not([hidden]) .backup-dot").count(),
    1,
  );
  await page.getByRole("button", { name: "预算设置", exact: true }).click();
  assert.match(await dialog().innerText(), /距离上次备份已 9 天/);
  await page.getByRole("button", { name: "夜间", exact: true }).click();
  await close();
  await noDialog();
  for (const size of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(size);
    for (const module of ["生活预算", "铜钱生意"]) {
      await page.getByRole("button", { name: module, exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await shot(
        `${module === "生活预算" ? "daily" : "copper"}-${size.width}-dark`,
      );
    }
  }
  await page.getByRole("button", { name: "记进货", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(250);
  const submit = await page
    .getByRole("button", { name: "记录进货", exact: true })
    .boundingBox();
  assert.ok(submit && submit.y + submit.height <= 500);
  assert.equal(await page.getByRole("dialog").count(), 1);
  await close();
  await noDialog();
  pass(
    "Overdue backup indicator, dark themes, 360/390/430 layouts and short viewport remain usable",
  );
  assert.deepEqual(errors, []);
  pass("No runtime exceptions, native dialogs or inactive-module portals");
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
