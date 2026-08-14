import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  Landmark,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings,
  Tag,
  Trash2,
  Upload,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { DEFAULT_DAILY_DATA } from '../lib/appData';
import { formatDisplayDate, getTodayDate, normalizeDateInput } from '../lib/date';
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
} from '../lib/daily';
import {
  BudgetCycle,
  DailyData,
  DailyExpenseCategory,
  DailyIncomeKind,
  DailyTransaction,
  LifeBudgetSettings,
} from '../types';
import { exportDailyToExcel, parseDailyImportWorkbook } from '../utils/excel';

interface DailyLedgerProps {
  data: DailyData;
  setData: React.Dispatch<React.SetStateAction<DailyData>>;
  theme: 'light' | 'dark';
  appControls?: React.ReactNode;
}

type Panel =
  | 'expense'
  | 'income'
  | 'calibration'
  | 'fixed'
  | 'settings'
  | 'cycle'
  | 'events'
  | null;

const formatAmount = (value: number) =>
  `¥ ${Math.round(value).toLocaleString('zh-CN')}`;

const formatSignedAmount = (value: number) =>
  `${value >= 0 ? '+' : '-'}${formatAmount(Math.abs(value))}`;

const parseAmount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTransactionAmount = (transaction: DailyTransaction) => {
  if (transaction.type === 'transfer') {
    return `转 ${formatAmount(transaction.amount)}`;
  }

  return `${transaction.type === 'income' ? '+' : '-'}${formatAmount(transaction.amount)}`;
};

const getTransactionAmountClass = (transaction: DailyTransaction) => {
  if (transaction.type === 'transfer') {
    return 'text-[#70685f]';
  }

  return transaction.type === 'income' ? 'text-[#6f8b6b]' : 'text-[#b66b5d]';
};

