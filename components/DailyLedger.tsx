import React, { useState, useEffect, useMemo } from 'react';
import { DailyData, Transaction } from '../types';
import { ChevronLeft, ChevronRight, Download, Upload, Calendar, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { exportDailyToExcel } from '../utils/excel';
import * as XLSX from 'xlsx';

const INITIAL_DATA: DailyData = {
  dailyLimit: 30,
  transactions: []
};

export const DailyLedger: React.FC = () => {
  const [data, setData] = useState<DailyData>(() => {
    const saved = localStorage.getItem('dailyBookData_v5');
    return saved ? JSON.parse(saved) : INITIAL_DATA;
  });

  // Date State
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [showPicker, setShowPicker] = useState(false);

  // Form State
  const [form, setForm] = useState({ 
    amount: '', 
    desc: '', 
    type: 'expense', 
    date: today.toISOString().split('T')[0] 
  });

  useEffect(() => {
    localStorage.setItem('dailyBookData_v5', JSON.stringify(data));
  }, [data]);

  // Calculations
  const monthTransactions = useMemo(() => {
    const prefix = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;
    return data.transactions.filter(t => t.date.startsWith(prefix));
  }, [data.transactions, currentYear, currentMonth]);

  const { income, expense, balance } = useMemo(() => {
    let inc = 0, exp = 0;
    monthTransactions.forEach(t => t.type === 'income' ? inc += t.amount : exp += t.amount);
    return { income: inc, expense: exp, balance: inc - exp };
  }, [monthTransactions]);

  const todaySpent = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return data.transactions
      .filter(t => t.type === 'expense' && t.date === todayStr)
      .reduce((acc, t) => acc + t.amount, 0);
  }, [data.transactions]);

  const chartData = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const map = new Map<number, number>();
    for(let i=1; i<=daysInMonth; i++) map.set(i, 0);
    
    monthTransactions.forEach(t => {
      if (t.type === 'expense') {
        const d = parseInt(t.date.split('-')[2]);
        map.set(d, (map.get(d) || 0) + t.amount);
      }
    });

    return Array.from(map.entries()).map(([day, amount]) => ({ day, amount }));
  }, [monthTransactions, currentYear, currentMonth]);

  // Actions
  const handleAddTx = () => {
    const amount = parseFloat(form.amount);
    if (!amount || !form.date) return alert("请完善信息");
    
    const newTx: Transaction = {
      id: Date.now(),
      date: form.date,
      type: form.type as 'income' | 'expense',
      amount,
      desc: form.desc || (form.type === 'expense' ? '日常支出' : '额外收入')
    };

    setData(prev => ({ ...prev, transactions: [...prev.transactions, newTx] }));
    
    // Switch view to the transaction date
    const d = new Date(form.date);
    setCurrentYear(d.getFullYear());
    setCurrentMonth(d.getMonth() + 1);
    
    setForm(prev => ({ ...prev, amount: '', desc: '' }));
  };

  const handleDeleteTx = (id: number) => {
    if (!window.confirm("确定删除这条记录吗？")) return;
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id)
    }));
  };

  const calculateMonthBalanceForPicker = (year: number, month: number) => {
    const prefix = `${year}-${month.toString().padStart(2, '0')}`;
    let bal = 0;
    let hasTx = false;
    data.transactions.forEach(t => {
      if (t.date.startsWith(prefix)) {
        hasTx = true;
        if (t.type === 'income') bal += t.amount;
        else bal -= t.amount;
      }
    });
    return { bal, hasTx };
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, {type: 'array'});
          const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          const newTxs = jsonData.map((r: any) => ({ 
            id: Date.now() + Math.random(), 
            date: r['日期'] || r['date'], 
            type: r['类型'] === '收入' ? 'income' : 'expense', 
            amount: Number(r['金额']), 
            desc: r['备注'] 
          })) as Transaction[];
          
          setData(prev => ({...prev, transactions: [...prev.transactions, ...newTxs]}));
          alert("导入成功");
        } catch(err) { alert("导入失败"); }
      };
      reader.readAsArrayBuffer(file);
  };

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex justify-between items-center border-b pb-4 border-blue-200">
        <h1 className="text-2xl font-bold text-blue-700 flex items-center gap-3">
           <Calendar className="text-blue-500" />
           日常月度账本
        </h1>
      </div>

      {/* Custom Month Picker Bar */}
      <div className="relative z-20">
        <div 
          onClick={() => setShowPicker(!showPicker)}
          className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:bg-blue-100 transition-colors select-none"
        >
          <div className="flex items-center gap-2 text-xl font-bold text-blue-800">
             {currentYear}年{currentMonth}月 <span className="text-xs align-middle">▼</span>
          </div>
          <div className="text-right">
             <div className="text-xs text-blue-400">本月结余</div>
             <div className={`font-bold text-lg ${balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {balance >= 0 ? '+' : ''}{balance.toFixed(2)}
             </div>
          </div>
        </div>

        {/* Picker Dropdown */}
        {showPicker && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-stone-200 shadow-2xl rounded-xl p-4 z-50">
            <div className="flex justify-between items-center mb-4">
              <button onClick={() => setPickerYear(p => p - 1)} className="p-1 hover:bg-stone-100 rounded"><ChevronLeft /></button>
              <span className="font-bold text-lg">{pickerYear}</span>
              <button onClick={() => setPickerYear(p => p + 1)} className="p-1 hover:bg-stone-100 rounded"><ChevronRight /></button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                const { bal, hasTx } = calculateMonthBalanceForPicker(pickerYear, m);
                const isActive = pickerYear === currentYear && m === currentMonth;
                
                // Determine badge style
                let badgeStyle = '';
                if (isActive) {
                    badgeStyle = 'bg-white/20 text-white';
                } else if (!hasTx) {
                    badgeStyle = 'bg-stone-100 text-stone-400'; // Gray for no record
                } else if (bal >= 0) {
                    badgeStyle = 'bg-emerald-100 text-emerald-700'; // Green for positive
                } else {
                    badgeStyle = 'bg-red-100 text-red-700'; // Red for negative
                }

                return (
                  <div 
                    key={m}
                    onClick={() => {
                      setCurrentYear(pickerYear);
                      setCurrentMonth(m);
                      setShowPicker(false);
                    }}
                    className={`
                      flex flex-col items-center justify-center p-2 rounded-lg cursor-pointer border transition-all
                      ${isActive ? 'bg-blue-500 text-white border-blue-600' : 'bg-white hover:bg-stone-50 border-transparent'}
                    `}
                  >
                    <span className="font-bold text-sm">{m}月</span>
                    <span className={`text-[10px] px-1.5 rounded-full mt-1 ${badgeStyle}`}>
                       {!hasTx ? '0' : (bal > 0 ? '+' : '') + bal.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Overview */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-stone-100">
           <h3 className="text-stone-500 font-bold text-sm mb-3">📊 收支概览</h3>
           <div className="flex justify-between items-end">
             <div>
                <div className="text-xs text-stone-400">总收入</div>
                <div className="text-xl font-bold text-emerald-600">+{income.toFixed(2)}</div>
             </div>
             <div className="text-right">
                <div className="text-xs text-stone-400">总支出</div>
                <div className="text-xl font-bold text-red-500">-{expense.toFixed(2)}</div>
             </div>
           </div>
        </div>

        {/* Daily Limit */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-stone-100">
          <h3 className="text-stone-500 font-bold text-sm mb-2">⚡ 今日额度监控</h3>
          <div className="flex justify-between items-center">
            <div>
              <span className="text-2xl font-bold text-stone-800">{todaySpent.toFixed(2)}</span>
              <span className="text-stone-400 text-sm ml-2">/ 今日已用</span>
            </div>
            <div className={`flex items-center gap-1 text-sm font-bold ${todaySpent > data.dailyLimit ? 'text-red-500' : 'text-emerald-600'}`}>
              {todaySpent > data.dailyLimit ? <AlertTriangle size={16}/> : <CheckCircle size={16}/>}
              {todaySpent > data.dailyLimit ? '严重超支' : '状态正常'}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-stone-500">
            <span>设定限额:</span>
            <input 
              type="number" 
              value={data.dailyLimit} 
              onChange={(e) => setData(prev => ({...prev, dailyLimit: Number(e.target.value)}))}
              className="w-20 border rounded px-2 py-1 bg-stone-50" 
            />
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
             <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12}} />
             <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12}} />
             <Tooltip 
                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
             />
             <ReferenceLine y={data.dailyLimit} stroke="red" strokeDasharray="3 3" />
             <Line type="monotone" dataKey="amount" stroke="#4A90E2" strokeWidth={2} dot={false} activeDot={{r: 6}} fill="url(#colorUv)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Input Form */}
      <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-blue-500">
        <h3 className="font-bold text-stone-700 mb-4">📝 记一笔</h3>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <select 
            value={form.type} 
            onChange={e => setForm({...form, type: e.target.value})} 
            className="p-2 border rounded bg-stone-50"
          >
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <input 
            type="date" 
            value={form.date} 
            onChange={e => setForm({...form, date: e.target.value})} 
            className="p-2 border rounded bg-stone-50"
          />
        </div>
        <div className="space-y-3">
          <input 
            type="number" 
            placeholder="金额" 
            value={form.amount} 
            onChange={e => setForm({...form, amount: e.target.value})} 
            className="w-full p-2 border rounded text-lg"
          />
          <input 
            type="text" 
            placeholder="备注" 
            value={form.desc} 
            onChange={e => setForm({...form, desc: e.target.value})} 
            className="w-full p-2 border rounded"
          />
          <button onClick={handleAddTx} className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition-colors">
            提交
          </button>
        </div>
      </div>
      
      {/* Export/Import Buttons */}
      <div className="flex gap-4 pt-4 border-t border-stone-200">
         <button 
           onClick={() => exportDailyToExcel(monthTransactions, currentYear, currentMonth)}
           className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 bg-white border rounded hover:bg-stone-50"
         >
           <Download size={16}/> 导出该月Excel
         </button>
         <label className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 bg-white border rounded hover:bg-stone-50 cursor-pointer">
           <Upload size={16}/> 导入Excel
           <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
         </label>
      </div>

      {/* List */}
      <div className="pb-10">
        <h3 className="font-bold text-stone-500 text-sm mb-2">本月明细</h3>
        <ul className="space-y-2">
          {[...monthTransactions].reverse().map(tx => (
            <li key={tx.id} className="flex justify-between items-center bg-white p-3 rounded shadow-sm group">
               <div>
                  <div className="text-stone-800 font-medium">{tx.desc}</div>
                  <div className="text-xs text-stone-400">{tx.date}</div>
               </div>
               <div className="flex items-center gap-3">
                   <div className={`font-bold ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                     {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                   </div>
                   <button 
                      onClick={() => handleDeleteTx(tx.id)}
                      className="text-stone-300 hover:text-red-500 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={16} />
                   </button>
               </div>
            </li>
          ))}
          {monthTransactions.length === 0 && <li className="text-center text-stone-400 text-sm py-4">本月暂无记录</li>}
        </ul>
      </div>
    </div>
  );
};