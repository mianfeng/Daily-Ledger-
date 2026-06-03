import {
  CopperAccount,
  CopperBalances,
  CopperBreakdown,
  CopperData,
  CopperRatios,
  CopperTransaction,
} from '../types';
import { createTransactionId, normalizeTransaction } from './ledger';
import { formatDisplayDate, getMonthKey, normalizeDateInput } from './date';

const COPPER_ACCOUNTS: CopperAccount[] = ['liquid', 'reserve'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const createEmptyCopperBreakdown = (): CopperBreakdown => ({
  liquid: 0,
  reserve: 0,
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
    const parsed = toFiniteNumber(value[account]);
    if (parsed !== null) {
      next[account] = roundCurrency(parsed);
    }
  }
  return next;
};

const sanitizeRatios = (
  value: unknown,
  fallback: CopperRatios,
): CopperRatios => {
  if (!isRecord(value)) {
    return fallback;
  }

  const liquid = toFiniteNumber(value.liquid);
  const reserve = toFiniteNumber(value.reserve);
  const hasLegacyCollection = toFiniteNumber(value.collection) !== null;

  if (
    liquid === null ||
    reserve === null ||
    hasLegacyCollection ||
    roundCurrency(liquid + reserve) !== 100
  ) {
    return fallback;
  }

  return {
    liquid: roundCurrency(liquid),
    reserve: roundCurrency(reserve),
  };
};

const normalizeCopperBreakdown = (value: unknown) => {
  if (!isRecord(value)) {
    return undefined;
  }

  const liquid = toFiniteNumber(value.liquid);
  const reserve = toFiniteNumber(value.reserve);

  if (liquid === null || reserve === null) {
    return undefined;
  }

  return {
    liquid: roundCurrency(liquid),
    reserve: roundCurrency(reserve),
  };
};

const normalizeRatiosSnapshot = (value: unknown) => {
  const ratios = normalizeCopperBreakdown(value);
  if (!ratios || roundCurrency(ratios.liquid + ratios.reserve) !== 100) {
    return undefined;
  }

  return ratios;
};

const normalizeInventoryAdjustment = (
  raw: Record<string, unknown>,
): CopperTransaction | null => {
  const date = normalizeDateInput(String(raw.date ?? raw['日期'] ?? ''));
  const inventoryDelta =
    toFiniteNumber(raw.inventoryDelta ?? raw['库存变化'] ?? raw['库存调整']) ?? 0;
  const previousInventoryCost =
    toFiniteNumber(raw.previousInventoryCost ?? raw['调整前库存']) ?? undefined;
  const nextInventoryCost =
    toFiniteNumber(raw.nextInventoryCost ?? raw['调整后库存']) ?? undefined;
  const id = toFiniteNumber(raw.id) ?? createTransactionId();
  const descCandidate = raw.desc ?? raw['备注'];
  const desc =
    typeof descCandidate === 'string' && descCandidate.trim()
      ? descCandidate.trim()
      : '库存成本调整';

  if (!date) {
    return null;
  }

  return {
    id,
    date,
    type: 'inventory_adjustment',
    amount: Math.abs(roundCurrency(inventoryDelta)),
    desc,
    cashAllocation: createEmptyCopperBreakdown(),
    inventoryDelta: roundCurrency(inventoryDelta),
    previousInventoryCost:
      previousInventoryCost === undefined
        ? undefined
        : roundCurrency(previousInventoryCost),
    nextInventoryCost:
      nextInventoryCost === undefined ? undefined : roundCurrency(nextInventoryCost),
  };
};

const getLegacyCashAllocation = (
  transaction: CopperTransaction,
  raw: Record<string, unknown>,
): CopperBreakdown | undefined => {
  const legacyAllocation = normalizeCopperBreakdown(raw.allocation);

  if (legacyAllocation) {
    return transaction.type === 'expense'
      ? {
          liquid: roundCurrency(-legacyAllocation.liquid),
          reserve: roundCurrency(-legacyAllocation.reserve),
        }
      : legacyAllocation;
  }

  const source = raw.source;

  if (transaction.type === 'expense' && source === 'reserve') {
    return {
      liquid: 0,
      reserve: roundCurrency(-transaction.amount),
    };
  }

  return undefined;
};

export const sanitizeCopperData = (
  raw: unknown,
  fallback: CopperData,
): CopperData => {
  if (!isRecord(raw)) {
    return fallback;
  }

  const ratios = sanitizeRatios(raw.ratios, fallback.ratios);
  const balances = sanitizeBreakdown(raw.balances, fallback.balances);
  const inventoryCostCandidate = toFiniteNumber(raw.inventoryCost);
  const inventoryCost =
    inventoryCostCandidate === null || inventoryCostCandidate < 0
      ? fallback.inventoryCost
      : roundCurrency(inventoryCostCandidate);
  const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];

  const transactions = rawTransactions
    .map((item): CopperTransaction | null => {
      if (!isRecord(item)) {
        return null;
      }

      const rawType = item.type ?? item['类型'];
      if (rawType === 'inventory_adjustment' || rawType === '库存调整') {
        return normalizeInventoryAdjustment(item);
      }

      const normalized = normalizeTransaction(item, {
        incomeDesc: '生意收入',
        expenseDesc: '进货支出',
      });

      if (!normalized) {
        return null;
      }

      const cost = Math.max(0, toFiniteNumber(item.cost ?? item['成本']) ?? 0);
      const cashAllocation =
        normalizeCopperBreakdown(item.cashAllocation) ??
        getLegacyCashAllocation(normalized as CopperTransaction, item);
      const inventoryDeltaCandidate = toFiniteNumber(
        item.inventoryDelta ?? item['库存变化'],
      );

      return {
        ...normalized,
        cost: normalized.type === 'income' ? roundCurrency(cost) : undefined,
        profit:
          normalized.type === 'income'
            ? roundCurrency(normalized.amount - cost)
            : undefined,
        cashAllocation,
        inventoryDelta:
          inventoryDeltaCandidate === null
            ? 0
            : roundCurrency(inventoryDeltaCandidate),
        ratiosSnapshot: normalizeRatiosSnapshot(item.ratiosSnapshot),
        isLegacyLocked: !cashAllocation,
      };
    })
    .filter((item): item is CopperTransaction => item !== null)
    .map((transaction) => ({
      ...transaction,
      date: normalizeDateInput(transaction.date),
    }));

  return {
    ratios,
    balances,
    inventoryCost,
    transactions,
  };
};

