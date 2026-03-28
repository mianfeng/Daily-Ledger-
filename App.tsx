import React, { useRef, useState } from 'react';
import { CopperShop } from './components/CopperShop';
import { DailyLedger } from './components/DailyLedger';
import { sanitizeCopperData } from './lib/copper';
import { sanitizeDailyData } from './lib/daily';
import { AppBackup, CopperData, DailyData, ViewType } from './types';
import { Briefcase, Calendar, Download, Upload } from 'lucide-react';

const COPPER_STORAGE_KEY = 'coinShopData_v5';
const DAILY_STORAGE_KEY = 'dailyBookData_v5';

const DEFAULT_COPPER_DATA: CopperData = {
  ratios: { liquid: 70, reserve: 20, collection: 10 },
  balances: { liquid: 4, reserve: 100, collection: 6 },
  transactions: [],
};

const DEFAULT_DAILY_DATA: DailyData = {
  dailyLimit: 30,
  transactions: [],
};

const formatBackupTimestamp = (value: Date) =>
  `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}_${String(value.getHours()).padStart(2, '0')}${String(value.getMinutes()).padStart(2, '0')}`;

const readStoredCopperData = () => {
  try {
    const raw = window.localStorage.getItem(COPPER_STORAGE_KEY);
    return raw ? sanitizeCopperData(JSON.parse(raw), DEFAULT_COPPER_DATA) : DEFAULT_COPPER_DATA;
  } catch {
    return DEFAULT_COPPER_DATA;
  }
};

const readStoredDailyData = () => {
  try {
    const raw = window.localStorage.getItem(DAILY_STORAGE_KEY);
    return raw ? sanitizeDailyData(JSON.parse(raw), DEFAULT_DAILY_DATA) : DEFAULT_DAILY_DATA;
  } catch {
    return DEFAULT_DAILY_DATA;
  }
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>(ViewType.DAILY);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = () => {
    const backup: AppBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: window.location.origin,
      copper: readStoredCopperData(),
      daily: readStoredDailyData(),
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-ledger-backup_${formatBackupTimestamp(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用备份覆盖当前整站数据吗？当前铜钱分账和日常账本都会被替换。')) {
      input.value = '';
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppBackup>;
      const copper = sanitizeCopperData(parsed.copper, DEFAULT_COPPER_DATA);
      const daily = sanitizeDailyData(parsed.daily, DEFAULT_DAILY_DATA);

      window.localStorage.setItem(COPPER_STORAGE_KEY, JSON.stringify(copper));
      window.localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(daily));

      alert('整站备份恢复成功，页面将刷新。');
      window.location.reload();
    } catch {
      alert('备份恢复失败，文件格式不正确。');
    } finally {
      input.value = '';
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] text-stone-800">
      {/* Sidebar - Desktop */}
      <nav 
        className={`fixed md:relative z-30 h-full bg-[#2c3e50] text-stone-300 transition-all duration-300 flex flex-col pt-8
          ${isSidebarOpen ? 'w-48' : 'w-[80px] hidden md:flex'}
        `}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
      >
        <div 
          onClick={() => setCurrentView(ViewType.COPPER)}
          className={`
            cursor-pointer p-4 flex flex-col items-center gap-2 transition-colors relative
            ${currentView === ViewType.COPPER ? 'bg-[#34495e] text-white' : 'hover:bg-[#34495e] hover:text-white'}
          `}
        >
          {currentView === ViewType.COPPER && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-600"></div>}
          <Briefcase size={24} />
          <span className={`text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
            铜钱生意
          </span>
        </div>

        <div 
          onClick={() => setCurrentView(ViewType.DAILY)}
          className={`
            cursor-pointer p-4 flex flex-col items-center gap-2 transition-colors relative
            ${currentView === ViewType.DAILY ? 'bg-[#34495e] text-white' : 'hover:bg-[#34495e] hover:text-white'}
          `}
        >
          {currentView === ViewType.DAILY && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
          <Calendar size={24} />
          <span className={`text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
            日常账本
          </span>
        </div>
      </nav>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#2c3e50] text-stone-300 flex justify-around z-40 pb-safe">
         <div 
          onClick={() => setCurrentView(ViewType.COPPER)}
          className={`flex-1 p-3 text-center ${currentView === ViewType.COPPER ? 'text-white bg-[#34495e]' : ''}`}
        >
          <div className="flex flex-col items-center">
            <Briefcase size={20} />
            <span className="text-xs mt-1">铜钱生意</span>
          </div>
        </div>
        <div 
          onClick={() => setCurrentView(ViewType.DAILY)}
          className={`flex-1 p-3 text-center ${currentView === ViewType.DAILY ? 'text-white bg-[#34495e]' : ''}`}
        >
          <div className="flex flex-col items-center">
             <Calendar size={20} />
             <span className="text-xs mt-1">日常账本</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full pb-20 md:pb-8 overflow-y-auto h-screen scrollbar-hide">
        <div className="mb-4 md:mb-6 bg-white/90 border border-stone-200 rounded-2xl px-4 py-3 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stone-700">整站备份</div>
              <div className="text-xs text-stone-500">
                换域名或换设备时，先在旧站导出整站备份，再到新站恢复。
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-3 py-2 text-xs text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
              >
                <Download size={14} /> 导出整站
              </button>
              <label className="flex items-center gap-2 px-3 py-2 text-xs text-white bg-stone-800 rounded-lg hover:bg-stone-900 transition-colors cursor-pointer">
                <Upload size={14} /> 恢复整站
                <input
                  ref={backupInputRef}
                  type="file"
                  hidden
                  accept=".json"
                  onChange={handleImportBackup}
                />
              </label>
            </div>
          </div>
        </div>
        {currentView === ViewType.COPPER ? <CopperShop /> : <DailyLedger />}
      </main>
    </div>
  );
};

export default App;
