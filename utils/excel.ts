import * as XLSX from 'xlsx';
import { sanitizeCopperData } from '../lib/copper';
import { sanitizeDailyData } from '../lib/daily';
import { normalizeTransaction } from '../lib/ledger';
import { CopperBalances, CopperBreakdown, CopperData, DailyData, Transaction } from '../types';

const getExportOrigin = () =>
  typeof window === 'undefined' ? 'local' : window.location.origin;

const appendSheet = (
  workbook: XLSX.WorkBook,
  sheetName: string,
  rows: Record<string, unknown>[],
) => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
};

const buildMetadataRows = (scope: string) => [
  { 项目: '模块', 值: scope },
  { 项目: '导出时间', 值: new Date().toISOString() },
  { 项目: '导出来源', 值: getExportOrigin() },
];

const normalizeSource = (value: unknown) => {
  if (value === 'liquid' || value === '流动库' || value === '流动') {
    return 'liquid' as const;
  }

  if (value === 'reserve' || value === '存储库' || value === '存储') {
    return 'reserve' as const;
  }

  if (value === 'collection' || value === '收藏库' || value === '收藏') {
    return 'collection' as const;
  }

  return undefined;
};

const parseBreakdown = (
  row: Record<string, unknown>,
  prefix = '分配',
): CopperBreakdown | undefined => {
  const liquid = Number(row[`${prefix}_流动`]);
  const reserve = Number(row[`${prefix}_存储`]);
  const collection = Number(row[`${prefix}_收藏`]);

  if (![liquid, reserve, collection].some((value) => Number.isFinite(value))) {
    return undefined;
  }

  return {
    liquid: Number.isFinite(liquid) ? liquid : 0,
    reserve: Number.isFinite(reserve) ? reserve : 0,
    collection: Number.isFinite(collection) ? collection : 0,
  };
};

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', '是'].includes(normalized);
};

const findSheet = (workbook: XLSX.WorkBook, names: string[]) =>
  names.find((name) => workbook.Sheets[name]);

export const exportCopperToExcel = (data: CopperData) => {
  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, '元数据', buildMetadataRows('铜钱分账'));
  appendSheet(workbook, '配置比例', [
    { 项目: '流动库', 比例: data.ratios.liquid },
    { 项目: '存储库', 比例: data.ratios.reserve },
    { 项目: '收藏库', 比例: data.ratios.collection },
  ]);
  appendSheet(workbook, '资产状态', [
    { 项目: '流动库', 金额: data.balances.liquid },
    { 项目: '存储库', 金额: data.balances.reserve },
    { 项目: '收藏库', 金额: data.balances.collection },
  ]);
  appendSheet(
    workbook,
    '铜钱流水',
    data.transactions.map((transaction) => ({
      日期: transaction.date,
      类型: transaction.type === 'income' ? '收入' : '支出',
      金额: transaction.amount,
      备注: transaction.desc,
      账户: transaction.source
        ? transaction.source === 'liquid'
          ? '流动库'
          : transaction.source === 'reserve'
            ? '存储库'
            : '收藏库'
        : '-',
      分配_流动: transaction.allocation?.liquid ?? '',
      分配_存储: transaction.allocation?.reserve ?? '',
      分配_收藏: transaction.allocation?.collection ?? '',
      历史锁定: transaction.isLegacyLocked ? '是' : '',
    })),
  );

  XLSX.writeFile(workbook, '铜钱分账_完整备份.xlsx');
};

export const exportDailyToExcel = (
  data: DailyData,
  year: number,
  month: number,
) => {
  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, '元数据', buildMetadataRows('日常账本'));
  appendSheet(workbook, '设置', [{ 项目: '日额度', 值: data.dailyLimit }]);
  appendSheet(
    workbook,
    '全部记录',
    data.transactions.map((transaction) => ({
      日期: transaction.date,
      类型: transaction.type === 'income' ? '收入' : '支出',
      金额: transaction.amount,
      备注: transaction.desc,
    })),
  );
  appendSheet(
    workbook,
    '当月记录',
    data.transactions
      .filter((transaction) =>
        transaction.date.startsWith(`${year}-${String(month).padStart(2, '0')}`),
      )
      .map((transaction) => ({
        日期: transaction.date,
        类型: transaction.type === 'income' ? '收入' : '支出',
        金额: transaction.amount,
        备注: transaction.desc,
      })),
  );

  XLSX.writeFile(
    workbook,
    `日常账本_完整备份_${year}-${String(month).padStart(2, '0')}.xlsx`,
  );
};

