import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, Calendar, Download, LogOut, Upload } from 'lucide-react';
import { CopperShop } from './components/CopperShop';
import { DailyLedger } from './components/DailyLedger';
import { api } from './lib/api';
import {
  DEFAULT_LEDGER_DATA,
  hasLocalLedgerData,
  readLocalLedgerData,
  sanitizeBackup,
  sanitizeLedgerData,
} from './lib/appData';
import { AppLedgerData, CopperData, DailyData, ViewType } from './types';

type AuthStatus = 'checking' | 'login' | 'authenticated';
type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

const getErrorStatus = (error: unknown) =>
  typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: number }).status)
    : undefined;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const getSaveStatusLabel = (status: SaveStatus) => {
  switch (status) {
    case 'saving':
      return '保存中';
    case 'saved':
      return '已保存';
    case 'failed':
      return '保存失败';
    case 'conflict':
      return '数据已更新';
    default:
      return '等待同步';
  }
};

const getSaveStatusStyle = (status: SaveStatus) => {
  switch (status) {
    case 'saving':
      return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'saved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'failed':
      return 'bg-red-50 text-red-700 border-red-100';
    case 'conflict':
      return 'bg-amber-50 text-amber-800 border-amber-100';
    default:
      return 'bg-stone-50 text-stone-500 border-stone-100';
  }
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>(ViewType.DAILY);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState('');
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [ledger, setLedger] = useState<AppLedgerData>(DEFAULT_LEDGER_DATA);
  const [revision, setRevision] = useState(0);
  const [pendingLocalMigration, setPendingLocalMigration] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(0);
  const lastSavedJsonRef = useRef(JSON.stringify(DEFAULT_LEDGER_DATA));
  const autosaveInFlightRef = useRef(false);
  const queuedAutosaveRef = useRef<AppLedgerData | null>(null);

  const setRevisionState = useCallback((nextRevision: number) => {
    revisionRef.current = nextRevision;
    setRevision(nextRevision);
  }, []);

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

  const applyServerState = useCallback(
    (data: AppLedgerData, nextRevision: number) => {
      lastSavedJsonRef.current = JSON.stringify(data);
      setLedger(data);
      setRevisionState(nextRevision);
      setSaveStatus(nextRevision > 0 ? 'saved' : 'idle');
    },
    [setRevisionState],
  );

  const loadLedger = useCallback(async () => {
    setLoadStatus('loading');
    setMessage('');

    try {
      const response = await api.getLedger();
      if (response.hasData) {
        applyServerState(sanitizeLedgerData(response.data), response.revision);
        setPendingLocalMigration(false);
      } else {
        applyServerState(DEFAULT_LEDGER_DATA, 0);
        setPendingLocalMigration(hasLocalLedgerData());
      }
      setLoadStatus('ready');
    } catch (error) {
      setLoadStatus('failed');
      setMessage(getErrorMessage(error, '服务器数据加载失败'));
    }
  }, [applyServerState]);

  useEffect(() => {
    let isActive = true;

    api
      .getSession()
      .then((session) => {
        if (!isActive) {
          return;
        }
        if (session.authenticated) {
          setAuthStatus('authenticated');
          void loadLedger();
        } else {
          setAuthStatus('login');
        }
      })
      .catch(() => {
        if (isActive) {
          setAuthStatus('login');
        }
      });

    return () => {
      isActive = false;
    };
  }, [loadLedger]);

  const persistLedger = useCallback(
    async (data: AppLedgerData, expectedRevision = revisionRef.current) => {
      setSaveStatus('saving');
      setMessage('');

      try {
        const response = await api.saveLedger(data, expectedRevision);
        const savedData = sanitizeLedgerData(response.data);
        lastSavedJsonRef.current = JSON.stringify(savedData);
        setRevisionState(response.revision);
        setSaveStatus('saved');
        return response;
      } catch (error) {
        if (getErrorStatus(error) === 409) {
          setSaveStatus('conflict');
          setMessage('服务器数据已在其他设备更新。请刷新后再继续编辑。');
        } else {
          setSaveStatus('failed');
          setMessage(getErrorMessage(error, '保存失败，请检查网络后重试。'));
        }
        throw error;
      }
    },
    [setRevisionState],
  );

  const queueAutosave = useCallback(
    async (data: AppLedgerData) => {
      if (autosaveInFlightRef.current) {
        queuedAutosaveRef.current = data;
        setSaveStatus('saving');
        return;
      }

      autosaveInFlightRef.current = true;
      try {
        await persistLedger(data);
      } finally {
        autosaveInFlightRef.current = false;
        const queued = queuedAutosaveRef.current;
        queuedAutosaveRef.current = null;
        if (queued && JSON.stringify(queued) !== lastSavedJsonRef.current) {
          void queueAutosave(queued);
        }
      }
    },
    [persistLedger],
  );

  useEffect(() => {
    if (authStatus !== 'authenticated' || loadStatus !== 'ready') {
      return;
    }

    const nextJson = JSON.stringify(ledger);
    if (nextJson === lastSavedJsonRef.current) {
      return;
    }

    setSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      void queueAutosave(ledger).catch(() => {
        // The status banner already shows the failure.
      });
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [authStatus, ledger, loadStatus, queueAutosave]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');

    try {
      await api.login(loginForm.username.trim(), loginForm.password);
      setAuthStatus('authenticated');
      setLoginForm((prev) => ({ ...prev, password: '' }));
      await loadLedger();
    } catch (error) {
      setMessage(getErrorMessage(error, '登录失败'));
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setAuthStatus('login');
    setLoadStatus('idle');
    setPendingLocalMigration(false);
  };

  const handleExportBackup = () => {
    window.location.assign('/api/ledger/export');
  };

  const handleImportBackup = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    if (!window.confirm('确定用备份覆盖服务器整站数据吗？当前铜钱分账和日常账本都会被替换。')) {
      input.value = '';
      return;
    }

    try {
      const text = await file.text();
      const nextData = sanitizeBackup(JSON.parse(text));
      const response = await persistLedger(nextData, revisionRef.current);
      applyServerState(sanitizeLedgerData(response.data), response.revision);
      alert('整站备份恢复成功，服务器数据已更新。');
    } catch (error) {
      alert(getErrorMessage(error, '备份恢复失败，文件格式不正确或服务器拒绝保存。'));
    } finally {
      input.value = '';
    }
  };

  const handleImportLocalData = async () => {
    if (!window.confirm('确定把当前浏览器里的旧本地数据导入服务器吗？')) {
      return;
    }

    const localData = readLocalLedgerData();
    setSaveStatus('saving');
    setMessage('');

    try {
      const response = await api.importLedger(localData, revisionRef.current, true);
      applyServerState(sanitizeLedgerData(response.data), response.revision);
      setPendingLocalMigration(false);
      alert('本地数据已导入服务器。');
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        setPendingLocalMigration(false);
        setSaveStatus('conflict');
        setMessage('服务器已有数据，已取消本地导入以避免覆盖。');
      } else {
        setSaveStatus('failed');
        setMessage(getErrorMessage(error, '本地数据导入服务器失败。'));
      }
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center text-stone-600">
        正在检查登录状态...
      </div>
    );
  }

  if (authStatus === 'login') {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-white border border-stone-200 rounded-2xl shadow-sm p-6 space-y-4"
        >
          <div>
            <h1 className="text-xl font-bold text-stone-800">Daily Ledger</h1>
            <p className="text-sm text-stone-500 mt-1">登录后访问你的 VPS 账本数据。</p>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-stone-500 mb-1">账号</span>
              <input
                value={loginForm.username}
                onChange={(event) =>
                  setLoginForm((prev) => ({ ...prev, username: event.target.value }))
                }
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-500"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-stone-500 mb-1">密码</span>
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                }
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-500"
                autoComplete="current-password"
              />
            </label>
          </div>
          {message && <div className="text-sm text-red-600">{message}</div>}
          <button
            type="submit"
            className="w-full bg-stone-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-stone-800"
          >
            登录
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] text-stone-800">
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

      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full pb-20 md:pb-8 overflow-y-auto h-screen scrollbar-hide">
        <div className="mb-4 md:mb-6 bg-white/90 border border-stone-200 rounded-2xl px-4 py-3 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stone-700">VPS 同步</div>
              <div className="text-xs text-stone-500">
                revision {revision} · {loadStatus === 'ready' ? '服务器数据已加载' : '正在加载服务器数据'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`inline-flex items-center px-3 py-2 text-xs border rounded-lg ${getSaveStatusStyle(saveStatus)}`}>
                {getSaveStatusLabel(saveStatus)}
              </span>
              <button
                onClick={() => void loadLedger()}
                className="px-3 py-2 text-xs text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
              >
                刷新
              </button>
              <button
                onClick={() => void persistLedger(ledger).catch(() => undefined)}
                className="px-3 py-2 text-xs text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
              >
                重试保存
              </button>
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
              <button
                onClick={() => void handleLogout()}
                className="flex items-center gap-2 px-3 py-2 text-xs text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
              >
                <LogOut size={14} /> 退出
              </button>
            </div>
          </div>
          {message && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {message}
            </div>
          )}
          {pendingLocalMigration && (
            <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
              <span>检测到当前浏览器里有旧本地数据，服务器为空时可以导入到 VPS。</span>
              <button
                onClick={() => void handleImportLocalData()}
                className="px-3 py-1.5 rounded bg-amber-700 text-white hover:bg-amber-800"
              >
                导入本地数据
              </button>
            </div>
          )}
        </div>

        {loadStatus === 'loading' && (
          <div className="bg-white border border-stone-200 rounded-2xl px-4 py-8 text-center text-stone-500">
            正在加载服务器数据...
          </div>
        )}

        {loadStatus === 'failed' && (
          <div className="bg-white border border-red-100 rounded-2xl px-4 py-8 text-center text-red-600">
            服务器数据加载失败，请检查网络后刷新。
          </div>
        )}

        {loadStatus === 'ready' &&
          (currentView === ViewType.COPPER ? (
            <CopperShop data={ledger.copper} setData={setCopperData} />
          ) : (
            <DailyLedger data={ledger.daily} setData={setDailyData} />
          ))}
      </main>
    </div>
  );
};

export default App;
