import { CopperAccount, CopperBreakdown, Transaction } from '../types';
import { parseSpreadsheetDate } from './date';

const COPPER_ACCOUNTS: CopperAccount[] = ['liquid', 'reserve', 'collection'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCopperBreakdown = (value: unknown): CopperBreakdown | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const liquid = toFiniteNumber(value.liquid);
  const reserve = toFiniteNumber(value.reserve);
  const collection = toFiniteNumber(value.collection);

  if (liquid === null || reserve === null || collection === null) {
    return undefined;
  }

  return { liquid, reserve, collection };
};

const normalizeType = (value: unknown) => {
  if (value === 'income' || value === '收入') {
    return 'income' as const;
  }

  if (value === 'expense' || value === '支出') {
    return 'expense' as const;
  }

  return null;
};

const normalizeSource = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return COPPER_ACCOUNTS.includes(value as CopperAccount)
    ? (value as CopperAccount)
    : undefined;
};

export const createTransactionId = () => Date.now() + Math.random();

export const normalizeTransaction = (
  raw: unknown,
  defaults: { incomeDesc: string; expenseDesc: string },
): Transaction | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const type = normalizeType(raw.type ?? raw['类型']);
  const date = parseSpreadsheetDate(raw.date ?? raw['日期']);
  const amount = toFiniteNumber(raw.amount ?? raw['金额']);

  if (!type || !date || amount === null || amount <= 0) {
    return null;
  }

  const descCandidate = raw.desc ?? raw['备注'];
  const desc =
    typeof descCandidate === 'string' && descCandidate.trim()
      ? descCandidate.trim()
      : type === 'income'
        ? defaults.incomeDesc
        : defaults.expenseDesc;

  const idCandidate = toFiniteNumber(raw.id);

  return {
    id: idCandidate ?? createTransactionId(),
    date,
    type,
    amount,
    desc,
    source: normalizeSource(raw.source),
    allocation: normalizeCopperBreakdown(raw.allocation),
  };
};
