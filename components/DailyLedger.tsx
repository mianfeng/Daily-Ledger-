import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDollarSign,
  Landmark,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  Tag,
  Trash2,
  Utensils,
  Wallet,
} from "lucide-react";
import { BackupSection, InlineError, Overlay, useUi } from "./ui/Ui";
import * as XLSX from "xlsx";
import { DEFAULT_DAILY_DATA } from "../lib/appData";
import {
  formatDisplayDate,
  getTodayDate,
  normalizeDateInput,
} from "../lib/date";
import {
  addFixedExpense,
  adjustFixedReserved,
  applyDueBudgetRollovers,
  allocateIncome,
  deleteDailyTransaction,
  deleteFixedExpense,
  getBudgetCycleSummaries,
  calibrateSpendableBalance,
  getBudgetSnapshot,
  getLifeBudget,
  initializeLifeBudget,
  markFixedExpensePaid,
  recordExpense,
} from "../lib/daily";
import {
  BudgetCycle,
  DailyData,
  DailyExpenseCategory,
  DailyIncomeKind,
  DailyTransaction,
  LifeBudgetSettings,
} from "../types";
import { exportDailyToExcel, parseDailyImportWorkbook } from "../utils/excel";

interface DailyLedgerProps {
  data: DailyData;
  setData: React.Dispatch<React.SetStateAction<DailyData>>;
  theme: "light" | "dark";
  appControls?: React.ReactNode;
}

type Panel =
  | "expense"
  | "income"
  | "calibration"
  | "fixed"
  | "settings"
  | "cycle"
  | "events"
  | null;

const formatAmount = (value: number) =>
  `${value < 0 ? "−" : ""}¥${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatBudgetDate = (date: string) =>
  formatDisplayDate(date).replace(/^\d{4}\//, "");

const parseAmount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTransactionAmount = (transaction: DailyTransaction) => {
  if (transaction.type === "transfer") {
    return `转 ${formatAmount(transaction.amount)}`;
  }

  return `${transaction.type === "income" ? "+" : "−"}${formatAmount(transaction.amount)}`;
};

const getTransactionAmountClass = (transaction: DailyTransaction) => {
  if (transaction.type === "transfer") {
    return "text-[var(--muted)]";
  }

  return transaction.type === "income"
    ? "text-[var(--pos)]"
    : "text-[var(--neg)]";
};

const addLocalDays = (date: string, days: number) => {
  const value = new Date(`${normalizeDateInput(date)}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const findBudgetWeekForDate = (
  cycle: BudgetCycle | null | undefined,
  date: string,
) => {
  const normalizedDate = normalizeDateInput(date);
  return cycle?.weeks.find(
    (week) =>
      normalizedDate >= week.startDate && normalizedDate <= week.endDate,
  );
};

const getDefaultPrepaidEffectiveDate = (
  paymentDate: string,
  cycle: BudgetCycle | null | undefined,
) => {
  const normalizedPaymentDate =
    normalizeDateInput(paymentDate) || getTodayDate();
  const paymentWeek = findBudgetWeekForDate(cycle, normalizedPaymentDate);
  return paymentWeek
    ? addLocalDays(paymentWeek.endDate, 1)
    : addLocalDays(normalizedPaymentDate, 1);
};

const categoryLabels: Record<DailyExpenseCategory, string> = {
  daily: "日常",
  dining: "外食/外卖",
  other: "其他",
  unplanned: "计划外",
  large: "大额",
  fixed: "固定支出",
  unrecorded: "未记录支出",
};

const incomeKindLabels: Record<DailyIncomeKind, string> = {
  main: "主要收入",
  casual: "零散收入",
  refund: "退款报销",
  correction: "余额修正",
};

const transferKindLabels = {
  weeklyRollover: "系统结转",
  cycleRollover: "系统结转",
} as const;

type FlowKey = "week" | "buffer" | "advance" | "reserve" | "fixed";

interface TransactionFlowItem {
  key: FlowKey;
  label: string;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  direction: "in" | "out";
}

const getFlowSnapshotBalance = (
  transaction: DailyTransaction,
  key: FlowKey,
  snapshot: DailyTransaction["balanceAfter"],
) => {
  if (!snapshot) {
    return undefined;
  }

  if (key === "week") {
    if (transaction.type === "income" || transaction.category === "fixed") {
      return snapshot.spendable;
    }
    return snapshot.weekRemaining;
  }
  if (key === "advance") {
    if (
      transaction.category === "large" ||
      transaction.expenseTiming === "prepaid"
    )
      return snapshot.spendable;
    return snapshot.futureSpendable;
  }
  if (key === "buffer") {
    return snapshot.buffer;
  }
  if (key === "reserve") {
    return snapshot.reserve;
  }
  return snapshot.fixedReserved;
};

const createFlowItem = (
  transaction: DailyTransaction,
  key: FlowKey,
  label: string,
  amount: number,
  direction: TransactionFlowItem["direction"],
): TransactionFlowItem => {
  return {
    key,
    label,
    amount: Math.abs(amount),
    balanceBefore: getFlowSnapshotBalance(
      transaction,
      key,
      transaction.balanceBefore,
    ),
    balanceAfter: getFlowSnapshotBalance(
      transaction,
      key,
      transaction.balanceAfter,
    ),
    direction,
  };
};

const getTransactionFlow = (transaction: DailyTransaction) => {
  const allocation = transaction.allocation;
  const sources: TransactionFlowItem[] = [];
  const destinations: TransactionFlowItem[] = [];
  if (!allocation) {
    return { sources, destinations, gap: 0 };
  }

  if (transaction.type === "income") {
    const order: Array<[FlowKey, string]> = [
      ["fixed", "固定预留"],
      ["reserve", "储备金"],
      ["buffer", "缓冲金"],
      ["week", "可消费余额"],
    ];
    for (const [key, label] of order) {
      const amount = allocation[key];
      if (amount > 0) {
        destinations.push(
          createFlowItem(transaction, key, label, amount, "in"),
        );
      }
    }
  } else if (transaction.type === "expense") {
    const order: Array<[FlowKey, string]> =
      transaction.expenseTiming === "prepaid"
        ? [
            ["buffer", "缓冲金"],
            ["reserve", "储备金"],
            ["advance", "周期日常剩余"],
          ]
        : transaction.category === "large"
          ? [
              ["buffer", "缓冲金"],
              ["advance", "周期日常剩余"],
            ]
          : transaction.category === "fixed"
            ? [
                ["fixed", "固定预留"],
                ["week", "周期日常剩余"],
                ["buffer", "缓冲金"],
                ["advance", "后续周预算"],
              ]
            : [
                ["week", "本周预算"],
                ["buffer", "缓冲金"],
                ["advance", "后续周预算"],
              ];
    for (const [key, label] of order) {
      const amount = allocation[key];
      if (amount > 0) {
        sources.push(createFlowItem(transaction, key, label, amount, "out"));
      }
    }
    const oldKeys: Array<[FlowKey, string]> = [
      ["week", "本周预算"],
      ["buffer", "缓冲金"],
      ["advance", "周期日常剩余"],
      ["reserve", "储备金"],
      ["fixed", "固定预留"],
    ];
    for (const [key, label] of oldKeys) {
      if (allocation[key] > 0 && !sources.some((item) => item.key === key))
        sources.push(
          createFlowItem(transaction, key, label, allocation[key], "out"),
        );
    }
  } else if (transaction.transferKind === "weeklyRollover") {
    if (allocation.week > 0) {
      sources.push(
        createFlowItem(
          transaction,
          "week",
          transaction.weekIndex === undefined
            ? "预算周余额"
            : `第 ${transaction.weekIndex + 1} 周余额`,
          allocation.week,
          "out",
        ),
      );
    }
    if (allocation.buffer > 0) {
      destinations.push(
        createFlowItem(
          transaction,
          "buffer",
          "缓冲金",
          allocation.buffer,
          "in",
        ),
      );
    }
    if (allocation.reserve > 0) {
      destinations.push(
        createFlowItem(
          transaction,
          "reserve",
          "储备金",
          allocation.reserve,
          "in",
        ),
      );
    }
  } else {
    if (allocation.buffer < 0) {
      sources.push(
        createFlowItem(
          transaction,
          "buffer",
          "缓冲金",
          allocation.buffer,
          "out",
        ),
      );
    }
    if (allocation.reserve > 0) {
      destinations.push(
        createFlowItem(
          transaction,
          "reserve",
          "储备金",
          allocation.reserve,
          "in",
        ),
      );
    }
  }

  const allocatedTotal =
    transaction.type === "transfer"
      ? transaction.amount
      : Math.max(0, allocation.week) +
        Math.max(0, allocation.buffer) +
        Math.max(0, allocation.advance) +
        Math.max(0, allocation.reserve) +
        Math.max(0, allocation.fixed);
  const gap = Math.max(
    0,
    Math.round((transaction.amount - allocatedTotal) * 100) / 100,
  );
  return { sources, destinations, gap };
};

