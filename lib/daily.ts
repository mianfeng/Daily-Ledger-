import {
  BudgetCycle,
  BudgetWeek,
  DailyData,
  DailyExpenseCategory,
  DailyIncomeKind,
  DailyTransaction,
  DailyTransactionAllocation,
  FixedExpense,
  LifeBudgetSettings,
  LifeBudgetState,
  Transaction,
} from '../types';
import {
  formatMonthKey,
  getDayOfMonth,
  getTodayDate,
  isDateInMonth,
  normalizeDateInput,
} from './date';
import { createTransactionId, normalizeTransaction } from './ledger';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const roundAmount = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampRate = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const daysBetweenInclusive = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
};

const getNextPayday = (startDate: string, payday: number) => {
  const start = new Date(`${startDate}T00:00:00`);
  const safePayday = Math.min(28, Math.max(1, Math.round(payday)));
  const candidate = new Date(start.getFullYear(), start.getMonth(), safePayday);
  if (candidate.getTime() <= start.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
};

const normalizeExpenseCategory = (value: unknown): DailyExpenseCategory | undefined => {
  if (
    value === 'daily' ||
    value === 'dining' ||
    value === 'other' ||
    value === 'unplanned' ||
    value === 'large' ||
    value === 'fixed' ||
    value === 'unrecorded'
  ) {
    return value;
  }
  return undefined;
};

const normalizeIncomeKind = (value: unknown): DailyIncomeKind | undefined => {
  if (
    value === 'main' ||
    value === 'casual' ||
    value === 'refund' ||
    value === 'correction'
  ) {
    return value;
  }
  return undefined;
};

const normalizeAllocation = (raw: unknown) => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const allocation: DailyTransactionAllocation = {
    week: roundAmount(toFiniteNumber(raw.week)),
    buffer: roundAmount(toFiniteNumber(raw.buffer)),
    advance: roundAmount(toFiniteNumber(raw.advance)),
    reserve: roundAmount(toFiniteNumber(raw.reserve)),
    fixed: roundAmount(toFiniteNumber(raw.fixed)),
  };

  if (raw.reserveDeposit !== undefined) {
    allocation.reserveDeposit = roundAmount(toFiniteNumber(raw.reserveDeposit));
  }

  if (raw.reserveRecovery !== undefined) {
    allocation.reserveRecovery = roundAmount(toFiniteNumber(raw.reserveRecovery));
  }

  return allocation;
};

export const DEFAULT_LIFE_BUDGET_SETTINGS: LifeBudgetSettings = {
  expectedPayday: 10,
  savingsRate: 0.2,
  bufferRate: 0.2,
  reserveRecoveryRate: 0.1,
  weeklyRolloverReserveRate: 0.7,
  minimumWeeklyLiving: 400,
  reserveMinimumOverride: null,
  largeExpenseAbsoluteThreshold: 1000,
  largeExpenseWeeklyRate: 0.5,
};

export const DEFAULT_LIFE_BUDGET: LifeBudgetState = {
  initialized: false,
  settings: DEFAULT_LIFE_BUDGET_SETTINGS,
  pockets: {
    spendable: 0,
    buffer: 0,
    reserve: 0,
    fixedReserved: 0,
  },
  currentCycle: null,
  archivedCycles: [],
  fixedExpenses: [],
};

const sanitizeSettings = (raw: unknown): LifeBudgetSettings => {
  const value = isRecord(raw) ? raw : {};
  const reserveMinimumCandidate = value.reserveMinimumOverride;
  const reserveMinimumOverride =
    reserveMinimumCandidate === null || reserveMinimumCandidate === undefined || reserveMinimumCandidate === ''
      ? null
      : Math.max(0, toFiniteNumber(reserveMinimumCandidate, 0));

  return {
    expectedPayday: Math.min(
      28,
      Math.max(1, Math.round(toFiniteNumber(value.expectedPayday, DEFAULT_LIFE_BUDGET_SETTINGS.expectedPayday))),
    ),
    savingsRate: clampRate(value.savingsRate, DEFAULT_LIFE_BUDGET_SETTINGS.savingsRate),
    bufferRate: clampRate(value.bufferRate, DEFAULT_LIFE_BUDGET_SETTINGS.bufferRate),
    reserveRecoveryRate: clampRate(
      value.reserveRecoveryRate,
      DEFAULT_LIFE_BUDGET_SETTINGS.reserveRecoveryRate,
    ),
    weeklyRolloverReserveRate: clampRate(
      value.weeklyRolloverReserveRate,
      DEFAULT_LIFE_BUDGET_SETTINGS.weeklyRolloverReserveRate,
    ),
    minimumWeeklyLiving: Math.max(
      0,
      toFiniteNumber(value.minimumWeeklyLiving, DEFAULT_LIFE_BUDGET_SETTINGS.minimumWeeklyLiving),
    ),
    reserveMinimumOverride,
    largeExpenseAbsoluteThreshold: Math.max(
      0,
      toFiniteNumber(
        value.largeExpenseAbsoluteThreshold,
        DEFAULT_LIFE_BUDGET_SETTINGS.largeExpenseAbsoluteThreshold,
      ),
    ),
    largeExpenseWeeklyRate: clampRate(
      value.largeExpenseWeeklyRate,
      DEFAULT_LIFE_BUDGET_SETTINGS.largeExpenseWeeklyRate,
    ),
  };
};

