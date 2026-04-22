import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { formatDisplayDate, getTodayDate, normalizeDateInput } from '../lib/date';
import {
  getCompliantDaysCount,
  getDailyChartData,
  getEstimatedMonthEndBalance,
  getMonthBalanceSnapshot,
  getMonthTransactions,
  getTodaySpent,
  getTransactionSummary,
  sanitizeDailyData,
} from '../lib/daily';
import { createTransactionId } from '../lib/ledger';
import { DailyData, Transaction } from '../types';
import { exportDailyToExcel, parseDailyImportWorkbook } from '../utils/excel';

const INITIAL_DATA: DailyData = {
  dailyLimit: 30,
  transactions: [],
};

export const DailyLedger: React.FC = () => {
  const today = new Date();
  const [data, setData] = useLocalStorageState<DailyData>(
    'dailyBookData_v5',
    INITIAL_DATA,
    {
      deserialize: (raw) => sanitizeDailyData(JSON.parse(raw), INITIAL_DATA),
    },
  );

  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [showPicker, setShowPicker] = useState(false);
  const [form, setForm] = useState<{
    amount: string;
    date: string;
    desc: string;
    type: Transaction['type'];
  }>({
    amount: '',
    desc: '',
    type: 'expense',
    date: getTodayDate(),
  });

  const monthTransactions = useMemo(
    () => getMonthTransactions(data.transactions, currentYear, currentMonth),
    [currentMonth, currentYear, data.transactions],
  );
  const { income, expense, balance } = useMemo(
    () => getTransactionSummary(monthTransactions),
    [monthTransactions],
  );
  const todaySpent = useMemo(
    () => getTodaySpent(data.transactions),
    [data.transactions],
  );
  const compliantDaysCount = useMemo(
    () => getCompliantDaysCount(monthTransactions, data.dailyLimit),
    [data.dailyLimit, monthTransactions],
  );
  const estimatedMonthEndBalance = useMemo(
    () =>
      getEstimatedMonthEndBalance({
        balance,
        currentMonth,
        currentYear,
        dailyLimit: data.dailyLimit,
        todaySpent,
      }),
    [balance, currentMonth, currentYear, data.dailyLimit, todaySpent],
  );
  const chartData = useMemo(
    () => getDailyChartData(monthTransactions, currentYear, currentMonth),
    [currentMonth, currentYear, monthTransactions],
  );

  const handleAddTx = () => {
    const amount = Number(form.amount);
    const date = normalizeDateInput(form.date);

    if (!Number.isFinite(amount) || amount <= 0 || !date) {
      alert('请完善信息');
      return;
    }

    const newTransaction: Transaction = {
      id: createTransactionId(),
      date,
      type: form.type,
      amount,
      desc: form.desc.trim() || (form.type === 'expense' ? '日常支出' : '额外收入'),
    };

    setData((prev) => ({
      ...prev,
      transactions: [...prev.transactions, newTransaction],
    }));

    const [year, month] = date.split('-').map(Number);
    setCurrentYear(year);
    setCurrentMonth(month);
    setForm((prev) => ({ ...prev, amount: '', desc: '' }));
  };

  const handleDeleteTx = (id: number) => {
    if (!window.confirm('确定删除这条记录吗？')) {
      return;
    }

    setData((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((transaction) => transaction.id !== id),
    }));
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用导入文件覆盖当前日常账本数据吗？日额度和全部流水都会被替换。')) {
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: 'array' });
        const importedData = parseDailyImportWorkbook(workbook, INITIAL_DATA);
        setData(importedData);
        alert(`导入成功，共恢复 ${importedData.transactions.length} 条记录`);
      } catch {
        alert('导入失败');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4 animate-fade-in relative pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b pb-3 border-stone-200 gap-4">
        <div>
          <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <div className="bg-blue-600 text-white p-1.5 rounded-lg">
              <Calendar size={18} />
            </div>
            日常账本
          </h1>
        </div>

        <div className="relative z-30 w-full md:w-auto">
          <button
            onClick={() => setShowPicker((prev) => !prev)}
            className="w-full md:w-auto flex justify-between md:justify-center items-center gap-2 bg-white border border-stone-200 px-3 py-1.5 rounded-full shadow-sm text-stone-600 hover:bg-stone-50 hover:border-blue-300 transition-all text-sm font-medium"
          >
            <span>
              {currentYear}年 {currentMonth}月
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform text-stone-400 ${showPicker ? 'rotate-180' : ''}`}
            />
          </button>

          {showPicker && (
            <div className="absolute top-full right-0 mt-2 w-full md:w-80 bg-white border border-stone-200 shadow-xl rounded-xl p-4 z-50 animate-fade-in">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-stone-100">
                <button
                  onClick={() => setPickerYear((prev) => prev - 1)}
                  className="p-1 hover:bg-stone-100 rounded text-stone-500"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="font-bold text-stone-700">{pickerYear}</span>
                <button
                  onClick={() => setPickerYear((prev) => prev + 1)}
                  className="p-1 hover:bg-stone-100 rounded text-stone-500"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                  const { balance: monthBalance, hasTransactions } = getMonthBalanceSnapshot(
                    data.transactions,
                    pickerYear,
                    month,
                  );
                  const isActive = pickerYear === currentYear && month === currentMonth;

                  let badgeStyle = '';
                  if (isActive) {
                    badgeStyle = 'bg-white/20 text-white';
                  } else if (!hasTransactions) {
                    badgeStyle = 'bg-stone-100 text-stone-400';
                  } else if (monthBalance >= 0) {
                    badgeStyle = 'bg-emerald-100 text-emerald-700';
                  } else {
                    badgeStyle = 'bg-red-100 text-red-700';
                  }

                  return (
                    <div
                      key={month}
                      onClick={() => {
                        setCurrentYear(pickerYear);
                        setCurrentMonth(month);
                        setShowPicker(false);
                      }}
                      className={`flex flex-col items-center justify-center p-2 rounded-lg cursor-pointer border transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                          : 'bg-white hover:bg-stone-50 border-transparent text-stone-600'
                      }`}
                    >
                      <span className="font-bold text-sm">{month}月</span>
                      <span className={`text-[10px] px-1.5 rounded-full mt-1 ${badgeStyle}`}>
                        {!hasTransactions
                          ? '·'
                          : `${monthBalance > 0 ? '+' : ''}${monthBalance.toFixed(0)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white px-3 py-3 rounded-xl shadow-sm border border-stone-100 flex flex-col justify-between min-h-[100px] relative overflow-hidden">
          <div className="flex justify-between items-start z-10">
            <h3 className="text-stone-400 font-bold text-xs">收支概览</h3>
            <div className="flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
              <Award size={10} className="text-amber-500" />
              <span className="text-[9px] font-bold text-amber-700">
                达标 {compliantDaysCount} 天
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 z-10">
            <div className="flex flex-col">
              <span className="text-[10px] text-stone-400 scale-90 origin-left">收入</span>
              <span className="font-bold text-emerald-600 text-sm">
                +{income.toFixed(0)}
              </span>
            </div>
            <div className="h-6 w-px bg-stone-100 mx-1"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-stone-400 scale-90 origin-left">支出</span>
              <span className="font-bold text-red-500 text-sm">
                -{expense.toFixed(0)}
              </span>
            </div>
            <div className="h-6 w-px bg-stone-100 mx-1"></div>
            <div className="flex flex-col text-right">
              <span className="text-[10px] text-stone-400 scale-90 origin-right">结余</span>
              <span className={`font-bold text-sm ${balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {balance >= 0 ? '+' : ''}
                {balance.toFixed(0)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white px-3 py-3 rounded-xl shadow-sm border border-stone-100 flex flex-col justify-between min-h-[100px]">
          <div className="flex justify-between items-center">
            <h3 className="text-stone-400 font-bold text-xs">今日额度</h3>
            <div className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              todaySpent > data.dailyLimit
                ? 'bg-red-50 text-red-500 border border-red-100'
                : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
            }`}>
              {todaySpent > data.dailyLimit ? '已超' : '正常'}
            </div>
          </div>

          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-lg font-bold ${todaySpent > data.dailyLimit ? 'text-red-500' : 'text-stone-800'}`}>
              {todaySpent.toFixed(0)}
            </span>
            <span className="text-xs text-stone-300">/</span>
            <input
              type="number"
              value={data.dailyLimit}
              onChange={(event) =>
                setData((prev) => ({
                  ...prev,
                  dailyLimit: Number(event.target.value) || 0,
                }))
              }
              className="w-8 text-xs text-stone-400 border-b border-dashed border-stone-200 focus:outline-none focus:border-blue-400 bg-transparent text-center"
            />
          </div>

          <div className="pt-2 mt-1 border-t border-dashed border-stone-100 flex justify-between items-center">
            <span className="text-[9px] text-stone-400 flex items-center gap-1">
              <TrendingUp size={10} /> 月末预估
            </span>
            {estimatedMonthEndBalance !== null ? (
              <span className={`text-[10px] font-bold ${
                estimatedMonthEndBalance >= 0 ? 'text-emerald-600' : 'text-red-500'
              }`}>
                {estimatedMonthEndBalance >= 0 ? '+' : ''}
                {estimatedMonthEndBalance.toFixed(0)}
              </span>
            ) : (
              <span className="text-[10px] text-stone-300">-</span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex gap-2 bg-stone-50 p-1 rounded-lg">
            <div className="flex bg-white rounded-md shadow-sm border border-stone-100 overflow-hidden shrink-0">
              <button
                onClick={() => setForm((prev) => ({ ...prev, type: 'expense' }))}
                className={`px-4 py-2 text-xs font-bold ${
                  form.type === 'expense'
                    ? 'bg-red-50 text-red-500'
                    : 'text-stone-400 hover:bg-stone-50'
                }`}
              >
                支
              </button>
              <div className="w-px bg-stone-100"></div>
              <button
                onClick={() => setForm((prev) => ({ ...prev, type: 'income' }))}
                className={`px-4 py-2 text-xs font-bold ${
                  form.type === 'income'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'text-stone-400 hover:bg-stone-50'
                }`}
              >
                收
              </button>
            </div>

            <div className="relative flex-1 md:flex-none">
              <input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, date: event.target.value }))
                }
                className="w-full md:w-32 h-full bg-transparent pl-8 text-xs font-medium text-stone-600 focus:outline-none cursor-pointer"
              />
              <Calendar
                size={14}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              />
            </div>
          </div>

          <div className="flex-1 flex gap-2 items-center bg-stone-50 p-1 rounded-lg px-3">
            <span className="text-stone-400 text-xs font-bold">¥</span>
            <input
              type="number"
              placeholder="0.00"
              value={form.amount}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, amount: event.target.value }))
              }
              className="w-24 bg-transparent text-sm font-bold text-stone-800 placeholder:text-stone-300 focus:outline-none"
            />
            <div className="w-px h-4 bg-stone-200 mx-1"></div>
            <input
              type="text"
              placeholder="备注 (如: 早餐)"
              value={form.desc}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, desc: event.target.value }))
              }
              className="flex-1 bg-transparent text-xs text-stone-700 placeholder:text-stone-300 focus:outline-none"
            />
          </div>

          <button
            onClick={handleAddTx}
            className="bg-stone-800 hover:bg-stone-900 text-white p-2.5 rounded-lg shadow-sm active:scale-95 transition-all flex justify-center"
          >
            <Check size={18} />
          </button>
        </div>
      </div>

      <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 h-56 relative">
        <h3 className="absolute top-3 left-3 text-[10px] font-bold text-stone-400 flex items-center gap-1">
          <TrendingUp size={10} /> 收支趋势
        </h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 9 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 9 }} />
            <Tooltip
              contentStyle={{
                borderRadius: '6px',
                border: 'none',
                boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)',
                fontSize: '11px',
                padding: '4px 8px',
              }}
            />
            <ReferenceLine y={data.dailyLimit} stroke="red" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="amount" stroke="#4A90E2" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex gap-4 pt-2 border-t border-stone-200">
        <button
          onClick={() => exportDailyToExcel(data, currentYear, currentMonth)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-500 bg-white border rounded hover:bg-stone-50"
        >
          <Download size={12} /> 导出备份
        </button>
        <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-500 bg-white border rounded hover:bg-stone-50 cursor-pointer">
          <Upload size={12} /> 导入备份
          <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
        </label>
      </div>

      <div>
        <h3 className="font-bold text-stone-400 text-[10px] uppercase tracking-wider mb-2">
          Transaction History
        </h3>
        <ul className="space-y-2">
          {[...monthTransactions].reverse().map((transaction) => (
            <li
              key={transaction.id}
              className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-stone-100 shadow-sm group hover:border-blue-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className={`w-0.5 h-6 rounded-full ${
                  transaction.type === 'income' ? 'bg-emerald-400' : 'bg-red-400'
                }`}></div>
                <div>
                  <div className="text-stone-800 font-medium text-xs">{transaction.desc}</div>
                  <div className="text-[10px] text-stone-400">
                    {formatDisplayDate(transaction.date)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`font-bold text-xs ${
                  transaction.type === 'income' ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {transaction.type === 'income' ? '+' : '-'}
                  {transaction.amount.toFixed(2)}
                </div>
                <button
                  onClick={() => handleDeleteTx(transaction.id)}
                  className="text-stone-400 hover:text-red-500 p-2 -m-1 rounded-full hover:bg-stone-50 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 touch-manipulation"
                  title="删除"
                  aria-label={`删除${transaction.desc}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
          {monthTransactions.length === 0 && (
            <li className="text-center text-stone-400 text-xs py-4">本月暂无记录</li>
          )}
        </ul>
      </div>
    </div>
  );
};
