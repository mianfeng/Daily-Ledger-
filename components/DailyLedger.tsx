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
  Shield,
  Tag,
  Upload,
  Utensils,
  Wallet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { DEFAULT_DAILY_DATA } from '../lib/appData';
import { formatDisplayDate, getTodayDate, normalizeDateInput } from '../lib/date';
import {
  addFixedExpense,
  allocateIncome,
  getBudgetCycleSummaries,
  calibrateSpendableBalance,
  getBudgetSnapshot,
  getLifeBudget,
  initializeLifeBudget,
  markFixedExpensePaid,
  recordExpense,
} from '../lib/daily';
import {
  DailyData,
  DailyExpenseCategory,
  DailyIncomeKind,
  LifeBudgetSettings,
} from '../types';
import { exportDailyToExcel, parseDailyImportWorkbook } from '../utils/excel';

interface DailyLedgerProps {
  data: DailyData;
  setData: React.Dispatch<React.SetStateAction<DailyData>>;
  theme: 'light' | 'dark';
}

type Panel = 'expense' | 'income' | 'calibration' | 'fixed' | 'settings' | 'cycle' | null;

const formatAmount = (value: number) =>
  `¥ ${Math.round(value).toLocaleString('zh-CN')}`;

const formatSignedAmount = (value: number) =>
  `${value >= 0 ? '+' : '-'}${formatAmount(Math.abs(value))}`;

const parseAmount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const percentToInput = (value: number) => String(Math.round(value * 100));

const inputToRate = (value: string, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, parsed)) / 100;
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

const panelButtonClass =
  'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold shadow-sm transition active:scale-[0.98]';

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