const sanitizeFixedExpense = (raw: unknown): FixedExpense | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const name = String(raw.name ?? '').trim();
  const amount = toFiniteNumber(raw.amount, 0);
  if (!name || amount <= 0) {
    return null;
  }

  return {
    id: toFiniteNumber(raw.id, createTransactionId()),
    name,
    amount: roundAmount(amount),
    dueDay: Math.min(31, Math.max(1, Math.round(toFiniteNumber(raw.dueDay, 1)))),
    isActive: raw.isActive !== false,
    paidCycleId: raw.paidCycleId === undefined ? undefined : toFiniteNumber(raw.paidCycleId),
    paidDate: typeof raw.paidDate === 'string' ? normalizeDateInput(raw.paidDate) : undefined,
  };
};

const sanitizePockets = (raw: unknown): LifeBudgetState['pockets'] => {
  const pockets = isRecord(raw) ? raw : {};

  return {
    spendable: roundAmount(Math.max(0, toFiniteNumber(pockets.spendable, 0))),
    buffer: roundAmount(Math.max(0, toFiniteNumber(pockets.buffer, 0))),
    reserve: roundAmount(Math.max(0, toFiniteNumber(pockets.reserve, 0))),
    fixedReserved: roundAmount(Math.max(0, toFiniteNumber(pockets.fixedReserved, 0))),
  };
};

const sanitizeBudgetWeek = (raw: unknown): BudgetWeek | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const startDate = normalizeDateInput(String(raw.startDate ?? ''));
  const endDate = normalizeDateInput(String(raw.endDate ?? ''));
  if (!startDate || !endDate) {
    return null;
  }

  return {
    index: Math.max(0, Math.round(toFiniteNumber(raw.index, 0))),
    startDate,
    endDate,
    allowance: roundAmount(Math.max(0, toFiniteNumber(raw.allowance, 0))),
  };
};

const sanitizeCycle = (raw: unknown): BudgetCycle | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const startDate = normalizeDateInput(String(raw.startDate ?? ''));
  const plannedEndDate = normalizeDateInput(String(raw.plannedEndDate ?? ''));
  const plannedNextIncomeDate = normalizeDateInput(String(raw.plannedNextIncomeDate ?? ''));
  const weeks = Array.isArray(raw.weeks)
    ? raw.weeks
        .map(sanitizeBudgetWeek)
        .filter((week): week is BudgetWeek => week !== null)
    : [];

  if (!startDate || !plannedEndDate || !plannedNextIncomeDate || weeks.length === 0) {
    return null;
  }

  return {
    id: toFiniteNumber(raw.id, createTransactionId()),
    startDate,
    plannedEndDate,
    plannedNextIncomeDate,
    status:
      raw.status === 'extended' || raw.status === 'closed' || raw.status === 'active'
        ? raw.status
        : 'active',
    mainIncome: roundAmount(Math.max(0, toFiniteNumber(raw.mainIncome, 0))),
    fixedReserved: roundAmount(Math.max(0, toFiniteNumber(raw.fixedReserved, 0))),
    reserveDeposit: roundAmount(Math.max(0, toFiniteNumber(raw.reserveDeposit, 0))),
    reserveRecovery: roundAmount(Math.max(0, toFiniteNumber(raw.reserveRecovery, 0))),
    startingBuffer: roundAmount(Math.max(0, toFiniteNumber(raw.startingBuffer, 0))),
    weeklyAllowance: roundAmount(Math.max(0, toFiniteNumber(raw.weeklyAllowance, 0))),
    weeks,
  };
};

const sanitizeLifeBudget = (raw: unknown): LifeBudgetState => {
  if (!isRecord(raw)) {
    return DEFAULT_LIFE_BUDGET;
  }

  const fixedExpenses = Array.isArray(raw.fixedExpenses)
    ? raw.fixedExpenses
        .map(sanitizeFixedExpense)
        .filter((item): item is FixedExpense => item !== null)
    : [];

  return {
    initialized: raw.initialized === true,
    settings: sanitizeSettings(raw.settings),
    pockets: sanitizePockets(raw.pockets),
    currentCycle: sanitizeCycle(raw.currentCycle),
    archivedCycles: Array.isArray(raw.archivedCycles)
      ? raw.archivedCycles
          .map(sanitizeCycle)
          .filter((cycle): cycle is BudgetCycle => cycle !== null)
      : [],
    fixedExpenses,
  };
};

const repairCycleFromTransactions = (
  cycle: BudgetCycle,
  transactions: DailyTransaction[],
) => {
  const mainIncomeTransactions = transactions.filter((transaction) => {
    const transactionDate = normalizeDateInput(transaction.date);
    return (
      transaction.type === 'income' &&
      (transaction.incomeKind === 'main' || transaction.incomeKind === undefined) &&
      transactionDate >= cycle.startDate &&
      transactionDate <= cycle.plannedEndDate
    );
  });

  if (mainIncomeTransactions.length === 0) {
    return cycle.mainIncome > 0 ? cycle : null;
  }

  const totals = mainIncomeTransactions.reduce(
    (result, transaction) => ({
      mainIncome: result.mainIncome + transaction.amount,
      fixedReserved: result.fixedReserved + (transaction.allocation?.fixed ?? 0),
      reserveDeposit:
        result.reserveDeposit +
        (transaction.allocation?.reserveDeposit ??
          (transaction.allocation?.reserveRecovery === undefined
            ? transaction.allocation?.reserve ?? 0
            : 0)),
      reserveRecovery:
        result.reserveRecovery + (transaction.allocation?.reserveRecovery ?? 0),
      startingBuffer: result.startingBuffer + (transaction.allocation?.buffer ?? 0),
    }),
    {
      mainIncome: 0,
      fixedReserved: 0,
      reserveDeposit: 0,
      reserveRecovery: 0,
      startingBuffer: 0,
    },
  );

  return {
    ...cycle,
    mainIncome: roundAmount(totals.mainIncome),
    fixedReserved: roundAmount(totals.fixedReserved),
    reserveDeposit: roundAmount(totals.reserveDeposit),
    reserveRecovery: roundAmount(totals.reserveRecovery),
    startingBuffer: roundAmount(totals.startingBuffer),
  };
};