export const applyCopperCashAllocation = (
  balances: CopperBalances,
  allocation: CopperBreakdown,
  direction: 'apply' | 'rollback',
) => {
  const multiplier = direction === 'apply' ? 1 : -1;
  const next = { ...balances };

  for (const account of COPPER_ACCOUNTS) {
    next[account] = roundCurrency(
      next[account] + allocation[account] * multiplier,
    );
  }

  return next;
};

export const buildIncomeCashAllocation = (
  amount: number,
  cost: number,
  ratios: CopperRatios,
): CopperBreakdown => {
  const profit = roundCurrency(amount - cost);

  if (profit <= 0) {
    return {
      liquid: roundCurrency(amount),
      reserve: 0,
    };
  }

  const reserveProfit = roundCurrency(profit * (ratios.reserve / 100));
  const liquidProfit = roundCurrency(profit - reserveProfit);

  return {
    liquid: roundCurrency(cost + liquidProfit),
    reserve: reserveProfit,
  };
};

export const buildExpenseCashAllocation = (
  amount: number,
  balances: CopperBalances,
): CopperBreakdown => {
  const liquidDeduction = roundCurrency(Math.min(Math.max(0, balances.liquid), amount));
  const reserveDeduction = roundCurrency(amount - liquidDeduction);

  return {
    liquid: roundCurrency(-liquidDeduction),
    reserve: roundCurrency(-reserveDeduction),
  };
};

export const createCopperIncomeTransaction = ({
  amount,
  cost,
  date,
  desc,
  ratios,
}: {
  amount: number;
  cost: number;
  date: string;
  desc: string;
  ratios: CopperRatios;
}): CopperTransaction => {
  const roundedAmount = roundCurrency(amount);
  const roundedCost = roundCurrency(cost);
  const profit = roundCurrency(roundedAmount - roundedCost);

  return {
    id: createTransactionId(),
    date: normalizeDateInput(date),
    type: 'income',
    amount: roundedAmount,
    cost: roundedCost,
    profit,
    desc: desc.trim() || '生意收入',
    cashAllocation: buildIncomeCashAllocation(roundedAmount, roundedCost, ratios),
    inventoryDelta: roundCurrency(-roundedCost),
    ratiosSnapshot: { ...ratios },
  };
};

export const createCopperExpenseTransaction = ({
  amount,
  date,
  desc,
  balances,
}: {
  amount: number;
  date: string;
  desc: string;
  balances: CopperBalances;
}): CopperTransaction => {
  const roundedAmount = roundCurrency(amount);

  return {
    id: createTransactionId(),
    date: normalizeDateInput(date),
    type: 'expense',
    amount: roundedAmount,
    desc: desc.trim() || '进货支出',
    cashAllocation: buildExpenseCashAllocation(roundedAmount, balances),
    inventoryDelta: roundedAmount,
  };
};

export const createInventoryAdjustmentTransaction = ({
  date,
  desc,
  previousInventoryCost,
  nextInventoryCost,
}: {
  date: string;
  desc: string;
  previousInventoryCost: number;
  nextInventoryCost: number;
}): CopperTransaction => {
  const previous = roundCurrency(previousInventoryCost);
  const next = roundCurrency(nextInventoryCost);
  const inventoryDelta = roundCurrency(next - previous);

  return {
    id: createTransactionId(),
    date: normalizeDateInput(date),
    type: 'inventory_adjustment',
    amount: Math.abs(inventoryDelta),
    desc: desc.trim() || '库存成本调整',
    cashAllocation: createEmptyCopperBreakdown(),
    inventoryDelta,
    previousInventoryCost: previous,
    nextInventoryCost: next,
  };
};