const addLocalDays = (date: string, days: number) => {
  const value = new Date(`${normalizeDateInput(date)}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const findBudgetWeekForDate = (cycle: BudgetCycle | null | undefined, date: string) => {
  const normalizedDate = normalizeDateInput(date);
  return cycle?.weeks.find(
    (week) => normalizedDate >= week.startDate && normalizedDate <= week.endDate,
  );
};

const getDefaultPrepaidEffectiveDate = (
  paymentDate: string,
  cycle: BudgetCycle | null | undefined,
) => {
  const normalizedPaymentDate = normalizeDateInput(paymentDate) || getTodayDate();
  const paymentWeek = findBudgetWeekForDate(cycle, normalizedPaymentDate);
  return paymentWeek
    ? addLocalDays(paymentWeek.endDate, 1)
    : addLocalDays(normalizedPaymentDate, 1);
};

const categoryLabels: Record<DailyExpenseCategory, string> = {
  daily: '日常',
  dining: '外食/外卖',
  other: '其他',
  unplanned: '计划外',
  large: '大额',
  fixed: '固定支出',
  unrecorded: '未记录支出',
};

const incomeKindLabels: Record<DailyIncomeKind, string> = {
  main: '主要收入',
  casual: '零散收入',
  refund: '退款报销',
  correction: '余额修正',
};

const transferKindLabels = {
  weeklyRollover: '系统结转',
  cycleRollover: '系统结转',
} as const;

type FlowKey = 'week' | 'buffer' | 'advance' | 'reserve' | 'fixed';

interface TransactionFlowItem {
  key: FlowKey;
  label: string;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  direction: 'in' | 'out';
}

const getFlowSnapshotBalance = (
  transaction: DailyTransaction,
  key: FlowKey,
  snapshot: DailyTransaction['balanceAfter'],
) => {
  if (!snapshot) {
    return undefined;
  }

  if (key === 'week') {
    if (transaction.type === 'income') {
      return snapshot.spendable;
    }
    return snapshot.weekRemaining;
  }
  if (key === 'advance') {
    return snapshot.futureSpendable;
  }
  if (key === 'buffer') {
    return snapshot.buffer;
  }
  if (key === 'reserve') {
    return snapshot.reserve;
  }
  return snapshot.fixedReserved;
};

const createFlowItem = (
  transaction: DailyTransaction,
  key: FlowKey,
  label: string,
  amount: number,
  direction: TransactionFlowItem['direction'],
): TransactionFlowItem => {
  return {
    key,
    label,
    amount: Math.abs(amount),
    balanceBefore: getFlowSnapshotBalance(transaction, key, transaction.balanceBefore),
    balanceAfter: getFlowSnapshotBalance(transaction, key, transaction.balanceAfter),
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

  if (transaction.type === 'income') {
    const order: Array<[FlowKey, string]> = [
      ['fixed', '固定预留'],
      ['reserve', '储备金'],
      ['buffer', '缓冲金'],
      ['week', '可消费余额'],
    ];
    for (const [key, label] of order) {
      const amount = allocation[key];
      if (amount > 0) {
        destinations.push(createFlowItem(transaction, key, label, amount, 'in'));
      }
    }
  } else if (transaction.type === 'expense') {
    const order: Array<[FlowKey, string]> =
      transaction.expenseTiming === 'prepaid'
        ? [
            ['buffer', '缓冲金'],
            ['reserve', '储备金'],
            ['advance', '后续周预算'],
          ]
        : transaction.category === 'large'
          ? [
              ['buffer', '缓冲金'],
              ['advance', '后续周预算'],
            ]
          : transaction.category === 'fixed'
            ? [
                ['fixed', '固定预留'],
                ['week', '本周预算'],
                ['buffer', '缓冲金'],
                ['advance', '后续周预算'],
              ]
            : [
                ['week', '本周预算'],
                ['buffer', '缓冲金'],
                ['advance', '后续周预算'],
              ];
    for (const [key, label] of order) {
      const amount = allocation[key];
      if (amount > 0) {
        sources.push(createFlowItem(transaction, key, label, amount, 'out'));
      }
    }
  } else if (transaction.transferKind === 'weeklyRollover') {
    if (allocation.week > 0) {
      sources.push(
        createFlowItem(
          transaction,
          'week',
          transaction.weekIndex === undefined
            ? '预算周余额'
            : `第 ${transaction.weekIndex + 1} 周余额`,
          allocation.week,
          'out',
        ),
      );
    }
    if (allocation.buffer > 0) {
      destinations.push(createFlowItem(transaction, 'buffer', '缓冲金', allocation.buffer, 'in'));
    }
    if (allocation.reserve > 0) {
      destinations.push(createFlowItem(transaction, 'reserve', '储备金', allocation.reserve, 'in'));
    }
  } else {
    if (allocation.buffer < 0) {
      sources.push(createFlowItem(transaction, 'buffer', '缓冲金', allocation.buffer, 'out'));
    }
    if (allocation.reserve > 0) {
      destinations.push(createFlowItem(transaction, 'reserve', '储备金', allocation.reserve, 'in'));
    }
  }

  const allocatedTotal =
    transaction.type === 'transfer'
      ? transaction.amount
      : Math.max(0, allocation.week) +
        Math.max(0, allocation.buffer) +
        Math.max(0, allocation.advance) +
        Math.max(0, allocation.reserve) +
        Math.max(0, allocation.fixed);
  const gap = Math.max(0, Math.round((transaction.amount - allocatedTotal) * 100) / 100);
  return { sources, destinations, gap };
};

const formatCreatedTime = (createdAt?: string) => {
  if (!createdAt) {
    return '';
  }
  const value = new Date(createdAt);
  if (!Number.isFinite(value.getTime())) {
    return '';
  }
  return value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const TransactionProcessRows: React.FC<{
  items: TransactionFlowItem[];
  gap: number;
}> = ({ items, gap }) => (
  <div className="min-w-0 space-y-1.5">
    {items.map((item) => (
      <div
        key={`${item.key}-${item.label}`}
        className="scrollbar-hide overflow-x-auto"
      >
        <div className="flex w-max items-baseline whitespace-nowrap text-xs font-bold text-stone-700">
          <span>{item.label}部分：</span>
          <span>{formatAmount(item.balanceBefore ?? 0)}</span>
          <span
            className={`mx-1 font-black ${item.direction === 'in' ? 'life-flow-change-in' : 'life-flow-change-out'}`}
          >
            {item.direction === 'in' ? '+' : '-'} {formatAmount(item.amount)}
          </span>
          <span>= {formatAmount(item.balanceAfter ?? 0)}</span>
        </div>
      </div>
    ))}
    {gap > 0 && (
      <div className="scrollbar-hide overflow-x-auto">
        <div className="w-max whitespace-nowrap text-xs font-bold text-stone-700">
          资金缺口部分：<span className="life-flow-change-out font-black">未覆盖 {formatAmount(gap)}</span>
        </div>
      </div>
    )}
  </div>
);

const quickActionClass =
  'life-action-button flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-black shadow-sm transition active:scale-[0.98]';

const fieldClass =
  'life-field w-full rounded-xl border border-stone-200 bg-white/80 px-3 py-2.5 text-sm text-stone-800 outline-none transition focus:border-[#8aa0a2] focus:ring-2 focus:ring-[#8aa0a2]/20';

const SectionShell: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <section className={`life-section rounded-2xl border border-stone-200 bg-white/85 shadow-sm ${className}`}>
    {children}
  </section>
);

const BottomSheet: React.FC<{
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  layer?: 'default' | 'detail';
}> = ({ children, icon, title, onClose, layer = 'default' }) => (
  <div
    className={`life-sheet-overlay ${layer === 'detail' ? 'life-sheet-overlay-detail' : ''}`}
    onClick={onClose}
  >
    <div className="life-sheet" onClick={(event) => event.stopPropagation()}>
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <PanelTitle icon={icon} title={title} />
        <button
          onClick={onClose}
          className="rounded-full border border-stone-200 bg-white/80 p-2 text-stone-500"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const TransactionFlowDetail: React.FC<{
  transaction: DailyTransaction;
  kindLabel: string;
}> = ({ transaction, kindLabel }) => {
  const { sources, destinations, gap } = getTransactionFlow(transaction);
  const createdTime = formatCreatedTime(transaction.createdAt);
  const processItems = [...sources, ...destinations];
  const hasCompleteSnapshots = Boolean(
    transaction.balanceBefore && transaction.balanceAfter,
  );
  const hasProcess = hasCompleteSnapshots && (processItems.length > 0 || gap > 0);
  const dateTime = `${formatDisplayDate(transaction.date)}${createdTime ? ` ${createdTime}` : ''}`;

  return (
    <div className="space-y-2">
      <div className="life-soft-row grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-stone-200 px-3 py-2.5">
        <div className="shrink-0 text-[10px] font-black tracking-[0.14em] text-stone-500">
          详情
        </div>
        <div className="scrollbar-hide min-w-0 overflow-x-auto">
          <div className="flex w-max items-center whitespace-nowrap text-xs font-bold text-stone-700">
            <span>{kindLabel}</span>
            <span className="mx-2 text-stone-400">｜</span>
            <span>{transaction.desc}</span>
            <span className="mx-2 text-stone-400">｜</span>
            <span>{dateTime}</span>
            <span className="mx-2 text-stone-400">｜</span>
            <span className={`font-black ${getTransactionAmountClass(transaction)}`}>
              {formatTransactionAmount(transaction)}
            </span>
          </div>
        </div>
      </div>

      {hasProcess && (
        <div className="life-soft-row grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-2xl border border-stone-200 px-3 py-2.5">
          <div className="shrink-0 pt-0.5 text-[10px] font-black tracking-[0.14em] text-stone-500">
            过程
          </div>
          <TransactionProcessRows items={processItems} gap={gap} />
        </div>
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
  <li className="life-event-row flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
      aria-label={`查看${kindLabel} ${transaction.desc}的资金流向`}
    >
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-stone-800">
          {kindLabel}
          <span className="ml-2 font-medium text-stone-500">{transaction.desc}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-stone-400">
          {transaction.expenseTiming === 'prepaid'
            ? `付款 ${formatDisplayDate(transaction.date)} · 归属 ${formatDisplayDate(transaction.effectiveDate ?? transaction.date)}`
            : formatDisplayDate(transaction.date)}
        </div>
      </div>
      <div className={`shrink-0 text-xs font-black ${getTransactionAmountClass(transaction)}`}>
        {formatTransactionAmount(transaction)}
      </div>
    </button>
    <button
      type="button"
      onClick={onDelete}
      className="shrink-0 rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-[#b66b5d]"
      title="删除"
      aria-label={`删除 ${transaction.desc}`}
    >
      <Trash2 size={13} />
    </button>
  </li>
);

export const DailyLedger: React.FC<DailyLedgerProps> = ({
  appControls,
  data,
  setData,
  theme,
}) => {
  const today = getTodayDate();
  const snapshot = useMemo(() => getBudgetSnapshot(data, today), [data, today]);
  const { budget, cycle, week } = snapshot;
  const [panel, setPanel] = useState<Panel>(budget.initialized ? null : 'settings');
  const [showBackup, setShowBackup] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [summaryCard, setSummaryCard] = useState<'pending' | 'fixed'>('pending');
  const [summaryTouchStart, setSummaryTouchStart] = useState<number | null>(null);
  const [showCycleWeeks, setShowCycleWeeks] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<DailyTransaction | null>(null);
  const [visibleEventCount, setVisibleEventCount] = useState(20);

  const [setupForm, setSetupForm] = useState({
    spendable: String(budget.pockets.spendable || ''),
    buffer: String(budget.pockets.buffer || ''),
    reserve: String(budget.pockets.reserve || ''),
    reserveFixedAmount: String(budget.settings.reserveFixedAmount || ''),
    bufferFixedAmount: String(budget.settings.bufferFixedAmount || ''),
    reserveGoal: String(budget.settings.reserveGoal || ''),
    bufferCap: String(budget.settings.bufferCap || ''),
    minimumWeeklyLiving: String(budget.settings.minimumWeeklyLiving),
  });
  const [incomeForm, setIncomeForm] = useState({
    amount: '',
    date: today,
    desc: '',
    incomeKind: 'main' as DailyIncomeKind,
  });
  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    date: today,
    effectiveDate: today,
    desc: '',
    category: 'daily' as DailyExpenseCategory,
    isPrepaid: false,
  });
  const [calibrationAmount, setCalibrationAmount] = useState('');
  const [fixedForm, setFixedForm] = useState({
    name: '',
    amount: '',
    dueDay: '1',
  });
  const [fixedReservedAmount, setFixedReservedAmount] = useState('');

  const weekProgress =
    week && week.allowance > 0
      ? Math.min(100, Math.round((snapshot.weekSpent / week.allowance) * 100))
      : 0;
  const reserveProgress =
    budget.settings.reserveGoal > 0
      ? Math.min(100, Math.round((budget.pockets.reserve / budget.settings.reserveGoal) * 100))
      : 100;
  const actualBookBalance = snapshot.calibratableBalance;
  const shouldRecommendLarge =
    !expenseForm.isPrepaid &&
    (parseAmount(expenseForm.amount) >= budget.settings.largeExpenseAbsoluteThreshold ||
      (week?.allowance ?? 0) > 0 &&
      parseAmount(expenseForm.amount) >=
        (week?.allowance ?? 0) * budget.settings.largeExpenseWeeklyRate);
  const prepaidHintTotal = snapshot.prepaidInCycle + snapshot.upcomingPrepaid;
  const activeFixedExpenses = budget.fixedExpenses.filter((item) => item.isActive);
  const activeFixedExpenseTotal = activeFixedExpenses.reduce(
    (total, item) => total + item.amount,
    0,
  );
  const fixedReserveGap = Math.max(
    0,
    activeFixedExpenseTotal - budget.pockets.fixedReserved,
  );
  const willAutoReserveFixed =
    incomeForm.incomeKind === 'main' &&
    fixedReserveGap > 0;

  const allEvents = useMemo(
    () =>
      data.transactions
        .map((transaction, index) => ({ transaction, index }))
        .sort((left, right) => {
          const dateOrder = right.transaction.date.localeCompare(left.transaction.date);
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
          } else if (left.transaction.createdAt || right.transaction.createdAt) {
            return right.transaction.createdAt ? 1 : -1;
          }
          return right.index - left.index;
        })
        .map(({ transaction }) => transaction),
    [data.transactions],
  );
  const recentEvents = allEvents.slice(0, 3);
  const visibleEvents = allEvents.slice(0, visibleEventCount);
  const getTransactionKindLabel = (transaction: DailyData['transactions'][number]) =>
    transaction.type === 'transfer'
      ? transferKindLabels[transaction.transferKind ?? 'weeklyRollover']
      : transaction.type === 'income'
      ? incomeKindLabels[transaction.incomeKind ?? 'casual']
      : transaction.expenseTiming === 'prepaid'
        ? '提前支付'
        : categoryLabels[transaction.category ?? 'other'];
  const cycleSummaries = useMemo(() => getBudgetCycleSummaries(data), [data]);
  const currentCycleSummary = cycleSummaries[0];
  const cycleVisibleBalance = currentCycleSummary?.balance ?? 0;
  const cycleDailyRemaining = budget.pockets.spendable;
  const cycleUsableBalance =
    cycleDailyRemaining + budget.pockets.buffer + budget.pockets.fixedReserved;
  const cycleTotalBalance = cycleUsableBalance + budget.pockets.reserve;
  const weekSpent = week
    ? Math.max(0, (week.allowance ?? 0) - snapshot.weekRemaining)
    : 0;
  const weeklyChartMax = (currentCycleSummary?.weeks ?? []).reduce(
    (maxValue, item) => Math.max(maxValue, item.allowance, item.spent),
    1,
  );

  const getWeekStatus = (startDate: string, endDate: string) => {
    if (startDate > today) {
      return 'future';
    }
    if (endDate < today) {
      return 'past';
    }
    return 'current';
  };

  const openPanel = (nextPanel: Panel) => {
    setSettingsSaved(false);
    if (nextPanel === 'cycle') {
      setShowCycleWeeks(false);
    }
    if (nextPanel === 'events' && panel !== 'events') {
      setVisibleEventCount(20);
    }
    setPanel((prev) => (prev === nextPanel ? null : nextPanel));
  };

  useEffect(() => {
    setData((prev) => applyDueBudgetRollovers(prev, today));
  }, [setData, today]);

  useEffect(() => {
    if (panel !== 'settings') {
      return;
    }

    setSetupForm({
      spendable: String(budget.pockets.spendable || ''),
      buffer: String(budget.pockets.buffer || ''),
      reserve: String(budget.pockets.reserve || ''),
      reserveFixedAmount: String(budget.settings.reserveFixedAmount || ''),
      bufferFixedAmount: String(budget.settings.bufferFixedAmount || ''),
      reserveGoal: String(budget.settings.reserveGoal || ''),
      bufferCap: String(budget.settings.bufferCap || ''),
      minimumWeeklyLiving: String(budget.settings.minimumWeeklyLiving),
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
            parseAmount(setupForm.reserveGoal) ||
            budget.settings.reserveGoal,
          bufferCap:
            parseAmount(setupForm.bufferCap) ||
            budget.settings.bufferCap,
          minimumWeeklyLiving:
            parseAmount(setupForm.minimumWeeklyLiving) ||
            budget.settings.minimumWeeklyLiving,
        },
      }),
    );
    setPanel(null);
  };

  const handleIncomeSubmit = () => {
    const amount = parseAmount(incomeForm.amount);
    if (amount <= 0) {
      alert('请输入收入金额');
      return;
    }

    if (
      willAutoReserveFixed &&
      !window.confirm(
        `本次会先补足固定预留缺口 ${formatAmount(Math.min(amount, fixedReserveGap))}，剩余金额再分配。继续吗？`,
      )
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
    setIncomeForm((prev) => ({ ...prev, amount: '', desc: '' }));
    setPanel(null);
  };

  const handleExpenseSubmit = () => {
    const amount = parseAmount(expenseForm.amount);
    if (amount <= 0) {
      alert('请输入支出金额');
      return;
    }

    if (
      expenseForm.isPrepaid &&
      normalizeDateInput(expenseForm.effectiveDate) <= normalizeDateInput(expenseForm.date)
    ) {
      alert('未来开销的归属日期要晚于付款日期');
      return;
    }

    const paymentWeek = findBudgetWeekForDate(cycle, expenseForm.date);
    const effectiveWeek = findBudgetWeekForDate(cycle, expenseForm.effectiveDate);
    if (
      expenseForm.isPrepaid &&
      paymentWeek &&
      effectiveWeek &&
      paymentWeek.index === effectiveWeek.index
    ) {
      alert('归属日期仍在付款所在预算周，会计入本周已用。请选下一预算周或更晚日期。');
      return;
    }

    if (
      expenseForm.isPrepaid &&
      amount > budget.pockets.buffer + budget.pockets.reserve &&
      !window.confirm('缓冲金和储备金不足，差额会从当前可用余额扣除，仍然记录吗？')
    ) {
      return;
    }

    const category =
      shouldRecommendLarge && expenseForm.category !== 'large'
        ? window.confirm('这笔支出较大，要按“大额支出”处理吗？')
          ? 'large'
          : expenseForm.category
        : expenseForm.category;

    if (
      category === 'large' &&
      amount > budget.pockets.buffer + budget.pockets.spendable &&
      !window.confirm('缓冲金和当前可消费余额不足，仍然记录吗？')
    ) {
      return;
    }

    setData((prev) =>
      recordExpense(prev, {
        amount,
        category,
        date: expenseForm.date,
        desc: expenseForm.desc,
        effectiveDate: expenseForm.isPrepaid ? expenseForm.effectiveDate : undefined,
        expenseTiming: expenseForm.isPrepaid ? 'prepaid' : undefined,
      }),
    );
    setExpenseForm((prev) => ({
      ...prev,
      amount: '',
      desc: '',
      category: 'daily',
      isPrepaid: false,
      effectiveDate: getDefaultPrepaidEffectiveDate(prev.date, cycle),
    }));
    setPanel(null);
  };

  const handleCalibrationSubmit = () => {
    const amount = parseAmount(calibrationAmount);
    if (amount < 0) {
      alert('请输入当前可消费余额');
      return;
    }

    setData((prev) => calibrateSpendableBalance(prev, amount, today));
    setCalibrationAmount('');
    setPanel(null);
  };

  const handleAddFixedExpense = () => {
    const amount = parseAmount(fixedForm.amount);
    const dueDay = Math.round(parseAmount(fixedForm.dueDay));
    if (!fixedForm.name.trim() || amount <= 0 || dueDay <= 0) {
      alert('请完善固定支出');
      return;
    }

    setData((prev) =>
      addFixedExpense(prev, {
        name: fixedForm.name.trim(),
        amount,
        dueDay,
      }),
    );
    setFixedForm({ name: '', amount: '', dueDay: '1' });
  };

  const handleDeleteFixedExpense = (fixedExpenseId: number) => {
    const fixedExpense = activeFixedExpenses.find((item) => item.id === fixedExpenseId);
    if (!fixedExpense) return;

    if (!window.confirm(`删除固定支出“${fixedExpense.name}”吗？历史付款记录会保留。`)) {
      return;
    }

    setData((prev) => deleteFixedExpense(prev, fixedExpenseId));
  };

  const handleFixedReservedSubmit = () => {
    const amount = parseAmount(fixedReservedAmount);
    if (amount < 0) {
      alert('请输入固定支出预留金额');
      return;
    }
    setData((prev) => adjustFixedReserved(prev, amount));
    setFixedReservedAmount('');
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用导入文件覆盖当前生活预算数据吗？旧流水和预算状态都会被替换。')) {
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: 'array' });
        const importedData = parseDailyImportWorkbook(workbook, DEFAULT_DAILY_DATA);
        setData(importedData);
        alert(`导入成功，共恢复 ${importedData.transactions.length} 条记录`);
      } catch {
        alert('导入失败');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDeleteTransaction = (transactionId: number) => {
    if (!window.confirm('确定删除这条记录吗？相关余额会按这条记录的分配自动回滚。')) {
      return;
    }
    setData((prev) => deleteDailyTransaction(prev, transactionId));
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
                  buffer: Math.max(0, currentBudget.pockets.buffer - bufferOverflow),
                  reserve: currentBudget.pockets.reserve + bufferOverflow,
                }
              : currentBudget.pockets,
        },
      };
    });
    setSettingsSaved(true);
  };

  return (
    <div className={`life-budget life-budget-${theme} relative space-y-4 pb-24 text-stone-800 animate-fade-in`}>
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8b8175]">
            Life Budget
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-black text-[#3f4842]">
            <span className="rounded-xl bg-[#8aa0a2] p-2 text-white shadow-sm">
              <Wallet size={20} />
            </span>
            生活预算
          </h1>
        </div>
        <button
          onClick={() => openPanel('settings')}
          className="rounded-full border border-stone-200 bg-white/80 p-2.5 text-[#70685f] shadow-sm"
          title="设置"
        >
          <Settings size={18} />
        </button>
      </header>

      {!budget.initialized && (
        <SectionShell className="border-[#d2b48f] bg-[#f6efe3] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-[#b78952]" size={18} />
            <div>
              <h2 className="font-bold text-[#5d5144]">先建立生活预算</h2>
              <p className="mt-1 text-xs leading-5 text-[#7d7165]">
                只需要填当前可消费余额、缓冲金和储备金。旧日常流水会保留，新预算从这里开始。
              </p>
            </div>
          </div>
        </SectionShell>
      )}

      <section className="grid grid-cols-1 gap-3">
        <div className="life-week-card rounded-[1.35rem] border border-[#b8c5c3] bg-[#dce8e6] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-[#657b7a]">
                <CalendarDays size={14} />
                本预算周
              </div>
              <div className="mt-2 text-4xl font-black tracking-tight text-[#30413f]">
                {formatAmount(snapshot.weekRemaining)}
              </div>
              <div className="mt-1 text-xs font-medium text-[#657b7a]">
                {week
                  ? `${formatDisplayDate(week.startDate)} - ${formatDisplayDate(week.endDate)}`
                  : '收入分配后生成预算周'}
              </div>
              <div className="mt-1 text-[11px] font-bold text-[#657b7a]">
                周期余额 {formatAmount(cycleVisibleBalance)}
              </div>
            </div>
            <div className="rounded-2xl bg-white/55 px-3 py-2 text-right">
              <div className="text-[10px] font-bold text-[#657b7a]">已用</div>
              <div className="text-sm font-black text-[#30413f]">
                {formatAmount(snapshot.weekSpent)}
              </div>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full rounded-full bg-[#8aa0a2] transition-all"
              style={{ width: `${weekProgress}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl bg-white/45 px-3 py-2">
              <div className="text-[#657b7a]">本周额度</div>
              <div className="font-black text-[#30413f]">
                {formatAmount(week?.allowance ?? 0)}
              </div>
            </div>
            <button
              onClick={() => openPanel('cycle')}
              className="rounded-xl bg-white/45 px-3 py-2 text-left transition active:scale-[0.98]"
            >
              <div className="text-[#657b7a]">周期状态</div>
              <div className="font-black text-[#30413f]">
                {snapshot.isExtended ? '延长期' : cycle ? '进行中' : '未开始'}
              </div>
            </button>
            <div className="life-week-buffer-chip rounded-xl bg-white/45 px-3 py-2">
              <div className="text-[#657b7a]">缓冲金</div>
              <div className="font-black text-[#30413f]">
                {formatAmount(budget.pockets.buffer)}
              </div>
            </div>
          </div>
          {prepaidHintTotal > 0 && (
            <button
              onClick={() => openPanel('cycle')}
              className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/40 px-3 py-2 text-left text-[11px] font-bold text-[#657b7a]"
            >
              <span>提前支付</span>
              <span>{formatAmount(prepaidHintTotal)}</span>
            </button>
          )}
        </div>

      </section>

      <section className="grid grid-cols-2 gap-3">
        <button
          onClick={() => openPanel('expense')}
          className="life-primary-entry rounded-2xl border border-[#7d999d] bg-[#4f7f8c] p-3 text-left text-white shadow-sm transition active:scale-[0.98]"
        >
          <div className="flex items-center gap-2 text-xs font-bold text-white/85">
            <ReceiptText size={15} />
            快速记录
          </div>
          <div className="mt-2 text-2xl font-black">记一笔</div>
          <div className="mt-3 rounded-lg bg-white/18 px-2 py-1.5 text-[11px] font-bold">
            支出优先入口
          </div>
        </button>

        <SectionShell className="overflow-hidden p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setSummaryCard('pending')}
              className={`text-xs font-black ${summaryCard === 'pending' ? 'text-[#8b7356]' : 'text-stone-400'}`}
            >
              待处理
            </button>
            <button
              onClick={() => setSummaryCard('fixed')}
              className={`text-xs font-black ${summaryCard === 'fixed' ? 'text-[#6e7c6b]' : 'text-stone-400'}`}
            >
              固定预留
            </button>
          </div>
          <div
            onTouchStart={(event) => setSummaryTouchStart(event.touches[0]?.clientX ?? null)}
            onTouchEnd={(event) => {
              if (summaryTouchStart === null) {
                return;
              }
              const delta = (event.changedTouches[0]?.clientX ?? summaryTouchStart) - summaryTouchStart;
              if (Math.abs(delta) > 28) {
                setSummaryCard(delta < 0 ? 'fixed' : 'pending');
              }
              setSummaryTouchStart(null);
            }}
            className="mt-3 min-h-[104px]"
          >
            {summaryCard === 'pending' ? (
              <div className="space-y-2 text-xs">
                <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <span>固定支出</span>
                  <b>{snapshot.pendingFixed.length}</b>
                </div>
                <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <span>余额校准</span>
                  <b>{snapshot.needsCalibration ? '可做' : '-'}</b>
                </div>
                <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <span>补回缺口</span>
                  <b>{snapshot.reserveGap > 0 ? formatAmount(snapshot.reserveGap) : '无'}</b>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="text-2xl font-black text-[#3e4c3b]">
                  {formatAmount(budget.pockets.fixedReserved)}
                </div>
                <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <span>本期固定项</span>
                  <b>{activeFixedExpenses.length}</b>
                </div>
                <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <span>待确认</span>
                  <b>{snapshot.pendingFixed.length}</b>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${summaryCard === 'pending' ? 'bg-[#8aa0a2]' : 'bg-stone-300'}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${summaryCard === 'fixed' ? 'bg-[#8aa0a2]' : 'bg-stone-300'}`} />
          </div>
        </SectionShell>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <button
          onClick={() => openPanel('income')}
          className={`${quickActionClass} bg-[#8aa0a2] text-white`}
        >
          <CircleDollarSign size={16} /> 收入分配
        </button>
        <button
          onClick={() => openPanel('calibration')}
          className={`${quickActionClass} bg-[#e8dfd1] text-[#65594c]`}
        >
          <RefreshCw size={16} /> 校准
        </button>
        <button
          onClick={() => openPanel('fixed')}
          className={`${quickActionClass} bg-[#eee8dd] text-[#65594c]`}
        >
          <Landmark size={16} /> 固定支出
        </button>
      </section>

      <SectionShell className="p-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-black text-stone-500">
            <CalendarDays size={14} />
            每周预算消耗
          </h2>
          <span className="text-[10px] text-stone-400">按周</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-stone-400">
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-[#c96f5d]" />
            已花
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-[#83b7ad]" />
            未花/预算
          </span>
        </div>
        {(currentCycleSummary?.weeks.length ?? 0) > 0 ? (
          <>
            <div className="mt-3 flex h-28 items-end gap-2 border-b border-stone-200 pb-2">
              {(currentCycleSummary?.weeks ?? []).map((item) => {
                const weekStatus = getWeekStatus(item.startDate, item.endDate);
                const spentValue =
                  weekStatus === 'future' ? item.prepaidSpent : item.spent;
                const remainingValue =
                  weekStatus === 'future'
                    ? Math.max(0, item.allowance - spentValue)
                    : item.remaining;
                const totalHeight = Math.max(
                  8,
                  Math.round((item.allowance / weeklyChartMax) * 100),
                );
                const spentRatio =
                  item.allowance > 0
                    ? Math.min(100, Math.round((spentValue / item.allowance) * 100))
                    : 0;
                const remainingRatio = Math.max(0, 100 - spentRatio);

                return (
                  <button
                    key={`${item.startDate}-${item.endDate}`}
                    onClick={() => openPanel('cycle')}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`第 ${item.index + 1} 周`}
                  >
                    <div className="flex h-20 w-full items-end rounded-lg bg-[#f8f4ec] px-1.5 pb-1.5">
                      <div
                        className="flex w-full flex-col overflow-hidden rounded-md"
                        style={{ height: `${totalHeight}%` }}
                      >
                        <div
                          className="bg-[#83b7ad]"
                          style={{ height: `${remainingRatio}%` }}
                        />
                        <div
                          className="bg-[#c96f5d]"
                          style={{ height: spentValue > 0 ? `${spentRatio}%` : '0%' }}
                        />
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold ${weekStatus === 'current' ? 'text-[#3f4842]' : 'text-stone-400'}`}>
                      W{item.index + 1}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid gap-1 text-[10px] font-bold text-stone-500">
              {(currentCycleSummary?.weeks ?? []).map((item) => {
                const weekStatus = getWeekStatus(item.startDate, item.endDate);
                const spentValue =
                  weekStatus === 'future' ? item.prepaidSpent : item.spent;
                const remainingValue = Math.max(0, item.allowance - spentValue);

                return (
                  <button
                    key={`${item.startDate}-${item.endDate}-data`}
                    onClick={() => openPanel('cycle')}
                    className="life-soft-row grid grid-cols-[3rem_1fr_1fr_1fr] items-center rounded-lg bg-[#f8f4ec] px-2 py-1.5 text-left"
                  >
                    <span>W{item.index + 1}</span>
                    <span>预算 {formatAmount(item.allowance)}</span>
                    <span>{weekStatus === 'future' ? '提前' : '已花'} {formatAmount(spentValue)}</span>
                    <span>{weekStatus === 'future' ? '未来' : `剩 ${formatAmount(remainingValue)}`}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="mt-3 flex h-24 w-full items-center justify-center rounded-xl bg-[#f8f4ec] text-xs font-bold text-stone-500">
            收入分配后显示周期节奏
          </div>
        )}
      </SectionShell>

      {panel === 'cycle' && (
        <BottomSheet
          icon={<CalendarDays size={16} />}
          title="周期详情"
          onClose={() => setPanel(null)}
        >
            {cycle ? (
              <>
                <section className="life-cycle-total mt-3 rounded-2xl border p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black text-[#657b7a]">总金额</div>
                      <div className="mt-1 text-3xl font-black tracking-normal">
                        {formatAmount(cycleTotalBalance)}
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-[#657b7a]">
                        总金额 = 可动用余额 + 储备金
                      </div>
                    </div>
                    <div className="life-cycle-status rounded-full px-2.5 py-1 text-[10px] font-black">
                      {snapshot.isExtended ? '延长期' : cycle.status === 'closed' ? '已结束' : '进行中'}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-[1.3fr_0.9fr] gap-2">
                    <div className="life-cycle-primary-balance rounded-xl px-3 py-2">
                      <div className="text-[10px] font-bold text-[#657b7a]">可动用余额</div>
                      <b className="mt-0.5 block text-xl">{formatAmount(cycleUsableBalance)}</b>
                      <div className="mt-1 text-[10px] font-bold text-[#657b7a]">
                        周期内可调度，不等于本周可花
                      </div>
                    </div>
                    <div className="life-cycle-reserve-balance rounded-xl px-3 py-2">
                      <div className="text-[10px] font-bold">储备金</div>
                      <b className="mt-0.5 block text-base">
                        {formatAmount(budget.pockets.reserve)} / {formatAmount(budget.settings.reserveGoal)}
                      </b>
                      <div className="mt-1 text-[10px] font-bold">目标进度 {reserveProgress}%</div>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-bold">
                    <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                      <span className="block text-[#657b7a]">本周期日常剩余</span>
                      <b className="mt-0.5 block text-sm text-[#30413f]">{formatAmount(cycleDailyRemaining)}</b>
                    </div>
                    <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                      <span className="block text-[#657b7a]">缓冲金</span>
                      <b className="mt-0.5 block text-sm text-[#30413f]">{formatAmount(budget.pockets.buffer)}</b>
                    </div>
                    <div className="life-cycle-chip rounded-lg px-2 py-1.5">
                      <span className="block text-[#657b7a]">固定预留</span>
                      <b className="mt-0.5 block text-sm text-[#30413f]">{formatAmount(budget.pockets.fixedReserved)}</b>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] font-bold text-[#657b7a]">
                    可动用余额 = 本周期日常剩余 + 缓冲金 + 固定预留
                  </div>
                </section>

                <section className="mt-3 rounded-xl border border-stone-200 bg-[#f8f4ec] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-[#4c554e]">本周提醒</div>
                      <div className="mt-0.5 text-[10px] font-bold text-stone-500">
                        {week
                          ? `${formatDisplayDate(week.startDate)} - ${formatDisplayDate(week.endDate)}`
                          : '暂无本周预算'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-stone-500">本周剩余</div>
                      <b className="text-lg text-[#30413f]">{formatAmount(snapshot.weekRemaining)}</b>
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e2e5dc]">
                    <div
                      className="h-full rounded-full bg-[#8aa0a2]"
                      style={{
                        width: `${week && week.allowance > 0 ? Math.min(100, Math.round((weekSpent / week.allowance) * 100)) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] font-bold text-stone-500">
                    <span>预算 {formatAmount(week?.allowance ?? 0)}</span>
                    <span>已花 {formatAmount(weekSpent)}</span>
                  </div>
                </section>

                <section className="mt-3 rounded-xl border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-black text-[#4c554e]">当前周期</div>
                      <div className="mt-0.5 text-stone-500">
                        {formatDisplayDate(cycle.startDate)} - {formatDisplayDate(cycle.plannedEndDate)}
                      </div>
                    </div>
                    <b>{snapshot.isExtended ? '延长期' : cycle.status === 'closed' ? '已结束' : '进行中'}</b>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">周期收入</span>
                      <b className="block">
                        {formatAmount(currentCycleSummary?.mainIncome ?? cycle.mainIncome)}
                        <span className="mx-1 text-stone-400">+</span>
                        {formatAmount(currentCycleSummary?.otherIncome ?? 0)}
                      </b>
                    </div>
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">日常预算</span>
                      <b className="block">{formatAmount(currentCycleSummary?.budget ?? 0)}</b>
                    </div>
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">储备增长</span>
                      <b className="block">{formatAmount((currentCycleSummary?.reserveChange ?? 0))}</b>
                    </div>
                  </div>
                  {(currentCycleSummary?.prepaidTotal ?? 0) > 0 && (
                    <div className="mt-2 rounded-xl bg-[#eef4f1] px-3 py-2 text-[11px] font-bold text-[#55736c]">
                      周期总开销中，提前支付 {formatAmount(currentCycleSummary?.prepaidTotal ?? 0)}
                    </div>
                  )}
                </section>

                <div className="mt-4">
                  <button
                    onClick={() => setShowCycleWeeks((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-left text-xs font-black text-[#4c554e]"
                  >
                    <span>本周期每周明细</span>
                    <span className="text-stone-500">
                      {showCycleWeeks ? '收起' : `查看 ${(currentCycleSummary?.weeks.length ?? 0)} 周`}
                    </span>
                  </button>
                  {showCycleWeeks && (
                    <div className="mt-2 space-y-2">
                      {(currentCycleSummary?.weeks ?? []).map((item) => {
                        const weekStatus = getWeekStatus(item.startDate, item.endDate);
                        const headline =
                          weekStatus === 'future'
                            ? `预算 ${formatAmount(item.allowance)}`
                            : `余额 ${formatAmount(item.remaining)}`;

                        return (
                          <div
                            key={`${item.startDate}-${item.endDate}`}
                            className="life-event-row rounded-xl bg-stone-50 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <b>
                                第 {item.index + 1} 周 · {formatDisplayDate(item.startDate)} - {formatDisplayDate(item.endDate)}
                              </b>
                              <span className="shrink-0 text-stone-500">{headline}</span>
                            </div>
                            {weekStatus === 'future' ? (
                              <div className="mt-2 rounded-lg bg-[#f8f4ec] px-2 py-1.5 text-[10px] font-bold text-stone-500">
                                未来周显示预算；已记录提前支付 {formatAmount(item.prepaidSpent)}。
                              </div>
                            ) : (
                              <>
                                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef0ea]">
                                  <div
                                    className="h-full rounded-full bg-[#8aa0a2]"
                                    style={{
                                      width: `${item.allowance > 0 ? Math.min(100, Math.round((item.spent / item.allowance) * 100)) : 0}%`,
                                    }}
                                  />
                                </div>
                                <div className="mt-1 flex justify-between text-[10px] text-stone-500">
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
                    <h3 className="text-xs font-black text-stone-500">提前支付</h3>
                    <div className="mt-2 space-y-2">
                      {(currentCycleSummary?.prepaidTransactions ?? []).map((transaction) => (
                        <div
                          key={transaction.id}
                          className="life-event-row flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs"
                        >
                          <div>
                            <b>{transaction.desc || categoryLabels[transaction.category ?? 'other']}</b>
                            <div className="mt-0.5 text-[10px] text-stone-500">
                              付款 {formatDisplayDate(transaction.date)} · 归属 {formatDisplayDate(transaction.effectiveDate ?? transaction.date)}
                            </div>
                          </div>
                          <b className="text-[#b66b5d]">{formatAmount(transaction.amount)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="life-help mt-3 rounded-xl bg-[#f3f0e9] px-3 py-3 text-xs leading-5 text-stone-600">
                还没有预算周期。录入一次“主要收入”后，会生成当前周期和每周额度。
              </div>
            )}

            {cycleSummaries.length > 1 && (
              <div className="mt-4">
                <h3 className="text-xs font-black text-stone-500">最近周期</h3>
                <div className="mt-2 space-y-2">
                  {cycleSummaries.slice(1, 5).map(({ cycle: item, balance, budget, reserveChange, otherIncome, prepaidTotal }) => {
                    const isFutureCycle = item.startDate > today;
                    return (
                    <div
                      key={item.id}
                      className="life-event-row flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <b>{formatDisplayDate(item.startDate)} - {formatDisplayDate(item.plannedEndDate)}</b>
                        <div className="mt-0.5 text-[10px] text-stone-500">
                          收入 {formatAmount(item.mainIncome)} + {formatAmount(otherIncome)} · {isFutureCycle ? '预算' : '结余'} {formatAmount(isFutureCycle ? budget : balance)}
                          {prepaidTotal > 0 ? ` · 提前 ${formatAmount(prepaidTotal)}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <b>{item.status === 'closed' ? '已结束' : item.status === 'extended' ? '延长期' : '进行中'}</b>
                        <div className="mt-0.5 text-[10px] text-stone-500">
                          储备 +{formatAmount(reserveChange)}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
        </BottomSheet>
      )}

      {panel === 'settings' && (
        <BottomSheet
          icon={<Settings size={16} />}
          title={budget.initialized ? '预算设置' : '初始设置'}
          onClose={() => setPanel(null)}
        >
          {!budget.initialized && (
            <div className="life-help mt-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs leading-5 text-stone-600">
              填写建议：可消费余额填你现在准备用来日常花的钱；缓冲金可先填 0 或 100；储备金填你已经攒下、可用于大额/兜底的钱。
            </div>
          )}
          {budget.initialized && (
            <div className="mt-3 rounded-2xl border border-stone-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#6e7c6b]">
                  <PiggyBank size={14} />
                  储备金概览
                </div>
                <span className="text-[10px] font-bold text-stone-500">只在设置里查看</span>
              </div>
              <div className="mt-2 text-2xl font-black text-[#3e4c3b]">
                {formatAmount(budget.pockets.reserve)} / {formatAmount(budget.settings.reserveGoal)}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef0ea]">
                <div
                  className={`h-full rounded-full ${
                    snapshot.reserveGap > 0 ? 'bg-[#b66b5d]' : 'bg-[#8ba889]'
                  }`}
                  style={{ width: `${reserveProgress}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <div className="text-stone-500">目标</div>
                  <b>{formatAmount(budget.settings.reserveGoal)}</b>
                </div>
                <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <div className="text-stone-500">最低线</div>
                  <b>{formatAmount(snapshot.reserveMinimum)}</b>
                </div>
                <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <div className="text-stone-500">缺口</div>
                  <b>{snapshot.reserveGap > 0 ? formatAmount(snapshot.reserveGap) : '无'}</b>
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {!budget.initialized && (
              <>
                <NumberField label="当前可消费余额" value={setupForm.spendable} onChange={(spendable) => setSetupForm((prev) => ({ ...prev, spendable }))} />
                <NumberField label="当前缓冲金" value={setupForm.buffer} onChange={(buffer) => setSetupForm((prev) => ({ ...prev, buffer }))} />
                <NumberField label="当前储备金" value={setupForm.reserve} onChange={(reserve) => setSetupForm((prev) => ({ ...prev, reserve }))} />
              </>
            )}
            <label className="text-xs font-bold text-stone-500">
              预计发薪日
              <div className={`${fieldClass} mt-1 flex items-center font-black`}>
                每月 15 日，遇周末提前
              </div>
            </label>
            <NumberField label="储备固定金额" value={setupForm.reserveFixedAmount} onChange={(reserveFixedAmount) => setSetupForm((prev) => ({ ...prev, reserveFixedAmount }))} />
            <NumberField label="缓冲固定金额" value={setupForm.bufferFixedAmount} onChange={(bufferFixedAmount) => setSetupForm((prev) => ({ ...prev, bufferFixedAmount }))} />
            <label className="text-xs font-bold text-stone-500">
              当前固定预留
              <div className={`${fieldClass} mt-1 flex items-center font-black`}>
                {formatAmount(budget.pockets.fixedReserved)}
              </div>
            </label>
            <NumberField label="储备金目标" value={setupForm.reserveGoal} onChange={(reserveGoal) => setSetupForm((prev) => ({ ...prev, reserveGoal }))} />
            <NumberField label="缓冲金上限" value={setupForm.bufferCap} onChange={(bufferCap) => setSetupForm((prev) => ({ ...prev, bufferCap }))} />
            <NumberField label="最低每周生活线" value={setupForm.minimumWeeklyLiving} onChange={(minimumWeeklyLiving) => setSetupForm((prev) => ({ ...prev, minimumWeeklyLiving }))} />
            <label className="text-xs font-bold text-stone-500">
              储备金最低线覆盖
              <input
                type="number"
                value={budget.settings.reserveMinimumOverride ?? ''}
                onChange={(event) =>
                  updateSettings({
                    reserveMinimumOverride:
                      event.target.value === '' ? null : parseAmount(event.target.value),
                  })
                }
                placeholder="留空自动计算"
                className={`${fieldClass} mt-1`}
              />
            </label>
          </div>
          {budget.initialized && (
            <div className="mt-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs leading-5 text-stone-600">
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
                  parseAmount(setupForm.bufferCap) ||
                  budget.settings.bufferCap,
                minimumWeeklyLiving:
                  parseAmount(setupForm.minimumWeeklyLiving) ||
                  budget.settings.minimumWeeklyLiving,
              });
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3f4842] px-4 py-3 text-sm font-black text-white"
          >
            <Check size={16} /> 保存生活预算设置
          </button>
          {settingsSaved && (
            <div className="mt-2 text-center text-xs font-bold text-[#6f8b6b]">
              已保存设置
            </div>
          )}
          {appControls && (
            <div className="mt-4 border-t border-stone-200 pt-3">
              <div className="mb-2 text-xs font-black text-stone-500">账本与外观</div>
              {appControls}
            </div>
          )}
        </BottomSheet>
      )}

      {panel === 'income' && (
        <BottomSheet
          icon={<CircleDollarSign size={16} />}
          title="收入分配"
          onClose={() => setPanel(null)}
        >
          <SegmentedChoices
            value={incomeForm.incomeKind}
            options={[
              ['main', '主要收入'],
              ['casual', '零散收入'],
              ['refund', '退款报销'],
            ]}
            onChange={(incomeKind) =>
              setIncomeForm((prev) => ({ ...prev, incomeKind: incomeKind as DailyIncomeKind }))
            }
          />
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
            <NumberField label="金额" value={incomeForm.amount} onChange={(amount) => setIncomeForm((prev) => ({ ...prev, amount }))} />
            <DateField label="日期" value={incomeForm.date} onChange={(date) => setIncomeForm((prev) => ({ ...prev, date }))} />
            <TextField label="备注" value={incomeForm.desc} onChange={(desc) => setIncomeForm((prev) => ({ ...prev, desc }))} placeholder="如 6月工资、红包、退款" />
          </div>
          {incomeForm.incomeKind === 'main' && (
            <div className="mt-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs leading-5 text-stone-600">
              {willAutoReserveFixed
                ? `主要收入会开启新的预算周期，并先补足固定预留缺口 ${formatAmount(fixedReserveGap)}。`
                : activeFixedExpenseTotal > 0
                  ? `主要收入会开启新的预算周期。当前固定预留已覆盖固定支出目标 ${formatAmount(activeFixedExpenseTotal)}，本次不会重复新增。`
                  : '主要收入会开启新的预算周期：剩余自动拆成储备金、本预算周额度和缓冲金。'}
            </div>
          )}
          <SubmitButton onClick={handleIncomeSubmit} label="确认分配" />
        </BottomSheet>
      )}

      {panel === 'expense' && (
        <BottomSheet
          icon={<ReceiptText size={16} />}
          title="记支出"
          onClose={() => setPanel(null)}
        >
          <div className="mt-3 grid grid-cols-5 gap-2">
            {[
              ['daily', '日常', <Wallet size={14} />],
              ['dining', '外食', <Utensils size={14} />],
              ['other', '其他', <Tag size={14} />],
              ['unplanned', '计划外', <AlertTriangle size={14} />],
              ['large', '大额', <Landmark size={14} />],
            ].map(([value, label, icon]) => (
              <button
                key={String(value)}
                onClick={() =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    category: value as DailyExpenseCategory,
                  }))
                }
                className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-bold transition ${
                  expenseForm.category === value
                    ? 'life-choice-active border-[#8aa0a2] bg-[#dce8e6] text-[#30413f]'
                    : 'life-choice border-stone-200 bg-white text-stone-500'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
            <NumberField label="金额" value={expenseForm.amount} onChange={(amount) => setExpenseForm((prev) => ({ ...prev, amount }))} />
            <DateField
              label={expenseForm.isPrepaid ? '付款日期' : '日期'}
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
            <TextField label="备注" value={expenseForm.desc} onChange={(desc) => setExpenseForm((prev) => ({ ...prev, desc }))} placeholder="可选" />
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs font-bold text-stone-600">
            <span>
              未来开销
              <span className="ml-2 font-medium text-stone-500">从缓冲金扣，不计入付款周已用</span>
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
              className="h-4 w-4 accent-[#8aa0a2]"
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
              <div className="rounded-xl bg-[#eef4f1] px-3 py-2 text-xs leading-5 text-[#55736c]">
                归属日期用于决定在哪个预算周显示“提前支付”。付款会立即从缓冲金扣，不够时从储备金补。
              </div>
            </div>
          )}
          {shouldRecommendLarge && expenseForm.category !== 'large' && (
            <div className="mt-3 rounded-xl bg-[#f8ece8] px-3 py-2 text-xs font-bold text-[#9b5b4e]">
              这笔金额较大，提交时会询问是否按大额支出处理。
            </div>
          )}
          <SubmitButton onClick={handleExpenseSubmit} label="记录支出" />
        </BottomSheet>
      )}

      {panel === 'calibration' && (
        <BottomSheet
          icon={<RefreshCw size={16} />}
          title="余额校准"
          onClose={() => setPanel(null)}
        >
          <div className="mt-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs leading-5 text-stone-600">
            当前账面可消费余额为 {formatAmount(actualBookBalance)}。填写你现在除储备金外还能动用的钱，包含固定支出预留，差额会自动修正。
          </div>
          <div className="mt-3">
            <NumberField label="当前可消费余额" value={calibrationAmount} onChange={setCalibrationAmount} />
          </div>
          <SubmitButton onClick={handleCalibrationSubmit} label="完成校准" />
        </BottomSheet>
      )}

      {panel === 'fixed' && (
        <BottomSheet
          icon={<Landmark size={16} />}
          title="固定支出"
          onClose={() => setPanel(null)}
        >
          <div className="life-soft-row rounded-2xl bg-[#f8f4ec] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-stone-500">固定支出预留</div>
                <div className="mt-1 text-2xl font-black text-[#3e4c3b]">
                  {formatAmount(budget.pockets.fixedReserved)}
                </div>
              </div>
              <div className="text-right text-[10px] font-bold text-stone-500">
                留空或 0 时扣本周
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                value={fixedReservedAmount}
                onChange={(event) => setFixedReservedAmount(event.target.value)}
                placeholder="留空/0 不预留"
                className={fieldClass}
              />
              <button
                onClick={handleFixedReservedSubmit}
                className="rounded-xl bg-[#3f4842] px-3 text-xs font-black text-white"
              >
                保存
              </button>
            </div>
            <div className="mt-2 text-[10px] font-bold text-stone-500">
              主要收入到账时会优先补足固定支出清单缺口；已覆盖目标时不会重复新增。
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[1.4fr_1fr_0.8fr] gap-2">
            <input
              value={fixedForm.name}
              onChange={(event) => setFixedForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="名称"
              className={fieldClass}
            />
            <input
              type="number"
              value={fixedForm.amount}
              onChange={(event) => setFixedForm((prev) => ({ ...prev, amount: event.target.value }))}
              placeholder="金额"
              className={fieldClass}
            />
            <input
              type="number"
              value={fixedForm.dueDay}
              onChange={(event) => setFixedForm((prev) => ({ ...prev, dueDay: event.target.value }))}
              placeholder="日"
              className={fieldClass}
            />
          </div>
          <button
            onClick={handleAddFixedExpense}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#eee8dd] px-4 py-2.5 text-xs font-black text-[#65594c]"
          >
            <Plus size={14} /> 添加固定支出
          </button>
          <ul className="mt-3 space-y-2">
            {activeFixedExpenses.map((item) => (
              <li
                key={item.id}
                className="life-event-row flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-bold text-stone-800">{item.name}</div>
                  <div className="text-[11px] text-stone-500">
                    {formatAmount(item.amount)} · 每月 {item.dueDay} 日
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setData((prev) => markFixedExpensePaid(prev, item.id))}
                    disabled={item.paidCycleId === cycle?.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                      item.paidCycleId === cycle?.id
                        ? 'bg-[#e4ecdf] text-[#6f806a]'
                        : 'bg-[#3f4842] text-white'
                    }`}
                  >
                    {item.paidCycleId === cycle?.id ? '已支付' : '标记已付'}
                  </button>
                  <button
                    onClick={() => handleDeleteFixedExpense(item.id)}
                    className="rounded-lg bg-white p-2 text-stone-400 shadow-sm transition hover:text-red-500"
                    title="删除固定支出"
                    aria-label={`删除固定支出 ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
            {activeFixedExpenses.length === 0 && (
              <li className="rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-stone-400">
                暂无固定支出
              </li>
            )}
          </ul>
        </BottomSheet>
      )}

      <SectionShell className="p-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => openPanel('events')}
            className="flex items-center gap-2 text-xs font-black text-stone-500"
          >
            <ReceiptText size={14} />
            最近关键事件
          </button>
          <button
            onClick={() => openPanel('events')}
            className="text-[10px] font-bold text-stone-400"
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
            <li className="rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-stone-400">
              暂无记录
            </li>
          )}
        </ul>
      </SectionShell>

      {panel === 'events' && (
        <BottomSheet
          icon={<ReceiptText size={16} />}
          title="历史流水"
          onClose={() => setPanel(null)}
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
              <li className="rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-stone-400">
                暂无记录
              </li>
            )}
          </ul>
          {visibleEventCount < allEvents.length && (
            <button
              type="button"
              onClick={() => setVisibleEventCount((count) => count + 20)}
              className="mt-3 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs font-black text-stone-500"
            >
              加载更多（剩余 {allEvents.length - visibleEventCount} 条）
            </button>
          )}
        </BottomSheet>
      )}

      {selectedTransaction && (
        <BottomSheet
          icon={<ReceiptText size={16} />}
          title="资金流向"
          onClose={() => setSelectedTransaction(null)}
          layer="detail"
        >
          <TransactionFlowDetail
            transaction={selectedTransaction}
            kindLabel={getTransactionKindLabel(selectedTransaction)}
          />
        </BottomSheet>
      )}

      <SectionShell className="p-3">
        <button
          onClick={() => setShowBackup((prev) => !prev)}
          className="flex w-full items-center justify-between text-xs font-black text-stone-500"
        >
          <span className="flex items-center gap-2">
            <Settings size={14} /> 备份与旧数据
          </span>
          <ChevronDown
            size={14}
            className={`transition ${showBackup ? 'rotate-180' : ''}`}
          />
        </button>
        {showBackup && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            <button
              onClick={() =>
                exportDailyToExcel(
                  data,
                  new Date().getFullYear(),
                  new Date().getMonth() + 1,
                )
              }
              className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500"
            >
              <Download size={12} /> 导出生活预算
            </button>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500">
              <Upload size={12} /> 导入旧备份
              <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
            </label>
          </div>
        )}
      </SectionShell>
    </div>
  );
};

const PanelTitle: React.FC<{ icon: React.ReactNode; title: string }> = ({
  icon,
  title,
}) => (
  <h2 className="flex items-center gap-2 text-sm font-black text-[#4c554e]">
    {icon}
    {title}
  </h2>
);

const NumberField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <label className="text-xs font-bold text-stone-500">
    {label}
    <input
      type="number"
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
  <label className="text-xs font-bold text-stone-500">
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
  <label className="text-xs font-bold text-stone-500">
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
  <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-stone-100 p-1">
    {options.map(([optionValue, label]) => (
      <button
        key={optionValue}
        onClick={() => onChange(optionValue)}
        className={`rounded-xl px-3 py-2 text-xs font-black transition ${
          value === optionValue
            ? 'bg-white text-[#3f4842] shadow-sm'
            : 'text-stone-500'
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
    className="life-primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3f4842] px-4 py-3 text-sm font-black text-white"
  >
    <Check size={16} />
    {label}
  </button>
);
