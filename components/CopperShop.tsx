import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightCircle,
  Calendar,
  Coins,
  Download,
  Lock,
  Package,
  Settings,
  Table,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { DEFAULT_COPPER_DATA } from '../lib/appData';
import {
  applyCopperTransaction,
  createCopperExpenseTransaction,
  createCopperIncomeTransaction,
  createInventoryAdjustmentTransaction,
  formatCopperTransactionDate,
  getCopperCashTotal,
  getCopperChartData,
  getCopperMonthlyStats,
  getCopperTransactionKindLabel,
  getTotalCopperAssets,
  rollbackCopperTransaction,
} from '../lib/copper';
import { getTodayDate } from '../lib/date';
import { CopperData, CopperRatios } from '../types';
import {
  exportCopperToExcel,
  parseCopperImportWorkbook,
} from '../utils/excel';

const formatSigned = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

const formatCompactAmount = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 10000) {
    return `${value < 0 ? '-' : ''}${(absValue / 10000).toFixed(absValue >= 100000 ? 0 : 1)}万`;
  }
  return `${Math.round(value)}`;
};

const formatCompactMoney = (value: number) => `¥ ${formatCompactAmount(value)}`;

const formatSignedCompact = (value: number) =>
  `${value >= 0 ? '+' : ''}${formatCompactAmount(value)}`;

const formatMoney = (value: number) => `¥ ${value.toFixed(2)}`;

type CopperTrendMode = 'flow' | 'inventory';

interface CopperShopProps {
  data: CopperData;
  setData: React.Dispatch<React.SetStateAction<CopperData>>;
}