const formatCreatedTime = (createdAt?: string) => {
  if (!createdAt) {
    return "";
  }
  const value = new Date(createdAt);
  if (!Number.isFinite(value.getTime())) {
    return "";
  }
  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const fieldClass =
  "life-field w-full rounded-xl border-0 bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line)] focus:ring-2 focus:ring-[var(--accent)]";

const SectionShell: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = "" }) => (
  <section className={`life-section ${className}`}>{children}</section>
);

const BottomSheet: React.FC<{
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  layer?: "default" | "detail";
  error?: string;
  onClearError?: () => void;
  saved?: boolean;
}> = ({ children, title, onClose, layer, error, onClearError, saved }) => {
  const nodes = React.Children.toArray(children);
  const footer = nodes.find(
    (node) =>
      React.isValidElement(node) &&
      (node.type === SubmitButton ||
        (typeof node.props === "object" &&
          node.props !== null &&
          "className" in node.props &&
          typeof node.props.className === "string" &&
          node.props.className.includes("life-primary-button"))),
  );
  const content = nodes.filter((node) => node !== footer);
  const isPage =
    layer === "detail" ||
    ["周期详情", "历史流水", "预算设置", "初始设置"].includes(title);
  return (
    <Overlay
      title={title}
      variant={isPage ? "page" : "sheet"}
      onClose={onClose}
      saved={saved}
      protectEdits={!["周期详情", "历史流水", "资金流向"].includes(title)}
      footer={footer}
      error={
        title === "记支出" && error === "请输入支出金额" ? undefined : error
      }
      onClearError={onClearError}
    >
      {content}
    </Overlay>
  );
};

const TransactionFlowDetail: React.FC<{
  transaction: DailyTransaction;
  kindLabel: string;
}> = ({ transaction, kindLabel }) => {
  const { sources, destinations, gap } = getTransactionFlow(transaction);
  const hasSnapshots = Boolean(
    transaction.balanceBefore && transaction.balanceAfter,
  );
  const items = [...sources, ...destinations];
  const totalAllocated =
    transaction.type === "transfer"
      ? transaction.amount
      : items.reduce((total, item) => total + item.amount, 0);
  return (
    <div>
      <section className="ui-card life-flow-summary">
        <span className="ui-badge">{kindLabel}</span>
        <h3>{transaction.desc || kindLabel}</h3>
        <div
          className={`life-flow-amount ui-num ${getTransactionAmountClass(transaction)}`}
        >
          {formatTransactionAmount(transaction)}
        </div>
        <p className="ui-help">
          {formatDisplayDate(transaction.date)}
          {transaction.createdAt
            ? ` · 记录于 ${formatCreatedTime(transaction.createdAt)}`
            : ""}
        </p>
        {transaction.expenseTiming === "prepaid" && (
          <p className="ui-help">
            付款 {formatDisplayDate(transaction.date)} → 归属{" "}
            {formatDisplayDate(transaction.effectiveDate ?? transaction.date)}
          </p>
        )}
      </section>
      {transaction.allocation && (
        <>
          <h3 className="mt-6">
            {transaction.type === "transfer"
              ? "内部转账"
              : transaction.type === "income"
                ? "资金去向"
                : "资金来源"}{" "}
            <span className="ui-help">· 真实分配</span>
          </h3>
          {items.map((item) => (
            <section
              className="ui-card life-flow-fund"
              key={`${item.direction}-${item.key}`}
            >
              <div className="flex items-center justify-between gap-3">
                <b>{item.label}</b>
                <b
                  className={`ui-num ${item.direction === "in" ? "ui-positive" : "ui-negative"}`}
                >
                  {item.direction === "in" ? "+" : "−"}
                  {formatAmount(item.amount)}
                </b>
              </div>
              {hasSnapshots && (
                <div className="life-flow-calculation ui-num">
                  <span>{formatAmount(item.balanceBefore ?? 0)}</span>
                  <span
                    className={
                      item.direction === "in" ? "ui-positive" : "ui-negative"
                    }
                  >
                    {item.direction === "in" ? "+" : "−"}{" "}
                    {formatAmount(item.amount)}
                  </span>
                  <span>
                    {Math.abs(
                      (item.balanceBefore ?? 0) +
                        (item.direction === "in" ? item.amount : -item.amount) -
                        (item.balanceAfter ?? 0),
                    ) < 0.015
                      ? "="
                      : "记录后"}{" "}
                    {formatAmount(item.balanceAfter ?? 0)}
                  </span>
                </div>
              )}
            </section>
          ))}
          {!hasSnapshots && (
            <div className="ui-warning mt-4">
              <span className="ui-badge ui-badge-warning">旧记录</span>
              <p className="mt-2">
                这条旧记录缺少前后余额快照，因此不显示「原余额 ± 变化 =
                新余额」，也不会用现在的余额反推历史。
              </p>
            </div>
          )}
          {gap > 0 && (
            <div className="life-flow-gap">
              <b>资金缺口 {formatAmount(gap)}</b>
              <p className="mt-1">未被任何口袋覆盖，不显示被扣款的口袋。</p>
            </div>
          )}
          {transaction.type !== "transfer" && (
            <p className="ui-help text-center mt-5 ui-num">
              各分配 {formatAmount(totalAllocated)}
              {gap > 0 ? ` + 缺口 ${formatAmount(gap)}` : ""} ={" "}
              {formatAmount(transaction.amount)}
            </p>
          )}
          {transaction.type === "transfer" && (
            <p className="ui-help mt-4">
              系统结转是口袋间内部转账，不计入收入或支出。
            </p>
          )}
        </>
      )}
      {!transaction.allocation && (
        <p className="ui-warning mt-4">
          旧记录未保存资金分配，展示记录本身的信息。
        </p>
      )}
    </div>
  );
};

const TransactionEventRow: React.FC<{
  transaction: DailyTransaction;
  kindLabel: string;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ transaction, kindLabel, onOpen, onDelete }) => (
  <li className="life-event-row flex items-center gap-2 rounded-xl bg-[var(--card)] px-3 py-2">
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
      aria-label={`查看${kindLabel} ${transaction.desc}的资金流向`}
    >
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-[var(--text)]">
          {kindLabel}
          <span className="ml-2 font-medium text-[var(--muted)]">
            {transaction.desc}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {transaction.expenseTiming === "prepaid"
            ? `付款 ${formatDisplayDate(transaction.date)} · 归属 ${formatDisplayDate(transaction.effectiveDate ?? transaction.date)}`
            : formatDisplayDate(transaction.date)}
        </div>
      </div>
      <div
        className={`shrink-0 text-xs font-bold ${getTransactionAmountClass(transaction)}`}
      >
        {formatTransactionAmount(transaction)}
      </div>
    </button>
    {transaction.type !== "transfer" && (
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded-lg p-1 text-[var(--muted)] transition hover:bg-[var(--card)] hover:text-[var(--neg)]"
        title="删除"
        aria-label={`删除 ${transaction.desc}`}
      >
        <Trash2 size={18} />
      </button>
    )}
  </li>
);

