import React, { useCallback, useEffect, useRef, useState } from "react";
import { Briefcase, Calendar, Download, Moon, Sun, Upload } from "lucide-react";
import { UiProvider, useUi, InlineError } from "./components/ui/Ui";
import { CopperShop } from "./components/CopperShop";
import { DailyLedger } from "./components/DailyLedger";
import {
  readLocalLedgerData,
  sanitizeBackup,
  writeLocalLedgerData,
} from "./lib/appData";
import {
  AppBackup,
  AppLedgerData,
  CopperData,
  DailyData,
  ViewType,
} from "./types";

const formatBackupTimestamp = (value: Date) =>
  `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}_${String(value.getHours()).padStart(2, "0")}${String(value.getMinutes()).padStart(2, "0")}`;

const THEME_STORAGE_KEY = "dailyLedgerTheme";

type AppTheme = "light" | "dark";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  declare props: Readonly<{ children: React.ReactNode }>;

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="warm-ui app-shell p-4">
          <div className="ui-card">
            <div className="text-lg font-black">页面加载失败</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              请刷新页面。如果仍然失败，先导出备份后再清理浏览器缓存。
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const LedgerApp: React.FC<{
  theme: AppTheme;
  setTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
  currentView: ViewType;
  setCurrentView: React.Dispatch<React.SetStateAction<ViewType>>;
}> = ({ theme, setTheme, currentView, setCurrentView }) => {
  const { confirm, notify } = useUi();
  const [backupError, setBackupError] = useState("");
  const [ledger, setLedger] = useState<AppLedgerData>(() =>
    readLocalLedgerData(),
  );
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
        copper: typeof next === "function" ? next(prev.copper) : next,
      }));
    },
    [],
  );

  const setDailyData = useCallback((next: React.SetStateAction<DailyData>) => {
    setLedger((prev) => ({
      ...prev,
      daily: typeof next === "function" ? next(prev.daily) : next,
    }));
  }, []);

  const handleExportBackup = () => {
    const backup: AppBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: window.location.origin,
      copper: ledger.copper,
      daily: ledger.daily,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
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

    if (
      !(await confirm({
        title: "恢复整站备份？",
        body: "生活预算与铜钱生意两个模块当前全部数据都会被覆盖。请确认已保存现有备份。",
        danger: true,
        confirmLabel: "覆盖并恢复",
      }))
    ) {
      input.value = "";
      return;
    }

    try {
      const text = await file.text();
      const nextData = sanitizeBackup(JSON.parse(text));
      writeLocalLedgerData(nextData);
      setLedger(nextData);
      setBackupError("");
      notify("整站备份恢复成功。");
    } catch {
      setBackupError("备份恢复失败，文件格式不正确。当前数据未替换。");
    } finally {
      input.value = "";
    }
  };

  const appControls = (
    <div className="ui-app-controls">
      <button
        className="ui-button"
        onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        {theme === "dark" ? "日间" : "夜间"}
      </button>
      <button className="ui-button" onClick={handleExportBackup}>
        <Download size={16} />
        导出整站
      </button>
      <label className="ui-button ui-file-button">
        <Upload size={16} />
        恢复整站
        <input
          ref={backupInputRef}
          aria-label="恢复整站 JSON 备份"
          type="file"
          accept=".json"
          onChange={handleImportBackup}
        />
      </label>
      <InlineError message={backupError} />
    </div>
  );
  return (
    <>
      <main className="app-main">
        {currentView === ViewType.COPPER ? (
          <CopperShop
            data={ledger.copper}
            setData={setCopperData}
            theme={theme}
            appControls={appControls}
          />
        ) : (
          <DailyLedger
            data={ledger.daily}
            setData={setDailyData}
            theme={theme}
            appControls={appControls}
          />
        )}
      </main>
      <nav className="app-tabs" aria-label="账本模块">
        <button
          aria-current={currentView === ViewType.DAILY ? "page" : undefined}
          onClick={() => setCurrentView(ViewType.DAILY)}
        >
          <Calendar size={20} />
          生活预算
        </button>
        <button
          aria-current={currentView === ViewType.COPPER ? "page" : undefined}
          onClick={() => setCurrentView(ViewType.COPPER)}
        >
          <Briefcase size={20} />
          铜钱生意
        </button>
      </nav>
    </>
  );
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState(ViewType.DAILY);
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  return (
    <AppErrorBoundary>
      <UiProvider theme={theme} business={currentView === ViewType.COPPER}>
        <div
          className={`warm-ui app-shell ${theme === "dark" ? "theme-dark" : ""} ${currentView === ViewType.COPPER ? "module-business" : ""}`}
        >
          <LedgerApp
            theme={theme}
            setTheme={setTheme}
            currentView={currentView}
            setCurrentView={setCurrentView}
          />
        </div>
      </UiProvider>
    </AppErrorBoundary>
  );
};
export default App;