export const CopperShop: React.FC<CopperShopProps> = ({ data, setData }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [ratioDraft, setRatioDraft] = useState<CopperRatios>(data.ratios);
  const [inventoryEntryAmount, setInventoryEntryAmount] = useState('');
  const [inventoryEntryDesc, setInventoryEntryDesc] = useState('');
  const [inventoryDraft, setInventoryDraft] = useState(String(data.inventoryCost));
  const [inventoryAdjustmentDesc, setInventoryAdjustmentDesc] = useState('');
  const [trendMode, setTrendMode] = useState<CopperTrendMode>('flow');
  const [form, setForm] = useState<{
    amount: string;
    cost: string;
    date: string;
    desc: string;
    type: 'income' | 'expense';
  }>({
    amount: '',
    cost: '',
    desc: '',
    type: 'income',
    date: getTodayDate(),
  });

  useEffect(() => {
    if (showSettings) {
      setRatioDraft(data.ratios);
      setInventoryEntryAmount('');
      setInventoryEntryDesc('');
      setInventoryDraft(String(data.inventoryCost));
      setInventoryAdjustmentDesc('');
    }
  }, [data.inventoryCost, data.ratios, showSettings]);

  const cashTotal = useMemo(
    () => getCopperCashTotal(data.balances),
    [data.balances],
  );
  const totalAssets = useMemo(
    () => getTotalCopperAssets(data),
    [data],
  );
  const monthlyStats = useMemo(
    () => getCopperMonthlyStats(data.transactions),
    [data.transactions],
  );
  const chartData = useMemo(
    () => getCopperChartData(data.transactions, data.inventoryCost),
    [data.inventoryCost, data.transactions],
  );
  const trendSummary = useMemo(() => {
    const flowData = chartData.map((item, index, allItems) => {
      const trendWindow = allItems.slice(Math.max(0, index - 2), index + 1);
      const profitTrend =
        trendWindow.reduce((total, current) => total + current.profit, 0) /
        trendWindow.length;

      return {
        ...item,
        profitTrend: Number(profitTrend.toFixed(2)),
      };
    });
    const lastPoint = chartData.at(-1);
    const firstPoint = chartData[0];
    const totals = chartData.reduce(
      (result, item) => ({
        income: result.income + item.income,
        profit: result.profit + item.profit,
      }),
      { income: 0, profit: 0 },
    );
    const bestProfitDay = chartData.reduce<(typeof chartData)[number] | null>(
      (best, item) => (!best || item.profit > best.profit ? item : best),
      null,
    );

    return {
      bestProfitDay,
      flowData,
      inventoryChange:
        lastPoint && firstPoint ? lastPoint.inventoryCost - firstPoint.inventoryCost : 0,
      totalIncome: totals.income,
      totalProfit: totals.profit,
    };
  }, [chartData]);
  const lockedLegacyCount = useMemo(
    () => data.transactions.filter((transaction) => transaction.isLegacyLocked).length,
    [data.transactions],
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

    if (form.type === 'income') {
      const cost = Number(form.cost);
      if (!Number.isFinite(cost) || cost < 0) {
        alert('请输入有效成本');
        return;
      }

      if (cost > data.inventoryCost) {
        alert('本笔成本不能超过当前库存总成本');
        return;
      }

      setData((prev) =>
        applyCopperTransaction(
          prev,
          createCopperIncomeTransaction({
            amount,
            cost,
            date: form.date,
            desc: form.desc,
            ratios: prev.ratios,
          }),
        ),
      );
    } else {
      if (amount > cashTotal) {
        alert('现金余额不足，无法进货');
        return;
      }

      setData((prev) =>
        applyCopperTransaction(
          prev,
          createCopperExpenseTransaction({
            amount,
            date: form.date,
            desc: form.desc,
            balances: prev.balances,
          }),
        ),
      );
    }

    setForm((prev) => ({ ...prev, amount: '', cost: '', desc: '' }));
  };

  const handleDeleteTransaction = (id: number) => {
    if (!window.confirm('确定删除这条记录吗？资金和库存成本将自动回滚。')) {
      return;
    }

    const transaction = data.transactions.find((item) => item.id === id);
    if (!transaction) {
      return;
    }

    if (transaction.isLegacyLocked || !transaction.cashAllocation) {
      alert('这条旧记录缺少精确资金明细，已锁定删除以避免余额出错。');
      return;
    }

    const nextInventoryCost =
      data.inventoryCost - (transaction.inventoryDelta ?? 0);
    if (nextInventoryCost < 0) {
      alert('这笔进货可能已被后续销售消耗，不能直接删除。');
      return;
    }

    setData((prev) => rollbackCopperTransaction(prev, transaction));
  };

  const handleSaveSettings = () => {
    const totalRatio = ratioDraft.liquid + ratioDraft.reserve;

    if (totalRatio !== 100) {
      alert('比例总和必须是100%');
      return;
    }

    setData((prev) => ({ ...prev, ratios: ratioDraft }));
    setShowSettings(false);
  };

  const handleInventoryEntry = () => {
    const amount = Number(inventoryEntryAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('请输入有效库存成本');
      return;
    }

    setData((prev) =>
      applyCopperTransaction(
        prev,
        createInventoryAdjustmentTransaction({
          date: getTodayDate(),
          desc: inventoryEntryDesc.trim() || '库存成本补录',
          previousInventoryCost: prev.inventoryCost,
          nextInventoryCost: prev.inventoryCost + amount,
        }),
      ),
    );
    setInventoryEntryAmount('');
    setInventoryEntryDesc('');
    setShowSettings(false);
  };

  const handleInventoryAdjustment = () => {
    const nextInventoryCost = Number(inventoryDraft);
    if (!Number.isFinite(nextInventoryCost) || nextInventoryCost < 0) {
      alert('请输入有效库存成本');
      return;
    }

    if (nextInventoryCost === data.inventoryCost) {
      alert('库存成本没有变化');
      return;
    }

    setData((prev) =>
      applyCopperTransaction(
        prev,
        createInventoryAdjustmentTransaction({
          date: getTodayDate(),
          desc: inventoryAdjustmentDesc,
          previousInventoryCost: prev.inventoryCost,
          nextInventoryCost,
        }),
      ),
    );
    setShowSettings(false);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用导入文件覆盖当前铜钱分账数据吗？余额、比例、库存成本和流水都会被替换。')) {
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target?.result, { type: 'array' });
        const importedData = parseCopperImportWorkbook(workbook, DEFAULT_COPPER_DATA);
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
          <Settings size={14} /> 配置
        </button>
      </div>

      {showSettings && (
        <div className="bg-white p-4 rounded-xl shadow-lg border-t-4 border-stone-400 space-y-4">
          <div>
            <h3 className="font-bold text-sm mb-3">利润分配比例 (总和须为100)</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
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
            </div>
            <button
              onClick={handleSaveSettings}
              className="w-full bg-amber-700 text-white py-1.5 rounded hover:bg-amber-800 text-sm"
            >
              保存比例
            </button>
          </div>

          <div className="pt-4 border-t border-stone-100">
            <h3 className="font-bold text-sm mb-3">库存成本补录</h3>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                type="number"
                value={inventoryEntryAmount}
                onChange={(event) => setInventoryEntryAmount(event.target.value)}
                className="md:w-32 p-1.5 border rounded text-sm"
                placeholder="本笔成本"
              />
              <input
                type="text"
                value={inventoryEntryDesc}
                onChange={(event) => setInventoryEntryDesc(event.target.value)}
                className="flex-1 p-1.5 border rounded text-sm"
                placeholder="备注"
              />
              <button
                onClick={handleInventoryEntry}
                className="px-3 py-1.5 bg-emerald-700 text-white rounded text-sm hover:bg-emerald-800"
              >
                补录库存
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-100">
            <h3 className="font-bold text-sm mb-3">盘点设置总额</h3>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                type="number"
                value={inventoryDraft}
                onChange={(event) => setInventoryDraft(event.target.value)}
                className="md:w-32 p-1.5 border rounded text-sm"
                placeholder="库存成本"
              />
              <input
                type="text"
                value={inventoryAdjustmentDesc}
                onChange={(event) => setInventoryAdjustmentDesc(event.target.value)}
                className="flex-1 p-1.5 border rounded text-sm"
                placeholder="备注"
              />
              <button
                onClick={handleInventoryAdjustment}
                className="px-3 py-1.5 bg-stone-700 text-white rounded text-sm hover:bg-stone-800"
              >
                记录调整
              </button>
            </div>
          </div>

          <div className="pt-3 border-t flex gap-2">
            <button
              onClick={() => exportCopperToExcel(data)}
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
          检测到 {lockedLegacyCount} 条旧版流水缺少精确资金明细。这些记录会保留展示，但禁止删除，避免回滚后余额失真。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-gradient-to-r from-amber-700 to-amber-900 p-3 rounded-xl shadow-sm text-white flex items-center justify-between">
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
          <Coins className="text-amber-200/40 rotate-12" size={32} />
        </div>
        <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase">现金合计</div>
            <div className="text-lg font-bold text-stone-800">¥ {cashTotal.toFixed(2)}</div>
          </div>
          <Wallet size={24} className="text-stone-300" />
        </div>
        <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase">库存成本</div>
            <div className="text-lg font-bold text-emerald-700">¥ {data.inventoryCost.toFixed(2)}</div>
          </div>
          <Package size={24} className="text-emerald-200" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-yellow-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
            <Coins size={12} className="text-yellow-600" /> 流动库
          </span>
          <span className="text-base font-bold text-stone-800">
            ¥ {data.balances.liquid.toFixed(2)}
          </span>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 rounded-full mt-1">
            利润 {data.ratios.liquid}%
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-emerald-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
            <Lock size={12} className="text-emerald-600" /> 存储库
          </span>
          <span className="text-base font-bold text-stone-800">
            ¥ {data.balances.reserve.toFixed(2)}
          </span>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 rounded-full mt-1">
            利润 {data.ratios.reserve}%
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
              进货
            </button>
          </div>

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
          <input
            type="number"
            placeholder="金额"
            value={form.amount}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, amount: event.target.value }))
            }
            className="w-20 bg-transparent text-sm font-bold text-stone-800 placeholder:text-stone-300 focus:outline-none text-right"
          />
          {form.type === 'income' && (
            <>
              <span className="text-stone-300 text-xs">|</span>
              <input
                type="number"
                placeholder="成本"
                value={form.cost}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, cost: event.target.value }))
                }
                className="w-20 bg-transparent text-sm font-bold text-emerald-700 placeholder:text-stone-300 focus:outline-none text-right"
              />
            </>
          )}
          <span className="text-stone-300 text-xs">|</span>
          <input
            type="text"
            placeholder={form.type === 'income' ? '备注...' : '进货备注...'}
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
        <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-amber-700" /> 经营趋势
                </h3>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-stone-400">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500"></span>
                    收入
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded-full bg-blue-500"></span>
                    利润均线
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 rounded-lg bg-stone-100 p-0.5 text-[10px] font-bold">
                {[
                  ['flow', '收利'],
                  ['inventory', '库存'],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setTrendMode(mode as CopperTrendMode)}
                    className={`rounded-md px-2 py-1 transition-colors ${
                      trendMode === mode
                        ? 'bg-white text-stone-800 shadow-sm'
                        : 'text-stone-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-emerald-50 px-2 py-2">
                <div className="text-[9px] font-bold text-emerald-700">近30天收入</div>
                <div className="mt-0.5 text-sm font-bold text-emerald-800">
                  {formatCompactMoney(trendSummary.totalIncome)}
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 px-2 py-2">
                <div className="text-[9px] font-bold text-blue-700">近30天毛利</div>
                <div className="mt-0.5 text-sm font-bold text-blue-800">
                  {formatSignedCompact(trendSummary.totalProfit)}
                </div>
              </div>
              <div className="rounded-lg bg-amber-50 px-2 py-2">
                <div className="text-[9px] font-bold text-amber-700">库存变化</div>
                <div
                  className={`mt-0.5 text-sm font-bold ${
                    trendSummary.inventoryChange >= 0
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}
                >
                  {formatSignedCompact(trendSummary.inventoryChange)}
                </div>
              </div>
            </div>

            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                {trendMode === 'flow' ? (
                  <ComposedChart
                    data={trendSummary.flowData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis
                      dataKey="shortDate"
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={18}
                      tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tickFormatter={(value) => formatCompactAmount(Number(value))}
                      tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      tickLine={false}
                      width={34}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatMoney(Number(value)),
                        name,
                      ]}
                      labelFormatter={(label) => `日期: ${label}`}
                      contentStyle={{
                        borderRadius: '8px',
                        border: 'none',
                        boxShadow: '0 10px 24px -16px rgba(0, 0, 0, 0.35)',
                        fontSize: '11px',
                        padding: '6px 8px',
                      }}
                    />
                    <Bar
                      dataKey="income"
                      name="收入"
                      fill="#10B981"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={14}
                    />
                    <Line
                      type="monotone"
                      dataKey="profitTrend"
                      name="利润均线"
                      stroke="#2563EB"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                ) : (
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis
                      dataKey="shortDate"
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={18}
                      tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      domain={['auto', 'auto']}
                      tickFormatter={(value) => formatCompactAmount(Number(value))}
                      tick={{ fontSize: 9, fill: '#D97706' }}
                      tickLine={false}
                      width={34}
                    />
                    <Tooltip
                      formatter={(value: number) => formatMoney(Number(value))}
                      labelFormatter={(label) => `日期: ${label}`}
                      contentStyle={{
                        borderRadius: '8px',
                        border: 'none',
                        boxShadow: '0 10px 24px -16px rgba(0, 0, 0, 0.35)',
                        fontSize: '11px',
                        padding: '6px 8px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="inventoryCost"
                      name="库存成本"
                      stroke="#D97706"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>

            {trendSummary.bestProfitDay && (
              <div className="flex items-center justify-between rounded-lg bg-stone-50 px-2.5 py-2 text-[10px] text-stone-500">
                <span>最高毛利日</span>
                <span className="font-bold text-stone-700">
                  {trendSummary.bestProfitDay.shortDate} / {formatMoney(trendSummary.bestProfitDay.profit)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {monthlyStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-stone-100">
          <div className="px-3 py-2 border-b border-stone-100 bg-stone-50 flex items-center gap-2">
            <Table size={12} className="text-stone-500" />
            <h3 className="font-bold text-[10px] text-stone-700">月度经营汇总</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-50 text-stone-500 font-medium">
                <tr>
                  <th className="px-3 py-1.5">月份</th>
                  <th className="px-3 py-1.5 text-emerald-600">收入</th>
                  <th className="px-3 py-1.5">成本</th>
                  <th className="px-3 py-1.5 text-blue-600">毛利润</th>
                  <th className="px-3 py-1.5 text-red-500">进货</th>
                  <th className="px-3 py-1.5 text-right">现金变化</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {monthlyStats.map((stat) => (
                  <tr key={stat.month} className="hover:bg-stone-50 transition-colors">
                    <td className="px-3 py-1.5 font-medium text-stone-700">{stat.month}</td>
                    <td className="px-3 py-1.5 text-emerald-600">+{stat.income.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-stone-600">{stat.cost.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 font-bold ${stat.profit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {formatSigned(stat.profit)}
                    </td>
                    <td className="px-3 py-1.5 text-red-500">-{stat.purchase.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-right font-bold ${stat.cashNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatSigned(stat.cashNet)}
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
          {[...data.transactions].reverse().slice(0, 10).map((transaction) => {
            const isIncome = transaction.type === 'income';
            const isAdjustment = transaction.type === 'inventory_adjustment';
            const amountLabel = isAdjustment
              ? formatSigned(transaction.inventoryDelta ?? 0)
              : `${isIncome ? '+' : '-'}${transaction.amount.toFixed(2)}`;

            return (
              <li
                key={transaction.id}
                className="bg-white px-3 py-2 rounded-lg shadow-sm flex justify-between items-center border border-stone-100 group"
              >
                <div>
                  <div className="font-medium text-stone-800 text-xs">{transaction.desc}</div>
                  <div className="text-[10px] text-stone-400 flex items-center gap-1 flex-wrap">
                    {formatCopperTransactionDate(transaction.date)}
                    <span className="px-1 bg-stone-50 rounded text-stone-500 scale-90 origin-left">
                      {getCopperTransactionKindLabel(transaction)}
                    </span>
                    {isIncome && (
                      <span className="px-1 bg-emerald-50 rounded text-emerald-700 scale-90 origin-left">
                        成本 {(transaction.cost ?? 0).toFixed(2)} / 利润 {formatSigned(transaction.profit ?? transaction.amount)}
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
                  <div className={`text-xs font-bold ${
                    isAdjustment
                      ? 'text-amber-700'
                      : isIncome
                        ? 'text-emerald-600'
                        : 'text-red-500'
                  }`}>
                    {amountLabel}
                  </div>
                  <button
                    onClick={() => handleDeleteTransaction(transaction.id)}
                    className={`p-1 rounded transition-colors opacity-0 group-hover:opacity-100 ${
                      transaction.isLegacyLocked
                        ? 'text-stone-200 cursor-not-allowed'
                        : 'text-stone-300 hover:text-red-500'
                    }`}
                    title={transaction.isLegacyLocked ? '历史锁定记录不可删除' : '删除'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
          {data.transactions.length === 0 && (
            <li className="text-center text-stone-400 py-4 text-xs">暂无记录</li>
          )}
        </ul>
      </div>
    </div>
  );
};