const repairBudgetFromTransactions = (
  budget: LifeBudgetState,
  transactions: DailyTransaction[],
): LifeBudgetState => ({
  ...budget,
  currentCycle: budget.currentCycle
    ? repairCycleFromTransactions(budget.currentCycle, transactions)
    : null,
  archivedCycles: budget.archivedCycles
    .map((cycle) => repairCycleFromTransactions(cycle, transactions))
    .filter((cycle): cycle is BudgetCycle => cycle !== null),
});

const sanitizePreviousCycle = (raw: unknown) => {
  if (raw === null) {
    return null;
  }
  return sanitizeCycle(raw);
};

export const sanitizeDailyData = (
  raw: unknown,
  fallback: DailyData,
): DailyData => {
  if (!isRecord(raw)) {
    return fallback;
  }

  const dailyLimitCandidate = Number(raw.dailyLimit);
  const dailyLimit = Number.isFinite(dailyLimitCandidate)
    ? dailyLimitCandidate
    : fallback.dailyLimit;
  const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  const transactions = rawTransactions
    .map((item) => {
      const normalized = normalizeTransaction(item, {
        incomeDesc: '额外收入',
        expenseDesc: '日常支出',
      });
      if (!normalized || !isRecord(item)) {
        return normalized;
      }

      return {
        ...normalized,
        date: normalizeDateInput(normalized.date),
        category: normalizeExpenseCategory(item.category),
        incomeKind: normalizeIncomeKind(item.incomeKind),
        allocation: normalizeAllocation(item.allocation),
        fixedExpenseId:
          item.fixedExpenseId === undefined
            ? undefined
            : toFiniteNumber(item.fixedExpenseId),
        previousCycle:
          item.previousCycle === undefined
            ? undefined
            : sanitizePreviousCycle(item.previousCycle),
        previousPockets:
          item.previousPockets === undefined
            ? undefined
            : sanitizePockets(item.previousPockets),
      };
    })
    .filter((item): item is Transaction => item !== null)
    .map((transaction) => ({
      ...transaction,
      date: normalizeDateInput(transaction.date),
    }));
  const budget = repairBudgetFromTransactions(
    sanitizeLifeBudget(raw.budget),
    transactions,
  );

  return {
    dailyLimit,
    budget,
    transactions,
  };
};

export const getLifeBudget = (data: DailyData) => data.budget ?? DEFAULT_LIFE_BUDGET;

export const getReserveMinimum = (budget: LifeBudgetState) => {
  if (budget.settings.reserveMinimumOverride !== null) {
    return budget.settings.reserveMinimumOverride;
  }

  const fixedTotal = budget.fixedExpenses
    .filter((item) => item.isActive)
    .reduce((total, item) => total + item.amount, 0);

  return roundAmount(fixedTotal + budget.settings.minimumWeeklyLiving * 2);
};

export const getCurrentBudgetWeek = (
  cycle: BudgetCycle | null,
  today = getTodayDate(),
) => {
  if (!cycle) {
    return null;
  }

  const normalizedToday = normalizeDateInput(today);
  return (
    cycle.weeks.find(
      (week) => normalizedToday >= week.startDate && normalizedToday <= week.endDate,
    ) ?? cycle.weeks[cycle.weeks.length - 1] ?? null
  );
};

const getWeekExpenseTotal = (
  transactions: DailyTransaction[],
  week: BudgetWeek | null,
) => {
  if (!week) {
    return 0;
  }

  return roundAmount(
    transactions
      .filter(
        (transaction) => {
          const transactionDate = normalizeDateInput(transaction.date);
          return (
            transaction.type === 'expense' &&
            transaction.category !== 'large' &&
            transactionDate >= week.startDate &&
            transactionDate <= week.endDate
          );
        },
      )
      .reduce((total, transaction) => {
        if (transaction.category === 'fixed') {
          return (
            total +
            (transaction.allocation?.week ?? 0) +
            (transaction.allocation?.advance ?? 0)
          );
        }
        return total + transaction.amount;
      }, 0),
  );
};

const isTransactionInCycle = (
  transaction: DailyTransaction,
  cycle: BudgetCycle,
) => {
  const transactionDate = normalizeDateInput(transaction.date);
  return transactionDate >= cycle.startDate && transactionDate <= cycle.plannedEndDate;
};

const getUsableIncomeAllocation = (transaction: DailyTransaction) =>
  roundAmount(
    (transaction.allocation?.week ?? 0) +
      (transaction.allocation?.buffer ?? 0) +
      (transaction.allocation?.advance ?? 0),
  );

const getUsableExpenseAllocation = (transaction: DailyTransaction) => {
  if (transaction.category === 'large') {
    return 0;
  }

  if (transaction.allocation) {
    return roundAmount(
      transaction.allocation.week +
        transaction.allocation.buffer +
        transaction.allocation.advance,
    );
  }

  return transaction.amount;
};

const getCycleUsableIncomeTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle,
) =>
  roundAmount(
    transactions
      .filter(
        (transaction) =>
          transaction.type === 'income' && isTransactionInCycle(transaction, cycle),
      )
      .reduce((total, transaction) => {
        const usableAllocation = getUsableIncomeAllocation(transaction);
        return total + (usableAllocation > 0 ? usableAllocation : transaction.amount);
      }, 0),
  );

const getCycleLivingExpenseTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle | null,
) => {
  if (!cycle) {
    return 0;
  }

  return roundAmount(
    transactions
      .filter(
        (transaction) => {
          return (
            transaction.type === 'expense' &&
            isTransactionInCycle(transaction, cycle)
          );
        },
      )
      .reduce((total, transaction) => total + getUsableExpenseAllocation(transaction), 0),
  );
};

export const getBudgetSnapshot = (data: DailyData, today = getTodayDate()) => {
  const budget = getLifeBudget(data);
  const cycle = budget.currentCycle;
  const week = getCurrentBudgetWeek(cycle, today);
  const weekSpent = getWeekExpenseTotal(data.transactions, week);
  const weekRemaining = roundAmount(Math.max(0, (week?.allowance ?? 0) - weekSpent));
  const reserveMinimum = getReserveMinimum(budget);
  const reserveGap = roundAmount(Math.max(0, reserveMinimum - budget.pockets.reserve));

  const cycleTransactions = cycle
    ? data.transactions.filter((transaction) => normalizeDateInput(transaction.date) >= cycle.startDate)
    : [];
  const reserveIn = cycle?.reserveDeposit ?? 0;
  const reserveOut = cycleTransactions
    .filter((transaction) => {
      const transactionDate = normalizeDateInput(transaction.date);
      return (
        transaction.category === 'large' &&
        (!cycle || transactionDate <= cycle.plannedEndDate)
      );
    })
    .reduce((total, transaction) => total + (transaction.allocation?.reserve ?? transaction.amount), 0);

  return {
    budget,
    cycle,
    week,
    weekSpent,
    weekRemaining,
    reserveMinimum,
    reserveGap,
    reserveNetChange: roundAmount(reserveIn - reserveOut),
    pendingFixed: budget.fixedExpenses.filter(
      (item) => item.isActive && item.paidCycleId !== cycle?.id,
    ),
    needsCalibration: Boolean(week),
    isExtended:
      Boolean(cycle) && normalizeDateInput(today) >= (cycle?.plannedNextIncomeDate ?? '9999-12-31'),
  };
};

export const getCycleExpenseTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle | null,
) => {
  if (!cycle) {
    return 0;
  }

  return roundAmount(
    transactions
      .filter(
        (transaction) => {
          const transactionDate = normalizeDateInput(transaction.date);
          return (
            transaction.type === 'expense' &&
            transactionDate >= cycle.startDate &&
            transactionDate <= cycle.plannedEndDate
          );
        },
      )
      .reduce((total, transaction) => total + transaction.amount, 0),
  );
};

export const getBudgetWeekSummaries = (
  data: DailyData,
  cycle: BudgetCycle | null,
) =>
  cycle
    ? cycle.weeks.map((week) => {
        const spent = getWeekExpenseTotal(data.transactions, week);
        return {
          ...week,
          spent,
          remaining: roundAmount(Math.max(0, week.allowance - spent)),
        };
      })
    : [];

export const getBudgetCycleSummaries = (data: DailyData) => {
  const budget = getLifeBudget(data);
  const cycles = [
    ...(budget.currentCycle ? [budget.currentCycle] : []),
    ...budget.archivedCycles,
  ];

  return cycles.map((cycle) => {
    const livingSpent = getCycleLivingExpenseTotal(data.transactions, cycle);
    const usableIncome = getCycleUsableIncomeTotal(data.transactions, cycle);
    const livingBudget = roundAmount(
      usableIncome ||
        cycle.weeks.reduce((total, week) => total + week.allowance, 0) +
          cycle.startingBuffer,
    );

    return {
      cycle,
      spent: getCycleExpenseTotal(data.transactions, cycle),
      livingSpent,
      weeks: getBudgetWeekSummaries(data, cycle),
      balance: roundAmount(livingBudget - livingSpent),
      budget: livingBudget,
      reserveChange: roundAmount(cycle.reserveDeposit + cycle.reserveRecovery),
    };
  });
};

const buildWeeks = (
  startDate: string,
  plannedEndDate: string,
  fullWeekAllowance: number,
) => {
  const weeks: BudgetWeek[] = [];
  let cursor = startDate;
  let index = 0;

  while (cursor <= plannedEndDate) {
    const endDate = addDays(cursor, 6) > plannedEndDate ? plannedEndDate : addDays(cursor, 6);
    const days = daysBetweenInclusive(cursor, endDate);
    weeks.push({
      index,
      startDate: cursor,
      endDate,
      allowance: roundAmount(fullWeekAllowance * (days / 7)),
    });
    cursor = addDays(endDate, 1);
    index += 1;
  }

  return weeks;
};

export const initializeLifeBudget = (
  data: DailyData,
  {
    buffer,
    reserve,
    spendable,
    settings,
  }: {
    spendable: number;
    buffer: number;
    reserve: number;
    settings: Partial<LifeBudgetSettings>;
  },
): DailyData => ({
  ...data,
  budget: {
    ...DEFAULT_LIFE_BUDGET,
    initialized: true,
    settings: sanitizeSettings({
      ...DEFAULT_LIFE_BUDGET_SETTINGS,
      ...settings,
    }),
    pockets: {
      spendable: roundAmount(Math.max(0, spendable)),
      buffer: roundAmount(Math.max(0, buffer)),
      reserve: roundAmount(Math.max(0, reserve)),
      fixedReserved: 0,
    },
  },
});

export const addFixedExpense = (
  data: DailyData,
  fixedExpense: Omit<FixedExpense, 'id' | 'isActive'>,
): DailyData => {
  const budget = getLifeBudget(data);
  return {
    ...data,
    budget: {
      ...budget,
      fixedExpenses: [
        ...budget.fixedExpenses,
        {
          ...fixedExpense,
          id: createTransactionId(),
          amount: roundAmount(Math.max(0, fixedExpense.amount)),
          dueDay: Math.min(31, Math.max(1, fixedExpense.dueDay)),
          isActive: true,
        },
      ],
    },
  };
};

