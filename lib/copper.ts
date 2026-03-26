import {
  CopperAccount,
  CopperBalances,
  CopperBreakdown,
  CopperData,
  CopperRatios,
  Transaction,
} from '../types';
import { createTransactionId, normalizeTransaction } from './ledger';
import { formatDisplayDate, getMonthKey, normalizeDateInput } from './date';

const COPPER_ACCOUNTS: CopperAccount[] = ['liquid', 'reserve', 'collection'];
const EXPENSE_FALLBACK_ORDER: CopperAccount[] = ['liquid', 'collection', 'reserve'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const createEmptyCopperBreakdown = (): CopperBreakdown => ({
  liquid: 0,
  reserve: 0,
  collection: 0,
});

const sanitizeBreakdown = (
  value: unknown,
  fallback: CopperBreakdown,
): CopperBreakdown => {
  if (!isRecord(value)) {
    return fallback;
  }

  const next = { ...fallback };
  for (const account of COPPER_ACCOUNTS) {
    const parsed = Number(value[account]);
    if (Number.isFinite(parsed)) {
      next[account] = roundCurrency(parsed);
    }
  }
  return next;
};

export const buildIncomeAllocation = (
  amount: number,
  ratios: CopperRatios,
): CopperBreakdown => {
  const liquid = roundCurrency(amount * (ratios.liquid / 100));
  const reserve = roundCurrency(amount * (ratios.reserve / 100));
  const collection = roundCurrency(amount - liquid - reserve);

  return {
    liquid,
    reserve,
    collection,
  };
};

export const buildExpenseAllocation = (
  amount: number,
  source: CopperAccount,
  balances: CopperBalances,
): CopperBreakdown => {
  const allocation = createEmptyCopperBreakdown();

  if (source !== 'liquid') {
    allocation[source] = roundCurrency(amount);
    return allocation;
  }

  let remaining = roundCurrency(amount);
  for (const account of EXPENSE_FALLBACK_ORDER) {
    if (remaining <= 0) {
      break;
    }

    if (account === 'reserve') {
      allocation.reserve = roundCurrency(remaining);
      remaining = 0;
      break;
    }

    const available = Math.max(0, balances[account]);
    const deduction = roundCurrency(Math.min(available, remaining));
    allocation[account] = deduction;
    remaining = roundCurrency(remaining - deduction);
  }

  return allocation;
};

const getLegacyAllocation = (
  transaction: Transaction,
  ratios: CopperRatios,
): CopperBreakdown => {
  if (transaction.type === 'income') {
    return buildIncomeAllocation(transaction.amount, ratios);
  }

  const fallback = createEmptyCopperBreakdown();
  fallback[transaction.source ?? 'liquid'] = roundCurrency(transaction.amount);
  return fallback;
};

export const sanitizeCopperData = (
  raw: unknown,
  fallback: CopperData,
): CopperData => {
  if (!isRecord(raw)) {
    return fallback;
  }

  const ratios = sanitizeBreakdown(raw.ratios, fallback.ratios);
  const balances = sanitizeBreakdown(raw.balances, fallback.balances);
  const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];

  const transactions = rawTransactions
    .map((item) =>
      normalizeTransaction(item, {
        incomeDesc: '生意收入',
        expenseDesc: '生意支出',
      }),
    )
    .filter((item): item is Transaction => item !== null)
    .map((transaction) => ({
      ...transaction,
      allocation: transaction.allocation ?? getLegacyAllocation(transaction, ratios),
      date: normalizeDateInput(transaction.date),
    }));

  return {
    ratios,
    balances,
    transactions,
  };
};

export const applyCopperAllocation = (
  balances: CopperBalances,
  allocation: CopperBreakdown,
  direction: 'add' | 'subtract',
) => {
  const multiplier = direction === 'add' ? 1 : -1;
  const next = { ...balances };

  for (const account of COPPER_ACCOUNTS) {
    next[account] = roundCurrency(
      next[account] + allocation[account] * multiplier,
    );
  }

  return next;
};

