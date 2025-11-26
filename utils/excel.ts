import * as XLSX from 'xlsx';
import { Transaction, CopperData, DailyData } from '../types';

export const exportCopperToExcel = (data: CopperData) => {
  const wb = XLSX.utils.book_new();
  
  // Transactions Sheet
  const wsData = data.transactions.map(t => ({
    日期: new Date(t.date).toLocaleDateString(),
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