export const adjustFixedReserved = (
  data: DailyData,
  amount: number,
): DailyData => {
  const budget = getLifeBudget(data);
  const safeAmount = roundAmount(Math.max(0, amount));
  const movableTotal = roundAmount(budget.pockets.spendable + budget.pockets.fixedReserved);
  const nextFixedReserved = roundAmount(Math.min(safeAmount, movableTotal));

  return {
    ...data,
    budget: {
      ...budget,
      pockets: {
        ...budget.pockets,
        fixedReserved: nextFixedReserved,
        spendable: roundAmount(
          Math.max(0, movableTotal - nextFixedReserved),
        ),
      },
    },
  };
};

export const allocateIncome = (
  data: DailyData,
  {
    amount,
    date,
    desc,
    incomeKind,
  }: {
    amount: number;
    date: string;
    desc: string;
    incomeKind: DailyIncomeKind;
  },
): DailyData => {
  const budget = getLifeBudget(data);
  const safeAmount = roundAmount(Math.max(0, amount));
  const normalizedDate = normalizeDateInput(date) || getTodayDate();

  if (safeAmount <= 0) {
    return data;
  }

  const incomeTransaction: DailyTransaction = {
    id: createTransactionId(),
    date: normalizedDate,
    type: 'income',
    amount: safeAmount,
    desc: desc.trim() || (incomeKind === 'main' ? '主要收入' : incomeKind === 'refund' ? '退款报销' : '零散收入'),
    incomeKind,
  };

  if (incomeKind === 'casual' || incomeKind === 'correction') {
    return {
      ...data,
      transactions: [
        ...data.transactions,
        {
          ...incomeTransaction,
          allocation: {
            week: 0,
            buffer: safeAmount,
            advance: 0,
            reserve: 0,
            fixed: 0,
          },
        },
      ],
      budget: {
        ...budget,
        pockets: {
          ...budget.pockets,
          buffer: roundAmount(budget.pockets.buffer + safeAmount),
        },
      },
    };
  }

  if (incomeKind === 'refund') {
    return {
      ...data,
      transactions: [
        ...data.transactions,
        {
          ...incomeTransaction,
          allocation: {
            week: safeAmount,
            buffer: 0,
            advance: 0,
            reserve: 0,
            fixed: 0,
          },
        },
      ],
      budget: {
        ...budget,
        pockets: {
          ...budget.pockets,
          spendable: roundAmount(budget.pockets.spendable + safeAmount),
        },
      },
    };
  }

  if (
    budget.currentCycle &&
    normalizedDate >= budget.currentCycle.startDate &&
    normalizedDate <= budget.currentCycle.plannedEndDate
  ) {
    const reserveGap = Math.max(0, getReserveMinimum(budget) - budget.pockets.reserve);
    const reserveDeposit = roundAmount(
      Math.min(safeAmount * budget.settings.savingsRate, safeAmount),
    );
    const reserveRecovery = roundAmount(
      Math.min(
        reserveGap,
        Math.max(0, safeAmount - reserveDeposit),
        safeAmount * budget.settings.reserveRecoveryRate,
      ),
    );
    const remaining = roundAmount(Math.max(0, safeAmount - reserveDeposit - reserveRecovery));
    const buffer = roundAmount(remaining * budget.settings.bufferRate);
    const spendable = roundAmount(remaining - buffer);

    return {
      ...data,
      transactions: [
        ...data.transactions,
        {
          ...incomeTransaction,
          allocation: {
            week: spendable,
            buffer,
            advance: 0,
            reserve: reserveDeposit + reserveRecovery,
            fixed: 0,
            reserveDeposit,
            reserveRecovery,
          },
        },
      ],
      budget: {
        ...budget,
        currentCycle: {
          ...budget.currentCycle,
          mainIncome: roundAmount(budget.currentCycle.mainIncome + safeAmount),
          reserveDeposit: roundAmount(budget.currentCycle.reserveDeposit + reserveDeposit),
          reserveRecovery: roundAmount(budget.currentCycle.reserveRecovery + reserveRecovery),
          startingBuffer: roundAmount(budget.currentCycle.startingBuffer + buffer),
        },
        pockets: {
          ...budget.pockets,
          spendable: roundAmount(budget.pockets.spendable + spendable),
          buffer: roundAmount(budget.pockets.buffer + buffer),
          reserve: roundAmount(budget.pockets.reserve + reserveDeposit + reserveRecovery),
        },
      },
    };
  }

  const plannedNextIncomeDate = getNextPayday(normalizedDate, budget.settings.expectedPayday);
  const plannedEndDate = addDays(plannedNextIncomeDate, -1);
  const fixedReserved = 0;
  const dayUnits = daysBetweenInclusive(normalizedDate, plannedEndDate) / 7;
  const availableAfterFixed = safeAmount;
  const desiredReserve = roundAmount(safeAmount * budget.settings.savingsRate);
  const reserveGap = Math.max(0, getReserveMinimum(budget) - budget.pockets.reserve);
  const desiredRecovery = roundAmount(Math.min(reserveGap, safeAmount * budget.settings.reserveRecoveryRate));
  const minimumCycleLiving = budget.settings.minimumWeeklyLiving * dayUnits;
  const saveCapacity = Math.max(0, availableAfterFixed - minimumCycleLiving);
  const reserveDeposit = roundAmount(Math.min(desiredReserve, saveCapacity));
  const reserveRecovery = roundAmount(
    Math.min(desiredRecovery, Math.max(0, saveCapacity - reserveDeposit)),
  );
  const spendingPool = Math.max(0, availableAfterFixed - reserveDeposit - reserveRecovery);
  const weeklyAllowance = roundAmount(
    spendingPool / Math.max(1, dayUnits + budget.settings.bufferRate),
  );
  const startingBuffer = roundAmount(weeklyAllowance * budget.settings.bufferRate);
  const weeks = buildWeeks(normalizedDate, plannedEndDate, weeklyAllowance);
  const spendable = roundAmount(
    weeks.reduce((total, week) => total + week.allowance, 0),
  );

  const currentCycle: BudgetCycle = {
    id: createTransactionId(),
    startDate: normalizedDate,
    plannedEndDate,
    plannedNextIncomeDate,
    status: 'active',
    mainIncome: safeAmount,
    fixedReserved,
    reserveDeposit,
    reserveRecovery,
    startingBuffer,
    weeklyAllowance,
    weeks,
  };

  return {
    ...data,
    transactions: [
      ...data.transactions,
      {
        ...incomeTransaction,
        previousCycle: budget.currentCycle,
        previousPockets: budget.pockets,
        allocation: {
          week: spendable,
          buffer: startingBuffer,
          advance: 0,
          reserve: reserveDeposit + reserveRecovery,
          fixed: fixedReserved,
          reserveDeposit,
          reserveRecovery,
        },
      },
    ],
    budget: {
      ...budget,
      initialized: true,
      archivedCycles: budget.currentCycle
        ? [
            { ...budget.currentCycle, status: 'closed' as const },
            ...budget.archivedCycles,
          ].slice(0, 12)
        : budget.archivedCycles,
      currentCycle,
      pockets: {
        spendable,
        buffer: startingBuffer,
        reserve: roundAmount(budget.pockets.reserve + reserveDeposit + reserveRecovery),
        fixedReserved: budget.pockets.fixedReserved,
      },
    },
  };
};