export const DailyLedger: React.FC<DailyLedgerProps> = ({
  appControls,
  data,
  setData,
  theme,
}) => {
  const { confirm, notify } = useUi();
  const [formError, setFormError] = useState("");
  const today = getTodayDate();
  const snapshot = useMemo(() => getBudgetSnapshot(data, today), [data, today]);
  const { budget, cycle, week } = snapshot;
  const [panel, setPanel] = useState<Panel>(
    budget.initialized ? null : "settings",
  );
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [summaryCard, setSummaryCard] = useState<"pending" | "fixed">(
    "pending",
  );
  const [summaryTouchStart, setSummaryTouchStart] = useState<number | null>(
    null,
  );
  const [showCycleWeeks, setShowCycleWeeks] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<DailyTransaction | null>(null);
  const [visibleEventCount, setVisibleEventCount] = useState(20);

  const [setupForm, setSetupForm] = useState({
    spendable: String(budget.pockets.spendable || ""),
    buffer: String(budget.pockets.buffer || ""),
    reserve: String(budget.pockets.reserve || ""),
    reserveFixedAmount: String(budget.settings.reserveFixedAmount || ""),
    bufferFixedAmount: String(budget.settings.bufferFixedAmount || ""),
    reserveGoal: String(budget.settings.reserveGoal || ""),
    bufferCap: String(budget.settings.bufferCap || ""),
    minimumWeeklyLiving: String(budget.settings.minimumWeeklyLiving),
    reserveMinimumOverride:
      budget.settings.reserveMinimumOverride === null
        ? ""
        : String(budget.settings.reserveMinimumOverride),
  });
  const [incomeForm, setIncomeForm] = useState({
    amount: "",
    date: today,
    desc: "",
    incomeKind: "main" as DailyIncomeKind,
  });
  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    date: today,
    effectiveDate: today,
    desc: "",
    category: "daily" as DailyExpenseCategory,
    isPrepaid: false,
  });
  const [calibrationAmount, setCalibrationAmount] = useState("");
  const [fixedForm, setFixedForm] = useState({
    name: "",
    amount: "",
    dueDay: "1",
  });
  const [fixedReservedAmount, setFixedReservedAmount] = useState("");

  const weekOverdrawn = week
    ? Math.max(0, snapshot.weekSpent - week.allowance)
    : 0;
  const weekProgress =
    week && week.allowance > 0
      ? Math.min(100, Math.round((snapshot.weekSpent / week.allowance) * 100))
      : 0;
  const reserveProgress =
    budget.settings.reserveGoal > 0
      ? Math.min(
          100,
          Math.round(
            (budget.pockets.reserve / budget.settings.reserveGoal) * 100,
          ),
        )
      : 100;
  const actualBookBalance = snapshot.calibratableBalance;
  const shouldRecommendLarge =
    !expenseForm.isPrepaid &&
    (parseAmount(expenseForm.amount) >=
      budget.settings.largeExpenseAbsoluteThreshold ||
      ((week?.allowance ?? 0) > 0 &&
        parseAmount(expenseForm.amount) >=
          (week?.allowance ?? 0) * budget.settings.largeExpenseWeeklyRate));
  const prepaidHintTotal = snapshot.prepaidInCycle + snapshot.upcomingPrepaid;
  const activeFixedExpenses = budget.fixedExpenses.filter(
    (item) => item.isActive,
  );
  const activeFixedExpenseTotal = activeFixedExpenses.reduce(
    (total, item) => total + item.amount,
    0,
  );
  const fixedReserveGap = Math.max(
    0,
    activeFixedExpenseTotal - budget.pockets.fixedReserved,
  );
  const willAutoReserveFixed =
    incomeForm.incomeKind === "main" && fixedReserveGap > 0;

  const allEvents = useMemo(
    () =>
      data.transactions
        .map((transaction, index) => ({ transaction, index }))
        .sort((left, right) => {
          const dateOrder = right.transaction.date.localeCompare(
            left.transaction.date,
          );
          if (dateOrder !== 0) {
            return dateOrder;
          }
          if (left.transaction.createdAt && right.transaction.createdAt) {
            const createdOrder = right.transaction.createdAt.localeCompare(
              left.transaction.createdAt,
            );
            if (createdOrder !== 0) {
              return createdOrder;
            }
          } else if (
            left.transaction.createdAt ||
            right.transaction.createdAt
          ) {
            return right.transaction.createdAt ? 1 : -1;
          }
          return right.index - left.index;
        })
        .map(({ transaction }) => transaction),
    [data.transactions],
  );
  const recentEvents = allEvents.slice(0, 3);
  const visibleEvents = allEvents.slice(0, visibleEventCount);
  const getTransactionKindLabel = (
    transaction: DailyData["transactions"][number],
  ) =>
    transaction.type === "transfer"
      ? transferKindLabels[transaction.transferKind ?? "weeklyRollover"]
      : transaction.type === "income"
        ? incomeKindLabels[transaction.incomeKind ?? "casual"]
        : transaction.expenseTiming === "prepaid"
          ? "提前支付"
          : categoryLabels[transaction.category ?? "other"];
  const expensePreview = useMemo(() => {
    const amount = parseAmount(expenseForm.amount);
    if (
      amount <= 0 ||
      expenseForm.isPrepaid ||
      expenseForm.category === "large"
    )
      return null;
    const next = recordExpense(data, {
      amount,
      category: expenseForm.category,
      date: expenseForm.date,
      desc: expenseForm.desc,
    });
    return getBudgetSnapshot(next, today).weekRemaining;
  }, [data, expenseForm, today]);
  const cycleSummaries = useMemo(() => getBudgetCycleSummaries(data), [data]);
  const currentCycleSummary = cycleSummaries[0];
  const cycleDailyRemaining = budget.pockets.spendable;
  const cycleUsableBalance =
    cycleDailyRemaining + budget.pockets.buffer + budget.pockets.fixedReserved;
  const cycleTotalBalance = cycleUsableBalance + budget.pockets.reserve;
  const weekSpent = week
    ? Math.max(0, (week.allowance ?? 0) - snapshot.weekRemaining)
    : 0;

  const getWeekStatus = (startDate: string, endDate: string) => {
    if (startDate > today) {
      return "future";
    }
    if (endDate < today) {
      return "past";
    }
    return "current";
  };

  const openPanel = (nextPanel: Panel) => {
    setSettingsSaved(false);
    setFormError("");
    if (nextPanel === "cycle") {
      setShowCycleWeeks(false);
    }
    if (nextPanel === "events" && panel !== "events") {
      setVisibleEventCount(20);
    }
    setPanel((prev) => (prev === nextPanel ? null : nextPanel));
  };

  useEffect(() => {
    setData((prev) => applyDueBudgetRollovers(prev, today));
  }, [setData, today]);

  useEffect(() => {
    if (panel !== "settings") {
      return;
    }

    setSetupForm({
      spendable: String(budget.pockets.spendable || ""),
      buffer: String(budget.pockets.buffer || ""),
      reserve: String(budget.pockets.reserve || ""),
      reserveFixedAmount: String(budget.settings.reserveFixedAmount || ""),
      bufferFixedAmount: String(budget.settings.bufferFixedAmount || ""),
      reserveGoal: String(budget.settings.reserveGoal || ""),
      bufferCap: String(budget.settings.bufferCap || ""),
      minimumWeeklyLiving: String(budget.settings.minimumWeeklyLiving),
      reserveMinimumOverride:
        budget.settings.reserveMinimumOverride === null
          ? ""
          : String(budget.settings.reserveMinimumOverride),
    });
  }, [budget, panel]);

  const handleInitialize = () => {
    setData((prev) =>
      initializeLifeBudget(prev, {
        spendable: parseAmount(setupForm.spendable),
        buffer: parseAmount(setupForm.buffer),
        reserve: parseAmount(setupForm.reserve),
        settings: {
          reserveFixedAmount:
            parseAmount(setupForm.reserveFixedAmount) ||
            budget.settings.reserveFixedAmount,
          bufferFixedAmount:
            parseAmount(setupForm.bufferFixedAmount) ||
            budget.settings.bufferFixedAmount,
          reserveGoal:
            parseAmount(setupForm.reserveGoal) || budget.settings.reserveGoal,
          bufferCap:
            parseAmount(setupForm.bufferCap) || budget.settings.bufferCap,
          reserveMinimumOverride:
            setupForm.reserveMinimumOverride === ""
              ? null
              : parseAmount(setupForm.reserveMinimumOverride),
          minimumWeeklyLiving:
            parseAmount(setupForm.minimumWeeklyLiving) ||
            budget.settings.minimumWeeklyLiving,
        },
      }),
    );
    setPanel(null);
  };

  const handleIncomeSubmit = async () => {
    setFormError("");
    const amount = parseAmount(incomeForm.amount);
    if (amount <= 0) {
      setFormError("请输入收入金额");
      return;
    }

    if (
      willAutoReserveFixed &&
      !(await confirm(
        `本次会先补足固定预留缺口 ${formatAmount(Math.min(amount, fixedReserveGap))}，剩余金额再分配。继续吗？`,
      ))
    ) {
      return;
    }

    setData((prev) =>
      allocateIncome(prev, {
        amount,
        date: incomeForm.date,
        desc: incomeForm.desc,
        incomeKind: incomeForm.incomeKind,
      }),
    );
    setIncomeForm((prev) => ({ ...prev, amount: "", desc: "" }));
    setPanel(null);
  };

  const handleExpenseSubmit = async () => {
    setFormError("");
    const amount = parseAmount(expenseForm.amount);
    if (amount <= 0) {
      setFormError("请输入支出金额");
      return;
    }

    if (
      expenseForm.isPrepaid &&
      normalizeDateInput(expenseForm.effectiveDate) <=
        normalizeDateInput(expenseForm.date)
    ) {
      setFormError("未来开销的归属日期要晚于付款日期");
      return;
    }

    const paymentWeek = findBudgetWeekForDate(cycle, expenseForm.date);
    const effectiveWeek = findBudgetWeekForDate(
      cycle,
      expenseForm.effectiveDate,
    );
    if (
      expenseForm.isPrepaid &&
      paymentWeek &&
      effectiveWeek &&
      paymentWeek.index === effectiveWeek.index
    ) {
      setFormError(
        "归属日期仍在付款所在预算周，会计入本周已用。请选下一预算周或更晚日期。",
      );
      return;
    }

    if (
      expenseForm.isPrepaid &&
      amount > budget.pockets.buffer + budget.pockets.reserve &&
      !(await confirm(
        "缓冲金和储备金不足，差额会从当前可用余额扣除，仍然记录吗？",
      ))
    ) {
      return;
    }

    const category =
      shouldRecommendLarge && expenseForm.category !== "large"
        ? (await confirm("这笔支出较大，要按“大额支出”处理吗？"))
          ? "large"
          : expenseForm.category
        : expenseForm.category;

    if (
      category === "large" &&
      amount > budget.pockets.buffer + budget.pockets.spendable &&
      !(await confirm("缓冲金和当前可消费余额不足，仍然记录吗？"))
    ) {
      return;
    }

    setData((prev) =>
      recordExpense(prev, {
        amount,
        category,
        date: expenseForm.date,
        desc: expenseForm.desc,
        effectiveDate: expenseForm.isPrepaid
          ? expenseForm.effectiveDate
          : undefined,
        expenseTiming: expenseForm.isPrepaid ? "prepaid" : undefined,
      }),
    );
    setExpenseForm((prev) => ({
      ...prev,
      amount: "",
      desc: "",
      category: "daily",
      isPrepaid: false,
      effectiveDate: getDefaultPrepaidEffectiveDate(prev.date, cycle),
    }));
    setPanel(null);
  };

  const handleCalibrationSubmit = () => {
    setFormError("");
    const amount = parseAmount(calibrationAmount);
    if (amount < 0) {
      setFormError("请输入当前可消费余额");
      return;
    }

    setData((prev) => calibrateSpendableBalance(prev, amount, today));
    setCalibrationAmount("");
    setPanel(null);
  };

  const handleAddFixedExpense = () => {
    setFormError("");
    const amount = parseAmount(fixedForm.amount);
    const dueDay = Math.round(parseAmount(fixedForm.dueDay));
    if (!fixedForm.name.trim() || amount <= 0 || dueDay <= 0) {
      setFormError("请完善固定支出");
      return;
    }

    setData((prev) =>
      addFixedExpense(prev, {
        name: fixedForm.name.trim(),
        amount,
        dueDay,
      }),
    );
    setFixedForm({ name: "", amount: "", dueDay: "1" });
  };

  const handleDeleteFixedExpense = async (fixedExpenseId: number) => {
    const fixedExpense = activeFixedExpenses.find(
      (item) => item.id === fixedExpenseId,
    );
    if (!fixedExpense) return;

    if (
      !(await confirm(
        `删除固定支出“${fixedExpense.name}”吗？历史付款记录会保留。`,
      ))
    ) {
      return;
    }

    setData((prev) => deleteFixedExpense(prev, fixedExpenseId));
  };

  const handleFixedReservedSubmit = () => {
    setFormError("");
    const amount = parseAmount(fixedReservedAmount);
    if (amount < 0) {
      setFormError("请输入固定支出预留金额");
      return;
    }
    setData((prev) => adjustFixedReserved(prev, amount));
    setFixedReservedAmount("");
    setSettingsSaved(true);
    notify("固定预留已保存");
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (
      !(await confirm(
        "确定用导入文件覆盖当前生活预算数据吗？旧流水和预算状态都会被替换。",
      ))
    ) {
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: "array" });
        const importedData = parseDailyImportWorkbook(
          workbook,
          DEFAULT_DAILY_DATA,
        );
        setData(importedData);
        notify(`导入成功，共恢复 ${importedData.transactions.length} 条记录`);
      } catch {
        setFormError("导入失败");
      } finally {
        input.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDeleteTransaction = async (transactionId: number) => {
    if (
      !(await confirm(
        "确定删除这条记录吗？相关余额会按这条记录的分配自动回滚。",
      ))
    ) {
      return;
    }
    setData((prev) => deleteDailyTransaction(prev, transactionId));
    return true;
  };

  const updateSettings = (nextSettings: Partial<LifeBudgetSettings>) => {
    setData((prev) => {
      const currentBudget = getLifeBudget(prev);
      const settings = {
        ...currentBudget.settings,
        ...nextSettings,
      };
      const bufferOverflow =
        settings.bufferCap > 0
          ? Math.max(0, currentBudget.pockets.buffer - settings.bufferCap)
          : currentBudget.pockets.buffer;

      return {
        ...prev,
        budget: {
          ...currentBudget,
          settings,
          pockets:
            bufferOverflow > 0
              ? {
                  ...currentBudget.pockets,
                  buffer: Math.max(
                    0,
                    currentBudget.pockets.buffer - bufferOverflow,
                  ),
                  reserve: currentBudget.pockets.reserve + bufferOverflow,
                }
              : currentBudget.pockets,
        },
      };
    });
    setSettingsSaved(true);
  };

  return (
    <div
      className={`life-budget life-budget-${theme} relative space-y-4 animate-fade-in`}
    >
      <header className="flex items-center justify-between gap-3 mb-5">
        <div>
          <div className="ui-help mt-0">
            {new Date(`${today}T12:00:00`).toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
            })}{" "}
            ·{" "}
            {new Date(`${today}T12:00:00`).toLocaleDateString("zh-CN", {
              weekday: "long",
            })}
          </div>
          <h1>生活预算</h1>
        </div>
        <button
          className="ui-icon-button"
          onClick={() => openPanel("settings")}
          aria-label="预算设置"
        >
          <Settings size={20} />
        </button>
      </header>
      {!panel && <InlineError message={formError} />}
      {!budget.initialized && (
        <div className="ui-warning">
          <b>先建立生活预算</b>
          <p>填写当前余额开始使用，旧流水会保留。</p>
          <button
            className="ui-button mt-3"
            onClick={() => openPanel("settings")}
          >
            初始设置
          </button>
        </div>
      )}
      <section className="life-week-card">
        {cycle ? (
          <>
            <div className="life-week-subtitle">
              <b>本周剩余</b>
              <span>
                {week
                  ? `${formatBudgetDate(week.startDate)} — ${formatBudgetDate(week.endDate)}`
                  : "暂无预算周"}
              </span>
            </div>
            <div
              className={`life-week-amount ${weekOverdrawn > 0 ? "is-over" : ""}`}
            >
              {formatAmount(snapshot.weekRemaining)}
            </div>
            {weekOverdrawn > 0 && (
              <p className="ui-negative text-sm mb-3">
                本周超支 {formatAmount(weekOverdrawn)}
              </p>
            )}
            <div
              className="life-track"
              role="progressbar"
              aria-label="本周预算消耗"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, weekProgress)}
            >
              <div
                className="life-track-fill"
                style={{ width: `${Math.max(0, weekProgress)}%` }}
              />
            </div>
            <div className="life-week-subtitle mt-2">
              <span>本周已用 {formatAmount(snapshot.weekSpent)}</span>
              <span>额度 {formatAmount(week?.allowance ?? 0)}</span>
            </div>
            <div className="life-balances">
              <div>
                周期日常剩余<b>{formatAmount(cycleDailyRemaining)}</b>
              </div>
              <div>
                缓冲金<b>{formatAmount(budget.pockets.buffer)}</b>
              </div>
            </div>
            <div className="life-pills">
              <button
                className="life-pill"
                aria-label={`周期 ${formatDisplayDate(cycle.startDate)} 至 ${formatDisplayDate(cycle.plannedEndDate)}，${snapshot.isExtended ? "延长期" : "进行中"}`}
                onClick={() => openPanel("cycle")}
              >
                周期 {formatBudgetDate(cycle.startDate)}–
                {formatBudgetDate(cycle.plannedEndDate)} ·{" "}
                {snapshot.isExtended ? "延长期" : "进行中"} ›
              </button>
              {prepaidHintTotal > 0 && (
                <button
                  className="life-pill life-pill-warning"
                  onClick={() => {
                    openPanel("cycle");
                    window.setTimeout(
                      () =>
                        document
                          .getElementById("prepaid-list")
                          ?.scrollIntoView({ block: "start" }),
                      50,
                    );
                  }}
                >
                  提前支付 {formatAmount(prepaidHintTotal)} ›
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="ui-empty">
            <h2>开始你的第一个预算周期</h2>
            <p>收入分配后，生成本周额度与周期安排。</p>
            <button className="ui-key" onClick={() => openPanel("income")}>
              收入分配
            </button>
          </div>
        )}
      </section>
      <section className="life-record-row">
        <button
          className="life-primary-entry"
          onClick={() => openPanel("expense")}
        >
          <Plus size={30} />
          记一笔
        </button>
        <div className="ui-card life-summary">
          <div className="life-summary-tabs">
            <button
              aria-pressed={summaryCard === "pending"}
              onClick={() => setSummaryCard("pending")}
            >
              待处理
            </button>
            <button
              aria-pressed={summaryCard === "fixed"}
              onClick={() => setSummaryCard("fixed")}
            >
              固定预留
            </button>
          </div>
          <div
            onTouchStart={(event) =>
              setSummaryTouchStart(event.touches[0]?.clientX ?? null)
            }
            onTouchEnd={(event) => {
              if (summaryTouchStart !== null) {
                const delta =
                  (event.changedTouches[0]?.clientX ?? summaryTouchStart) -
                  summaryTouchStart;
                if (Math.abs(delta) > 28)
                  setSummaryCard(delta < 0 ? "fixed" : "pending");
              }
              setSummaryTouchStart(null);
            }}
          >
            {summaryCard === "pending" ? (
              <>
                <div className="life-summary-row">
                  <span>固定支出</span>
                  <b>{snapshot.pendingFixed.length} 笔</b>
                </div>
                <div className="life-summary-row">
                  <span>余额校准</span>
                  <b>{snapshot.needsCalibration ? "可做" : "无需"}</b>
                </div>
                <div className="life-summary-row">
                  <span>储备缺口</span>
                  <b>
                    {snapshot.reserveGap > 0
                      ? formatAmount(snapshot.reserveGap)
                      : "无"}
                  </b>
                </div>
              </>
            ) : (
              <>
                <b className="ui-num text-xl">
                  {formatAmount(budget.pockets.fixedReserved)}
                </b>
                <div className="life-summary-row">
                  <span>本期固定项</span>
                  <b>{activeFixedExpenses.length}</b>
                </div>
                <div className="life-summary-row">
                  <span>待确认</span>
                  <b>{snapshot.pendingFixed.length}</b>
                </div>
              </>
            )}
          </div>
          <div className="life-summary-dots">
            <span className={summaryCard === "pending" ? "selected" : ""} />
            <span className={summaryCard === "fixed" ? "selected" : ""} />
          </div>
        </div>
      </section>
      <section className="life-quick-actions">
        <button
          className="life-action-button"
          onClick={() => openPanel("income")}
        >
          <CircleDollarSign />
          收入分配
        </button>
        <button
          className="life-action-button"
          onClick={() => openPanel("calibration")}
        >
          <RefreshCw />
          余额校准
        </button>
        <button
          className="life-action-button"
          onClick={() => openPanel("fixed")}
        >
          <Landmark />
          固定支出
        </button>
      </section>
      <SectionShell>
        <div className="flex justify-between items-center gap-2">
          <h3>每周预算消耗</h3>
          <span className="ui-help">本周期</span>
        </div>
        <div className="ui-help">已花 · 未来周斜纹表示提前支付</div>
        {(currentCycleSummary?.weeks.length ?? 0) > 0 ? (
          <div
            className="life-weekly-chart"
            role="group"
            aria-label="每周预算与提前支付"
          >
            {(currentCycleSummary?.weeks ?? []).map((item) => {
              const status = getWeekStatus(item.startDate, item.endDate);
              const spent =
                status === "future" ? item.prepaidSpent : item.spent;
              const percent = Math.min(
                100,
                Math.max(0, (spent / Math.max(1, item.allowance)) * 100),
              );
              return (
                <button
                  className={`life-week-column ${status}`}
                  key={item.index}
                  onClick={() => openPanel("cycle")}
                  aria-label={`第${item.index + 1}周，预算${formatAmount(item.allowance)}，${status === "future" ? "提前支付" : "已花"}${formatAmount(spent)}`}
                >
                  <div className="life-week-well">
                    <div
                      className={`life-week-fill ${status === "future" && spent > 0 ? "prepaid" : ""}`}
                      style={{ height: `${percent}%` }}
                    />
                  </div>
                  {status === "current" ? "本周" : `第${item.index + 1}周`}
                  <b>
                    {status === "future"
                      ? spent > 0
                        ? `提前 ${formatAmount(spent)}`
                        : `预算 ${formatAmount(item.allowance)}`
                      : `剩 ${formatAmount(item.remaining)}`}
                  </b>
                  <span>
                    {status === "past"
                      ? "已结束"
                      : status === "future"
                        ? "未来"
                        : "当前"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ui-empty">收入分配后显示周期节奏。</p>
        )}
      </SectionShell>

      {panel === "cycle" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<CalendarDays size={16} />}
          title="周期详情"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          {cycle ? (
            <>
              <section className="life-cycle-total mt-3 rounded-2xl border p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-[var(--muted)]">
                      总金额
                    </div>
                    <div className="mt-1 text-3xl font-bold tracking-normal">
                      {formatAmount(cycleTotalBalance)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-[var(--muted)]">
                      总金额 = 可动用余额 + 储备金
                    </div>
                  </div>
                  <div className="life-cycle-status rounded-full px-2.5 py-1 text-xs font-bold">
                    {snapshot.isExtended
                      ? "延长期"
                      : cycle.status === "closed"
                        ? "已结束"
                        : "进行中"}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-[1.3fr_0.9fr] gap-2">
                  <div className="life-cycle-primary-balance rounded-xl px-3 py-2">
                    <div className="text-xs font-bold text-[var(--muted)]">
                      可动用余额
                    </div>
                    <b className="mt-0.5 block text-xl">
                      {formatAmount(cycleUsableBalance)}
                    </b>
                    <div className="mt-1 text-xs font-bold text-[var(--muted)]">
                      周期内可调度，不等于本周可花
                    </div>
                  </div>
                  <div className="life-cycle-reserve-balance rounded-xl px-3 py-2">
                    <div className="text-xs font-bold">储备金</div>
                    <b className="mt-0.5 block text-base">
                      {formatAmount(budget.pockets.reserve)} /{" "}
                      {formatAmount(budget.settings.reserveGoal)}
                    </b>
                    <div className="mt-1 text-xs font-bold">
                      目标进度 {reserveProgress}%
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs font-bold">
                  <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                    <span className="block text-[var(--muted)]">
                      本周期日常剩余
                    </span>
                    <b className="mt-0.5 block text-sm text-[var(--text)]">
                      {formatAmount(cycleDailyRemaining)}
                    </b>
                  </div>
                  <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                    <span className="block text-[var(--muted)]">缓冲金</span>
                    <b className="mt-0.5 block text-sm text-[var(--text)]">
                      {formatAmount(budget.pockets.buffer)}
                    </b>
                  </div>
                  <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                    <span className="block text-[var(--muted)]">固定预留</span>
                    <b className="mt-0.5 block text-sm text-[var(--text)]">
                      {formatAmount(budget.pockets.fixedReserved)}
                    </b>
                  </div>
                </div>
                <div className="mt-2 text-xs font-bold text-[var(--muted)]">
                  可动用余额 = 本周期日常剩余 + 缓冲金 + 固定预留
                </div>
              </section>

              <section className="mt-3 rounded-xl border-0 bg-[var(--card)] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-[var(--text)]">
                      本周提醒
                    </div>
                    <div className="mt-0.5 text-xs font-bold text-[var(--muted)]">
                      {week
                        ? `${formatDisplayDate(week.startDate)} - ${formatDisplayDate(week.endDate)}`
                        : "暂无本周预算"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-[var(--muted)]">
                      本周剩余
                    </div>
                    <b className="text-lg text-[var(--text)]">
                      {formatAmount(snapshot.weekRemaining)}
                    </b>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--track)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{
                      width: `${week && week.allowance > 0 ? Math.min(100, Math.round((weekSpent / week.allowance) * 100)) : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs font-bold text-[var(--muted)]">
                  <span>预算 {formatAmount(week?.allowance ?? 0)}</span>
                  <span>已花 {formatAmount(weekSpent)}</span>
                </div>
              </section>

              <section className="mt-3 rounded-xl border-0 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-[var(--text)]">当前周期</div>
                    <div className="mt-0.5 text-[var(--muted)]">
                      {formatDisplayDate(cycle.startDate)} -{" "}
                      {formatDisplayDate(cycle.plannedEndDate)}
                    </div>
                  </div>
                  <b>
                    {snapshot.isExtended
                      ? "延长期"
                      : cycle.status === "closed"
                        ? "已结束"
                        : "进行中"}
                  </b>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">周期收入</span>
                    <b className="block">
                      {formatAmount(
                        currentCycleSummary?.mainIncome ?? cycle.mainIncome,
                      )}
                      <span className="mx-1 text-[var(--muted)]">+</span>
                      {formatAmount(currentCycleSummary?.otherIncome ?? 0)}
                    </b>
                  </div>
                  <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">日常预算</span>
                    <b className="block">
                      {formatAmount(currentCycleSummary?.budget ?? 0)}
                    </b>
                  </div>
                  <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                    <span className="text-[var(--muted)]">储备增长</span>
                    <b className="block">
                      {formatAmount(currentCycleSummary?.reserveChange ?? 0)}
                    </b>
                  </div>
                </div>
                {(currentCycleSummary?.prepaidTotal ?? 0) > 0 && (
                  <div className="mt-2 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--pos)]">
                    周期总开销中，提前支付{" "}
                    {formatAmount(currentCycleSummary?.prepaidTotal ?? 0)}
                  </div>
                )}
              </section>

              <div className="mt-4">
                <button
                  onClick={() => setShowCycleWeeks((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-xl bg-[var(--card)] px-3 py-2 text-left text-xs font-bold text-[var(--text)]"
                >
                  <span>本周期每周明细</span>
                  <span className="text-[var(--muted)]">
                    {showCycleWeeks
                      ? "收起"
                      : `查看 ${currentCycleSummary?.weeks.length ?? 0} 周`}
                  </span>
                </button>
                {showCycleWeeks && (
                  <div className="mt-2 space-y-2">
                    {(currentCycleSummary?.weeks ?? []).map((item) => {
                      const weekStatus = getWeekStatus(
                        item.startDate,
                        item.endDate,
                      );
                      const headline =
                        weekStatus === "future"
                          ? `预算 ${formatAmount(item.allowance)}`
                          : `余额 ${formatAmount(item.remaining)}`;

                      return (
                        <div
                          key={`${item.startDate}-${item.endDate}`}
                          className="life-event-row rounded-xl bg-[var(--card)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <b>
                              第 {item.index + 1} 周 ·{" "}
                              {formatDisplayDate(item.startDate)} -{" "}
                              {formatDisplayDate(item.endDate)}
                            </b>
                            <span className="shrink-0 text-[var(--muted)]">
                              {headline}
                            </span>
                          </div>
                          {weekStatus === "future" ? (
                            <div className="mt-2 rounded-lg bg-[var(--card)] px-2 py-1.5 text-xs font-bold text-[var(--muted)]">
                              未来周显示预算；已记录提前支付{" "}
                              {formatAmount(item.prepaidSpent)}。
                            </div>
                          ) : (
                            <>
                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--track)]">
                                <div
                                  className="h-full rounded-full bg-[var(--accent)]"
                                  style={{
                                    width: `${item.allowance > 0 ? Math.min(100, Math.round((item.spent / item.allowance) * 100)) : 0}%`,
                                  }}
                                />
                              </div>
                              <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
                                <span>预算 {formatAmount(item.allowance)}</span>
                                <span>已花 {formatAmount(item.spent)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {(currentCycleSummary?.prepaidTransactions.length ?? 0) > 0 && (
                <div className="mt-4">
                  <h3
                    id="prepaid-list"
                    className="text-xs font-bold text-[var(--muted)]"
                  >
                    提前支付
                  </h3>
                  <div className="mt-2 space-y-2">
                    {(currentCycleSummary?.prepaidTransactions ?? []).map(
                      (transaction) => (
                        <div
                          key={transaction.id}
                          className="life-event-row flex items-center justify-between gap-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs"
                        >
                          <div>
                            <b>
                              {transaction.desc ||
                                categoryLabels[transaction.category ?? "other"]}
                            </b>
                            <div className="mt-0.5 text-xs text-[var(--muted)]">
                              付款 {formatDisplayDate(transaction.date)} · 归属{" "}
                              {formatDisplayDate(
                                transaction.effectiveDate ?? transaction.date,
                              )}
                            </div>
                          </div>
                          <b className="text-[var(--neg)]">
                            {formatAmount(transaction.amount)}
                          </b>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="life-help mt-3 rounded-xl bg-[var(--card)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">
              还没有预算周期。录入一次“主要收入”后，会生成当前周期和每周额度。
            </div>
          )}

          {cycleSummaries.length > 1 && (
            <div className="mt-4">
              <h3 className="text-xs font-bold text-[var(--muted)]">
                最近周期
              </h3>
              <div className="mt-2 space-y-2">
                {cycleSummaries
                  .slice(1, 5)
                  .map(
                    ({
                      cycle: item,
                      balance,
                      budget,
                      reserveChange,
                      otherIncome,
                      prepaidTotal,
                    }) => {
                      const isFutureCycle = item.startDate > today;
                      return (
                        <div
                          key={item.id}
                          className="life-event-row flex items-center justify-between rounded-xl bg-[var(--card)] px-3 py-2 text-xs"
                        >
                          <div>
                            <b>
                              {formatDisplayDate(item.startDate)} -{" "}
                              {formatDisplayDate(item.plannedEndDate)}
                            </b>
                            <div className="mt-0.5 text-xs text-[var(--muted)]">
                              收入 {formatAmount(item.mainIncome)} +{" "}
                              {formatAmount(otherIncome)} ·{" "}
                              {isFutureCycle ? "预算" : "结余"}{" "}
                              {formatAmount(isFutureCycle ? budget : balance)}
                              {prepaidTotal > 0
                                ? ` · 提前 ${formatAmount(prepaidTotal)}`
                                : ""}
                            </div>
                          </div>
                          <div className="text-right">
                            <b>
                              {item.status === "closed"
                                ? "已结束"
                                : item.status === "extended"
                                  ? "延长期"
                                  : "进行中"}
                            </b>
                            <div className="mt-0.5 text-xs text-[var(--muted)]">
                              储备 +{formatAmount(reserveChange)}
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {panel === "settings" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<Settings size={16} />}
          saved={settingsSaved}
          title={budget.initialized ? "预算设置" : "初始设置"}
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          {!budget.initialized && (
            <div className="life-help mt-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              填写建议：可消费余额填你现在准备用来日常花的钱；缓冲金可先填 0 或
              100；储备金填你已经攒下、可用于大额/兜底的钱。
            </div>
          )}
          {budget.initialized && (
            <div className="mt-3 rounded-2xl border-0 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--text)]">
                  <PiggyBank size={14} />
                  储备金概览
                </div>
                <span className="text-xs font-bold text-[var(--muted)]">
                  只在设置里查看
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--text)]">
                {formatAmount(budget.pockets.reserve)} /{" "}
                {formatAmount(budget.settings.reserveGoal)}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--track)]">
                <div
                  className={`h-full rounded-full ${
                    snapshot.reserveGap > 0
                      ? "bg-[var(--neg)]"
                      : "bg-[var(--pos)]"
                  }`}
                  style={{ width: `${reserveProgress}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                  <div className="text-[var(--muted)]">目标</div>
                  <b>{formatAmount(budget.settings.reserveGoal)}</b>
                </div>
                <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                  <div className="text-[var(--muted)]">最低线</div>
                  <b>{formatAmount(snapshot.reserveMinimum)}</b>
                </div>
                <div className="life-soft-row rounded-lg bg-[var(--card)] px-2 py-1.5">
                  <div className="text-[var(--muted)]">缺口</div>
                  <b>
                    {snapshot.reserveGap > 0
                      ? formatAmount(snapshot.reserveGap)
                      : "无"}
                  </b>
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {!budget.initialized && (
              <>
                <NumberField
                  label="当前可消费余额"
                  value={setupForm.spendable}
                  onChange={(spendable) =>
                    setSetupForm((prev) => ({ ...prev, spendable }))
                  }
                />
                <NumberField
                  label="当前缓冲金"
                  value={setupForm.buffer}
                  onChange={(buffer) =>
                    setSetupForm((prev) => ({ ...prev, buffer }))
                  }
                />
                <NumberField
                  label="当前储备金"
                  value={setupForm.reserve}
                  onChange={(reserve) =>
                    setSetupForm((prev) => ({ ...prev, reserve }))
                  }
                />
              </>
            )}
            <label className="text-xs font-bold text-[var(--muted)]">
              预计发薪日
              <div className={`${fieldClass} mt-1 flex items-center font-bold`}>
                每月 15 日，遇周末提前
              </div>
            </label>
            <NumberField
              label="储备固定金额"
              value={setupForm.reserveFixedAmount}
              onChange={(reserveFixedAmount) =>
                setSetupForm((prev) => ({ ...prev, reserveFixedAmount }))
              }
            />
            <NumberField
              label="缓冲固定金额"
              value={setupForm.bufferFixedAmount}
              onChange={(bufferFixedAmount) =>
                setSetupForm((prev) => ({ ...prev, bufferFixedAmount }))
              }
            />
            <label className="text-xs font-bold text-[var(--muted)]">
              当前固定预留
              <div className={`${fieldClass} mt-1 flex items-center font-bold`}>
                {formatAmount(budget.pockets.fixedReserved)}
              </div>
            </label>
            <NumberField
              label="储备金目标"
              value={setupForm.reserveGoal}
              onChange={(reserveGoal) =>
                setSetupForm((prev) => ({ ...prev, reserveGoal }))
              }
            />
            <NumberField
              label="缓冲金上限"
              value={setupForm.bufferCap}
              onChange={(bufferCap) =>
                setSetupForm((prev) => ({ ...prev, bufferCap }))
              }
            />
            <NumberField
              label="最低每周生活线"
              value={setupForm.minimumWeeklyLiving}
              onChange={(minimumWeeklyLiving) =>
                setSetupForm((prev) => ({ ...prev, minimumWeeklyLiving }))
              }
            />
            <label className="text-xs font-bold text-[var(--muted)]">
              储备金最低线覆盖
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={setupForm.reserveMinimumOverride}
                onChange={(event) =>
                  setSetupForm((prev) => ({
                    ...prev,
                    reserveMinimumOverride: event.target.value,
                  }))
                }
                placeholder="留空自动计算"
                className={`${fieldClass} mt-1`}
              />
            </label>
          </div>
          {budget.initialized && (
            <div className="mt-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              设置只影响之后的收入分配和提醒线，已经生成的预算周不会自动重算。
            </div>
          )}
          <button
            onClick={() => {
              if (!budget.initialized) {
                handleInitialize();
                return;
              }

              updateSettings({
                reserveFixedAmount:
                  parseAmount(setupForm.reserveFixedAmount) ||
                  budget.settings.reserveFixedAmount,
                bufferFixedAmount:
                  parseAmount(setupForm.bufferFixedAmount) ||
                  budget.settings.bufferFixedAmount,
                reserveGoal:
                  parseAmount(setupForm.reserveGoal) ||
                  budget.settings.reserveGoal,
                bufferCap:
                  parseAmount(setupForm.bufferCap) || budget.settings.bufferCap,
                reserveMinimumOverride:
                  setupForm.reserveMinimumOverride === ""
                    ? null
                    : parseAmount(setupForm.reserveMinimumOverride),
                minimumWeeklyLiving:
                  parseAmount(setupForm.minimumWeeklyLiving) ||
                  budget.settings.minimumWeeklyLiving,
              });
            }}
            className="life-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-[var(--on-accent)]"
          >
            <Check size={16} /> 保存生活预算设置
          </button>
          {settingsSaved && (
            <div className="mt-2 text-center text-xs font-bold text-[var(--pos)]">
              已保存设置
            </div>
          )}
          <BackupSection
            moduleName="生活预算"
            appControls={appControls}
            onExport={() =>
              exportDailyToExcel(
                data,
                new Date().getFullYear(),
                new Date().getMonth() + 1,
              )
            }
            onImport={handleImport}
          />
        </BottomSheet>
      )}

      {panel === "income" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<CircleDollarSign size={16} />}
          title="收入分配"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          <SegmentedChoices
            value={incomeForm.incomeKind}
            options={[
              ["main", "主要收入"],
              ["casual", "零散收入"],
              ["refund", "退款报销"],
            ]}
            onChange={(incomeKind) =>
              setIncomeForm((prev) => ({
                ...prev,
                incomeKind: incomeKind as DailyIncomeKind,
              }))
            }
          />
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
            <NumberField
              label="金额"
              value={incomeForm.amount}
              onChange={(amount) =>
                setIncomeForm((prev) => ({ ...prev, amount }))
              }
            />
            <DateField
              label="日期"
              value={incomeForm.date}
              onChange={(date) => setIncomeForm((prev) => ({ ...prev, date }))}
            />
            <TextField
              label="备注"
              value={incomeForm.desc}
              onChange={(desc) => setIncomeForm((prev) => ({ ...prev, desc }))}
              placeholder="如 6月工资、红包、退款"
            />
          </div>
          {incomeForm.incomeKind === "main" && (
            <div className="mt-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              {willAutoReserveFixed
                ? `主要收入会开启新的预算周期，并先补足固定预留缺口 ${formatAmount(fixedReserveGap)}。`
                : activeFixedExpenseTotal > 0
                  ? `主要收入会开启新的预算周期。当前固定预留已覆盖固定支出目标 ${formatAmount(activeFixedExpenseTotal)}，本次不会重复新增。`
                  : "主要收入会开启新的预算周期：剩余自动拆成储备金、本预算周额度和缓冲金。"}
            </div>
          )}
          <SubmitButton onClick={handleIncomeSubmit} label="确认分配" />
        </BottomSheet>
      )}

      {panel === "expense" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<ReceiptText size={16} />}
          title="记支出"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          <label className="ui-help">
            支出金额
            <div className="ui-amount-field">
              <span>¥</span>
              <input
                aria-label="支出金额"
                type="number"
                inputMode="decimal"
                step="any"
                value={expenseForm.amount}
                placeholder="0.00"
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))
                }
              />
            </div>
          </label>
          {formError === "请输入支出金额" && (
            <InlineError message={formError} />
          )}
          <div className="mt-3 grid grid-cols-5 gap-2">
            {[
              ["daily", "日常", <Wallet size={14} />],
              ["dining", "外食", <Utensils size={14} />],
              ["other", "其他", <Tag size={14} />],
              ["unplanned", "计划外", <AlertTriangle size={14} />],
              ["large", "大额", <Landmark size={14} />],
            ].map(([value, label, icon]) => (
              <button
                aria-pressed={expenseForm.category === value}
                key={String(value)}
                onClick={() =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    category: value as DailyExpenseCategory,
                  }))
                }
                className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border text-xs font-bold transition ${
                  expenseForm.category === value
                    ? "life-choice-active border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]"
                    : "life-choice border-[var(--line)] bg-[var(--card)] text-[var(--muted)]"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
            <DateField
              label={expenseForm.isPrepaid ? "付款日期" : "日期"}
              value={expenseForm.date}
              onChange={(date) =>
                setExpenseForm((prev) => ({
                  ...prev,
                  date,
                  effectiveDate:
                    prev.isPrepaid &&
                    normalizeDateInput(prev.effectiveDate) <
                      getDefaultPrepaidEffectiveDate(date, cycle)
                      ? getDefaultPrepaidEffectiveDate(date, cycle)
                      : prev.effectiveDate,
                }))
              }
            />
            <TextField
              label="备注"
              value={expenseForm.desc}
              onChange={(desc) => setExpenseForm((prev) => ({ ...prev, desc }))}
              placeholder="可选"
            />
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs font-bold text-[var(--muted)]">
            <span>
              未来开销
              <span className="block ui-help">先付款，归属到未来预算周</span>
            </span>
            <input
              type="checkbox"
              checked={expenseForm.isPrepaid}
              onChange={(event) =>
                setExpenseForm((prev) => ({
                  ...prev,
                  isPrepaid: event.target.checked,
                  effectiveDate: event.target.checked
                    ? getDefaultPrepaidEffectiveDate(prev.date, cycle)
                    : prev.effectiveDate,
                }))
              }
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </label>
          {expenseForm.isPrepaid && (
            <div className="mt-3 grid grid-cols-1 gap-3">
              <DateField
                label="归属日期"
                value={expenseForm.effectiveDate}
                onChange={(effectiveDate) =>
                  setExpenseForm((prev) => ({ ...prev, effectiveDate }))
                }
              />
              <div className="rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--pos)]">
                付款立即从缓冲金扣，不足时从储备金补；仍不足时按现有规则使用当前可用余额。计入归属日期所在预算周，不占付款周额度。归属日期须晚于付款日期，且不在付款所在预算周。
              </div>
            </div>
          )}
          {shouldRecommendLarge && expenseForm.category !== "large" && (
            <div className="mt-3 rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-xs font-bold text-[var(--neg)]">
              这笔金额较大，提交时会询问是否按大额支出处理。
            </div>
          )}
          {!expenseForm.isPrepaid && (
            <div className="ui-hint mt-4">
              {expenseForm.category === "large" ? (
                "大额支出使用缓冲金和周期日常剩余，资金分配以提交后流水为准。"
              ) : (
                <>
                  从本周预算扣款，不足时按现有规则补足。
                  <b className="block mt-1 ui-num">
                    本周剩余 {formatAmount(snapshot.weekRemaining)}
                    {expensePreview !== null
                      ? ` → ${formatAmount(expensePreview)}`
                      : ""}
                  </b>
                </>
              )}
            </div>
          )}
          <SubmitButton onClick={handleExpenseSubmit} label="记录支出" />
        </BottomSheet>
      )}

      {panel === "calibration" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<RefreshCw size={16} />}
          title="余额校准"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          <div className="mt-3 rounded-xl bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
            当前账面可消费余额为 {formatAmount(actualBookBalance)}
            。填写你现在除储备金外还能动用的钱，包含缓冲金和固定支出预留。这不是包含储备金的总资产；差异可能形成未记录支出或余额修正流水。
          </div>
          <div className="mt-3">
            <NumberField
              label="当前可消费余额"
              value={calibrationAmount}
              onChange={setCalibrationAmount}
            />
          </div>
          <SubmitButton onClick={handleCalibrationSubmit} label="完成校准" />
        </BottomSheet>
      )}

      {panel === "fixed" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<Landmark size={16} />}
          saved={settingsSaved}
          title="固定支出"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          <div className="life-soft-row rounded-2xl bg-[var(--card)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-[var(--muted)]">
                  固定支出预留
                </div>
                <div className="mt-1 text-2xl font-bold text-[var(--text)]">
                  {formatAmount(budget.pockets.fixedReserved)}
                </div>
              </div>
              <div className="text-right text-xs font-bold text-[var(--muted)]">
                留空或 0 时扣本周
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={fixedReservedAmount}
                onChange={(event) => setFixedReservedAmount(event.target.value)}
                aria-label="固定支出预留目标金额"
                placeholder="留空/0 不预留"
                className={fieldClass}
              />
              <button
                onClick={handleFixedReservedSubmit}
                className="rounded-xl bg-[var(--accent)] px-3 text-xs font-bold text-[var(--on-accent)]"
              >
                保存
              </button>
            </div>
            <div className="mt-2 text-xs font-bold text-[var(--muted)]">
              主要收入到账时会优先补足固定支出清单缺口；已覆盖目标时不会重复新增。手动增加预留从可消费余额、缓冲金移入，不增加总资产。
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[1.4fr_1fr_0.8fr] gap-2">
            <input
              value={fixedForm.name}
              onChange={(event) =>
                setFixedForm((prev) => ({ ...prev, name: event.target.value }))
              }
              aria-label="固定支出名称"
              placeholder="名称"
              className={fieldClass}
            />
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={fixedForm.amount}
              onChange={(event) =>
                setFixedForm((prev) => ({
                  ...prev,
                  amount: event.target.value,
                }))
              }
              aria-label="固定支出金额"
              placeholder="金额"
              className={fieldClass}
            />
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={fixedForm.dueDay}
              onChange={(event) =>
                setFixedForm((prev) => ({
                  ...prev,
                  dueDay: event.target.value,
                }))
              }
              aria-label="每月到期日"
              placeholder="日"
              className={fieldClass}
            />
          </div>
          <button
            onClick={handleAddFixedExpense}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--card)] px-4 py-2.5 text-xs font-bold text-[var(--muted)]"
          >
            <Plus size={14} /> 添加固定支出
          </button>
          <ul className="mt-3 space-y-2">
            {activeFixedExpenses.map((item) => (
              <li
                key={item.id}
                className="life-event-row flex items-center justify-between gap-3 rounded-xl border-0 bg-[var(--card)] px-3 py-2"
              >
                <div>
                  <div className="text-sm font-bold text-[var(--text)]">
                    {item.name}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {formatAmount(item.amount)} · 每月 {item.dueDay} 日
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "记录固定支出？",
                          body: `标记“${item.name}”已付会记录 ${formatAmount(item.amount)} 的实际支出，并扣除相应资金。`,
                          confirmLabel: "记录并标记已付",
                        })
                      )
                        setData((prev) => markFixedExpensePaid(prev, item.id));
                    }}
                    disabled={item.paidCycleId === cycle?.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                      item.paidCycleId === cycle?.id
                        ? "bg-[var(--accent-soft)] text-[var(--pos)]"
                        : "bg-[var(--accent)] text-[var(--on-accent)]"
                    }`}
                  >
                    {item.paidCycleId === cycle?.id ? "已支付" : "标记已付"}
                  </button>
                  <button
                    onClick={() => handleDeleteFixedExpense(item.id)}
                    className="ui-icon-button"
                    title="删除固定支出"
                    aria-label={`删除固定支出 ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
            {activeFixedExpenses.length === 0 && (
              <li className="rounded-xl bg-[var(--card)] px-3 py-4 text-center text-xs text-[var(--muted)]">
                暂无固定支出
              </li>
            )}
          </ul>
        </BottomSheet>
      )}

      <SectionShell className="p-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => openPanel("events")}
            className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]"
          >
            <ReceiptText size={14} />
            最近关键事件
          </button>
          <button
            onClick={() => openPanel("events")}
            className="text-xs font-bold text-[var(--muted)]"
          >
            查看全部
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {recentEvents.map((transaction) => (
            <TransactionEventRow
              key={transaction.id}
              transaction={transaction}
              kindLabel={getTransactionKindLabel(transaction)}
              onOpen={() => setSelectedTransaction(transaction)}
              onDelete={() => handleDeleteTransaction(transaction.id)}
            />
          ))}
          {recentEvents.length === 0 && (
            <li className="rounded-xl bg-[var(--card)] px-3 py-4 text-center text-xs text-[var(--muted)]">
              暂无记录
            </li>
          )}
        </ul>
      </SectionShell>

      {panel === "events" && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<ReceiptText size={16} />}
          title="历史流水"
          onClose={() => {
            setPanel(null);
            setFormError("");
          }}
        >
          <ul className="space-y-2">
            {visibleEvents.map((transaction) => (
              <TransactionEventRow
                key={transaction.id}
                transaction={transaction}
                kindLabel={getTransactionKindLabel(transaction)}
                onOpen={() => setSelectedTransaction(transaction)}
                onDelete={() => handleDeleteTransaction(transaction.id)}
              />
            ))}
            {allEvents.length === 0 && (
              <li className="rounded-xl bg-[var(--card)] px-3 py-4 text-center text-xs text-[var(--muted)]">
                暂无记录
              </li>
            )}
          </ul>
          {visibleEventCount < allEvents.length && (
            <button
              type="button"
              onClick={() => setVisibleEventCount((count) => count + 20)}
              className="mt-3 w-full rounded-xl border-0 bg-[var(--card)] px-3 py-2.5 text-xs font-bold text-[var(--muted)]"
            >
              加载更多（剩余 {allEvents.length - visibleEventCount} 条）
            </button>
          )}
        </BottomSheet>
      )}

      {selectedTransaction && (
        <BottomSheet
          error={formError}
          onClearError={() => {
            setFormError("");
            setSettingsSaved(false);
          }}
          icon={<ReceiptText size={16} />}
          title="资金流向"
          onClose={() => {
            setSelectedTransaction(null);
            setFormError("");
          }}
          layer="detail"
        >
          <TransactionFlowDetail
            transaction={selectedTransaction}
            kindLabel={getTransactionKindLabel(selectedTransaction)}
          />{" "}
          {selectedTransaction.type !== "transfer" && (
            <button
              className="ui-danger w-full mt-6"
              onClick={async () => {
                if (await handleDeleteTransaction(selectedTransaction.id))
                  setSelectedTransaction(null);
              }}
            >
              <Trash2 size={18} />
              删除这笔记录 · 回滚各口袋
            </button>
          )}
        </BottomSheet>
      )}
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <label className="text-xs font-bold text-[var(--muted)]">
    {label}
    <input
      type="number"
      inputMode="decimal"
      step="any"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${fieldClass} mt-1`}
    />
  </label>
);

const DateField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <label className="text-xs font-bold text-[var(--muted)]">
    {label}
    <input
      type="date"
      value={normalizeDateInput(value)}
      onChange={(event) => onChange(event.target.value)}
      className={`${fieldClass} mt-1`}
    />
  </label>
);

const TextField: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, onChange }) => (
  <label className="text-xs font-bold text-[var(--muted)]">
    {label}
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`${fieldClass} mt-1`}
    />
  </label>
);

const SegmentedChoices: React.FC<{
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="ui-segmented mt-3">
    {options.map(([optionValue, label]) => (
      <button
        aria-pressed={value === optionValue}
        key={optionValue}
        onClick={() => onChange(optionValue)}
        className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
          value === optionValue
            ? "bg-[var(--card)] text-[var(--text)] shadow-sm"
            : "text-[var(--muted)]"
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

const SubmitButton: React.FC<{ label: string; onClick: () => void }> = ({
  label,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="life-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-[var(--on-accent)]"
  >
    <Check size={16} />
    {label}
  </button>
);
