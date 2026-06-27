import * as XLSX from 'xlsx';
import { sanitizeCopperData } from '../lib/copper';
import { sanitizeDailyData } from '../lib/daily';
import { normalizeTransaction } from '../lib/ledger';
import { CopperBalances, CopperBreakdown, CopperData, DailyData, Transaction } from '../types';

const JSON_CHUNK_SIZE = 30000;

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

const parseNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', '是'].includes(normalized);
};

const parseJsonValue = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const findSheet = (workbook: XLSX.WorkBook, names: string[]) =>
  names.find((name) => workbook.Sheets[name]);

const parseBreakdown = (
  row: Record<string, unknown>,
  prefix: string,
): CopperBreakdown | undefined => {
  const liquid = parseNumber(row[`${prefix}_流动`]);
  const reserve = parseNumber(row[`${prefix}_存储`]);

  if (liquid === null || reserve === null) {
    return undefined;
  }

  return {
    liquid,
    reserve,
  };
};

const parseLegacyAllocation = (row: Record<string, unknown>) => {
  const liquid = parseNumber(row['分配_流动']);
  const reserve = parseNumber(row['分配_存储']);

  if (liquid === null || reserve === null) {
    return undefined;
  }

  return {
    liquid,
    reserve,
  };
};

const normalizeCopperType = (value: unknown) => {
  if (value === 'income' || value === '收入' || value === '销售收入') {
    return 'income';
  }

  if (value === 'expense' || value === '支出' || value === '进货支出') {
    return 'expense';
  }

  if (value === 'inventory_adjustment' || value === '库存调整') {
    return 'inventory_adjustment';
  }

  return value;
};

