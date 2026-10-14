import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRightCircle,
  Briefcase,
  Check,
  Coins,
  Lock,
  Package,
  RotateCcw,
  Settings,
  Table,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BackupSection, InlineError, Overlay, useUi } from "./ui/Ui";
import * as XLSX from "xlsx";
import { DEFAULT_COPPER_DATA } from "../lib/appData";
import {
  autoConfirmCopperPendingTransactions,
  applyCopperTransaction,
  cancelCopperPendingTransaction,
  confirmCopperPendingTransaction,
  createCopperExpenseTransaction,
  createCopperIncomeTransaction,
  createInventoryAdjustmentTransaction,
  formatCopperTransactionDate,
  getCopperCashTotal,
  getCopperChartData,
  getCopperMonthlyStats,
  getCopperPendingDueDate,
  getCopperTransactionKindLabel,
  getTotalCopperAssets,
  isCopperCancelledTransaction,
  isCopperPendingTransaction,
  rollbackCopperTransaction,
} from "../lib/copper";
import { getTodayDate } from "../lib/date";
import { CopperData, CopperRatios } from "../types";
import { exportCopperToExcel, parseCopperImportWorkbook } from "../utils/excel";

const formatCompactAmount = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 10000) {
    return `${value < 0 ? "-" : ""}${(absValue / 10000).toFixed(absValue >= 100000 ? 0 : 1)}万`;
  }
  return `${Math.round(value)}`;
};

const formatCompactMoney = (value: number) => `¥ ${formatCompactAmount(value)}`;

const formatSignedCompact = (value: number) =>
  `${value >= 0 ? "+" : "−"}¥${formatCompactAmount(Math.abs(value))}`;

