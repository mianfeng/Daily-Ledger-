import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, Calendar, Download, Moon, Sun, Upload } from 'lucide-react';
import { CopperShop } from './components/CopperShop';
import { DailyLedger } from './components/DailyLedger';
import {
  readLocalLedgerData,
  sanitizeBackup,
  writeLocalLedgerData,
} from './lib/appData';
import { AppBackup, AppLedgerData, CopperData, DailyData, ViewType } from './types';

const formatBackupTimestamp = (value: Date) =>
  `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}_${String(value.getHours()).padStart(2, '0')}${String(value.getMinutes()).padStart(2, '0')}`;

const THEME_STORAGE_KEY = 'dailyLedgerTheme';

type AppTheme = 'light' | 'dark';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>(ViewType.DAILY);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [ledger, setLedger] = useState<AppLedgerData>(() => readLocalLedgerData());
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    writeLocalLedgerData(ledger);
  }, [ledger]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is optional; keep the UI responsive if storage fails.
    }
  }, [theme]);

  const setCopperData = useCallback(
    (next: React.SetStateAction<CopperData>) => {
      setLedger((prev) => ({
        ...prev,
        copper: typeof next === 'function' ? next(prev.copper) : next,
      }));
    },
    [],
  );

  const setDailyData = useCallback(
    (next: React.SetStateAction<DailyData>) => {
      setLedger((prev) => ({
        ...prev,
        daily: typeof next === 'function' ? next(prev.daily) : next,
      }));
    },
    [],
  );

  const handleExportBackup = () => {
    const backup: AppBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: window.location.origin,
      copper: ledger.copper,
      daily: ledger.daily,
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

    if (!window.confirm('确定用备份覆盖当前整站数据吗？当前铜钱分账和生活预算都会被替换。')) {
      input.value = '';
      return;
    }

    try {
      const text = await file.text();
      const nextData = sanitizeBackup(JSON.parse(text));
      writeLocalLedgerData(nextData);
      setLedger(nextData);
      alert('整站备份恢复成功。');
    } catch {
      alert('备份恢复失败，文件格式不正确。');
    } finally {
      input.value = '';
    }
  };

  return (
    <div
      className={`flex min-h-screen transition-colors ${
        theme === 'dark' ? 'bg-[#141815] text-stone-100' : 'bg-[#F3F1E8] text-stone-800'
      }`}
    >
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
            生活预算
          </span>
        </div>
      </nav>

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
            <span className="text-xs mt-1">生活预算</span>
          </div>
        </div>
      </nav>

      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full pb-20 md:pb-8 overflow-y-auto h-screen scrollbar-hide">
        <div
          className={`mb-4 md:mb-6 rounded-2xl px-4 py-3 shadow-sm transition-colors ${
            theme === 'dark'
              ? 'border border-white/10 bg-[#20261f] text-stone-100'
              : 'border border-stone-200 bg-white/90 text-stone-800'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className={`text-sm font-semibold ${theme === 'dark' ? 'text-stone-100' : 'text-stone-700'}`}>本地账本</div>
              <div className={`text-xs ${theme === 'dark' ? 'text-stone-400' : 'text-stone-500'}`}>
                数据保存在当前浏览器。换设备前请导出整站备份，再到新设备恢复。
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${
                  theme === 'dark'
                    ? 'bg-white/10 text-stone-100 hover:bg-white/15'
                    : 'bg-[#e9dcc4] text-[#5d4d37] hover:bg-[#dfcda9]'
                }`}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? '日间' : '夜间'}
              </button>
              <button
                onClick={handleExportBackup}
                className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${
                  theme === 'dark'
                    ? 'bg-white/10 text-stone-100 hover:bg-white/15'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
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

        {currentView === ViewType.COPPER ? (
          <CopperShop data={ledger.copper} setData={setCopperData} />
        ) : (
          <DailyLedger
            data={ledger.daily}
            setData={setDailyData}
            theme={theme}
          />
        )}
      </main>
    </div>
  );
};

export default App;