export const exportCopperToExcel = (data: CopperData) => {
  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, '元数据', buildMetadataRows('铜钱分账'));
  appendSheet(workbook, '配置比例', [
    { 项目: '流动库', 比例: data.ratios.liquid },
    { 项目: '存储库', 比例: data.ratios.reserve },
  ]);
  appendSheet(workbook, '资产状态', [
    { 项目: '流动库', 金额: data.balances.liquid },
    { 项目: '存储库', 金额: data.balances.reserve },
    { 项目: '库存成本', 金额: data.inventoryCost },
  ]);
  appendSheet(
    workbook,
    '铜钱流水',
    data.transactions.map((transaction) => ({
      日期: transaction.date,
      类型:
        transaction.type === 'income'
          ? '销售收入'
          : transaction.type === 'expense'
            ? '进货支出'
            : '库存调整',
      金额: transaction.amount,
      备注: transaction.desc,
      成本: transaction.cost ?? '',
      利润: transaction.profit ?? '',
      现金_流动: transaction.cashAllocation?.liquid ?? '',
      现金_存储: transaction.cashAllocation?.reserve ?? '',
      库存变化: transaction.inventoryDelta ?? '',
      调整前库存: transaction.previousInventoryCost ?? '',
      调整后库存: transaction.nextInventoryCost ?? '',
      比例_流动: transaction.ratiosSnapshot?.liquid ?? '',
      比例_存储: transaction.ratiosSnapshot?.reserve ?? '',
      历史锁定: transaction.isLegacyLocked ? '是' : '',
      确认状态: transaction.confirmationStatus ?? '',
      确认日期: transaction.confirmedAt ?? '',
      取消日期: transaction.cancelledAt ?? '',
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
  const serializedState = JSON.stringify(data);
  const stateRows = Array.from(
    { length: Math.ceil(serializedState.length / JSON_CHUNK_SIZE) || 1 },
    (_, index) => ({
      序号: index + 1,
      JSON片段: serializedState.slice(
        index * JSON_CHUNK_SIZE,
        (index + 1) * JSON_CHUNK_SIZE,
      ),
    }),
  );

  appendSheet(workbook, '元数据', buildMetadataRows('生活预算'));
  appendSheet(workbook, '完整状态', stateRows);
  appendSheet(workbook, '设置', [{ 项目: '日额度', 值: data.dailyLimit }]);
  appendSheet(
    workbook,
    '全部记录',
    data.transactions.map((transaction) => ({
      日期: transaction.date,
      类型: transaction.type === 'income' ? '收入' : '支出',
      金额: transaction.amount,
      备注: transaction.desc,
      分类: transaction.category ?? '',
      收入类型: transaction.incomeKind ?? '',
      费用时点: transaction.expenseTiming ?? '',
      归属日期: transaction.effectiveDate ?? '',
      分配_周: transaction.allocation?.week ?? '',
      分配_缓冲: transaction.allocation?.buffer ?? '',
      分配_预支: transaction.allocation?.advance ?? '',
      分配_储备: transaction.allocation?.reserve ?? '',
      分配_固定: transaction.allocation?.fixed ?? '',
      分配_储备存入: transaction.allocation?.reserveDeposit ?? '',
      分配_储备补回: transaction.allocation?.reserveRecovery ?? '',
      固定支出ID: transaction.fixedExpenseId ?? '',
      前周期: transaction.previousCycle ? JSON.stringify(transaction.previousCycle) : '',
      前钱袋: transaction.previousPockets ? JSON.stringify(transaction.previousPockets) : '',
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
        分类: transaction.category ?? '',
        收入类型: transaction.incomeKind ?? '',
        费用时点: transaction.expenseTiming ?? '',
        归属日期: transaction.effectiveDate ?? '',
      })),
  );

  XLSX.writeFile(
    workbook,
    `生活预算_完整备份_${year}-${String(month).padStart(2, '0')}.xlsx`,
  );
};

export const parseDailyImportSheet = (sheet: XLSX.WorkSheet) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });

  return rows
    .map((row): Transaction | null => {
      const normalized = normalizeTransaction(
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
      );

      if (!normalized) {
        return null;
      }

      const allocationValues = {
        week: parseNumber(row['分配_周']),
        buffer: parseNumber(row['分配_缓冲']),
        advance: parseNumber(row['分配_预支']),
        reserve: parseNumber(row['分配_储备']),
        fixed: parseNumber(row['分配_固定']),
        reserveDeposit: parseNumber(row['分配_储备存入']),
        reserveRecovery: parseNumber(row['分配_储备补回']),
      };
      const hasAllocation = Object.values(allocationValues).some((value) => value !== null);
      const fixedExpenseId = parseNumber(row['固定支出ID']);

      return {
        ...normalized,
        category: (row['分类'] ?? row.category) as Transaction['category'],
        incomeKind: (row['收入类型'] ?? row.incomeKind) as Transaction['incomeKind'],
        expenseTiming: (row['费用时点'] ?? row.expenseTiming) as Transaction['expenseTiming'],
        effectiveDate: (row['归属日期'] ?? row.effectiveDate) as Transaction['effectiveDate'],
        allocation: hasAllocation
          ? {
              week: allocationValues.week ?? 0,
              buffer: allocationValues.buffer ?? 0,
              advance: allocationValues.advance ?? 0,
              reserve: allocationValues.reserve ?? 0,
              fixed: allocationValues.fixed ?? 0,
              reserveDeposit: allocationValues.reserveDeposit ?? undefined,
              reserveRecovery: allocationValues.reserveRecovery ?? undefined,
            }
          : undefined,
        fixedExpenseId: fixedExpenseId ?? undefined,
        previousCycle: parseJsonValue(row['前周期']),
        previousPockets: parseJsonValue(row['前钱袋']),
      };
    })
    .filter((transaction): transaction is Transaction => transaction !== null);
};

export const parseCopperStatusSheet = (
  sheet: XLSX.WorkSheet,
  fallback: CopperBalances,
) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const balances = { ...fallback };
  let inventoryCost: number | undefined;

  for (const row of rows) {
    const label = String(row['项目'] ?? '').trim();
    const amount = parseNumber(row['金额']);
    if (amount === null) {
      continue;
    }

    if (label === '流动库') {
      balances.liquid = amount;
    } else if (label === '存储库') {
      balances.reserve = amount;
    } else if (label === '库存成本') {
      inventoryCost = amount;
    }
  }

  return { balances, inventoryCost };
};

