import {
  BudgetCycle,
  BudgetWeek,
  DailyData,
  DailyExpenseCategory,
  DailyExpenseTiming,
  DailyIncomeKind,
  DailyTransaction,
  DailyTransactionAllocation,
  DailyTransactionBalanceAfter,
  DailyTransferKind,
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

const normalizeExpenseTiming = (value: unknown): DailyExpenseTiming | undefined => {
  if (value === 'prepaid') {
    return value;
  }
  return undefined;
};

const normalizeTransferKind = (value: unknown): DailyTransferKind | undefined => {
  if (value === 'weeklyRollover' || value === 'cycleRollover') {
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

const normalizeCreatedAt = (value: unknown) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
};

const normalizeBalanceSnapshot = (raw: unknown): DailyTransactionBalanceAfter | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const keys: Array<keyof DailyTransactionBalanceAfter> = [
    'spendable',
    'weekRemaining',
    'futureSpendable',
    'buffer',
    'reserve',
    'fixedReserved',
  ];
  if (keys.some((key) => !Number.isFinite(Number(raw[key])))) {
    return undefined;
  }

  return {
    spendable: roundAmount(Math.max(0, Number(raw.spendable))),
    weekRemaining: roundAmount(Math.max(0, Number(raw.weekRemaining))),
    futureSpendable: roundAmount(Math.max(0, Number(raw.futureSpendable))),
    buffer: roundAmount(Math.max(0, Number(raw.buffer))),
    reserve: roundAmount(Math.max(0, Number(raw.reserve))),
    fixedReserved: roundAmount(Math.max(0, Number(raw.fixedReserved))),
  };
};

export const DEFAULT_LIFE_BUDGET_SETTINGS: LifeBudgetSettings = {
  expectedPayday: 10,
  savingsRate: 0.2,
  bufferRate: 0.2,
  reserveFixedAmount: 10000,
  bufferFixedAmount: 1500,
  reserveRecoveryRate: 0.1,
  weeklyRolloverReserveRate: 0.4,
  reserveGoal: 50000,
  bufferCap: 6000,
  minimumWeeklyLiving: 500,
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
    reserveFixedAmount: Math.max(
      0,
      toFiniteNumber(value.reserveFixedAmount, DEFAULT_LIFE_BUDGET_SETTINGS.reserveFixedAmount),
    ),
    bufferFixedAmount: Math.max(
      0,
      toFiniteNumber(value.bufferFixedAmount, DEFAULT_LIFE_BUDGET_SETTINGS.bufferFixedAmount),
    ),
    reserveRecoveryRate: clampRate(
      value.reserveRecoveryRate,
      DEFAULT_LIFE_BUDGET_SETTINGS.reserveRecoveryRate,
    ),
    weeklyRolloverReserveRate: DEFAULT_LIFE_BUDGET_SETTINGS.weeklyRolloverReserveRate,
    reserveGoal: Math.max(
      0,
      toFiniteNumber(value.reserveGoal, DEFAULT_LIFE_BUDGET_SETTINGS.reserveGoal),
    ),
    bufferCap: Math.max(
      0,
      toFiniteNumber(value.bufferCap, DEFAULT_LIFE_BUDGET_SETTINGS.bufferCap),
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

  const rolledOverWeekIndexes = Array.isArray(raw.rolledOverWeekIndexes)
    ? raw.rolledOverWeekIndexes
        .map((index) => Math.max(0, Math.round(toFiniteNumber(index, -1))))
        .filter((index) => index >= 0)
    : [];

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
    rolledOverWeekIndexes,
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

      const expenseTiming = normalizeExpenseTiming(item.expenseTiming);
      const paymentDate = normalizeDateInput(normalized.date);
      const rawEffectiveDate =
        typeof item.effectiveDate === 'string'
          ? normalizeDateInput(item.effectiveDate)
          : '';
      const effectiveDate =
        expenseTiming === 'prepaid'
          ? rawEffectiveDate && rawEffectiveDate >= paymentDate
            ? rawEffectiveDate
            : paymentDate
          : undefined;

      return {
        ...normalized,
        date: paymentDate,
        category: normalizeExpenseCategory(item.category),
        incomeKind: normalizeIncomeKind(item.incomeKind),
        transferKind: normalizeTransferKind(item.transferKind),
        expenseTiming,
        effectiveDate,
        allocation: normalizeAllocation(item.allocation),
        createdAt: normalizeCreatedAt(item.createdAt),
        balanceBefore: normalizeBalanceSnapshot(item.balanceBefore),
        balanceAfter: normalizeBalanceSnapshot(item.balanceAfter),
        fixedExpenseId:
          item.fixedExpenseId === undefined
            ? undefined
            : toFiniteNumber(item.fixedExpenseId),
        cycleId:
          item.cycleId === undefined
            ? undefined
            : toFiniteNumber(item.cycleId),
        weekIndex:
          item.weekIndex === undefined
            ? undefined
            : Math.max(0, Math.round(toFiniteNumber(item.weekIndex))),
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

const getActiveFixedExpenseTotal = (budget: LifeBudgetState) =>
  roundAmount(
    budget.fixedExpenses
      .filter((item) => item.isActive)
      .reduce((total, item) => total + item.amount, 0),
  );

const splitBufferAllocation = (
  amount: number,
  currentBuffer: number,
  bufferCap: number,
) => {
  const safeAmount = roundAmount(Math.max(0, amount));
  const availableBufferRoom =
    bufferCap <= 0 ? 0 : Math.max(0, roundAmount(bufferCap - currentBuffer));
  const buffer = roundAmount(Math.min(safeAmount, availableBufferRoom));
  const reserveOverflow = roundAmount(safeAmount - buffer);

  return { buffer, reserveOverflow };
};

const addRolledOverWeekIndex = (cycle: BudgetCycle, weekIndex: number) => ({
  ...cycle,
  rolledOverWeekIndexes: Array.from(
    new Set([...cycle.rolledOverWeekIndexes, weekIndex]),
  ).sort((left, right) => left - right),
});

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

const isPrepaidExpense = (transaction: DailyTransaction) =>
  transaction.type === 'expense' && transaction.expenseTiming === 'prepaid';

const getExpenseReportDate = (transaction: DailyTransaction) =>
  isPrepaidExpense(transaction)
    ? normalizeDateInput(transaction.effectiveDate ?? transaction.date)
    : normalizeDateInput(transaction.date);

const getPrepaidExpenseAmount = (transaction: DailyTransaction) =>
  isPrepaidExpense(transaction) ? transaction.amount : 0;

const getWeekRolloverTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle | null,
  week: BudgetWeek | null,
) => {
  if (!cycle || !week) {
    return 0;
  }

  return roundAmount(
    transactions
      .filter(
        (transaction) =>
          transaction.type === 'transfer' &&
          transaction.transferKind === 'weeklyRollover' &&
          transaction.cycleId === cycle.id &&
          transaction.weekIndex === week.index,
      )
      .reduce((total, transaction) => total + (transaction.allocation?.week ?? 0), 0),
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
          const transactionDate = getExpenseReportDate(transaction);
          return (
            transaction.type === 'expense' &&
            (isPrepaidExpense(transaction) || transaction.category !== 'large') &&
            transactionDate >= week.startDate &&
            transactionDate <= week.endDate
          );
        },
      )
      .reduce((total, transaction) => {
        if (isPrepaidExpense(transaction)) {
          return total + transaction.amount;
        }
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

const getWeekPrepaidExpenseTotal = (
  transactions: DailyTransaction[],
  week: BudgetWeek | null,
) => {
  if (!week) {
    return 0;
  }

  return roundAmount(
    transactions
      .filter((transaction) => {
        const transactionDate = getExpenseReportDate(transaction);
        return (
          isPrepaidExpense(transaction) &&
          transactionDate >= week.startDate &&
          transactionDate <= week.endDate
        );
      })
      .reduce((total, transaction) => total + transaction.amount, 0),
  );
};

const isTransactionInCycle = (
  transaction: DailyTransaction,
  cycle: BudgetCycle,
) => {
  const transactionDate =
    transaction.type === 'expense'
      ? getExpenseReportDate(transaction)
      : normalizeDateInput(transaction.date);
  return transactionDate >= cycle.startDate && transactionDate <= cycle.plannedEndDate;
};

const getUsableIncomeAllocation = (transaction: DailyTransaction) =>
  roundAmount(
    (transaction.allocation?.week ?? 0) +
      (transaction.allocation?.buffer ?? 0) +
      (transaction.allocation?.advance ?? 0),
  );

const getUsableExpenseAllocation = (transaction: DailyTransaction) => {
  if (isPrepaidExpense(transaction)) {
    return transaction.amount;
  }

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
        return total + (transaction.allocation ? usableAllocation : transaction.amount);
      }, 0),
  );

const getCycleOtherIncomeTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle,
) =>
  roundAmount(
    transactions
      .filter(
        (transaction) =>
          transaction.type === 'income' &&
          transaction.incomeKind !== 'main' &&
          transaction.incomeKind !== undefined &&
          isTransactionInCycle(transaction, cycle),
      )
      .reduce((total, transaction) => total + transaction.amount, 0),
  );

const getCyclePrepaidExpenses = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle,
) =>
  transactions.filter(
    (transaction) => isPrepaidExpense(transaction) && isTransactionInCycle(transaction, cycle),
  );

const getCyclePrepaidExpenseTotal = (
  transactions: DailyTransaction[],
  cycle: BudgetCycle,
) =>
  roundAmount(
    getCyclePrepaidExpenses(transactions, cycle).reduce(
      (total, transaction) => total + transaction.amount,
      0,
    ),
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

export const getCalibratableBalance = (data: DailyData) => {
  const budget = getLifeBudget(data);
  return roundAmount(
    budget.pockets.spendable +
      budget.pockets.buffer +
      budget.pockets.fixedReserved,
  );
};

export const getBudgetSnapshot = (data: DailyData, today = getTodayDate()) => {
  const budget = getLifeBudget(data);
  const cycle = budget.currentCycle;
  const week = getCurrentBudgetWeek(cycle, today);
  const weekSpent = getWeekExpenseTotal(data.transactions, week);
  const weekRolledOver = getWeekRolloverTotal(data.transactions, cycle, week);
  const weekRemaining = roundAmount(
    Math.max(0, (week?.allowance ?? 0) - weekSpent - weekRolledOver),
  );
  const reserveMinimum = getReserveMinimum(budget);
  const reserveGap = roundAmount(Math.max(0, reserveMinimum - budget.pockets.reserve));

  const cycleTransactions = cycle
    ? data.transactions.filter((transaction) => normalizeDateInput(transaction.date) >= cycle.startDate)
    : [];
  const transferReserveIn = cycleTransactions
    .filter(
      (transaction) =>
        transaction.type === 'transfer' &&
        normalizeDateInput(transaction.date) >= (cycle?.startDate ?? '') &&
        (!cycle || normalizeDateInput(transaction.date) <= cycle.plannedEndDate),
    )
    .reduce((total, transaction) => total + (transaction.allocation?.reserve ?? 0), 0);
  const reserveIn = roundAmount((cycle?.reserveDeposit ?? 0) + transferReserveIn);
  const reserveOut = cycleTransactions
    .filter((transaction) => {
      const transactionDate = normalizeDateInput(transaction.date);
      return (
        (transaction.category === 'large' || isPrepaidExpense(transaction)) &&
        transaction.type === 'expense' &&
        (transaction.category === 'large' || (transaction.allocation?.reserve ?? 0) > 0) &&
        (!cycle || transactionDate <= cycle.plannedEndDate)
      );
    })
    .reduce(
      (total, transaction) =>
        total +
        (transaction.category === 'large'
          ? transaction.allocation?.reserve ?? transaction.amount
          : transaction.allocation?.reserve ?? 0),
      0,
    );
  const prepaidInCycle = cycle ? getCyclePrepaidExpenseTotal(data.transactions, cycle) : 0;
  const upcomingPrepaid = roundAmount(
    data.transactions
      .filter((transaction) => {
        if (!isPrepaidExpense(transaction)) {
          return false;
        }
        const effectiveDate = getExpenseReportDate(transaction);
        if (cycle) {
          return effectiveDate > cycle.plannedEndDate;
        }
        return effectiveDate >= normalizeDateInput(today);
      })
      .reduce((total, transaction) => total + transaction.amount, 0),
  );

  return {
    budget,
    cycle,
    week,
    weekSpent,
    weekRemaining,
    reserveMinimum,
    reserveGap,
    reserveNetChange: roundAmount(reserveIn - reserveOut),
    prepaidInCycle,
    upcomingPrepaid,
    calibratableBalance: getCalibratableBalance(data),
    pendingFixed: budget.fixedExpenses.filter(
      (item) => item.isActive && item.paidCycleId !== cycle?.id,
    ),
    needsCalibration: Boolean(week),
    isExtended:
      Boolean(cycle) && normalizeDateInput(today) >= (cycle?.plannedNextIncomeDate ?? '9999-12-31'),
  };
};

const getTransactionBalanceSnapshot = (
  data: DailyData,
  balanceDate: string,
): DailyTransactionBalanceAfter => {
  const budget = getLifeBudget(data);
  const snapshot = getBudgetSnapshot(data, balanceDate);

  return {
    spendable: roundAmount(Math.max(0, budget.pockets.spendable)),
    weekRemaining: snapshot.weekRemaining,
    futureSpendable: roundAmount(
      Math.max(0, budget.pockets.spendable - snapshot.weekRemaining),
    ),
    buffer: roundAmount(Math.max(0, budget.pockets.buffer)),
    reserve: roundAmount(Math.max(0, budget.pockets.reserve)),
    fixedReserved: roundAmount(Math.max(0, budget.pockets.fixedReserved)),
  };
};

const appendTransactionWithAudit = (
  data: DailyData,
  transaction: DailyTransaction,
  budget: LifeBudgetState,
  balanceDate = transaction.date,
): DailyData => {
  const transactionWithTime: DailyTransaction = {
    ...transaction,
    createdAt: transaction.createdAt ?? new Date().toISOString(),
    balanceBefore: getTransactionBalanceSnapshot(data, balanceDate),
  };
  const nextData: DailyData = {
    ...data,
    budget,
    transactions: [...data.transactions, transactionWithTime],
  };
  const auditedTransaction: DailyTransaction = {
    ...transactionWithTime,
    balanceAfter: getTransactionBalanceSnapshot(nextData, balanceDate),
  };

  return {
    ...nextData,
    transactions: [...data.transactions, auditedTransaction],
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
          const transactionDate = getExpenseReportDate(transaction);
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
        const prepaidSpent = getWeekPrepaidExpenseTotal(data.transactions, week);
        const rolledOver = getWeekRolloverTotal(data.transactions, cycle, week);
        return {
          ...week,
          spent,
          prepaidSpent,
          rolledOver,
          remaining: roundAmount(Math.max(0, week.allowance - spent - rolledOver)),
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
    const otherIncome = getCycleOtherIncomeTotal(data.transactions, cycle);
    const prepaidTotal = getCyclePrepaidExpenseTotal(data.transactions, cycle);
    const prepaidTransactions = getCyclePrepaidExpenses(data.transactions, cycle);
    const rolloverTotal = data.transactions
      .filter(
        (transaction) =>
          transaction.type === 'transfer' &&
          transaction.transferKind === 'weeklyRollover' &&
          transaction.cycleId === cycle.id,
      )
      .reduce((total, transaction) => total + (transaction.allocation?.week ?? 0), 0);
    const transferReserveIn = data.transactions
      .filter(
        (transaction) =>
          transaction.type === 'transfer' &&
          normalizeDateInput(transaction.date) >= cycle.startDate &&
          normalizeDateInput(transaction.date) <= cycle.plannedEndDate,
      )
      .reduce((total, transaction) => total + (transaction.allocation?.reserve ?? 0), 0);
    const livingBudget = roundAmount(
      usableIncome ||
        cycle.weeks.reduce((total, week) => total + week.allowance, 0) +
          cycle.startingBuffer,
    );

    return {
      cycle,
      mainIncome: cycle.mainIncome,
      otherIncome,
      spent: getCycleExpenseTotal(data.transactions, cycle),
      livingSpent,
      weeks: getBudgetWeekSummaries(data, cycle),
      balance: roundAmount(livingBudget - livingSpent - rolloverTotal),
      budget: livingBudget,
      prepaidTotal,
      prepaidTransactions,
      reserveChange: roundAmount(cycle.reserveDeposit + cycle.reserveRecovery + transferReserveIn),
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

export const applyDueBudgetRollovers = (
  data: DailyData,
  today = getTodayDate(),
): DailyData => {
  const budget = getLifeBudget(data);
  const cycle = budget.currentCycle;
  const normalizedToday = normalizeDateInput(today) || getTodayDate();

  if (!cycle) {
    return data;
  }

  let nextData = data;
  let nextCycle = cycle;
  let nextPockets = budget.pockets;
  let changed = false;

  for (const week of cycle.weeks) {
    const rolloverDate = addDays(week.endDate, 1);
    const alreadyRolled =
      nextCycle.rolledOverWeekIndexes.includes(week.index) ||
      nextData.transactions.some(
        (transaction) =>
          transaction.type === 'transfer' &&
          transaction.transferKind === 'weeklyRollover' &&
          transaction.cycleId === cycle.id &&
          transaction.weekIndex === week.index,
      );

    if (rolloverDate > normalizedToday || alreadyRolled) {
      continue;
    }

    const spent = getWeekExpenseTotal(nextData.transactions, week);
    const alreadyTransferred = getWeekRolloverTotal(nextData.transactions, cycle, week);
    const remaining = roundAmount(Math.max(0, week.allowance - spent - alreadyTransferred));
    nextCycle = addRolledOverWeekIndex(nextCycle, week.index);
    changed = true;

    if (remaining <= 0) {
      continue;
    }

    const desiredReserve = roundAmount(remaining * budget.settings.weeklyRolloverReserveRate);
    const desiredBuffer = roundAmount(remaining - desiredReserve);
    const bufferAllocation = splitBufferAllocation(
      desiredBuffer,
      nextPockets.buffer,
      budget.settings.bufferCap,
    );
    const buffer = bufferAllocation.buffer;
    const reserve = roundAmount(desiredReserve + bufferAllocation.reserveOverflow);
    const transaction: DailyTransaction = {
      id: createTransactionId(),
      date: rolloverDate,
      type: 'transfer',
      amount: remaining,
      desc: `第 ${week.index + 1} 周余额结转`,
      transferKind: 'weeklyRollover',
      cycleId: cycle.id,
      weekIndex: week.index,
      allocation: {
        week: remaining,
        buffer,
        advance: 0,
        reserve,
        fixed: 0,
      },
    };

    nextPockets = {
      ...nextPockets,
      spendable: roundAmount(Math.max(0, nextPockets.spendable - remaining)),
      buffer: roundAmount(nextPockets.buffer + buffer),
      reserve: roundAmount(nextPockets.reserve + reserve),
    };
    nextData = appendTransactionWithAudit(
      nextData,
      transaction,
      {
        ...budget,
        currentCycle: nextCycle,
        pockets: nextPockets,
      },
      week.endDate,
    );
  }

  if (!changed) {
    return data;
  }

  return {
    ...nextData,
    budget: {
      ...budget,
      currentCycle: nextCycle,
      pockets: nextPockets,
    },
  };
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
): DailyData => {
  const nextSettings = sanitizeSettings({
      ...DEFAULT_LIFE_BUDGET_SETTINGS,
      ...settings,
    });
  const bufferAllocation = splitBufferAllocation(buffer, 0, nextSettings.bufferCap);

  return {
    ...data,
    budget: {
      ...DEFAULT_LIFE_BUDGET,
      initialized: true,
      settings: nextSettings,
    pockets: {
      spendable: roundAmount(Math.max(0, spendable)),
        buffer: bufferAllocation.buffer,
        reserve: roundAmount(Math.max(0, reserve) + bufferAllocation.reserveOverflow),
      fixedReserved: 0,
    },
  },
  };
};

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

export const deleteFixedExpense = (data: DailyData, fixedExpenseId: number): DailyData => {
  const budget = getLifeBudget(data);
  const hasActiveFixedExpense = budget.fixedExpenses.some(
    (item) => item.id === fixedExpenseId && item.isActive,
  );

  if (!hasActiveFixedExpense) return data;

  return {
    ...data,
    budget: {
      ...budget,
      fixedExpenses: budget.fixedExpenses.map((item) =>
        item.id === fixedExpenseId ? { ...item, isActive: false } : item,
      ),
    },
  };
};

export const adjustFixedReserved = (
  data: DailyData,
  amount: number,
): DailyData => {
  const budget = getLifeBudget(data);
  const safeAmount = roundAmount(Math.max(0, amount));
  const movableTotal = roundAmount(
    budget.pockets.spendable + budget.pockets.buffer + budget.pockets.fixedReserved,
  );
  const nextFixedReserved = roundAmount(Math.min(safeAmount, movableTotal));
  const fixedReservedDelta = roundAmount(nextFixedReserved - budget.pockets.fixedReserved);
  const releasedToSpendable = fixedReservedDelta < 0 ? Math.abs(fixedReservedDelta) : 0;
  const spendableUsed = fixedReservedDelta > 0
    ? Math.min(budget.pockets.spendable, fixedReservedDelta)
    : 0;
  const bufferUsed = fixedReservedDelta > 0
    ? roundAmount(fixedReservedDelta - spendableUsed)
    : 0;

  return {
    ...data,
    budget: {
      ...budget,
      pockets: {
        ...budget.pockets,
        fixedReserved: nextFixedReserved,
        spendable: roundAmount(
          Math.max(0, budget.pockets.spendable - spendableUsed + releasedToSpendable),
        ),
        buffer: roundAmount(
          Math.max(0, budget.pockets.buffer - bufferUsed),
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
  const safeAmount = roundAmount(Math.max(0, amount));
  const normalizedDate = normalizeDateInput(date) || getTodayDate();
  const rolloverData = applyDueBudgetRollovers(data, normalizedDate);
  const budget = getLifeBudget(rolloverData);

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
  const fixedReserveTarget = getActiveFixedExpenseTotal(budget);
  const fixedReserveGap = roundAmount(
    Math.max(0, fixedReserveTarget - budget.pockets.fixedReserved),
  );

  if (incomeKind === 'casual' || incomeKind === 'correction') {
    const bufferAllocation = splitBufferAllocation(
      safeAmount,
      budget.pockets.buffer,
      budget.settings.bufferCap,
    );
    const allocation: DailyTransactionAllocation = {
      week: 0,
      buffer: bufferAllocation.buffer,
      advance: 0,
      reserve: bufferAllocation.reserveOverflow,
      fixed: 0,
    };
    const nextBudget: LifeBudgetState = {
      ...budget,
      pockets: {
        ...budget.pockets,
        buffer: roundAmount(budget.pockets.buffer + bufferAllocation.buffer),
        reserve: roundAmount(budget.pockets.reserve + bufferAllocation.reserveOverflow),
      },
    };
    return appendTransactionWithAudit(
      rolloverData,
      { ...incomeTransaction, allocation },
      nextBudget,
    );
  }

  if (incomeKind === 'refund') {
    const allocation: DailyTransactionAllocation = {
      week: safeAmount,
      buffer: 0,
      advance: 0,
      reserve: 0,
      fixed: 0,
    };
    const nextBudget: LifeBudgetState = {
      ...budget,
      pockets: {
        ...budget.pockets,
        spendable: roundAmount(budget.pockets.spendable + safeAmount),
      },
    };
    return appendTransactionWithAudit(
      rolloverData,
      { ...incomeTransaction, allocation },
      nextBudget,
    );
  }

  if (
    budget.currentCycle &&
    normalizedDate >= budget.currentCycle.startDate &&
    normalizedDate <= budget.currentCycle.plannedEndDate
  ) {
    const fixedReserved = roundAmount(Math.min(safeAmount, fixedReserveGap));
    const spendableIncome = roundAmount(Math.max(0, safeAmount - fixedReserved));
    const allocation: DailyTransactionAllocation = {
      week: spendableIncome,
      buffer: 0,
      advance: 0,
      reserve: 0,
      fixed: fixedReserved,
    };
    const nextBudget: LifeBudgetState = {
      ...budget,
      currentCycle: {
        ...budget.currentCycle,
        mainIncome: roundAmount(budget.currentCycle.mainIncome + safeAmount),
        fixedReserved: roundAmount(budget.currentCycle.fixedReserved + fixedReserved),
      },
      pockets: {
        ...budget.pockets,
        spendable: roundAmount(budget.pockets.spendable + spendableIncome),
        fixedReserved: roundAmount(budget.pockets.fixedReserved + fixedReserved),
      },
    };
    return appendTransactionWithAudit(
      rolloverData,
      { ...incomeTransaction, allocation },
      nextBudget,
    );
  }

  const plannedNextIncomeDate = getNextPayday(normalizedDate, budget.settings.expectedPayday);
  const plannedEndDate = addDays(plannedNextIncomeDate, -1);
  const fixedReserved = roundAmount(Math.min(safeAmount, fixedReserveGap));
  const dayUnits = daysBetweenInclusive(normalizedDate, plannedEndDate) / 7;
  const availableAfterFixed = roundAmount(Math.max(0, safeAmount - fixedReserved));
  const reserveDeposit = roundAmount(
    Math.min(availableAfterFixed, budget.settings.reserveFixedAmount),
  );
  const afterReserve = roundAmount(Math.max(0, availableAfterFixed - reserveDeposit));
  const minimumCycleLiving = roundAmount(budget.settings.minimumWeeklyLiving * dayUnits);
  const minimumLivingPool = roundAmount(Math.min(afterReserve, minimumCycleLiving));
  const afterMinimumLiving = roundAmount(Math.max(0, afterReserve - minimumLivingPool));
  const intendedStartingBuffer = roundAmount(
    Math.min(afterMinimumLiving, budget.settings.bufferFixedAmount),
  );
  const weeklyPool = roundAmount(Math.max(0, afterReserve - intendedStartingBuffer));
  const weeklyAllowance = roundAmount(weeklyPool / Math.max(1, dayUnits));
  const previousBufferReserve = budget.currentCycle
    ? roundAmount(budget.pockets.buffer * budget.settings.weeklyRolloverReserveRate)
    : 0;
  const nextCycleBufferCarry = budget.currentCycle
    ? roundAmount(Math.max(0, budget.pockets.buffer - previousBufferReserve))
    : 0;
  const startingBufferAllocation = splitBufferAllocation(
    intendedStartingBuffer,
    nextCycleBufferCarry,
    budget.settings.bufferCap,
  );
  const startingBuffer = startingBufferAllocation.buffer;
  const bufferOverflowReserve = startingBufferAllocation.reserveOverflow;
  const totalReserve = roundAmount(
    reserveDeposit + previousBufferReserve + bufferOverflowReserve,
  );
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
    reserveRecovery: 0,
    startingBuffer,
    weeklyAllowance,
    rolledOverWeekIndexes: [],
    weeks,
  };
  const cycleRolloverTransaction: DailyTransaction | null =
    budget.currentCycle && previousBufferReserve > 0
      ? {
          id: createTransactionId(),
          date: normalizedDate,
          type: 'transfer',
          amount: previousBufferReserve,
          desc: '周期缓冲金结转',
          transferKind: 'cycleRollover',
          cycleId: budget.currentCycle.id,
          allocation: {
            week: 0,
            buffer: roundAmount(-previousBufferReserve),
            advance: 0,
            reserve: previousBufferReserve,
            fixed: 0,
          },
        }
      : null;
  const rolloverBudget: LifeBudgetState = {
    ...budget,
    pockets: {
      ...budget.pockets,
      buffer: nextCycleBufferCarry,
      reserve: roundAmount(budget.pockets.reserve + previousBufferReserve),
    },
  };
  const dataAfterCycleRollover = cycleRolloverTransaction
    ? appendTransactionWithAudit(
        rolloverData,
        cycleRolloverTransaction,
        rolloverBudget,
      )
    : rolloverData;
  const incomeAllocation: DailyTransactionAllocation = {
    week: spendable,
    buffer: startingBuffer,
    advance: 0,
    reserve: roundAmount(reserveDeposit + bufferOverflowReserve),
    fixed: fixedReserved,
    reserveDeposit,
    reserveRecovery: bufferOverflowReserve,
  };
  const nextBudget: LifeBudgetState = {
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
      buffer: roundAmount(nextCycleBufferCarry + startingBuffer),
      reserve: roundAmount(budget.pockets.reserve + totalReserve),
      fixedReserved: roundAmount(budget.pockets.fixedReserved + fixedReserved),
    },
  };
  return appendTransactionWithAudit(
    dataAfterCycleRollover,
    {
      ...incomeTransaction,
      previousCycle: budget.currentCycle,
      previousPockets: budget.pockets,
      allocation: incomeAllocation,
    },
    nextBudget,
  );
};

export const recordExpense = (
  data: DailyData,
  {
    amount,
    category,
    date,
    desc,
    effectiveDate,
    expenseTiming,
  }: {
    amount: number;
    category: DailyExpenseCategory;
    date: string;
    desc: string;
    effectiveDate?: string;
    expenseTiming?: DailyExpenseTiming;
  },
): DailyData => {
  const budget = getLifeBudget(data);
  const safeAmount = roundAmount(Math.max(0, amount));
  const normalizedDate = normalizeDateInput(date) || getTodayDate();
  if (safeAmount <= 0) {
    return data;
  }

  if (expenseTiming === 'prepaid') {
    const normalizedEffectiveDate = normalizeDateInput(effectiveDate ?? normalizedDate) || normalizedDate;
    const safeEffectiveDate =
      normalizedEffectiveDate < normalizedDate ? normalizedDate : normalizedEffectiveDate;
    let remaining = safeAmount;
    const buffer = roundAmount(Math.min(remaining, budget.pockets.buffer));
    remaining = roundAmount(remaining - buffer);
    const reserve = roundAmount(Math.min(remaining, budget.pockets.reserve));
    remaining = roundAmount(remaining - reserve);
    const advance = roundAmount(Math.min(remaining, budget.pockets.spendable));

    const transaction: DailyTransaction = {
      id: createTransactionId(),
      date: normalizedDate,
      type: 'expense',
      amount: safeAmount,
      category,
      desc: desc.trim() || '提前支付',
      expenseTiming: 'prepaid',
      effectiveDate: safeEffectiveDate,
      allocation: {
        week: 0,
        buffer,
        advance,
        reserve,
        fixed: 0,
      },
    };
    const nextBudget: LifeBudgetState = {
      ...budget,
      pockets: {
        ...budget.pockets,
        spendable: roundAmount(Math.max(0, budget.pockets.spendable - advance)),
        buffer: roundAmount(Math.max(0, budget.pockets.buffer - buffer)),
        reserve: roundAmount(Math.max(0, budget.pockets.reserve - reserve)),
      },
    };
    return appendTransactionWithAudit(data, transaction, nextBudget);
  }

  if (category === 'large') {
    let remaining = safeAmount;
    const buffer = roundAmount(Math.min(remaining, budget.pockets.buffer));
    remaining = roundAmount(remaining - buffer);
    const advance = roundAmount(Math.min(remaining, budget.pockets.spendable));
    const transaction: DailyTransaction = {
      id: createTransactionId(),
      date: normalizedDate,
      type: 'expense',
      amount: safeAmount,
      category,
      desc: desc.trim() || '大额支出',
      allocation: {
        week: 0,
        buffer,
        advance,
        reserve: 0,
        fixed: 0,
      },
    };
    const nextBudget: LifeBudgetState = {
      ...budget,
      pockets: {
        ...budget.pockets,
        spendable: roundAmount(Math.max(0, budget.pockets.spendable - advance)),
        buffer: roundAmount(Math.max(0, budget.pockets.buffer - buffer)),
      },
    };
    return appendTransactionWithAudit(data, transaction, nextBudget);
  }

  const snapshot = getBudgetSnapshot(data, normalizedDate);
  let remaining = safeAmount;
  const week = roundAmount(Math.min(remaining, snapshot.weekRemaining));
  remaining = roundAmount(remaining - week);
  const buffer = roundAmount(Math.min(remaining, budget.pockets.buffer));
  remaining = roundAmount(remaining - buffer);
  const advance = roundAmount(
    Math.min(remaining, Math.max(0, budget.pockets.spendable - week)),
  );

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

  const nextBudget: LifeBudgetState = {
    ...budget,
    pockets: {
      ...budget.pockets,
      spendable: roundAmount(Math.max(0, budget.pockets.spendable - week - advance)),
      buffer: roundAmount(Math.max(0, budget.pockets.buffer - buffer)),
    },
  };
  return appendTransactionWithAudit(data, transaction, nextBudget);
};

export const calibrateSpendableBalance = (
  data: DailyData,
  actualBalance: number,
  date = getTodayDate(),
): DailyData => {
  const expected = getCalibratableBalance(data);
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
  transaction.allocation.advance = roundAmount(
    Math.min(
      remaining,
      Math.max(0, budget.pockets.spendable - transaction.allocation.week),
    ),
  );

  const nextBudget: LifeBudgetState = {
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
  };
  return appendTransactionWithAudit(data, transaction, nextBudget);
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
    fixedReserved: roundAmount(Math.max(0, cycle.fixedReserved - allocation.fixed)),
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
  if (transaction.type === 'transfer') {
    return {
      spendable: roundAmount(
        Math.max(0, pockets.spendable - allocation.week - allocation.advance),
      ),
      buffer: roundAmount(Math.max(0, pockets.buffer + allocation.buffer)),
      reserve: roundAmount(Math.max(0, pockets.reserve + allocation.reserve)),
      fixedReserved: roundAmount(Math.max(0, pockets.fixedReserved + allocation.fixed)),
    };
  }

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
  const relatedCycleRolloverIds =
    currentCycleOpeningDeleted && transaction.previousCycle
      ? new Set(
          data.transactions
            .filter(
              (item) =>
                item.type === 'transfer' &&
                item.transferKind === 'cycleRollover' &&
                item.cycleId === transaction.previousCycle?.id &&
                item.date === transaction.date,
            )
            .map((item) => item.id),
        )
      : new Set<number>();
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
  const rollbackPockets =
    transaction.type === 'transfer'
      ? {
          ...budget.pockets,
          spendable: roundAmount(
            budget.pockets.spendable +
              pocketRollbackAllocation.week +
              pocketRollbackAllocation.advance,
          ),
          buffer: roundAmount(
            Math.max(0, budget.pockets.buffer - pocketRollbackAllocation.buffer),
          ),
          reserve: roundAmount(
            Math.max(0, budget.pockets.reserve - pocketRollbackAllocation.reserve),
          ),
          fixedReserved: roundAmount(
            Math.max(0, budget.pockets.fixedReserved - pocketRollbackAllocation.fixed),
          ),
        }
      : {
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
        .filter((item) => !relatedCycleRolloverIds.has(item.id))
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
    transactions: data.transactions.filter(
      (item) => item.id !== transactionId && !relatedCycleRolloverIds.has(item.id),
    ),
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
    } else if (transaction.type === 'expense') {
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

    if (transaction.type === 'income') {
      hasTransactions = true;
      balance += transaction.amount;
    } else if (transaction.type === 'expense') {
      hasTransactions = true;
      balance -= transaction.amount;
    }
  }

  return {
    balance: roundAmount(balance),
    hasTransactions,
  };
};