export const parseDailyImportSheet = (sheet: XLSX.WorkSheet) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });

  return rows
    .map((row) =>
      normalizeTransaction(
        {
          date: row['日期'] ?? row.date,
          type: row['类型'] ?? row.type,
          amount: row['金额'] ?? row.amount,
          desc: row['备注'] ?? row.desc,
        },
        {
          incomeDesc: '额外收入',
          expenseDesc: '日常支出',
        },
      ),
    )
    .filter((transaction): transaction is Transaction => transaction !== null);
};

export const parseCopperStatusSheet = (
  sheet: XLSX.WorkSheet,
  fallback: CopperBalances,
) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const balances = { ...fallback };

  for (const row of rows) {
    const label = String(row['项目'] ?? '').trim();
    const amount = Number(row['金额']);
    if (!Number.isFinite(amount)) {
      continue;
    }

    if (label === '流动库') {
      balances.liquid = amount;
    } else if (label === '存储库') {
      balances.reserve = amount;
    } else if (label === '收藏库') {
      balances.collection = amount;
    }
  }

  return balances;
};

const parseCopperRatioSheet = (
  sheet: XLSX.WorkSheet,
  fallback: CopperData['ratios'],
) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const ratios = { ...fallback };

  for (const row of rows) {
    const label = String(row['项目'] ?? '').trim();
    const value = Number(row['比例']);
    if (!Number.isFinite(value)) {
      continue;
    }

    if (label === '流动库') {
      ratios.liquid = value;
    } else if (label === '存储库') {
      ratios.reserve = value;
    } else if (label === '收藏库') {
      ratios.collection = value;
    }
  }

  return ratios;
};

const parseCopperTransactionSheet = (sheet: XLSX.WorkSheet): Transaction[] => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const transactions: Transaction[] = [];

  for (const row of rows) {
    const normalized = normalizeTransaction(
      {
        date: row['日期'] ?? row.date,
        type: row['类型'] ?? row.type,
        amount: row['金额'] ?? row.amount,
        desc: row['备注'] ?? row.desc,
        source: normalizeSource(row['账户'] ?? row['来源'] ?? row.source),
      },
      {
        incomeDesc: '生意收入',
        expenseDesc: '生意支出',
      },
    );

    if (!normalized) {
      continue;
    }

    transactions.push({
      ...normalized,
      allocation: parseBreakdown(row) ?? normalized.allocation,
      isLegacyLocked: parseBoolean(row['历史锁定']),
    });
  }

  return transactions;
};

export const parseCopperImportWorkbook = (
  workbook: XLSX.WorkBook,
  fallback: CopperData,
) => {
  const statusSheetName = findSheet(workbook, ['资产状态']);
  const ratioSheetName = findSheet(workbook, ['配置比例']);
  const transactionSheetName = findSheet(workbook, ['铜钱流水']);

  const balances = statusSheetName
    ? parseCopperStatusSheet(workbook.Sheets[statusSheetName], fallback.balances)
    : fallback.balances;
  const ratios = ratioSheetName
    ? parseCopperRatioSheet(workbook.Sheets[ratioSheetName], fallback.ratios)
    : fallback.ratios;
  const transactions = transactionSheetName
    ? parseCopperTransactionSheet(workbook.Sheets[transactionSheetName])
    : fallback.transactions;

  return sanitizeCopperData(
    {
      ratios,
      balances,
      transactions,
    },
    fallback,
  );
};

export const parseDailyImportWorkbook = (
  workbook: XLSX.WorkBook,
  fallback: DailyData,
) => {
  const settingsSheetName = findSheet(workbook, ['设置']);
  const recordSheetName = findSheet(workbook, ['全部记录', '记录', '当月记录']);

  let dailyLimit = fallback.dailyLimit;
  if (settingsSheetName) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[settingsSheetName], { raw: true });
    const limitRow = rows.find((row) => String(row['项目'] ?? '').trim() === '日额度');
    const limitValue = Number(limitRow?.['值']);
    if (Number.isFinite(limitValue)) {
      dailyLimit = limitValue;
    }
  }

  const transactions = recordSheetName
    ? parseDailyImportSheet(workbook.Sheets[recordSheetName])
    : fallback.transactions;

  return sanitizeDailyData(
    {
      dailyLimit,
      transactions,
    },
    fallback,
  );
};
