import { DailyData, Transaction } from '../types';
import {
  formatMonthKey,
  getDayOfMonth,
  getTodayDate,
  isDateInMonth,
  normalizeDateInput,
} from './date';
import { normalizeTransaction } from './ledger';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const roundAmount = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

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

  return {
    dailyLimit,
    transactions: rawTransactions
      .map((item) =>
        normalizeTransaction(item, {
          incomeDesc: '额外收入',
          expenseDesc: '日常支出',
        }),
      )
      .filter((item): item is Transaction => item !== null)
      .map((transaction) => ({
        ...transaction,
        date: normalizeDateInput(transaction.date),
      })),
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