const parseCopperRatioSheet = (
  sheet: XLSX.WorkSheet,
  fallback: CopperData['ratios'],
) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const ratios = { ...fallback };

  for (const row of rows) {
    const label = String(row['项目'] ?? '').trim();
    const value = parseNumber(row['比例']);
    if (value === null) {
      continue;
    }

    if (label === '流动库') {
      ratios.liquid = value;
    } else if (label === '存储库') {
      ratios.reserve = value;
    }
  }

  return ratios;
};

const parseCopperTransactionSheet = (sheet: XLSX.WorkSheet) => {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  const transactions: Record<string, unknown>[] = [];

  for (const row of rows) {
    const type = normalizeCopperType(row['类型'] ?? row.type);
    const common = {
      id: row.id,
      date: row['日期'] ?? row.date,
      amount: row['金额'] ?? row.amount,
      desc: row['备注'] ?? row.desc,
    };

    if (type === 'inventory_adjustment') {
      transactions.push({
        ...common,
        type,
        inventoryDelta: row['库存变化'] ?? row.inventoryDelta,
        previousInventoryCost: row['调整前库存'] ?? row.previousInventoryCost,
        nextInventoryCost: row['调整后库存'] ?? row.nextInventoryCost,
      });
      continue;
    }

    const normalized = normalizeTransaction(
      {
        ...common,
        type,
      },
      {
        incomeDesc: '生意收入',
        expenseDesc: '进货支出',
      },
    );

    if (!normalized) {
      continue;
    }

    transactions.push({
      ...normalized,
      cost: row['成本'] ?? row.cost,
      profit: row['利润'] ?? row.profit,
      cashAllocation: parseBreakdown(row, '现金'),
      allocation: parseLegacyAllocation(row),
      inventoryDelta: row['库存变化'] ?? row.inventoryDelta,
      ratiosSnapshot: parseBreakdown(row, '比例'),
      isLegacyLocked: parseBoolean(row['历史锁定']),
      confirmationStatus: row['确认状态'] ?? row.confirmationStatus,
      confirmedAt: row['确认日期'] ?? row.confirmedAt,
      cancelledAt: row['取消日期'] ?? row.cancelledAt,
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

  const status = statusSheetName
    ? parseCopperStatusSheet(workbook.Sheets[statusSheetName], fallback.balances)
    : { balances: fallback.balances, inventoryCost: fallback.inventoryCost };
  const ratios = ratioSheetName
    ? parseCopperRatioSheet(workbook.Sheets[ratioSheetName], fallback.ratios)
    : fallback.ratios;
  const transactions = transactionSheetName
    ? parseCopperTransactionSheet(workbook.Sheets[transactionSheetName])
    : fallback.transactions;

  return sanitizeCopperData(
    {
      ratios,
      balances: status.balances,
      inventoryCost: status.inventoryCost ?? fallback.inventoryCost,
      transactions,
    },
    fallback,
  );
};

export const parseDailyImportWorkbook = (
  workbook: XLSX.WorkBook,
  fallback: DailyData,
) => {
  const stateSheetName = findSheet(workbook, ['完整状态']);
  if (stateSheetName) {
    const stateRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[stateSheetName],
      { raw: true },
    );
    const serializedState = stateRows
      .sort((left, right) => Number(left['序号'] ?? 0) - Number(right['序号'] ?? 0))
      .map((row) => String(row['JSON片段'] ?? ''))
      .join('');
    const parsedState = parseJsonValue(serializedState);
    if (parsedState) {
      return sanitizeDailyData(parsedState, fallback);
    }
  }

  const settingsSheetName = findSheet(workbook, ['设置']);
  const recordSheetName = findSheet(workbook, ['全部记录', '记录', '当月记录']);

  let dailyLimit = fallback.dailyLimit;
  if (settingsSheetName) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[settingsSheetName], { raw: true });
    const limitRow = rows.find((row) => String(row['项目'] ?? '').trim() === '日额度');
    const limitValue = parseNumber(limitRow?.['值']);
    if (limitValue !== null) {
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