export const DailyLedger: React.FC<DailyLedgerProps> = ({ data, setData, theme }) => {
  const today = getTodayDate();
  const snapshot = useMemo(() => getBudgetSnapshot(data, today), [data, today]);
  const { budget, cycle, week } = snapshot;
  const [panel, setPanel] = useState<Panel>(budget.initialized ? null : 'settings');
  const [showBackup, setShowBackup] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [setupForm, setSetupForm] = useState({
    spendable: String(budget.pockets.spendable || ''),
    buffer: String(budget.pockets.buffer || ''),
    reserve: String(budget.pockets.reserve || ''),
    expectedPayday: String(budget.settings.expectedPayday),
    savingsRate: percentToInput(budget.settings.savingsRate),
    bufferRate: percentToInput(budget.settings.bufferRate),
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
    desc: '',
    category: 'daily' as DailyExpenseCategory,
  });
  const [calibrationAmount, setCalibrationAmount] = useState('');
  const [fixedForm, setFixedForm] = useState({
    name: '',
    amount: '',
    dueDay: '1',
  });

  const weekProgress =
    week && week.allowance > 0
      ? Math.min(100, Math.round((snapshot.weekSpent / week.allowance) * 100))
      : 0;
  const reserveProgress =
    snapshot.reserveMinimum > 0
      ? Math.min(100, Math.round((budget.pockets.reserve / snapshot.reserveMinimum) * 100))
      : 100;
  const actualBookBalance = snapshot.weekRemaining + budget.pockets.buffer;
  const shouldRecommendLarge =
    parseAmount(expenseForm.amount) >= budget.settings.largeExpenseAbsoluteThreshold ||
    (week?.allowance ?? 0) > 0 &&
      parseAmount(expenseForm.amount) >=
        (week?.allowance ?? 0) * budget.settings.largeExpenseWeeklyRate;

  const recentEvents = useMemo(
    () =>
      [...data.transactions]
        .sort((left, right) => (left.date < right.date ? 1 : -1))
        .slice(0, 10),
    [data.transactions],
  );
  const cycleSummaries = useMemo(() => getBudgetCycleSummaries(data), [data]);
  const currentCycleSummary = cycleSummaries[0];

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
    setPanel((prev) => {
      const resolvedPanel = prev === nextPanel ? null : nextPanel;
      if (resolvedPanel) {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`life-panel-${resolvedPanel}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      return resolvedPanel;
    });
  };

  useEffect(() => {
    if (panel !== 'settings') {
      return;
    }

    setSetupForm({
      spendable: String(budget.pockets.spendable || ''),
      buffer: String(budget.pockets.buffer || ''),
      reserve: String(budget.pockets.reserve || ''),
      expectedPayday: String(budget.settings.expectedPayday),
      savingsRate: percentToInput(budget.settings.savingsRate),
      bufferRate: percentToInput(budget.settings.bufferRate),
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
          expectedPayday: Math.round(parseAmount(setupForm.expectedPayday)) || 10,
          savingsRate: inputToRate(setupForm.savingsRate, budget.settings.savingsRate),
          bufferRate: inputToRate(setupForm.bufferRate, budget.settings.bufferRate),
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

    const category =
      shouldRecommendLarge && expenseForm.category !== 'large'
        ? window.confirm('这笔支出较大，要按“大额支出”处理吗？')
          ? 'large'
          : expenseForm.category
        : expenseForm.category;

    if (
      category === 'large' &&
      budget.pockets.reserve - amount < snapshot.reserveMinimum &&
      !window.confirm('这笔大额支出会让储备金低于最低线，仍然记录吗？')
    ) {
      return;
    }

    setData((prev) =>
      recordExpense(prev, {
        amount,
        category,
        date: expenseForm.date,
        desc: expenseForm.desc,
      }),
    );
    setExpenseForm((prev) => ({ ...prev, amount: '', desc: '', category: 'daily' }));
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

  const updateSettings = (nextSettings: Partial<LifeBudgetSettings>) => {
    setData((prev) => ({
      ...prev,
      budget: {
        ...getLifeBudget(prev),
        settings: {
          ...getLifeBudget(prev).settings,
          ...nextSettings,
        },
      },
    }));
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

      <section className="grid grid-cols-1 gap-3 md:grid-cols-[1.35fr_0.9fr]">
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
            <div className="rounded-xl bg-white/45 px-3 py-2">
              <div className="text-[#657b7a]">可消费池</div>
              <div className="font-black text-[#30413f]">
                {formatAmount(actualBookBalance)}
              </div>
            </div>
          </div>
        </div>

        <div className="life-buffer-card rounded-[1.35rem] border border-[#c9d7ca] bg-[#e4ecdf] p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#6f806a]">
              <Shield size={14} />
              缓冲金
            </div>
            <span className="rounded-full bg-white/55 px-2 py-1 text-[10px] font-bold text-[#6f806a]">
              本周补充
            </span>
          </div>
          <div className="mt-3 text-3xl font-black text-[#3f563d]">
            {formatAmount(budget.pockets.buffer)}
          </div>
          <p className="mt-2 text-xs leading-5 text-[#6f806a]">
            普通支出超出本预算周时自动补上；不用时，周期结束后多余部分会回到储备金。
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <SectionShell className="p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#8b7356]">
            <AlertTriangle size={14} />
            待处理
          </div>
          <div className="mt-3 space-y-2 text-xs">
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
        </SectionShell>

        <SectionShell className="p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#6e7c6b]">
            <Landmark size={14} />
            固定支出预留
          </div>
          <div className="mt-2 text-2xl font-black text-[#3e4c3b]">
            {formatAmount(budget.pockets.fixedReserved)}
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
              <span>本期固定项</span>
              <b>{budget.fixedExpenses.filter((item) => item.isActive).length}</b>
            </div>
            <div className="life-soft-row flex justify-between rounded-lg bg-[#f8f4ec] px-2 py-1.5">
              <span>待确认</span>
              <b>{snapshot.pendingFixed.length}</b>
            </div>
          </div>
        </SectionShell>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button
          onClick={() => openPanel('expense')}
          className={`${panelButtonClass} bg-[#3f4842] text-white`}
        >
          <ReceiptText size={16} /> 记支出
        </button>
        <button
          onClick={() => openPanel('income')}
          className={`${panelButtonClass} bg-[#8aa0a2] text-white`}
        >
          <CircleDollarSign size={16} /> 收入分配
        </button>
        <button
          onClick={() => openPanel('calibration')}
          className={`${panelButtonClass} bg-[#e8dfd1] text-[#65594c]`}
        >
          <RefreshCw size={16} /> 余额校准
        </button>
        <button
          onClick={() => openPanel('fixed')}
          className={`${panelButtonClass} bg-[#eee8dd] text-[#65594c]`}
        >
          <Landmark size={16} /> 固定支出
        </button>
      </section>

      {panel === 'cycle' && (
        <div id="life-panel-cycle">
          <SectionShell className="p-4">
            <PanelTitle icon={<CalendarDays size={16} />} title="周期详情" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="life-soft-row rounded-xl bg-[#f8f4ec] px-3 py-2">
                <div className="text-stone-500">本预算周剩余</div>
                <b className="text-base">{formatAmount(snapshot.weekRemaining)}</b>
              </div>
              <div className="life-soft-row rounded-xl bg-[#f8f4ec] px-3 py-2">
                <div className="text-stone-500">缓冲金</div>
                <b className="text-base">{formatAmount(budget.pockets.buffer)}</b>
              </div>
              <div className="life-soft-row rounded-xl bg-[#f8f4ec] px-3 py-2">
                <div className="text-stone-500">固定支出预留</div>
                <b className="text-base">{formatAmount(budget.pockets.fixedReserved)}</b>
              </div>
              <div className="life-soft-row rounded-xl bg-[#f8f4ec] px-3 py-2">
                <div className="text-stone-500">储备金</div>
                <b className="text-base">{formatAmount(budget.pockets.reserve)}</b>
              </div>
            </div>

            {cycle ? (
              <>
                <div className="mt-4 rounded-2xl border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-black text-[#4c554e]">当前周期</div>
                      <div className="mt-0.5 text-stone-500">
                        {formatDisplayDate(cycle.startDate)} - {formatDisplayDate(cycle.plannedEndDate)}
                      </div>
                    </div>
                    <b>{snapshot.isExtended ? '延长期' : cycle.status === 'closed' ? '已结束' : '进行中'}</b>
                  </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">周期收入</span>
                      <b className="block">{formatAmount(cycle.mainIncome)}</b>
                    </div>
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">日常预算</span>
                      <b className="block">{formatAmount(currentCycleSummary?.budget ?? 0)}</b>
                    </div>
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">日常结余</span>
                      <b className="block">{formatAmount(currentCycleSummary?.balance ?? 0)}</b>
                    </div>
                    <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                      <span className="text-stone-500">储备增长</span>
                      <b className="block">{formatAmount((currentCycleSummary?.reserveChange ?? 0))}</b>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="text-xs font-black text-stone-500">本周期每周情况</h3>
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
                              未来周，只显示预算，不计算余额。
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
                </div>
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
                  {cycleSummaries.slice(1, 5).map(({ cycle: item, balance, budget, reserveChange }) => {
                    const isFutureCycle = item.startDate > today;
                    return (
                    <div
                      key={item.id}
                      className="life-event-row flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <b>{formatDisplayDate(item.startDate)} - {formatDisplayDate(item.plannedEndDate)}</b>
                        <div className="mt-0.5 text-[10px] text-stone-500">
                          收入 {formatAmount(item.mainIncome)} · {isFutureCycle ? '预算' : '结余'} {formatAmount(isFutureCycle ? budget : balance)}
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
          </SectionShell>
        </div>
      )}

      {panel === 'settings' && (
        <div id="life-panel-settings">
        <SectionShell className="p-4">
          <PanelTitle icon={<Settings size={16} />} title={budget.initialized ? '预算设置' : '初始设置'} />
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
                {formatAmount(budget.pockets.reserve)}
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
                  <div className="text-stone-500">最低线</div>
                  <b>{formatAmount(snapshot.reserveMinimum)}</b>
                </div>
                <div className="life-soft-row rounded-lg bg-[#f8f4ec] px-2 py-1.5">
                  <div className="text-stone-500">净变化</div>
                  <b className={snapshot.reserveNetChange >= 0 ? 'text-[#6f8b6b]' : 'text-[#b66b5d]'}>
                    {formatSignedAmount(snapshot.reserveNetChange)}
                  </b>
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
            <NumberField label="预计发薪日" value={setupForm.expectedPayday} onChange={(expectedPayday) => setSetupForm((prev) => ({ ...prev, expectedPayday }))} />
            <NumberField label="储备比例 %" value={setupForm.savingsRate} onChange={(savingsRate) => setSetupForm((prev) => ({ ...prev, savingsRate }))} />
            <NumberField label="缓冲比例 %" value={setupForm.bufferRate} onChange={(bufferRate) => setSetupForm((prev) => ({ ...prev, bufferRate }))} />
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
          <button
            onClick={() => {
              if (!budget.initialized) {
                handleInitialize();
                return;
              }

              updateSettings({
                expectedPayday: Math.round(parseAmount(setupForm.expectedPayday)) || 10,
                savingsRate: inputToRate(setupForm.savingsRate, budget.settings.savingsRate),
                bufferRate: inputToRate(setupForm.bufferRate, budget.settings.bufferRate),
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
        </SectionShell>
        </div>
      )}

      {panel === 'income' && (
        <div id="life-panel-income">
        <SectionShell className="p-4">
          <PanelTitle icon={<CircleDollarSign size={16} />} title="收入分配" />
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
              主要收入会开启新的预算周期：先预留固定支出，再存入储备金，剩余自动拆成本预算周额度和缓冲金。
            </div>
          )}
          <SubmitButton onClick={handleIncomeSubmit} label="确认分配" />
        </SectionShell>
        </div>
      )}

      {panel === 'expense' && (
        <div id="life-panel-expense">
        <SectionShell className="p-4">
          <PanelTitle icon={<ReceiptText size={16} />} title="记支出" />
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
            <DateField label="日期" value={expenseForm.date} onChange={(date) => setExpenseForm((prev) => ({ ...prev, date }))} />
            <TextField label="备注" value={expenseForm.desc} onChange={(desc) => setExpenseForm((prev) => ({ ...prev, desc }))} placeholder="可选" />
          </div>
          {shouldRecommendLarge && expenseForm.category !== 'large' && (
            <div className="mt-3 rounded-xl bg-[#f8ece8] px-3 py-2 text-xs font-bold text-[#9b5b4e]">
              这笔金额较大，提交时会询问是否按大额支出处理。
            </div>
          )}
          <SubmitButton onClick={handleExpenseSubmit} label="记录支出" />
        </SectionShell>
        </div>
      )}

      {panel === 'calibration' && (
        <div id="life-panel-calibration">
        <SectionShell className="p-4">
          <PanelTitle icon={<RefreshCw size={16} />} title="余额校准" />
          <div className="mt-3 rounded-xl bg-[#f3f0e9] px-3 py-2 text-xs leading-5 text-stone-600">
            当前账面可消费余额为 {formatAmount(actualBookBalance)}。只填你现在准备用来日常花的钱合计，差额会自动修正。
          </div>
          <div className="mt-3">
            <NumberField label="当前可消费余额" value={calibrationAmount} onChange={setCalibrationAmount} />
          </div>
          <SubmitButton onClick={handleCalibrationSubmit} label="完成校准" />
        </SectionShell>
        </div>
      )}

      {panel === 'fixed' && (
        <div id="life-panel-fixed">
        <SectionShell className="p-4">
          <PanelTitle icon={<Landmark size={16} />} title="固定支出" />
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
            {budget.fixedExpenses.map((item) => (
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
              </li>
            ))}
            {budget.fixedExpenses.length === 0 && (
              <li className="rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-stone-400">
                暂无固定支出
              </li>
            )}
          </ul>
        </SectionShell>
        </div>
      )}

      <SectionShell className="p-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-black text-stone-500">
            <ReceiptText size={14} />
            最近关键事件
          </h2>
          <span className="text-[10px] text-stone-400">最近 10 条</span>
        </div>
        <ul className="mt-3 space-y-2">
          {recentEvents.map((transaction) => (
            <li
              key={transaction.id}
              className="life-event-row flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2"
            >
              <div>
                <div className="text-xs font-bold text-stone-800">
                  {transaction.type === 'income'
                    ? incomeKindLabels[transaction.incomeKind ?? 'casual']
                    : categoryLabels[transaction.category ?? 'other']}
                  <span className="ml-2 font-medium text-stone-500">{transaction.desc}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-stone-400">
                  {formatDisplayDate(transaction.date)}
                </div>
              </div>
              <div
                className={`text-xs font-black ${
                  transaction.type === 'income' ? 'text-[#6f8b6b]' : 'text-[#b66b5d]'
                }`}
              >
                {transaction.type === 'income' ? '+' : '-'}
                {formatAmount(transaction.amount)}
              </div>
            </li>
          ))}
          {recentEvents.length === 0 && (
            <li className="rounded-xl bg-stone-50 px-3 py-4 text-center text-xs text-stone-400">
              暂无记录
            </li>
          )}
        </ul>
      </SectionShell>

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
