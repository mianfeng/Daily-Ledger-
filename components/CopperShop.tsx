import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightCircle,
  Calendar,
  Coins,
  Download,
  Lock,
  Settings,
  Table,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import {
  applyCopperTransaction,
  buildIncomeAllocation,
  createCopperTransaction,
  createEmptyCopperBreakdown,
  formatCopperTransactionDate,
  getCopperChartData,
  getCopperMonthlyStats,
  getCopperSourceLabel,
  getTotalCopperAssets,
  rollbackCopperTransaction,
  sanitizeCopperData,
} from '../lib/copper';
import { getTodayDate } from '../lib/date';
import { CopperAccount, CopperData, CopperRatios, Transaction } from '../types';
import {
  exportCopperToExcel,
  parseCopperImportWorkbook,
} from '../utils/excel';

const INITIAL_DATA: CopperData = {
  ratios: { liquid: 70, reserve: 20, collection: 10 },
  balances: { liquid: 4, reserve: 100, collection: 6 },
  transactions: [],
};

const resolveLegacyTransaction = (
  transaction: Transaction,
  ratios: CopperRatios,
): Transaction => {
  if (transaction.allocation || transaction.isLegacyLocked) {
    return transaction;
  }

  if (transaction.type === 'income') {
    return {
      ...transaction,
      allocation: buildIncomeAllocation(transaction.amount, ratios),
    };
  }

  if (transaction.source && transaction.source !== 'liquid') {
    const allocation = createEmptyCopperBreakdown();
    allocation[transaction.source] = transaction.amount;

    return {
      ...transaction,
      allocation,
    };
  }

  return {
    ...transaction,
    isLegacyLocked: true,
  };
};

const hasMigrationChange = (original: Transaction, resolved: Transaction) => {
  if (Boolean(original.isLegacyLocked) !== Boolean(resolved.isLegacyLocked)) {
    return true;
  }

  const originalAllocation = original.allocation;
  const resolvedAllocation = resolved.allocation;

  if (Boolean(originalAllocation) !== Boolean(resolvedAllocation)) {
    return true;
  }

  if (!originalAllocation || !resolvedAllocation) {
    return false;
  }

  return (
    originalAllocation.liquid !== resolvedAllocation.liquid ||
    originalAllocation.reserve !== resolvedAllocation.reserve ||
    originalAllocation.collection !== resolvedAllocation.collection
  );
};

