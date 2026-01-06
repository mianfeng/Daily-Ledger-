import React, { useState, useEffect, useMemo } from 'react';
import { DailyData, Transaction } from '../types';
import { ChevronLeft, ChevronRight, Download, Upload, Calendar, AlertTriangle, CheckCircle, Trash2, TrendingUp, Award, ChevronDown, Check } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
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

  // Calculate days that stayed within limit this month
  const compliantDaysCount = useMemo(() => {
    const dailySpends = new Map<number, number>();
    monthTransactions.forEach(t => {
      if (t.type === 'expense') {
        const d = parseInt(t.date.split('-')[2]);
        dailySpends.set(d, (dailySpends.get(d) || 0) + t.amount);
      }
    });
    
    let count = 0;
    dailySpends.forEach((amount) => {
      if (amount <= data.dailyLimit) {
        count++;
      }
    });
    return count;
  }, [monthTransactions, data.dailyLimit]);

  // Month-End Estimation Calculation
  const estimatedMonthEndBalance = useMemo(() => {
    const now = new Date();
    if (currentYear !== now.getFullYear() || currentMonth !== (now.getMonth() + 1)) {
        return null;
    }

    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const currentDay = now.getDate();
    const remainingDaysInMonth = daysInMonth - currentDay; 
    
    const todayAllowanceLeft = Math.max(0, data.dailyLimit - todaySpent);
    const futureAllowance = remainingDaysInMonth * data.dailyLimit;
    const projectedFutureSpend = todayAllowanceLeft + futureAllowance;
    
    return balance - projectedFutureSpend;
  }, [balance, currentYear, currentMonth, data.dailyLimit, todaySpent]);

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
    <div className="space-y-4 animate-fade-in relative pb-20">
      {/* Header & Date Picker */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b pb-3 border-stone-200 gap-4">
        <div>
           <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
              <div className="bg-blue-600 text-white p-1.5 rounded-lg"><Calendar size={18} /></div>
              日常账本
           </h1>
        </div>

        {/* Optimized Date Picker Button */}
        <div className="relative z-30 w-full md:w-auto">
           <button 
             onClick={() => setShowPicker(!showPicker)}
             className="w-full md:w-auto flex justify-between md:justify-center items-center gap-2 bg-white border border-stone-200 px-3 py-1.5 rounded-full shadow-sm text-stone-600 hover:bg-stone-50 hover:border-blue-300 transition-all text-sm font-medium"
           >
              <span>{currentYear}年 {currentMonth}月</span>
              <ChevronDown size={14} className={`transition-transform text-stone-400 ${showPicker ? 'rotate-180' : ''}`} />
           </button>

           {/* Picker Dropdown */}
           {showPicker && (
             <div className="absolute top-full right-0 mt-2 w-full md:w-80 bg-white border border-stone-200 shadow-xl rounded-xl p-4 z-50 animate-fade-in">
               <div className="flex justify-between items-center mb-4 pb-2 border-b border-stone-100">
                 <button onClick={() => setPickerYear(p => p - 1)} className="p-1 hover:bg-stone-100 rounded text-stone-500"><ChevronLeft size={18} /></button>
                 <span className="font-bold text-stone-700">{pickerYear}</span>
                 <button onClick={() => setPickerYear(p => p + 1)} className="p-1 hover:bg-stone-100 rounded text-stone-500"><ChevronRight size={18} /></button>
               </div>
               <div className="grid grid-cols-4 gap-2">
                 {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                   const { bal, hasTx } = calculateMonthBalanceForPicker(pickerYear, m);
                   const isActive = pickerYear === currentYear && m === currentMonth;
                   
                   let badgeStyle = '';
                   if (isActive) {
                       badgeStyle = 'bg-white/20 text-white';
                   } else if (!hasTx) {
                       badgeStyle = 'bg-stone-100 text-stone-400';
                   } else if (bal >= 0) {
                       badgeStyle = 'bg-emerald-100 text-emerald-700';
                   } else {
                       badgeStyle = 'bg-red-100 text-red-700';
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
                         ${isActive ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white hover:bg-stone-50 border-transparent text-stone-600'}
                       `}
                     >
                       <span className="font-bold text-sm">{m}月</span>
                       <span className={`text-[10px] px-1.5 rounded-full mt-1 ${badgeStyle}`}>
                          {!hasTx ? '·' : (bal > 0 ? '+' : '') + bal.toFixed(0)}
                       </span>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}
        </div>
      </div>

      {/* 1. Dashboard Stats (RICH CONTENT, 2 COLUMNS) */}
      <div className="grid grid-cols-2 gap-3">
        {/* Overview: Income, Expense, Balance + Compliant Days */}
        <div className="bg-white px-3 py-3 rounded-xl shadow-sm border border-stone-100 flex flex-col justify-between min-h-[100px] relative overflow-hidden">
           {/* Header */}
           <div className="flex justify-between items-start z-10">
             <h3 className="text-stone-400 font-bold text-xs">收支概览</h3>
             <div className="flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
                <Award size={10} className="text-amber-500"/>
                <span className="text-[9px] font-bold text-amber-700">达标 {compliantDaysCount} 天</span>
             </div>
           </div>

           {/* Stats Row */}
           <div className="flex items-center justify-between mt-2 z-10">
              <div className="flex flex-col">
                 <span className="text-[10px] text-stone-400 scale-90 origin-left">收入</span>
                 <span className="font-bold text-emerald-600 text-sm">+{income.toFixed(0)}</span>
              </div>
              <div className="h-6 w-px bg-stone-100 mx-1"></div>
              <div className="flex flex-col">
                 <span className="text-[10px] text-stone-400 scale-90 origin-left">支出</span>
                 <span className="font-bold text-red-500 text-sm">-{expense.toFixed(0)}</span>
              </div>
              <div className="h-6 w-px bg-stone-100 mx-1"></div>
              <div className="flex flex-col text-right">
                 <span className="text-[10px] text-stone-400 scale-90 origin-right">结余</span>
                 <span className={`font-bold text-sm ${balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {balance >= 0 ? '+' : ''}{balance.toFixed(0)}
                 </span>
              </div>
           </div>
        </div>

        {/* Limit Monitor: Spent/Limit + Estimated Month End */}
        <div className="bg-white px-3 py-3 rounded-xl shadow-sm border border-stone-100 flex flex-col justify-between min-h-[100px]">
           {/* Header */}
           <div className="flex justify-between items-center">
             <h3 className="text-stone-400 font-bold text-xs">今日额度</h3>
             <div className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${todaySpent > data.dailyLimit ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
               {todaySpent > data.dailyLimit ? '已超' : '正常'}
             </div>
           </div>
           
           {/* Main Numbers */}
           <div className="flex items-baseline gap-1 mt-1">
              <span className={`text-lg font-bold ${todaySpent > data.dailyLimit ? 'text-red-500' : 'text-stone-800'}`}>{todaySpent.toFixed(0)}</span>
              <span className="text-xs text-stone-300">/</span>
              <input 
                 type="number" 
                 value={data.dailyLimit} 
                 onChange={(e) => setData(prev => ({...prev, dailyLimit: Number(e.target.value)}))}
                 className="w-8 text-xs text-stone-400 border-b border-dashed border-stone-200 focus:outline-none focus:border-blue-400 bg-transparent text-center" 
               />
           </div>

           {/* Estimated Month End */}
           <div className="pt-2 mt-1 border-t border-dashed border-stone-100 flex justify-between items-center">
              <span className="text-[9px] text-stone-400 flex items-center gap-1">
                 <TrendingUp size={10}/> 月末预估
              </span>
              {estimatedMonthEndBalance !== null ? (
                  <span className={`text-[10px] font-bold ${estimatedMonthEndBalance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                     {estimatedMonthEndBalance >= 0 ? '+' : ''}{estimatedMonthEndBalance.toFixed(0)}
                  </span>
              ) : (
                  <span className="text-[10px] text-stone-300">-</span>
              )}
           </div>
        </div>
      </div>

      {/* 2. Input Form (Optimized Compact) */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
           {/* Date & Type Group */}
           <div className="flex gap-2 bg-stone-50 p-1 rounded-lg">
             <div className="flex bg-white rounded-md shadow-sm border border-stone-100 overflow-hidden shrink-0">
               <button onClick={() => setForm({...form, type: 'expense'})} className={`px-4 py-2 text-xs font-bold ${form.type === 'expense' ? 'bg-red-50 text-red-500' : 'text-stone-400 hover:bg-stone-50'}`}>支</button>
               <div className="w-px bg-stone-100"></div>
               <button onClick={() => setForm({...form, type: 'income'})} className={`px-4 py-2 text-xs font-bold ${form.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}>收</button>
             </div>
             
             <div className="relative flex-1 md:flex-none">
                <input 
                  type="date" 
                  value={form.date} 
                  onChange={e => setForm({...form, date: e.target.value})} 
                  className="w-full md:w-32 h-full bg-transparent pl-8 text-xs font-medium text-stone-600 focus:outline-none cursor-pointer"
                />
                <Calendar size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"/>
             </div>
           </div>

           {/* Input Fields */}
           <div className="flex-1 flex gap-2 items-center bg-stone-50 p-1 rounded-lg px-3">
              <span className="text-stone-400 text-xs font-bold">¥</span>
              <input 
                type="number" 
                placeholder="0.00" 
                value={form.amount} 
                onChange={e => setForm({...form, amount: e.target.value})} 
                className="w-24 bg-transparent text-sm font-bold text-stone-800 placeholder:text-stone-300 focus:outline-none"
              />
              <div className="w-px h-4 bg-stone-200 mx-1"></div>
              <input 
                type="text" 
                placeholder="备注 (如: 早餐)" 
                value={form.desc} 
                onChange={e => setForm({...form, desc: e.target.value})} 
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

      {/* 3. Chart */}
      <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 h-56 relative">
         <h3 className="absolute top-3 left-3 text-[10px] font-bold text-stone-400 flex items-center gap-1">
             <TrendingUp size={10}/> 收支趋势
          </h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
             <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 9}} />
             <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 9}} />
             <Tooltip contentStyle={{borderRadius: '6px', border: 'none', boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.1)', fontSize: '11px', padding: '4px 8px'}} />
             <ReferenceLine y={data.dailyLimit} stroke="red" strokeDasharray="3 3" />
             <Line 
               type="linear" 
               dataKey="amount" 
               stroke="#4A90E2" 
               strokeWidth={2} 
               dot={false} 
               activeDot={{r: 4}} 
              />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Footer Actions */}
      <div className="flex gap-4 pt-2 border-t border-stone-200">
         <button 
           onClick={() => exportDailyToExcel(monthTransactions, currentYear, currentMonth)}
           className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-500 bg-white border rounded hover:bg-stone-50"
         >
           <Download size={12}/> 导出
         </button>
         <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-500 bg-white border rounded hover:bg-stone-50 cursor-pointer">
           <Upload size={12}/> 导入
           <input type="file" hidden onChange={handleImport} accept=".xlsx,.xls" />
         </label>
      </div>

      {/* List */}
      <div className="">
        <h3 className="font-bold text-stone-400 text-[10px] uppercase tracking-wider mb-2">Transaction History</h3>
        <ul className="space-y-2">
          {[...monthTransactions].reverse().map(tx => (
            <li key={tx.id} className="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-stone-100 shadow-sm group hover:border-blue-200 transition-colors">
               <div className="flex items-center gap-2">
                  <div className={`w-0.5 h-6 rounded-full ${tx.type === 'income' ? 'bg-emerald-400' : 'bg-red-400'}`}></div>
                  <div>
                    <div className="text-stone-800 font-medium text-xs">{tx.desc}</div>
                    <div className="text-[10px] text-stone-400">{tx.date}</div>
                  </div>
               </div>
               <div className="flex items-center gap-2">
                   <div className={`font-bold text-xs ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                     {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)}
                   </div>
                   <button 
                      onClick={() => handleDeleteTx(tx.id)}
                      className="text-stone-300 hover:text-red-500 p-1 rounded-full hover:bg-stone-50 transition-all opacity-0 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={12} />
                   </button>
               </div>
            </li>
          ))}
          {monthTransactions.length === 0 && <li className="text-center text-stone-400 text-xs py-4">本月暂无记录</li>}
        </ul>
      </div>
    </div>
  );
};