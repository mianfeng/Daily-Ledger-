import * as XLSX from 'xlsx';
import { CopperBalances, CopperData, Transaction } from '../types';
import { normalizeTransaction } from '../lib/ledger';

export const exportCopperToExcel = (data: CopperData) => {
  const wb = XLSX.utils.book_new();
  
  // Transactions Sheet
  const wsData = data.transactions.map(t => ({
    日期: t.date,
    类型: t.type === 'income' ? '收入' : '支出',
    金额: t.amount,
    备注: t.desc,
    账户: t.source ? (t.source === 'liquid' ? '流动库' : t.source === 'reserve' ? '存储库' : '收藏库') : '-'
  }));
  const ws = XLSX.utils.json_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "铜钱流水");

  // Status Sheet
  const wsStatus = XLSX.utils.json_to_sheet([
    { 项目: "流动库", 金额: data.balances.liquid },
    { 项目: "存储库", 金额: data.balances.reserve },
    { 项目: "收藏库", 金额: data.balances.collection }
  ]);
  XLSX.utils.book_append_sheet(wb, wsStatus, "资产状态");

  XLSX.writeFile(wb, "铜钱生意账本.xlsx");
};

export const exportDailyToExcel = (transactions: Transaction[], year: number, month: number) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(transactions.map(t => ({
    日期: t.date,
    类型: t.type === 'income' ? '收入' : '支出',
    金额: t.amount,
    备注: t.desc
  })));
  XLSX.utils.book_append_sheet(wb, ws, "记录");
  XLSX.writeFile(wb, `日常账本_${year}-${month}.xlsx`);
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