const formatMoney = (value: number) =>
  `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type CopperTrendMode = "flow" | "inventory";

interface CopperShopProps {
  data: CopperData;
  setData: React.Dispatch<React.SetStateAction<CopperData>>;
  theme: "light" | "dark";
  appControls?: React.ReactNode;
}

export const CopperShop: React.FC<CopperShopProps> = ({
  data,
  setData,
  theme,
  appControls,
}) => {
  const { confirm, notify } = useUi();
  const [formError, setFormError] = useState("");
  const [showEntry, setShowEntry] = useState(false);
  const [showMonthly, setShowMonthly] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ratioDraft, setRatioDraft] = useState<CopperRatios>(data.ratios);
  const [inventoryEntryAmount, setInventoryEntryAmount] = useState("");
  const [inventoryEntryDesc, setInventoryEntryDesc] = useState("");
  const [inventoryDraft, setInventoryDraft] = useState(
    String(data.inventoryCost),
  );
  const [inventoryAdjustmentDesc, setInventoryAdjustmentDesc] = useState("");
  const [trendMode, setTrendMode] = useState<CopperTrendMode>("flow");
  const [showCancelledTransactions, setShowCancelledTransactions] =
    useState(false);
  const [form, setForm] = useState<{
    amount: string;
    cost: string;
    date: string;
    desc: string;
    isPending: boolean;
    type: "income" | "expense";
  }>({
    amount: "",
    cost: "",
    desc: "",
    isPending: true,
    type: "income",
    date: getTodayDate(),
  });

  useEffect(() => {
    setData((prev) => autoConfirmCopperPendingTransactions(prev));
  }, [data.transactions, setData]);

  useEffect(() => {
    if (showSettings) {
      setRatioDraft(data.ratios);
      setInventoryEntryAmount("");
      setInventoryEntryDesc("");
      setInventoryDraft(String(data.inventoryCost));
      setInventoryAdjustmentDesc("");
    }
  }, [data.inventoryCost, data.ratios, showSettings]);

  const cashTotal = useMemo(
    () => getCopperCashTotal(data.balances),
    [data.balances],
  );
  const totalAssets = useMemo(() => getTotalCopperAssets(data), [data]);
  const monthlyStats = useMemo(
    () => getCopperMonthlyStats(data.transactions),
    [data.transactions],
  );
  const chartData = useMemo(
    () => getCopperChartData(data.transactions, data.inventoryCost),
    [data.inventoryCost, data.transactions],
  );
  const trendSummary = useMemo(() => {
    const flowData = chartData.map((item, index, allItems) => {
      const trendWindow = allItems.slice(Math.max(0, index - 2), index + 1);
      const profitTrend =
        trendWindow.reduce((total, current) => total + current.profit, 0) /
        trendWindow.length;

      return {
        ...item,
        profitTrend: Number(profitTrend.toFixed(2)),
      };
    });
    const lastPoint = chartData.at(-1);
    const firstPoint = chartData[0];
    const totals = chartData.reduce(
      (result, item) => ({
        income: result.income + item.income,
        profit: result.profit + item.profit,
      }),
      { income: 0, profit: 0 },
    );
    const bestProfitDay = chartData.reduce<(typeof chartData)[number] | null>(
      (best, item) => (!best || item.profit > best.profit ? item : best),
      null,
    );

    return {
      bestProfitDay,
      flowData,
      inventoryChange:
        lastPoint && firstPoint
          ? lastPoint.inventoryCost - firstPoint.inventoryCost
          : 0,
      totalIncome: totals.income,
      totalProfit: totals.profit,
    };
  }, [chartData]);
  const lockedLegacyCount = useMemo(
    () =>
      data.transactions.filter((transaction) => transaction.isLegacyLocked)
        .length,
    [data.transactions],
  );
  const recentTransactions = useMemo(
    () =>
      [...data.transactions]
        .filter(
          (transaction) =>
            showCancelledTransactions ||
            !isCopperCancelledTransaction(transaction),
        )
        .reverse()
        .slice(0, 10),
    [data.transactions, showCancelledTransactions],
  );
  const chartGridColor = "var(--line)";
  const chartTickColor = "var(--muted)";
  const tooltipStyle = {
    background: "var(--card)",
    borderRadius: "16px",
    border: "none",
    boxShadow: "var(--raise)",
    color: "var(--text)",
    fontSize: "12px",
    padding: "12px",
  };

  const handleAddTransaction = () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("请输入有效金额");
      return;
    }

    if (!form.date) {
      setFormError("请选择日期");
      return;
    }

    if (form.type === "income") {
      const cost = Number(form.cost);
      if (!Number.isFinite(cost) || cost < 0) {
        setFormError("请输入有效成本");
        return;
      }

      if (cost > data.inventoryCost) {
        setFormError("本笔成本不能超过当前库存总成本");
        return;
      }

      setData((prev) =>
        applyCopperTransaction(
          prev,
          createCopperIncomeTransaction({
            amount,
            cost,
            date: form.date,
            desc: form.desc,
            isPending: form.isPending,
            ratios: prev.ratios,
          }),
        ),
      );
    } else {
      if (amount > cashTotal) {
        setFormError("现金余额不足，无法进货");
        return;
      }

      setData((prev) =>
        applyCopperTransaction(
          prev,
          createCopperExpenseTransaction({
            amount,
            date: form.date,
            desc: form.desc,
            balances: prev.balances,
          }),
        ),
      );
    }

    setShowEntry(false);
    setFormError("");
    notify("记账成功");
    setForm((prev) => ({
      ...prev,
      amount: "",
      cost: "",
      desc: "",
      isPending: prev.type === "income" ? true : prev.isPending,
    }));
  };

  const handleDeleteTransaction = async (id: number) => {
    if (!(await confirm("确定删除这条记录吗？资金和库存成本将自动回滚。"))) {
      return;
    }

    const transaction = data.transactions.find((item) => item.id === id);
    if (!transaction) {
      return;
    }

    if (transaction.isLegacyLocked || !transaction.cashAllocation) {
      setFormError("这条旧记录缺少精确资金明细，已锁定删除以避免余额出错。");
      return;
    }

    const nextInventoryCost =
      data.inventoryCost - (transaction.inventoryDelta ?? 0);
    if (nextInventoryCost < 0) {
      setFormError("这笔进货可能已被后续销售消耗，不能直接删除。");
      return;
    }

    setData((prev) => rollbackCopperTransaction(prev, transaction));
  };

  const handleConfirmPending = async (id: number) => {
    if (
      !(await confirm({
        title: "确认销售？",
        body: "款与库存已经入账。本操作只将销售标记为已确认，不会重复入账。",
        confirmLabel: "确认销售",
      }))
    )
      return;
    setData((prev) => confirmCopperPendingTransaction(prev, id));
  };

  const handleCancelPending = async (id: number) => {
    if (
      !(await confirm(
        "确定取消这笔待确认销售吗？资金和库存成本会回滚，记录会保留为已取消。",
      ))
    ) {
      return;
    }

    setData((prev) => cancelCopperPendingTransaction(prev, id));
  };

  const handleSaveSettings = () => {
    const totalRatio = ratioDraft.liquid + ratioDraft.reserve;

    if (totalRatio !== 100) {
      setFormError("比例总和必须是100%");
      return;
    }

    setData((prev) => ({ ...prev, ratios: ratioDraft }));
    setShowSettings(false);
  };

  const handleInventoryEntry = () => {
    const amount = Number(inventoryEntryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("请输入有效库存成本");
      return;
    }

    setData((prev) =>
      applyCopperTransaction(
        prev,
        createInventoryAdjustmentTransaction({
          date: getTodayDate(),
          desc: inventoryEntryDesc.trim() || "库存成本补录",
          previousInventoryCost: prev.inventoryCost,
          nextInventoryCost: prev.inventoryCost + amount,
        }),
      ),
    );
    setInventoryEntryAmount("");
    setInventoryEntryDesc("");
    setShowSettings(false);
  };

  const handleInventoryAdjustment = () => {
    const nextInventoryCost = Number(inventoryDraft);
    if (!Number.isFinite(nextInventoryCost) || nextInventoryCost < 0) {
      setFormError("请输入有效库存成本");
      return;
    }

    if (nextInventoryCost === data.inventoryCost) {
      setFormError("库存成本没有变化");
      return;
    }

    setData((prev) =>
      applyCopperTransaction(
        prev,
        createInventoryAdjustmentTransaction({
          date: getTodayDate(),
          desc: inventoryAdjustmentDesc,
          previousInventoryCost: prev.inventoryCost,
          nextInventoryCost,
        }),
      ),
    );
    setShowSettings(false);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (
      !(await confirm(
        "确定用导入文件覆盖当前铜钱分账数据吗？余额、比例、库存成本和流水都会被替换。",
      ))
    ) {
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: "array" });
        const importedData = parseCopperImportWorkbook(
          workbook,
          DEFAULT_COPPER_DATA,
        );
        setData(importedData);
        notify(`导入成功，共恢复 ${importedData.transactions.length} 条流水`);
      } catch {
        setFormError("导入失败，格式不正确");
      } finally {
        input.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div
      className={`copper-shop copper-shop-${theme} module-business space-y-4 animate-fade-in`}
    >
      <header className="flex items-center justify-between gap-3 mb-5">
        <div>
          <p className="ui-help mt-0">本地保存于此浏览器</p>
          <h1>铜钱生意</h1>
        </div>
        <button
          className="ui-icon-button"
          onClick={() => {
            setFormError("");
            setShowSettings(true);
          }}
          aria-label="铜钱配置"
        >
          <Settings size={20} />
        </button>
      </header>
      {!showSettings && !showEntry && <InlineError message={formError} />}
      {showSettings && (
        <Overlay
          title="铜钱配置"
          variant="page"
          protectEdits
          onClose={() => setShowSettings(false)}
          error={formError}
          onClearError={() => setFormError("")}
        >
          <div className="space-y-4">
            <div className="ui-card">
              <h3 className="font-bold text-sm mb-3">
                利润分配比例 (总和须为100)
              </h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1">
                    流动库 %
                  </label>
                  <input
                    type="number"
                    value={ratioDraft.liquid}
                    onChange={(event) =>
                      setRatioDraft((prev) => ({
                        ...prev,
                        liquid: Number(event.target.value) || 0,
                      }))
                    }
                    className="w-full p-1.5 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1">
                    存储库 %
                  </label>
                  <input
                    type="number"
                    value={ratioDraft.reserve}
                    onChange={(event) =>
                      setRatioDraft((prev) => ({
                        ...prev,
                        reserve: Number(event.target.value) || 0,
                      }))
                    }
                    className="w-full p-1.5 border rounded text-sm"
                  />
                </div>
              </div>
              <button onClick={handleSaveSettings} className="ui-key w-full">
                保存比例
              </button>
            </div>

            <div className="ui-card">
              <h3 className="font-bold text-sm mb-3">库存成本补录</h3>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  type="number"
                  value={inventoryEntryAmount}
                  onChange={(event) =>
                    setInventoryEntryAmount(event.target.value)
                  }
                  className="md:w-32 p-1.5 border rounded text-sm"
                  aria-label="本笔库存成本"
                  placeholder="本笔成本"
                />
                <input
                  type="text"
                  value={inventoryEntryDesc}
                  onChange={(event) =>
                    setInventoryEntryDesc(event.target.value)
                  }
                  className="flex-1 p-1.5 border rounded text-sm"
                  aria-label="库存调整备注"
                  placeholder="备注"
                />
                <button onClick={handleInventoryEntry} className="ui-key">
                  补录库存
                </button>
              </div>
            </div>

            <div className="ui-card">
              <h3 className="font-bold text-sm mb-3">盘点设置总额</h3>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  type="number"
                  value={inventoryDraft}
                  onChange={(event) => setInventoryDraft(event.target.value)}
                  className="md:w-32 p-1.5 border rounded text-sm"
                  aria-label="盘点库存成本总额"
                  placeholder="库存成本"
                />
                <input
                  type="text"
                  value={inventoryAdjustmentDesc}
                  onChange={(event) =>
                    setInventoryAdjustmentDesc(event.target.value)
                  }
                  className="flex-1 p-1.5 border rounded text-sm"
                  aria-label="库存调整备注"
                  placeholder="备注"
                />
                <button onClick={handleInventoryAdjustment} className="ui-key">
                  记录调整
                </button>
              </div>
            </div>

            <p className="ui-help">库存补录与盘点是库存调整，不是进货付款。</p>
            <BackupSection
              moduleName="铜钱生意"
              appControls={appControls}
              onExport={() => exportCopperToExcel(data)}
              onImport={handleImport}
            />
          </div>
        </Overlay>
      )}

      {lockedLegacyCount > 0 && (
        <div className="bg-[var(--warn-soft)] border-0 text-[var(--warn)] px-3 py-2 rounded-xl text-xs">
          检测到 {lockedLegacyCount}{" "}
          条旧版流水缺少精确资金明细。这些记录会保留展示，但禁止删除，避免回滚后余额失真。
        </div>
      )}

      <section className="business-assets">
        <div className="flex items-center justify-between ui-muted text-sm">
          <b>总资产</b>
          <Briefcase size={20} />
        </div>
        <div className="ui-num">{formatMoney(totalAssets)}</div>
        <div className="life-balances">
          <div>
            现金合计<b>{formatMoney(cashTotal)}</b>
          </div>
          <div>
            库存成本<b>{formatMoney(data.inventoryCost)}</b>
          </div>
        </div>
      </section>
      <section className="business-pockets">
        <div className="ui-card business-pocket">
          <div className="ui-muted text-xs flex items-center gap-2">
            <Wallet size={16} />
            流动库
          </div>
          <div className="ui-num">{formatMoney(data.balances.liquid)}</div>
          <div className="ui-help mb-0">利润分配 {data.ratios.liquid}%</div>
        </div>
        <div className="ui-card business-pocket">
          <div className="ui-muted text-xs flex items-center gap-2">
            <Lock size={16} />
            存储库
          </div>
          <div className="ui-num">{formatMoney(data.balances.reserve)}</div>
          <div className="ui-help mb-0">利润分配 {data.ratios.reserve}%</div>
        </div>
      </section>
      <section className="business-entries">
        <button
          className="ui-key"
          onClick={() => {
            setFormError("");
            setForm((prev) => ({ ...prev, type: "income", isPending: true }));
            setShowEntry(true);
          }}
        >
          <Coins size={18} />
          记销售
        </button>
        <button
          className="ui-key"
          onClick={() => {
            setFormError("");
            setForm((prev) => ({ ...prev, type: "expense", isPending: false }));
            setShowEntry(true);
          }}
        >
          <Package size={18} />
          记进货
        </button>
      </section>
      {showEntry && (
        <Overlay
          title={form.type === "income" ? "记销售" : "记进货"}
          protectEdits
          onClose={() => setShowEntry(false)}
          error={formError}
          onClearError={() => setFormError("")}
          footer={
            <button className="ui-key" onClick={handleAddTransaction}>
              {form.type === "income" ? "记录销售" : "记录进货"}
              <ArrowRightCircle size={18} />
            </button>
          }
        >
          <label className="ui-help">
            {form.type === "income" ? "销售金额" : "进货金额"}
            <div className="ui-amount-field">
              <span>¥</span>
              <input
                aria-label={form.type === "income" ? "销售金额" : "进货金额"}
                type="number"
                inputMode="decimal"
                step="any"
                value={form.amount}
                placeholder="0.00"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </div>
          </label>
          <div className="space-y-4">
            {form.type === "income" && (
              <label className="block ui-help">
                销售成本
                <input
                  className="mt-2"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={form.cost}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, cost: event.target.value }))
                  }
                />
              </label>
            )}
            <label className="block ui-help">
              日期
              <input
                className="mt-2"
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </label>
            <label className="block ui-help">
              备注
              <input
                className="mt-2"
                value={form.desc}
                placeholder="可选"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, desc: event.target.value }))
                }
              />
            </label>
            {form.type === "income" && (
              <label className="ui-card flex items-center justify-between gap-3">
                <span>
                  <b>待确认销售</b>
                  <span className="block ui-help">
                    款与库存立即入账，10个自然日后应用处理时自动确认。
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={form.isPending}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      isPending: event.target.checked,
                    }))
                  }
                />
              </label>
            )}
            <p className="ui-help">
              {form.type === "income"
                ? "销售成本不能超过现有库存成本；利润可为负。"
                : "进货会减少现金并增加库存成本；现金不足时不能进货。"}
            </p>
          </div>
        </Overlay>
      )}

      {chartData.length > 0 && (
        <div className="business-trend">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-[var(--text)] flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-[var(--warn)]" />{" "}
                  经营趋势
                </h3>
                <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-[var(--accent)]"></span>
                    收入
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded-full bg-[var(--accent)]"></span>
                    利润均线
                  </span>
                </div>
              </div>
              <div className="ui-segmented">
                {[
                  ["flow", "收利"],
                  ["inventory", "库存"],
                ].map(([mode, label]) => (
                  <button
                    aria-pressed={trendMode === mode}
                    key={mode}
                    onClick={() => setTrendMode(mode as CopperTrendMode)}
                    className={`rounded-md px-2 py-1 transition-colors ${
                      trendMode === mode
                        ? "bg-[var(--card)] text-[var(--text)] shadow-sm"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[var(--accent-soft)] px-2 py-2">
                <div className="text-xs font-bold text-[var(--pos)]">
                  近30天收入
                </div>
                <div className="mt-0.5 text-sm font-bold text-[var(--pos)]">
                  {formatCompactMoney(trendSummary.totalIncome)}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--accent-soft)] px-2 py-2">
                <div className="text-xs font-bold text-[var(--accent)]">
                  近30天毛利
                </div>
                <div className="mt-0.5 text-sm font-bold text-[var(--accent)]">
                  {formatSignedCompact(trendSummary.totalProfit)}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--warn-soft)] px-2 py-2">
                <div className="text-xs font-bold text-[var(--warn)]">
                  库存变化
                </div>
                <div
                  className={`mt-0.5 text-sm font-bold ${
                    trendSummary.inventoryChange >= 0
                      ? "text-[var(--warn)]"
                      : "text-[var(--pos)]"
                  }`}
                >
                  {formatSignedCompact(trendSummary.inventoryChange)}
                </div>
              </div>
            </div>

            <p className="business-chart-summary" aria-label="经营趋势摘要">
              近30天收入 {formatMoney(trendSummary.totalIncome)}，毛利{" "}
              {formatMoney(trendSummary.totalProfit)}，库存变化{" "}
              {formatMoney(trendSummary.inventoryChange)}
              。轻触图表查看当日数值。
            </p>
            <div className="h-56" role="group" aria-label="经营趋势图">
              <ResponsiveContainer width="100%" height="100%">
                {trendMode === "flow" ? (
                  <ComposedChart
                    accessibilityLayer
                    data={trendSummary.flowData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={chartGridColor}
                    />
                    <XAxis
                      dataKey="shortDate"
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={18}
                      tick={{ fontSize: 12, fill: chartTickColor }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tickFormatter={(value) =>
                        formatCompactAmount(Number(value))
                      }
                      tick={{ fontSize: 12, fill: chartTickColor }}
                      tickLine={false}
                      width={44}
                    />
                    <Tooltip
                      trigger="click"
                      formatter={(value: number, name: string) => [
                        formatMoney(Number(value)),
                        name,
                      ]}
                      labelFormatter={(label) => `日期: ${label}`}
                      contentStyle={tooltipStyle}
                    />
                    <Bar
                      dataKey="income"
                      name="收入"
                      fill="var(--accent-soft)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={14}
                    />
                    <Line
                      type="monotone"
                      dataKey="profitTrend"
                      name="利润均线"
                      stroke="var(--accent)"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                ) : (
                  <ComposedChart
                    accessibilityLayer
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={chartGridColor}
                    />
                    <XAxis
                      dataKey="shortDate"
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={18}
                      tick={{ fontSize: 12, fill: chartTickColor }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      domain={["auto", "auto"]}
                      tickFormatter={(value) =>
                        formatCompactAmount(Number(value))
                      }
                      tick={{ fontSize: 12, fill: chartTickColor }}
                      tickLine={false}
                      width={44}
                    />
                    <Tooltip
                      trigger="click"
                      formatter={(value: number) => formatMoney(Number(value))}
                      labelFormatter={(label) => `日期: ${label}`}
                      contentStyle={tooltipStyle}
                    />
                    <Line
                      type="monotone"
                      dataKey="inventoryCost"
                      name="库存成本"
                      stroke="var(--accent)"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>

            {trendSummary.bestProfitDay && (
              <div className="flex items-center justify-between rounded-lg bg-[var(--card)] px-2.5 py-2 text-xs text-[var(--muted)]">
                <span>最高毛利日</span>
                <span className="font-bold text-[var(--text)]">
                  {trendSummary.bestProfitDay.shortDate} /{" "}
                  {formatMoney(trendSummary.bestProfitDay.profit)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {monthlyStats.length > 0 && (
        <button
          className="ui-button w-full"
          onClick={() => setShowMonthly(true)}
        >
          <Table size={18} />
          月度经营汇总 · 查看全部
        </button>
      )}
      {showMonthly && (
        <Overlay
          title="月度经营汇总"
          variant="page"
          onClose={() => setShowMonthly(false)}
        >
          <div className="space-y-4">
            {monthlyStats.map((stat) => (
              <section className="business-month-card" key={stat.month}>
                <h3>{stat.month}</h3>
                <dl className="business-month-grid">
                  <div>
                    <dt>收入</dt>
                    <dd className="ui-positive">+{formatMoney(stat.income)}</dd>
                  </div>
                  <div>
                    <dt>销售成本</dt>
                    <dd>{formatMoney(stat.cost)}</dd>
                  </div>
                  <div>
                    <dt>毛利润</dt>
                    <dd
                      className={
                        stat.profit >= 0 ? "ui-positive" : "ui-negative"
                      }
                    >
                      {stat.profit >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(stat.profit))}
                    </dd>
                  </div>
                  <div>
                    <dt>待确认</dt>
                    <dd>
                      {stat.pendingCount}笔 / {formatMoney(stat.pendingIncome)}
                    </dd>
                  </div>
                  <div>
                    <dt>进货</dt>
                    <dd className="ui-negative">
                      −{formatMoney(stat.purchase)}
                    </dd>
                  </div>
                  <div>
                    <dt>现金变化</dt>
                    <dd
                      className={
                        stat.cashNet >= 0 ? "ui-positive" : "ui-negative"
                      }
                    >
                      {stat.cashNet >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(stat.cashNet))}
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
        </Overlay>
      )}

      <section className="business-recent">
        <div className="flex items-center justify-between gap-2">
          <h3>最近流水</h3>
          <button
            className="ui-button"
            aria-pressed={showCancelledTransactions}
            onClick={() => setShowCancelledTransactions((prev) => !prev)}
          >
            {showCancelledTransactions ? "隐藏已取消" : "显示已取消"}
          </button>
        </div>
        <ul>
          {recentTransactions.map((transaction) => {
            const isIncome = transaction.type === "income";
            const isAdjustment = transaction.type === "inventory_adjustment";
            const pending = isCopperPendingTransaction(transaction);
            const cancelled = isCopperCancelledTransaction(transaction);
            const amount = isAdjustment
              ? (transaction.inventoryDelta ?? 0)
              : transaction.amount;
            const sign = isAdjustment
              ? amount >= 0
                ? "+"
                : "−"
              : isIncome
                ? "+"
                : "−";
            const days = Math.max(
              0,
              Math.ceil(
                (new Date(
                  `${getCopperPendingDueDate(transaction)}T00:00:00`,
                ).getTime() -
                  new Date(`${getTodayDate()}T00:00:00`).getTime()) /
                  86400000,
              ),
            );
            const profit = transaction.profit ?? transaction.amount;
            return (
              <li
                key={transaction.id}
                className={cancelled ? "is-cancelled" : ""}
              >
                <div>
                  <b className="block text-sm">
                    {transaction.desc ||
                      getCopperTransactionKindLabel(transaction)}
                  </b>
                  <p className="ui-help mt-1 mb-0">
                    {formatCopperTransactionDate(transaction.date)} ·{" "}
                    {getCopperTransactionKindLabel(transaction)}
                  </p>
                  {isIncome && (
                    <p className="ui-help mt-1 mb-0">
                      成本 {formatMoney(transaction.cost ?? 0)} / 利润{" "}
                      <span
                        className={profit >= 0 ? "ui-positive" : "ui-negative"}
                      >
                        {profit >= 0 ? "+" : "−"}
                        {formatMoney(Math.abs(profit))}
                      </span>
                    </p>
                  )}
                  {transaction.isLegacyLocked && (
                    <span className="ui-badge ui-badge-warning">
                      <Lock size={12} /> 历史锁定
                    </span>
                  )}
                  {isIncome && !pending && !cancelled && (
                    <span className="ui-badge">已确认</span>
                  )}
                  {cancelled && <span className="ui-badge">已取消</span>}
                </div>
                <div className="flex items-center gap-2">
                  <b
                    className={`ui-num ${cancelled ? "ui-muted line-through" : isIncome ? "ui-positive" : isAdjustment ? "ui-muted" : "ui-negative"}`}
                  >
                    {sign}
                    {formatMoney(Math.abs(amount))}
                  </b>
                  {!pending && !transaction.isLegacyLocked && (
                    <button
                      className="ui-icon-button"
                      onClick={() => handleDeleteTransaction(transaction.id)}
                      aria-label={`删除 ${transaction.desc}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                {pending && (
                  <>
                    <div className="business-pending-note">
                      待确认 · {days}天后自动确认 · 款与库存已入账
                    </div>
                    <div className="business-pending-actions">
                      <button
                        className="ui-key"
                        onClick={() => handleConfirmPending(transaction.id)}
                      >
                        <Check size={16} />
                        确认
                      </button>
                      <button
                        className="ui-danger"
                        onClick={() => handleCancelPending(transaction.id)}
                      >
                        <RotateCcw size={16} />
                        取消并回滚
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
          {recentTransactions.length === 0 && (
            <li className="business-empty">
              暂无记录。点击「记销售」或「记进货」开始记账。
            </li>
          )}
        </ul>
      </section>
    </div>
  );
};