export const recordExpense = (
  data: DailyData,
  {
    amount,
    category,
    date,
    desc,
  }: {
    amount: number;
    category: DailyExpenseCategory;
    date: string;
    desc: string;
  },
): DailyData => {
  const budget = getLifeBudget(data);
  const safeAmount = roundAmount(Math.max(0, amount));
  const normalizedDate = normalizeDateInput(date) || getTodayDate();
  if (safeAmount <= 0) {
    return data;
  }

  if (category === 'large') {
    const reserve = roundAmount(Math.min(safeAmount, budget.pockets.reserve));
    const transaction: DailyTransaction = {
      id: createTransactionId(),
      date: normalizedDate,
      type: 'expense',
      amount: safeAmount,
      category,
      desc: desc.trim() || '大额支出',
      allocation: {
        week: 0,
        buffer: 0,
        advance: 0,
        reserve,
        fixed: 0,
      },
    };

    return {
      ...data,
      transactions: [...data.transactions, transaction],
      budget: {
        ...budget,
        pockets: {
          ...budget.pockets,
          reserve: roundAmount(Math.max(0, budget.pockets.reserve - reserve)),
        },
      },
    };
  }

  const snapshot = getBudgetSnapshot(data, normalizedDate);
  let remaining = safeAmount;
  const week = roundAmount(Math.min(remaining, snapshot.weekRemaining));
  remaining = roundAmount(remaining - week);
  const buffer = roundAmount(Math.min(remaining, budget.pockets.buffer));
  remaining = roundAmount(remaining - buffer);
  const advance = remaining;

  const transaction: DailyTransaction = {
    id: createTransactionId(),
    date: normalizedDate,
    type: 'expense',
    amount: safeAmount,
    category,
    desc:
      desc.trim() ||
      (category === 'dining'
        ? '外食/外卖'
        : category === 'unplanned'
          ? '计划外支出'
          : category === 'unrecorded'
            ? '本周校准差额'
            : '日常支出'),
    allocation: {
      week,
      buffer,
      advance,
      reserve: 0,
      fixed: 0,
    },
  };

  return {
    ...data,
    transactions: [...data.transactions, transaction],
    budget: {
      ...budget,
      pockets: {
        ...budget.pockets,
        spendable: roundAmount(Math.max(0, budget.pockets.spendable - week - advance)),
        buffer: roundAmount(Math.max(0, budget.pockets.buffer - buffer)),
      },
    },
  };
};

export const calibrateSpendableBalance = (
  data: DailyData,
  actualBalance: number,
  date = getTodayDate(),
): DailyData => {
  const snapshot = getBudgetSnapshot(data, date);
  const expected = roundAmount(snapshot.weekRemaining + snapshot.budget.pockets.buffer);
  const delta = roundAmount(actualBalance - expected);

  if (Math.abs(delta) < 0.01) {
    return data;
  }

  if (delta < 0) {
    return recordExpense(data, {
      amount: Math.abs(delta),
      category: 'unrecorded',
      date,
      desc: '本周校准差额',
    });
  }

  return allocateIncome(data, {
    amount: delta,
    date,
    desc: '余额修正',
    incomeKind: 'correction',
  });
};

