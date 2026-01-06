import React, { useState, useEffect, useMemo } from 'react';
import { CopperData, Transaction } from '../types';
import { Download, Upload, Settings, Coins, Lock, Archive, PlusCircle, Table, Trash2, Wallet, TrendingUp, ArrowRight, ArrowRightCircle, Calendar } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
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
  const [form, setForm] = useState({ 
    amount: '', 
    desc: '', 
    type: 'income', 
    source: 'liquid',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    localStorage.setItem('coinShopData_v5', JSON.stringify(data));
  }, [data]);

  // Calculations
  const totalAssets = useMemo(() => {
    return data.balances.liquid + data.balances.reserve + data.balances.collection;
  }, [data.balances]);

  // Monthly Summary Calculation (For Table)
  const monthlyStats = useMemo(() => {
    const stats: Record<string, { income: number; expense: number }> = {};
    data.transactions.forEach(tx => {
      // Extract YYYY-MM
      // Ensure we handle ISO strings safely
      const dateStr = tx.date.split('T')[0];
      const monthKey = dateStr.substring(0, 7);
      if (!stats[monthKey]) {
        stats[monthKey] = { income: 0, expense: 0 };
      }
      if (tx.type === 'income') {
        stats[monthKey].income += tx.amount;
      } else {
        stats[monthKey].expense += tx.amount;
      }
    });

    // Sort by month descending for table
    return Object.entries(stats)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, { income, expense }]) => ({
        month,
        income,
        expense,
        net: income - expense
      }));
  }, [data.transactions]);

  // Daily Stats for Chart (Trend by Day + Running Assets)
  const chartData = useMemo(() => {
    const dailyNetChange: Record<string, number> = {};
    const dailyIncome: Record<string, number> = {};
    const dailyExpense: Record<string, number> = {};

    data.transactions.forEach(tx => {
       // Fix: Normalize date to YYYY-MM-DD to handle ISO strings with time
       const d = tx.date.split('T')[0]; 
       if (!dailyNetChange[d]) {
         dailyNetChange[d] = 0;
         dailyIncome[d] = 0;
         dailyExpense[d] = 0;
       }
       if (tx.type === 'income') {
         dailyNetChange[d] += tx.amount;
         dailyIncome[d] += tx.amount;
       } else {
         dailyNetChange[d] -= tx.amount;
         dailyExpense[d] += tx.amount;
       }
    });

    // Unique sorted dates (Descending for calculation)
    const allDates = Object.keys(dailyNetChange).sort((a, b) => b.localeCompare(a));
    
    // Calculate historical assets working backwards from current
    let runningAsset = totalAssets;
    const history: any[] = [];

    // Iterating backwards (newest to oldest) to reconstruct history from current balance
    for (const d of allDates) {
        history.push({
            date: d,
            shortDate: d.substring(5), // "MM-DD"
            assets: runningAsset,
            income: dailyIncome[d],
            expense: dailyExpense[d]
        });
        // Restore asset state for previous day 
        runningAsset -= dailyNetChange[d];
    }

    // Return last 30 entries (reversed to be ascending time for chart)
    return history.reverse().slice(-30);
  }, [data.transactions, totalAssets]);

  const handleAddTransaction = () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return alert("请输入有效金额");
    if (!form.date) return alert("请选择日期");

    const newTx: Transaction = {
      id: Date.now(),
      date: form.date,
      type: form.type as 'income' | 'expense',
      amount,
      desc: form.desc || (form.type === 'income' ? '生意收入' : '生意支出'),
      source: form.type === 'expense' ? (form.source as any) : undefined
    };

    const newBalances = { ...data.balances };

    if (newTx.type === 'income') {
      newBalances.liquid += amount * (data.ratios.liquid / 100);
      newBalances.reserve += amount * (data.ratios.reserve / 100);
      newBalances.collection += amount * (data.ratios.collection / 100);
    } else {
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
      newBalances.liquid -= tx.amount * (data.ratios.liquid / 100);
      newBalances.reserve -= tx.amount * (data.ratios.reserve / 100);
      newBalances.collection -= tx.amount * (data.ratios.collection / 100);
    } else {
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
        
        const statusSheet = wb.Sheets["资产状态"];
        if(statusSheet) {
          const statusArr: any[] = XLSX.utils.sheet_to_json(statusSheet);
          const newBalances = { ...data.balances };
          statusArr.forEach(row => {
            if (row['项目'] === "流动库") newBalances.liquid = Number(row['金额']);
            if (row['项目'] === "存储库") newBalances.reserve = Number(row['金额']);
            if (row['项目'] === "收藏库") newBalances.collection = Number(row['金额']);
          });
          setData({ ...data, balances: newBalances, transactions: [] });
          alert("导入成功 (仅恢复余额)");
        }
      } catch (err) {
        alert("导入失败，格式不正确");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex justify-between items-center border-b pb-3 border-stone-200">
        <h1 className="text-xl font-bold text-amber-900 flex items-center gap-2">
          <div className="relative w-6 h-6">
            <div className="absolute inset-0 bg-amber-700 rounded-full"></div>
            <div className="absolute inset-1.5 bg-[#F5F5F0] rounded-sm"></div>
          </div>
          铜钱分账
        </h1>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-stone-600 border border-stone-300 rounded hover:bg-stone-100 transition-colors"
        >
          <Settings size={14} /> 比例配置
        </button>
      </div>

      {/* Settings Modal (Inline) */}
      {showSettings && (
        <div className="bg-white p-4 rounded-xl shadow-lg border-t-4 border-stone-400">
          <h3 className="font-bold text-sm mb-3">配置比例 (总和须为100)</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-stone-500 mb-1">流动库 %</label>
              <input type="number" defaultValue={data.ratios.liquid} id="r1" className="w-full p-1.5 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">存储库 %</label>
              <input type="number" defaultValue={data.ratios.reserve} id="r2" className="w-full p-1.5 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">收藏库 %</label>
              <input type="number" defaultValue={data.ratios.collection} id="r3" className="w-full p-1.5 border rounded text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                const r1 = Number((document.getElementById('r1') as HTMLInputElement).value);
                const r2 = Number((document.getElementById('r2') as HTMLInputElement).value);
                const r3 = Number((document.getElementById('r3') as HTMLInputElement).value);
                handleSaveSettings(r1, r2, r3);
              }}
              className="flex-1 bg-amber-700 text-white py-1.5 rounded hover:bg-amber-800 text-sm"
            >
              保存配置
            </button>
          </div>
          <div className="mt-3 pt-3 border-t flex gap-2">
            <button onClick={() => exportCopperToExcel(data)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
              <Download size={14} /> 导出Excel
            </button>
            <label className="flex items-center gap-1 px-3 py-1.5 bg-stone-500 text-white rounded text-xs hover:bg-stone-600 cursor-pointer">
              <Upload size={14} /> 导入Excel
              <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
            </label>
          </div>
        </div>
      )}

      {/* Total Assets & Jars Compact Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-4 bg-gradient-to-r from-amber-700 to-amber-900 p-3 rounded-xl shadow-sm text-white flex items-center justify-between">
             <div className="flex items-center gap-3">
                <div className="p-1.5 bg-white/10 rounded-full">
                  <Wallet size={18} className="text-white" />
                </div>
                <div>
                   <div className="text-amber-100 text-[10px] font-medium uppercase tracking-wider">Total Assets</div>
                   <div className="text-xl font-bold leading-none">¥ {totalAssets.toFixed(2)}</div>
                </div>
             </div>
             <div className="text-amber-200/50 text-3xl opacity-20 rotate-12">
                <Coins />
             </div>
          </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Liquid Jar */}
        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-yellow-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <div className="flex flex-col items-center w-full">
             <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
                <Coins size={12} className="text-yellow-600"/> 流动库
             </span>
             <span className="text-base font-bold text-stone-800">¥ {data.balances.liquid.toFixed(0)}</span>
          </div>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">{data.ratios.liquid}%</div>
        </div>

        {/* Reserve Jar */}
        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-emerald-600 text-center flex flex-col items-center justify-between min-h-[80px]">
          <div className="flex flex-col items-center w-full">
             <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
                <Lock size={12} className="text-emerald-600"/> 存储库
             </span>
             <span className="text-base font-bold text-stone-800">¥ {data.balances.reserve.toFixed(0)}</span>
          </div>
          <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">{data.ratios.reserve}%</div>
        </div>

        {/* Collection Jar */}
        <div className="bg-white p-2 rounded-lg shadow-sm border-t-2 border-amber-900 text-center flex flex-col items-center justify-between min-h-[80px]">
           <div className="flex flex-col items-center w-full">
             <span className="text-[10px] font-bold text-stone-500 flex items-center justify-center gap-1 mb-1 w-full border-b border-dashed border-stone-100 pb-1">
                <Archive size={12} className="text-amber-900"/> 收藏库
             </span>
             <span className="text-base font-bold text-stone-800">¥ {data.balances.collection.toFixed(0)}</span>
           </div>
           <div className="text-[10px] text-stone-400 bg-stone-50 px-1.5 py-0 rounded-full mt-1">{data.ratios.collection}%</div>
        </div>
      </div>

      {/* Super Compact Input Section (Toolbar Style) */}
      <div className="bg-white p-2 rounded-xl shadow-sm border border-stone-200 flex flex-col md:flex-row items-stretch md:items-center gap-2">
         {/* Left Group: Type & Date */}
         <div className="flex items-center gap-2 bg-stone-50 p-1 rounded-lg">
            <div className="flex bg-white rounded-md shadow-sm border border-stone-100 overflow-hidden">
               <button
                 onClick={() => setForm({...form, type: 'income'})}
                 className={`px-3 py-1.5 text-xs font-bold transition-colors ${form.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
               >
                 收
               </button>
               <div className="w-px bg-stone-100"></div>
               <button
                 onClick={() => setForm({...form, type: 'expense'})}
                 className={`px-3 py-1.5 text-xs font-bold transition-colors ${form.type === 'expense' ? 'bg-red-50 text-red-500' : 'text-stone-400 hover:bg-stone-50'}`}
               >
                 支
               </button>
            </div>
            
            <div className="h-4 w-px bg-stone-200 mx-1 hidden md:block"></div>

            <div className="relative flex-1 md:flex-none">
               <input 
                  type="date"
                  value={form.date}
                  onChange={e => setForm({...form, date: e.target.value})}
                  className="w-full md:w-32 bg-transparent text-xs text-stone-600 font-medium focus:outline-none cursor-pointer pl-6 py-1 min-w-[7.5rem]"
               />
               <Calendar size={12} className="absolute left-1 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"/>
            </div>
         </div>

         {/* Right Group: Details & Action */}
         <div className="flex flex-1 items-center gap-2 bg-stone-50 p-1 rounded-lg">
             {form.type === 'expense' && (
               <select 
                  value={form.source} 
                  onChange={e => setForm({...form, source: e.target.value})}
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
               onChange={e => setForm({...form, amount: e.target.value})}
               className="w-20 bg-transparent text-sm font-bold text-stone-800 placeholder:text-stone-300 focus:outline-none text-right"
            />
            <span className="text-stone-300 text-xs">|</span>
            <input 
               type="text" 
               placeholder="备注..." 
               value={form.desc}
               onChange={e => setForm({...form, desc: e.target.value})}
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

      {/* Chart Section */}
      {chartData.length > 0 && (
        <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 h-56 relative">
           <h3 className="absolute top-3 left-3 text-[10px] font-bold text-stone-400 flex items-center gap-1">
              <TrendingUp size={10}/> 收支趋势 (近30天)
           </h3>
           <ResponsiveContainer width="100%" height="100%">
             <LineChart data={chartData} margin={{ top: 20, right: 30, left: -25, bottom: 0 }}>
               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
               <XAxis dataKey="shortDate" tick={{fontSize: 9, fill: '#9CA3AF'}} axisLine={false} tickLine={false} />
               {/* Primary Axis for Income/Expense */}
               <YAxis yAxisId="left" tick={{fontSize: 9, fill: '#9CA3AF'}} axisLine={false} tickLine={false} />
               {/* Secondary Axis for Total Assets */}
               <YAxis yAxisId="right" orientation="right" tick={{fontSize: 9, fill: '#F59E0B'}} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
               
               <Tooltip 
                 formatter={(value: number) => value.toFixed(1)}
                 labelFormatter={(label) => `日期: ${label}`}
                 contentStyle={{borderRadius: '6px', border: 'none', boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)', fontSize: '11px', padding: '4px 8px'}} 
               />
               <Legend verticalAlign="top" height={24} iconSize={6} wrapperStyle={{fontSize: '10px', right: 0, top: 0}} />
               
               <Line yAxisId="left" type="monotone" name="收入" dataKey="income" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{r: 3}} />
               <Line yAxisId="left" type="monotone" name="支出" dataKey="expense" stroke="#EF4444" strokeWidth={2} dot={false} activeDot={{r: 3}} />
               <Line yAxisId="right" type="monotone" name="总资产" dataKey="assets" stroke="#F59E0B" strokeWidth={2} strokeDasharray="3 3" dot={false} activeDot={{r: 3}} />
             </LineChart>
           </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Summary Table */}
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
        <h2 className="text-[10px] font-bold text-stone-400 mb-2 uppercase tracking-wider">Recent Transactions</h2>
        <ul className="space-y-1.5">
          {[...data.transactions].reverse().slice(0, 10).map((tx) => (
            <li key={tx.id} className="bg-white px-3 py-2 rounded-lg shadow-sm flex justify-between items-center border border-stone-100 group">
              <div>
                <div className="font-medium text-stone-800 text-xs">{tx.desc}</div>
                <div className="text-[10px] text-stone-400 flex items-center gap-1">
                  {new Date(tx.date).toLocaleDateString()} 
                  {tx.type === 'expense' && <span className="px-1 bg-stone-50 rounded text-stone-500 scale-90 origin-left">{tx.source === 'liquid' ? '流动' : tx.source === 'reserve' ? '存储' : '收藏'}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`text-xs font-bold ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                </div>
                <button 
                  onClick={() => handleDeleteTransaction(tx.id)}
                  className="text-stone-300 hover:text-red-500 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
          {data.transactions.length === 0 && <li className="text-center text-stone-400 py-4 text-xs">暂无记录</li>}
        </ul>
      </div>
    </div>
  );
};