export const applyCopperTransaction = (
  data: CopperData,
  transaction: CopperTransaction,
): CopperData => ({
  ...data,
  balances: transaction.cashAllocation
    ? applyCopperCashAllocation(data.balances, transaction.cashAllocation, 'apply')
    : data.balances,
  inventoryCost: roundCurrency(
    data.inventoryCost + (transaction.inventoryDelta ?? 0),
  ),
  transactions: [...data.transactions, transaction],
});

export const rollbackCopperTransaction = (
  data: CopperData,
  transaction: CopperTransaction,
): CopperData => ({
  ...data,
  balances: transaction.cashAllocation
    ? applyCopperCashAllocation(data.balances, transaction.cashAllocation, 'rollback')
    : data.balances,
  inventoryCost: roundCurrency(
    data.inventoryCost - (transaction.inventoryDelta ?? 0),
  ),
  transactions: data.transactions.filter((item) => item.id !== transaction.id),
});

export const getCopperCashTotal = (balances: CopperBalances) =>
  roundCurrency(balances.liquid + balances.reserve);

export const getTotalCopperAssets = (data: Pick<CopperData, 'balances' | 'inventoryCost'>) =>
  roundCurrency(getCopperCashTotal(data.balances) + data.inventoryCost);

export const getCopperMonthlyStats = (transactions: CopperTransaction[]) => {
  const stats: Record<
    string,
    {
      cashNet: number;
      cost: number;
      income: number;
      inventoryAdjustment: number;
      profit: number;
      purchase: number;
    }
  > = {};

  for (const transaction of transactions) {
    const monthKey = getMonthKey(transaction.date);
    if (!monthKey) {
      continue;
    }

    if (!stats[monthKey]) {
      stats[monthKey] = {
        cashNet: 0,
        cost: 0,
        income: 0,
        inventoryAdjustment: 0,
        profit: 0,
        purchase: 0,
      };
    }

    const cashDelta =
      (transaction.cashAllocation?.liquid ?? 0) +
      (transaction.cashAllocation?.reserve ?? 0);
    stats[monthKey].cashNet = roundCurrency(stats[monthKey].cashNet + cashDelta);

    if (transaction.type === 'income') {
      stats[monthKey].income = roundCurrency(
        stats[monthKey].income + transaction.amount,
      );
      stats[monthKey].cost = roundCurrency(
        stats[monthKey].cost + (transaction.cost ?? 0),
      );
      stats[monthKey].profit = roundCurrency(
        stats[monthKey].profit + (transaction.profit ?? transaction.amount),
      );
    } else if (transaction.type === 'expense') {
      stats[monthKey].purchase = roundCurrency(
        stats[monthKey].purchase + transaction.amount,
      );
    } else {
      stats[monthKey].inventoryAdjustment = roundCurrency(
        stats[monthKey].inventoryAdjustment + (transaction.inventoryDelta ?? 0),
      );
    }
  }

  return Object.entries(stats)
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([month, values]) => ({
      month,
      ...values,
    }));
};

export const getCopperChartData = (
  transactions: CopperTransaction[],
  currentInventoryCost: number,
) => {
  const dailyIncome: Record<string, number> = {};
  const dailyInventoryDelta: Record<string, number> = {};
  const dailyProfit: Record<string, number> = {};

  for (const transaction of transactions) {
    const date = normalizeDateInput(transaction.date);
    if (!date) {
      continue;
    }

    if (!dailyIncome[date]) {
      dailyIncome[date] = 0;
      dailyInventoryDelta[date] = 0;
      dailyProfit[date] = 0;
    }

    dailyInventoryDelta[date] = roundCurrency(
      dailyInventoryDelta[date] + (transaction.inventoryDelta ?? 0),
    );

    if (transaction.type === 'income') {
      dailyIncome[date] = roundCurrency(dailyIncome[date] + transaction.amount);
      dailyProfit[date] = roundCurrency(
        dailyProfit[date] + (transaction.profit ?? transaction.amount),
      );
    }
  }

  const allDates = Object.keys(dailyInventoryDelta).sort((left, right) =>
    right.localeCompare(left),
  );

  let runningInventoryCost = currentInventoryCost;
  const history: Array<{
    date: string;
    income: number;
    inventoryCost: number;
    profit: number;
    shortDate: string;
  }> = [];

  for (const date of allDates) {
    history.push({
      date,
      shortDate: date.slice(5),
      income: dailyIncome[date],
      profit: dailyProfit[date],
      inventoryCost: runningInventoryCost,
    });

    runningInventoryCost = roundCurrency(
      runningInventoryCost - dailyInventoryDelta[date],
    );
  }

  return history.reverse().slice(-30);
};

export const getCopperTransactionKindLabel = (transaction: CopperTransaction) => {
  if (transaction.type === 'income') {
    return '销售收入';
  }

  if (transaction.type === 'expense') {
    return '进货支出';
  }

  return '库存调整';
};

export const formatCopperTransactionDate = (value: string) =>
  formatDisplayDate(value);