export const CopperShop: React.FC = () => {
  const [data, setData] = useLocalStorageState<CopperData>(
    'coinShopData_v5',
    INITIAL_DATA,
    {
      deserialize: (raw) => sanitizeCopperData(JSON.parse(raw), INITIAL_DATA),
    },
  );
  const [showSettings, setShowSettings] = useState(false);
  const [ratioDraft, setRatioDraft] = useState<CopperRatios>(data.ratios);
  const [form, setForm] = useState<{
    amount: string;
    date: string;
    desc: string;
    source: CopperAccount;
    type: 'income' | 'expense';
  }>({
    amount: '',
    desc: '',
    type: 'income',
    source: 'liquid',
    date: getTodayDate(),
  });

  useEffect(() => {
    if (showSettings) {
      setRatioDraft(data.ratios);
    }
  }, [data.ratios, showSettings]);

  const resolvedTransactions = useMemo(
    () =>
      data.transactions.map((transaction) =>
        resolveLegacyTransaction(transaction, data.ratios),
      ),
    [data.ratios, data.transactions],
  );

  useEffect(() => {
    const needsMigration = data.transactions.some((transaction, index) =>
      hasMigrationChange(transaction, resolvedTransactions[index]),
    );

    if (!needsMigration) {
      return;
    }

    setData((prev) => ({
      ...prev,
      transactions: prev.transactions.map((transaction) =>
        resolveLegacyTransaction(transaction, prev.ratios),
      ),
    }));
  }, [data.transactions, resolvedTransactions, setData]);

  const totalAssets = useMemo(
    () => getTotalCopperAssets(data.balances),
    [data.balances],
  );
  const monthlyStats = useMemo(
    () => getCopperMonthlyStats(resolvedTransactions),
    [resolvedTransactions],
  );
  const chartData = useMemo(
    () => getCopperChartData(resolvedTransactions, totalAssets),
    [resolvedTransactions, totalAssets],
  );
  const lockedLegacyCount = useMemo(
    () => resolvedTransactions.filter((transaction) => transaction.isLegacyLocked).length,
    [resolvedTransactions],
  );

  const handleAddTransaction = () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('请输入有效金额');
      return;
    }

    if (!form.date) {
      alert('请选择日期');
      return;
    }

    setData((prev) => {
      const transaction = createCopperTransaction({
        amount,
        date: form.date,
        desc: form.desc,
        ratios: prev.ratios,
        balances: prev.balances,
        source: form.source,
        type: form.type,
      });

      return {
        ...prev,
        balances: applyCopperTransaction(prev.balances, transaction, prev.ratios),
        transactions: [...prev.transactions, transaction],
      };
    });

    setForm((prev) => ({ ...prev, amount: '', desc: '' }));
  };

  const handleDeleteTransaction = (id: number) => {
    if (!window.confirm('确定删除这条记录吗？资金将自动回滚。')) {
      return;
    }

    const transaction = resolvedTransactions.find((item) => item.id === id);
    if (!transaction) {
      return;
    }

    if (transaction.isLegacyLocked) {
      alert('这条旧记录缺少精确扣款明细，已锁定删除以避免余额出错。');
      return;
    }

    setData((prev) => {
      return {
        ...prev,
        balances: rollbackCopperTransaction(prev.balances, transaction, prev.ratios),
        transactions: prev.transactions.filter((item) => item.id !== id),
      };
    });
  };

  const handleSaveSettings = () => {
    const totalRatio =
      ratioDraft.liquid + ratioDraft.reserve + ratioDraft.collection;

    if (totalRatio !== 100) {
      alert('比例总和必须是100%');
      return;
    }

    setData((prev) => ({ ...prev, ratios: ratioDraft }));
    setShowSettings(false);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用导入文件覆盖当前铜钱分账数据吗？余额、比例和流水都会被替换。')) {
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: 'array' });
        const importedData = parseCopperImportWorkbook(workbook, INITIAL_DATA);
        setData(importedData);
        alert(`导入成功，共恢复 ${importedData.transactions.length} 条流水`);
      } catch {
        alert('导入失败，格式不正确');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      <div className="flex justify-between items-center border-b pb-3 border-stone-200">
        <h1 className="text-xl font-bold text-amber-900 flex items-center gap-2">
          <div className="relative w-6 h-6">
            <div className="absolute inset-0 bg-amber-700 rounded-full"></div>
            <div className="absolute inset-1.5 bg-[#F5F5F0] rounded-sm"></div>
          </div>
          铜钱分账
        </h1>
        <button
          onClick={() => setShowSettings((prev) => !prev)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-stone-600 border border-stone-300 rounded hover:bg-stone-100 transition-colors"
        >
          <Settings size={14} /> 比例配置
        </button>
      </div>

      {showSettings && (
        <div className="bg-white p-4 rounded-xl shadow-lg border-t-4 border-stone-400">
          <h3 className="font-bold text-sm mb-3">配置比例 (总和须为100)</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-stone-500 mb-1">流动库 %</label>
              <input
                type="number"
                value={ratioDraft.liquid}
                onChange={(event) =>
                  setRatioDraft((prev) => ({
                    ...prev,
                    liquid: Number(event.target.value) || 0,
                  }))
                }
                className="w-full p-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">存储库 %</label>
              <input
                type="number"
                value={ratioDraft.reserve}
                onChange={(event) =>
                  setRatioDraft((prev) => ({
                    ...prev,
                    reserve: Number(event.target.value) || 0,
                  }))
                }
                className="w-full p-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">收藏库 %</label>
              <input
                type="number"
                value={ratioDraft.collection}
                onChange={(event) =>
                  setRatioDraft((prev) => ({
                    ...prev,
                    collection: Number(event.target.value) || 0,
                  }))
                }
                className="w-full p-1.5 border rounded text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveSettings}
              className="flex-1 bg-amber-700 text-white py-1.5 rounded hover:bg-amber-800 text-sm"
            >
              保存配置
            </button>
          </div>
          <div className="mt-3 pt-3 border-t flex gap-2">
            <button
              onClick={() =>
                exportCopperToExcel({
                  ...data,
                  transactions: resolvedTransactions,
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
            >
              <Download size={14} /> 导出备份
            </button>
            <label className="flex items-center gap-1 px-3 py-1.5 bg-stone-500 text-white rounded text-xs hover:bg-stone-600 cursor-pointer">
              <Upload size={14} /> 导入备份
              <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
            </label>
          </div>
        </div>
      )}

      {lockedLegacyCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-xl text-xs">
          检测到 {lockedLegacyCount} 条旧版流水缺少精确扣款明细。这些记录会保留展示，但禁止删除，避免回滚后余额失真。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-4 bg-gradient-to-r from-amber-700 to-amber-900 p-3 rounded-xl shadow-sm text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-white/10 rounded-full">
              <Wallet size={18} className="text-white" />
            </div>
            <div>
              <div className="text-amber-100 text-[10px] font-medium uppercase tracking-wider">
                Total Assets
              </div>
              <div className="text-xl font-bold leading-none">
                ¥ {totalAssets.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="text-amber-200/50 text-3xl opacity-20 rotate-12">
            <Coins />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-yellow-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <div className="flex flex-col items-center w-full">
            <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
              <Coins size={12} className="text-yellow-600" /> 流动库
            </span>
            <span className="text-base font-bold text-stone-800">
              ¥ {data.balances.liquid.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">
            {data.ratios.liquid}%
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-emerald-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <div className="flex flex-col items-center w-full">
            <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
              <Lock size={12} className="text-emerald-600" /> 存储库
            </span>
            <span className="text-base font-bold text-stone-800">
              ¥ {data.balances.reserve.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">
            {data.ratios.reserve}%
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-amber-900 text-center flex flex-col items-center justify-between min-h-[80px]">
          <div className="flex flex-col items-center w-full">
            <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
              <Archive size={12} className="text-amber-900" /> 收藏库
            </span>
            <span className="text-base font-bold text-stone-800">
              ¥ {data.balances.collection.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">
            {data.ratios.collection}%
          </div>
        </div>
      </div>

      <div className="bg-white p-2 rounded-xl shadow-sm border border-stone-200 flex flex-col md:flex-row items-stretch md:items-center gap-2">
        <div className="flex items-center gap-2 bg-stone-50 p-1 rounded-lg">
          <div className="flex bg-white rounded-md shadow-sm border border-stone-100 overflow-hidden">
            <button
              onClick={() => setForm((prev) => ({ ...prev, type: 'income' }))}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                form.type === 'income'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'text-stone-400 hover:bg-stone-50'
              }`}
            >
              收
            </button>
            <div className="w-px bg-stone-100"></div>
            <button
              onClick={() => setForm((prev) => ({ ...prev, type: 'expense' }))}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                form.type === 'expense'
                  ? 'bg-red-50 text-red-500'
                  : 'text-stone-400 hover:bg-stone-50'
              }`}
            >
              支
            </button>
          </div>

          <div className="h-4 w-px bg-stone-200 mx-1 hidden md:block"></div>

          <div className="relative flex-1 md:flex-none">
            <input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, date: event.target.value }))
              }
              className="w-full md:w-32 bg-transparent text-xs text-stone-600 font-medium focus:outline-none cursor-pointer pl-6 py-1 min-w-[7.5rem]"
            />
            <Calendar
              size={12}
              className="absolute left-1 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
            />
          </div>
        </div>

        <div className="flex flex-1 items-center gap-2 bg-stone-50 p-1 rounded-lg">
          {form.type === 'expense' && (
            <select
              value={form.source}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  source: event.target.value as CopperAccount,
                }))
              }
              className="bg-transparent text-xs text-stone-600 font-medium focus:outline-none border-r border-stone-200 pr-2"
            >
              <option value="liquid">流动</option>
              <option value="reserve">存储</option>
              <option value="collection">收藏</option>
            </select>
          )}

          <input
            type="number"
            placeholder="金额"
            value={form.amount}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, amount: event.target.value }))
            }
            className="w-20 bg-transparent text-sm font-bold text-stone-800 placeholder:text-stone-300 focus:outline-none text-right"
          />
          <span className="text-stone-300 text-xs">|</span>
          <input
            type="text"
            placeholder="备注..."
            value={form.desc}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, desc: event.target.value }))
            }
            className="flex-1 bg-transparent text-xs text-stone-700 placeholder:text-stone-300 focus:outline-none min-w-0"
          />
        </div>

        <button
          onClick={handleAddTransaction}
          className="bg-amber-700 hover:bg-amber-800 text-white p-2 rounded-lg transition-colors shadow-sm active:scale-95 flex items-center justify-center"
        >
          <ArrowRightCircle size={18} />
        </button>
      </div>

      {chartData.length > 0 && (
        <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 h-56 relative">
          <h3 className="absolute top-3 left-3 text-[10px] font-bold text-stone-400 flex items-center gap-1">
            <TrendingUp size={10} /> 收支趋势 (近30天)
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="shortDate" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#F59E0B' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(value: number) => value.toFixed(1)}
                labelFormatter={(label) => `日期: ${label}`}
                contentStyle={{
                  borderRadius: '6px',
                  border: 'none',
                  boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)',
                  fontSize: '11px',
                  padding: '4px 8px',
                }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                iconSize={6}
                wrapperStyle={{ fontSize: '10px', right: 0, top: 0 }}
              />
              <Line yAxisId="left" type="monotone" name="收入" dataKey="income" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="left" type="monotone" name="支出" dataKey="expense" stroke="#EF4444" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" name="总资产" dataKey="assets" stroke="#F59E0B" strokeWidth={2} strokeDasharray="3 3" dot={false} activeDot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {monthlyStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-stone-100">
          <div className="px-3 py-2 border-b border-stone-100 bg-stone-50 flex items-center gap-2">
            <Table size={12} className="text-stone-500" />
            <h3 className="font-bold text-[10px] text-stone-700">月度汇总</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-50 text-stone-500 font-medium">
                <tr>
                  <th className="px-3 py-1.5">月份</th>
                  <th className="px-3 py-1.5 text-emerald-600">总收入</th>
                  <th className="px-3 py-1.5 text-red-500">总支出</th>
                  <th className="px-3 py-1.5 text-right">净收益</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {monthlyStats.map((stat) => (
                  <tr key={stat.month} className="hover:bg-stone-50 transition-colors">
                    <td className="px-3 py-1.5 font-medium text-stone-700">{stat.month}</td>
                    <td className="px-3 py-1.5 text-emerald-600">+{stat.income.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-red-500">-{stat.expense.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-right font-bold ${stat.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {stat.net >= 0 ? '+' : ''}
                      {stat.net.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-[10px] font-bold text-stone-400 mb-2 uppercase tracking-wider">
          Recent Transactions
        </h2>
        <ul className="space-y-1.5">
          {[...resolvedTransactions].reverse().slice(0, 10).map((transaction) => (
            <li
              key={transaction.id}
              className="bg-white px-3 py-2 rounded-lg shadow-sm flex justify-between items-center border border-stone-100 group"
            >
              <div>
                <div className="font-medium text-stone-800 text-xs">{transaction.desc}</div>
                <div className="text-[10px] text-stone-400 flex items-center gap-1">
                  {formatCopperTransactionDate(transaction.date)}
                  {transaction.type === 'expense' && (
                    <span className="px-1 bg-stone-50 rounded text-stone-500 scale-90 origin-left">
                      {getCopperSourceLabel(transaction)}
                    </span>
                  )}
                  {transaction.isLegacyLocked && (
                    <span className="px-1 bg-amber-50 rounded text-amber-700 scale-90 origin-left">
                      历史锁定
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`text-xs font-bold ${transaction.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {transaction.type === 'income' ? '+' : '-'}
                  {transaction.amount.toFixed(2)}
                </div>
                <button
                  onClick={() => handleDeleteTransaction(transaction.id)}
                  className={`p-2 -m-1 rounded-full transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 touch-manipulation ${
                    transaction.isLegacyLocked
                      ? 'text-stone-200 cursor-not-allowed'
                      : 'text-stone-400 hover:text-red-500 hover:bg-stone-50'
                  }`}
                  title={transaction.isLegacyLocked ? '历史锁定记录不可删除' : '删除'}
                  aria-label={transaction.isLegacyLocked ? `${transaction.desc}不可删除` : `删除${transaction.desc}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
          {resolvedTransactions.length === 0 && (
            <li className="text-center text-stone-400 py-4 text-xs">暂无记录</li>
          )}
        </ul>
      </div>
    </div>
  );
};
