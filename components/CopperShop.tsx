import React, { useState, useEffect, useMemo } from 'react';
import { CopperData, Transaction } from '../types';
import { Download, Upload, Settings, Coins, Lock, Archive, PlusCircle, MinusCircle, Table, Trash2 } from 'lucide-react';
import { exportCopperToExcel } from '../utils/excel';
import * as XLSX from 'xlsx';

const INITIAL_DATA: CopperData = {
  ratios: { liquid: 70, reserve: 20, collection: 10 },
  balances: { liquid: 4.00, reserve: 100.00, collection: 6.00 },
  transactions: []
};

export const CopperShop: React.FC = () => {
  const [data, setData] = useState<CopperData>(() => {
    const saved = localStorage.getItem('coinShopData_v5');
    return saved ? JSON.parse(saved) : INITIAL_DATA;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState({ amount: '', desc: '', type: 'income', source: 'liquid' });

  useEffect(() => {
    localStorage.setItem('coinShopData_v5', JSON.stringify(data));
  }, [data]);

  // Monthly Summary Calculation
  const monthlyStats = useMemo(() => {
    const stats: Record<string, { income: number; expense: number }> = {};
    data.transactions.forEach(tx => {
      // Extract YYYY-MM
      const monthKey = tx.date.substring(0, 7);
      if (!stats[monthKey]) {
        stats[monthKey] = { income: 0, expense: 0 };
      }
      if (tx.type === 'income') {
        stats[monthKey].income += tx.amount;
      } else {
        stats[monthKey].expense += tx.amount;
      }
    });

    // Sort by month descending
    return Object.entries(stats)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, { income, expense }]) => ({
        month,
        income,
        expense,
        net: income - expense
      }));
  }, [data.transactions]);

  const handleAddTransaction = () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return alert("请输入有效金额");

    const newTx: Transaction = {
      id: Date.now(),
      date: new Date().toISOString(),
      type: form.type as 'income' | 'expense',
      amount,
      desc: form.desc || (form.type === 'income' ? '生意收入' : '生意支出'),
      source: form.type === 'expense' ? (form.source as any) : undefined
    };

    const newBalances = { ...data.balances };

    if (newTx.type === 'income') {
      // Auto split logic
      newBalances.liquid += amount * (data.ratios.liquid / 100);
      newBalances.reserve += amount * (data.ratios.reserve / 100);
      newBalances.collection += amount * (data.ratios.collection / 100);
    } else {
      // Deduct from specific source
      newBalances[form.source as keyof typeof newBalances] -= amount;
    }

    setData({
      ...data,
      balances: newBalances,
      transactions: [...data.transactions, newTx]
    });

    setForm({ ...form, amount: '', desc: '' });
  };

  const handleDeleteTransaction = (id: number) => {
    if (!window.confirm("确定删除这条记录吗？资金将自动回滚。")) return;

    const tx = data.transactions.find(t => t.id === id);
    if (!tx) return;

    const newBalances = { ...data.balances };

    if (tx.type === 'income') {
      // Reverse income: deduct using CURRENT ratios
      // Note: Ideally we should use historical ratios, but for simplicity V5 uses current config
      newBalances.liquid -= tx.amount * (data.ratios.liquid / 100);
      newBalances.reserve -= tx.amount * (data.ratios.reserve / 100);
      newBalances.collection -= tx.amount * (data.ratios.collection / 100);
    } else {
      // Reverse expense: add back to source
      if (tx.source) {
        newBalances[tx.source] += tx.amount;
      }
    }

    setData({
      ...data,
      balances: newBalances,
      transactions: data.transactions.filter(t => t.id !== id)
    });
  };

  const handleSaveSettings = (r1: number, r2: number, r3: number) => {
    if (r1 + r2 + r3 !== 100) return alert("比例总和必须是100%");
    setData({ ...data, ratios: { liquid: r1, reserve: r2, collection: r3 } });
    setShowSettings(false);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("确定覆盖现有数据吗？")) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        
        // Basic import logic - assumes strict template adherence
        const statusSheet = wb.Sheets["资产状态"];
        if(statusSheet) {
          const statusArr: any[] = XLSX.utils.sheet_to_json(statusSheet);
          const newBalances = { ...data.balances };
          statusArr.forEach(row => {
            if (row['项目'] === "流动库") newBalances.liquid = Number(row['金额']);
            if (row['项目'] === "存储库") newBalances.reserve = Number(row['金额']);
            if (row['项目'] === "收藏库") newBalances.collection = Number(row['金额']);
          });
          setData({ ...data, balances: newBalances, transactions: [] }); // Reset tx history on simple import
          alert("导入成功 (仅恢复余额)");
        }
      } catch (err) {
        alert("导入失败，格式不正确");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-center border-b pb-4 border-stone-300">
        <h1 className="text-2xl font-bold text-amber-900 flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 bg-amber-700 rounded-full"></div>
            <div className="absolute inset-2 bg-[#F5F5F0] rounded-sm"></div>
          </div>
          铜钱分账系统
        </h1>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-2 px-3 py-1.5 text-stone-600 border border-stone-300 rounded hover:bg-stone-100 transition-colors"
        >
          <Settings size={16} /> 比例配置
        </button>
      </div>

      {/* Settings Modal (Inline) */}
      {showSettings && (
        <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-stone-400">
          <h3 className="font-bold text-lg mb-4">配置比例 (总和须为100)</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm text-stone-500 mb-1">流动库 %</label>
              <input type="number" defaultValue={data.ratios.liquid} id="r1" className="w-full p-2 border rounded" />
            </div>
            <div>
              <label className="block text-sm text-stone-500 mb-1">存储库 %</label>
              <input type="number" defaultValue={data.ratios.reserve} id="r2" className="w-full p-2 border rounded" />
            </div>
            <div>
              <label className="block text-sm text-stone-500 mb-1">收藏库 %</label>
              <input type="number" defaultValue={data.ratios.collection} id="r3" className="w-full p-2 border rounded" />
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => {
                const r1 = Number((document.getElementById('r1') as HTMLInputElement).value);
                const r2 = Number((document.getElementById('r2') as HTMLInputElement).value);
                const r3 = Number((document.getElementById('r3') as HTMLInputElement).value);
                handleSaveSettings(r1, r2, r3);
              }}
              className="flex-1 bg-amber-700 text-white py-2 rounded hover:bg-amber-800"
            >
              保存配置
            </button>
          </div>
          <div className="mt-4 pt-4 border-t flex gap-3">
            <button onClick={() => exportCopperToExcel(data)} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
              <Download size={16} /> 导出Excel
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-stone-500 text-white rounded text-sm hover:bg-stone-600 cursor-pointer">
              <Upload size={16} /> 导入Excel
              <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
            </label>
          </div>
        </div>
      )}

      {/* Jars Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-yellow-600 text-center">
          <div className="flex justify-center mb-2 text-yellow-600"><Coins size={28} /></div>
          <h3 className="font-bold text-stone-600">🌊 流动库</h3>
          <div className="text-2xl font-bold mt-2">¥ {data.balances.liquid.toFixed(2)}</div>
          <div className="text-xs text-stone-400 mt-1">占比 {data.ratios.liquid}%</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-emerald-600 text-center">
          <div className="flex justify-center mb-2 text-emerald-600"><Lock size={28} /></div>
          <h3 className="font-bold text-stone-600">🔒 存储库</h3>
          <div className="text-2xl font-bold mt-2">¥ {data.balances.reserve.toFixed(2)}</div>
          <div className="text-xs text-stone-400 mt-1">占比 {data.ratios.reserve}%</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-amber-900 text-center">
          <div className="flex justify-center mb-2 text-amber-900"><Archive size={28} /></div>
          <h3 className="font-bold text-stone-600">🧿 收藏库</h3>
          <div className="text-2xl font-bold mt-2">¥ {data.balances.collection.toFixed(2)}</div>
          <div className="text-xs text-stone-400 mt-1">占比 {data.ratios.collection}%</div>
        </div>
      </div>

      {/* Input Section */}
      <div className="bg-white p-6 rounded-xl shadow-md">
        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><PlusCircle size={20} className="text-amber-700"/> 生意记账</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <select 
            value={form.type} 
            onChange={e => setForm({...form, type: e.target.value})}
            className="p-3 border rounded-lg bg-stone-50"
          >
            <option value="income">收入 (自动分账)</option>
            <option value="expense">支出</option>
          </select>
          
          {form.type === 'expense' && (
            <select 
              value={form.source} 
              onChange={e => setForm({...form, source: e.target.value})}
              className="p-3 border rounded-lg bg-stone-50"
            >
              <option value="liquid">从 流动库 扣款</option>
              <option value="reserve">从 存储库 扣款</option>
              <option value="collection">从 收藏库 扣款</option>
            </select>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input 
            type="number" 
            placeholder="金额" 
            value={form.amount}
            onChange={e => setForm({...form, amount: e.target.value})}
            className="p-3 border rounded-lg text-lg"
          />
          <input 
            type="text" 
            placeholder="备注：如 卖出一枚康熙通宝" 
            value={form.desc}
            onChange={e => setForm({...form, desc: e.target.value})}
            className="p-3 border rounded-lg"
          />
        </div>

        <button 
          onClick={handleAddTransaction}
          className="w-full py-3 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-lg transition-colors"
        >
          确认提交
        </button>
      </div>

      {/* Monthly Summary Table */}
      {monthlyStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-4 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
            <Table size={18} className="text-stone-500" />
            <h3 className="font-bold text-stone-700">月度收支汇总</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-stone-50 text-stone-500 font-medium">
                <tr>
                  <th className="px-4 py-3">月份</th>
                  <th className="px-4 py-3 text-emerald-600">总收入</th>
                  <th className="px-4 py-3 text-red-500">总支出</th>
                  <th className="px-4 py-3 text-right">净收益</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {monthlyStats.map((stat) => (
                  <tr key={stat.month} className="hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-700">{stat.month}</td>
                    <td className="px-4 py-3 text-emerald-600">+{stat.income.toFixed(2)}</td>
                    <td className="px-4 py-3 text-red-500">-{stat.expense.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${stat.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {stat.net >= 0 ? '+' : ''}{stat.net.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div>
        <h2 className="text-lg font-bold text-stone-700 mb-3">📜 近期生意流水</h2>
        <ul className="space-y-3">
          {[...data.transactions].reverse().slice(0, 10).map((tx) => (
            <li key={tx.id} className="bg-white p-4 rounded-lg shadow-sm flex justify-between items-center border-l-4 border-stone-200 group">
              <div>
                <div className="font-medium text-stone-800">{tx.desc}</div>
                <div className="text-xs text-stone-400">
                  {new Date(tx.date).toLocaleDateString()} 
                  {tx.type === 'expense' && <span className="ml-2 px-1 bg-stone-100 rounded text-stone-500">{tx.source === 'liquid' ? '流动' : tx.source === 'reserve' ? '存储' : '收藏'}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-lg font-bold ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                </div>
                <button 
                  onClick={() => handleDeleteTransaction(tx.id)}
                  className="text-stone-300 hover:text-red-500 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="删除"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
          {data.transactions.length === 0 && <li className="text-center text-stone-400 py-4">暂无记录</li>}
        </ul>
      </div>
    </div>
  );
};