export const createCopperTransaction = ({
  amount,
  date,
  desc,
  ratios,
  balances,
  source,
  type,
}: {
  amount: number;
  date: string;
  desc: string;
  ratios: CopperRatios;
  balances: CopperBalances;
  source: CopperAccount;
  type: Transaction['type'];
}): Transaction => {
  const normalizedDate = normalizeDateInput(date);
  const allocation =
    type === 'income'
      ? buildIncomeAllocation(amount, ratios)
      : buildExpenseAllocation(amount, source, balances);

  return {
    id: createTransactionId(),
    date: normalizedDate,
    type,
    amount: roundCurrency(amount),
    desc: desc.trim() || (type === 'income' ? '生意收入' : '生意支出'),
    source: type === 'expense' ? source : undefined,
    allocation,
  };
};

export const rollbackCopperTransaction = (
  balances: CopperBalances,
  transaction: Transaction,
  ratios: CopperRatios,
) => {
  const allocation = transaction.allocation ?? getLegacyAllocation(transaction, ratios);
  return applyCopperAllocation(
    balances,
    allocation,
    transaction.type === 'income' ? 'subtract' : 'add',
  );
};

export const applyCopperTransaction = (
  balances: CopperBalances,
  transaction: Transaction,
  ratios: CopperRatios,
) => {
  const allocation = transaction.allocation ?? getLegacyAllocation(transaction, ratios);
  return applyCopperAllocation(
    balances,
    allocation,
    transaction.type === 'income' ? 'add' : 'subtract',
  );
};

export const getTotalCopperAssets = (balances: CopperBalances) =>
  roundCurrency(balances.liquid + balances.reserve + balances.collection);

export const getCopperMonthlyStats = (transactions: Transaction[]) => {
  const stats: Record<string, { income: number; expense: number }> = {};

  for (const transaction of transactions) {
    const monthKey = getMonthKey(transaction.date);
    if (!stats[monthKey]) {
      stats[monthKey] = { income: 0, expense: 0 };
    }

    if (transaction.type === 'income') {
      stats[monthKey].income = roundCurrency(
        stats[monthKey].income + transaction.amount,
      );
    } else {
      stats[monthKey].expense = roundCurrency(
        stats[monthKey].expense + transaction.amount,
      );
    }
  }

  return Object.entries(stats)
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([month, values]) => ({
      month,
      income: values.income,
      expense: values.expense,
      net: roundCurrency(values.income - values.expense),
    }));
};

export const getCopperChartData = (
  transactions: Transaction[],
  totalAssets: number,
) => {
  const dailyNetChange: Record<string, number> = {};
  const dailyIncome: Record<string, number> = {};
  const dailyExpense: Record<string, number> = {};

  for (const transaction of transactions) {
    const date = normalizeDateInput(transaction.date);
    if (!dailyNetChange[date]) {
      dailyNetChange[date] = 0;
      dailyIncome[date] = 0;
      dailyExpense[date] = 0;
    }

    if (transaction.type === 'income') {
      dailyNetChange[date] = roundCurrency(dailyNetChange[date] + transaction.amount);
      dailyIncome[date] = roundCurrency(dailyIncome[date] + transaction.amount);
    } else {
      dailyNetChange[date] = roundCurrency(dailyNetChange[date] - transaction.amount);
      dailyExpense[date] = roundCurrency(dailyExpense[date] + transaction.amount);
    }
  }

  const allDates = Object.keys(dailyNetChange).sort((left, right) =>
    right.localeCompare(left),
  );

  let runningAssets = totalAssets;
  const history: Array<{
    assets: number;
    date: string;
    expense: number;
    income: number;
    shortDate: string;
  }> = [];

  for (const date of allDates) {
    history.push({
      date,
      shortDate: date.slice(5),
      assets: runningAssets,
      income: dailyIncome[date],
      expense: dailyExpense[date],
    });

    runningAssets = roundCurrency(runningAssets - dailyNetChange[date]);
  }

  return history.reverse().slice(-30);
};

export const getCopperSourceLabel = (transaction: Transaction) => {
  if (transaction.type !== 'expense') {
    return '';
  }

  const allocation = transaction.allocation;
  if (allocation) {
    const impacted = COPPER_ACCOUNTS.filter((account) => allocation[account] > 0);
    if (impacted.length > 1) {
      return impacted
        .map((account) =>
          account === 'liquid' ? '流动' : account === 'reserve' ? '存储' : '收藏',
        )
        .join('/');
    }
  }

  if (transaction.source === 'reserve') {
    return '存储';
  }

  if (transaction.source === 'collection') {
    return '收藏';
  }

  return '流动';
};

export const formatCopperTransactionDate = (value: string) =>
  formatDisplayDate(value);