export const markFixedExpensePaid = (
  data: DailyData,
  fixedExpenseId: number,
  date = getTodayDate(),
): DailyData => {
  const budget = getLifeBudget(data);
  const fixedExpense = budget.fixedExpenses.find((item) => item.id === fixedExpenseId);
  if (!fixedExpense || fixedExpense.paidCycleId === budget.currentCycle?.id) {
    return data;
  }

  const transaction: DailyTransaction = {
    id: createTransactionId(),
    date: normalizeDateInput(date) || getTodayDate(),
    type: 'expense',
    amount: fixedExpense.amount,
    category: 'fixed',
    desc: fixedExpense.name,
    fixedExpenseId: fixedExpense.id,
    allocation: {
      week: 0,
      buffer: 0,
      advance: 0,
      reserve: 0,
      fixed: Math.min(fixedExpense.amount, budget.pockets.fixedReserved),
    },
  };
  let remaining = roundAmount(fixedExpense.amount - transaction.allocation.fixed);
  const snapshot = getBudgetSnapshot(data, transaction.date);
  transaction.allocation.week = roundAmount(Math.min(remaining, snapshot.weekRemaining));
  remaining = roundAmount(remaining - transaction.allocation.week);
  transaction.allocation.buffer = roundAmount(Math.min(remaining, budget.pockets.buffer));
  remaining = roundAmount(remaining - transaction.allocation.buffer);
  transaction.allocation.advance = remaining;

  return {
    ...data,
    transactions: [...data.transactions, transaction],
    budget: {
      ...budget,
      pockets: {
        ...budget.pockets,
        fixedReserved: roundAmount(Math.max(0, budget.pockets.fixedReserved - transaction.allocation.fixed)),
        spendable: roundAmount(
          Math.max(
            0,
            budget.pockets.spendable -
              transaction.allocation.week -
              transaction.allocation.advance,
          ),
        ),
        buffer: roundAmount(Math.max(0, budget.pockets.buffer - transaction.allocation.buffer)),
      },
      fixedExpenses: budget.fixedExpenses.map((item) =>
        item.id === fixedExpense.id
          ? {
              ...item,
              paidCycleId: budget.currentCycle?.id,
              paidDate: transaction.date,
            }
          : item,
      ),
    },
  };
};

const rollbackCycleMainIncome = (
  cycle: BudgetCycle,
  transaction: DailyTransaction,
  allocation: DailyTransactionAllocation,
) => {
  if (transaction.type !== 'income' || transaction.incomeKind !== 'main') {
    return cycle;
  }

  const nextMainIncome = roundAmount(Math.max(0, cycle.mainIncome - transaction.amount));
  if (nextMainIncome <= 0 && normalizeDateInput(transaction.date) === cycle.startDate) {
    return null;
  }

  const reserveDepositRollback =
    allocation.reserveDeposit !== undefined
      ? allocation.reserveDeposit
      : Math.min(cycle.reserveDeposit, allocation.reserve);
  const reserveRecoveryRollback =
    allocation.reserveRecovery !== undefined
      ? allocation.reserveRecovery
      : Math.min(
          cycle.reserveRecovery,
          roundAmount(Math.max(0, allocation.reserve - reserveDepositRollback)),
        );

  return {
    ...cycle,
    mainIncome: nextMainIncome,
    reserveDeposit: roundAmount(Math.max(0, cycle.reserveDeposit - reserveDepositRollback)),
    reserveRecovery: roundAmount(Math.max(0, cycle.reserveRecovery - reserveRecoveryRollback)),
    startingBuffer: roundAmount(Math.max(0, cycle.startingBuffer - allocation.buffer)),
  };
};

const getFallbackAllocation = (
  transaction: DailyTransaction,
): DailyTransactionAllocation => ({
  week: transaction.type === 'income' && transaction.incomeKind === 'refund' ? transaction.amount : 0,
  buffer:
    transaction.type === 'income' &&
    (transaction.incomeKind === 'casual' || transaction.incomeKind === 'correction')
      ? transaction.amount
      : 0,
  advance: 0,
  reserve: transaction.type === 'expense' && transaction.category === 'large' ? transaction.amount : 0,
  fixed: transaction.type === 'expense' && transaction.category === 'fixed' ? transaction.amount : 0,
});

const applyAllocationToPockets = (
  pockets: LifeBudgetState['pockets'],
  transaction: DailyTransaction,
  allocation: DailyTransactionAllocation,
) => {
  const direction = transaction.type === 'income' ? 1 : -1;

  return {
    spendable: roundAmount(
      Math.max(0, pockets.spendable + direction * (allocation.week + allocation.advance)),
    ),
    buffer: roundAmount(Math.max(0, pockets.buffer + direction * allocation.buffer)),
    reserve: roundAmount(Math.max(0, pockets.reserve + direction * allocation.reserve)),
    fixedReserved: roundAmount(Math.max(0, pockets.fixedReserved + direction * allocation.fixed)),
  };
};

const getPersistentCycleOpeningRollbackAllocation = (
  allocation: DailyTransactionAllocation,
): DailyTransactionAllocation => ({
  week: 0,
  buffer: 0,
  advance: 0,
  reserve: allocation.reserve,
  fixed: allocation.fixed,
  reserveDeposit: allocation.reserveDeposit,
  reserveRecovery: allocation.reserveRecovery,
});

