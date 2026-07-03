import { parseSpreadsheetDate } from './date';

export interface NormalizedTransaction {
  id: number;
  date: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  desc: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeType = (value: unknown) => {
  if (value === 'income' || value === '收入') {
    return 'income' as const;
  }

  if (value === 'expense' || value === '支出') {
    return 'expense' as const;
  }

  if (value === 'transfer' || value === '系统结转' || value === '内部转移') {
    return 'transfer' as const;
  }

  return null;
};

export const createTransactionId = () => Date.now() + Math.random();

export const normalizeTransaction = (
  raw: unknown,
  defaults: { incomeDesc: string; expenseDesc: string },
): NormalizedTransaction | null => {
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
        : type === 'expense'
          ? defaults.expenseDesc
          : '系统结转';

  const idCandidate = toFiniteNumber(raw.id);

  return {
    id: idCandidate ?? createTransactionId(),
    date,
    type,
    amount,
    desc,
  };
};