export const deleteDailyTransaction = (
  data: DailyData,
  transactionId: number,
): DailyData => {
  const transactionIndex = data.transactions.findIndex((item) => item.id === transactionId);
  const transaction = data.transactions[transactionIndex];
  if (!transaction) {
    return data;
  }

  const budget = getLifeBudget(data);
  const allocation = transaction.allocation ?? getFallbackAllocation(transaction);

  const direction = transaction.type === 'income' ? -1 : 1;
  const transactionOpenedCurrentCycle =
    transaction.previousCycle !== undefined &&
    transaction.type === 'income' &&
    transaction.incomeKind === 'main' &&
    budget.currentCycle?.startDate === normalizeDateInput(transaction.date);
  const currentCycleOpeningDeleted =
    transactionOpenedCurrentCycle &&
    budget.currentCycle !== null &&
    roundAmount(Math.max(0, budget.currentCycle.mainIncome - transaction.amount)) <= 0;
  const pocketRollbackAllocation =
    transaction.previousCycle !== undefined && !transactionOpenedCurrentCycle
      ? getPersistentCycleOpeningRollbackAllocation(allocation)
      : allocation;
  const nextCurrentCycle = currentCycleOpeningDeleted
    ? transaction.previousCycle
    : budget.currentCycle
      ? rollbackCycleMainIncome(budget.currentCycle, transaction, allocation)
      : null;
  const nextArchivedCycles = currentCycleOpeningDeleted
    ? budget.archivedCycles.filter((cycle) => cycle.id !== transaction.previousCycle?.id)
    : budget.archivedCycles
        .map((cycle) => rollbackCycleMainIncome(cycle, transaction, allocation))
        .filter((cycle): cycle is BudgetCycle => cycle !== null);
  const rollbackPockets = {
    ...budget.pockets,
    spendable: roundAmount(
      Math.max(
        0,
        budget.pockets.spendable +
          direction * (pocketRollbackAllocation.week + pocketRollbackAllocation.advance),
      ),
    ),
    buffer: roundAmount(
      Math.max(0, budget.pockets.buffer + direction * pocketRollbackAllocation.buffer),
    ),
    reserve: roundAmount(
      Math.max(0, budget.pockets.reserve + direction * pocketRollbackAllocation.reserve),
    ),
    fixedReserved: roundAmount(
      Math.max(0, budget.pockets.fixedReserved + direction * pocketRollbackAllocation.fixed),
    ),
  };
  const restoredPockets = currentCycleOpeningDeleted && transaction.previousPockets
    ? data.transactions
        .slice(transactionIndex + 1)
        .reduce(
          (pockets, item) =>
            applyAllocationToPockets(
              pockets,
              item,
              item.allocation ?? getFallbackAllocation(item),
            ),
          transaction.previousPockets,
        )
    : rollbackPockets;
  const nextBudget: LifeBudgetState = {
    ...budget,
    currentCycle: nextCurrentCycle,
    archivedCycles: nextArchivedCycles,
    pockets: restoredPockets,
    fixedExpenses:
      transaction.type === 'expense' && transaction.category === 'fixed'
        ? budget.fixedExpenses.map((item) =>
            (transaction.fixedExpenseId !== undefined
              ? item.id === transaction.fixedExpenseId
              : item.name === transaction.desc &&
                item.amount === transaction.amount &&
                item.paidDate === transaction.date)
              ? {
                  ...item,
                  paidCycleId: undefined,
                  paidDate: undefined,
                }
              : item,
          )
        : budget.fixedExpenses,
  };

  return {
    ...data,
    budget: nextBudget,
    transactions: data.transactions.filter((item) => item.id !== transactionId),
  };
};

export const getMonthTransactions = (
  transactions: Transaction[],
  year: number,
  month: number,
) => transactions.filter((transaction) => isDateInMonth(transaction.date, year, month));

export const getTransactionSummary = (transactions: Transaction[]) => {
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      income = roundAmount(income + transaction.amount);
    } else {
      expense = roundAmount(expense + transaction.amount);
    }
  }

  return {
    income,
    expense,
    balance: roundAmount(income - expense),
  };
};

export const getTodaySpent = (
  transactions: Transaction[],
  today = getTodayDate(),
) =>
  roundAmount(
    transactions
      .filter(
        (transaction) =>
          transaction.type === 'expense' && normalizeDateInput(transaction.date) === today,
      )
      .reduce((total, transaction) => total + transaction.amount, 0),
  );

export const getCompliantDaysCount = (
  transactions: Transaction[],
  dailyLimit: number,
) => {
  const dailySpends = new Map<number, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }

    const day = getDayOfMonth(transaction.date);
    dailySpends.set(day, roundAmount((dailySpends.get(day) ?? 0) + transaction.amount));
  }

  let count = 0;
  for (const amount of dailySpends.values()) {
    if (amount <= dailyLimit) {
      count += 1;
    }
  }

  return count;
};

export const getEstimatedMonthEndBalance = ({
  balance,
  currentMonth,
  currentYear,
  dailyLimit,
  todaySpent,
}: {
  balance: number;
  currentMonth: number;
  currentYear: number;
  dailyLimit: number;
  todaySpent: number;
}) => {
  const now = new Date();
  if (
    currentYear !== now.getFullYear() ||
    currentMonth !== now.getMonth() + 1
  ) {
    return null;
  }

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const currentDay = now.getDate();
  const remainingDaysInMonth = daysInMonth - currentDay;
  const todayAllowanceLeft = Math.max(0, dailyLimit - todaySpent);
  const futureAllowance = remainingDaysInMonth * dailyLimit;

  return roundAmount(balance - todayAllowanceLeft - futureAllowance);
};

export const getDailyChartData = (
  transactions: Transaction[],
  year: number,
  month: number,
) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAmounts = new Map<number, number>();

  for (let day = 1; day <= daysInMonth; day += 1) {
    dailyAmounts.set(day, 0);
  }

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }

    const day = getDayOfMonth(transaction.date);
    dailyAmounts.set(
      day,
      roundAmount((dailyAmounts.get(day) ?? 0) + transaction.amount),
    );
  }

  return Array.from(dailyAmounts.entries()).map(([day, amount]) => ({
    day,
    amount,
  }));
};

export const getMonthBalanceSnapshot = (
  transactions: Transaction[],
  year: number,
  month: number,
) => {
  const monthKey = formatMonthKey(year, month);
  let balance = 0;
  let hasTransactions = false;

  for (const transaction of transactions) {
    if (!normalizeDateInput(transaction.date).startsWith(monthKey)) {
      continue;
    }

    hasTransactions = true;
    balance += transaction.type === 'income' ? transaction.amount : -transaction.amount;
  }

  return {
    balance: roundAmount(balance),
    hasTransactions,
  };
};
