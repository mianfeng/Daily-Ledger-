import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Briefcase, Calendar, Download, Moon, Sun, Upload } from "lucide-react";
import {
  UiProvider,
  useUi,
  InlineError,
  ModuleUiScope,
} from "./components/ui/Ui";
import { BackupProvider, useBackup } from "./components/ui/Backup";
import { CopperShop } from "./components/CopperShop";
import { DailyLedger } from "./components/DailyLedger";
import {
  readLocalLedgerData,
  sanitizeBackup,
  writeLocalLedgerData,
} from "./lib/appData";
import { AppLedgerData, CopperData, DailyData, ViewType } from "./types";

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

type LedgerProps = {
  theme: AppTheme;
  setTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
  currentView: ViewType;
  setCurrentView: React.Dispatch<React.SetStateAction<ViewType>>;
};
const LedgerPanels: React.FC<
  LedgerProps & {
    ledger: AppLedgerData;
    setLedger: React.Dispatch<React.SetStateAction<AppLedgerData>>;
  }
> = ({ theme, setTheme, currentView, setCurrentView, ledger, setLedger }) => {
  const { notify } = useUi();
  const { exportSnapshot, reviewImport } = useBackup();
  const scrollPositions = useRef({ [ViewType.DAILY]: 0, [ViewType.COPPER]: 0 });
  const switchView = (next: ViewType) => {
    if (next === currentView) return;
    scrollPositions.current[currentView] = window.scrollY;
    setCurrentView(next);
  };
  useLayoutEffect(() => {
    window.scrollTo({
      top: scrollPositions.current[currentView],
      behavior: "instant",
    });
  }, [currentView]);
  const [backupError, setBackupError] = useState("");
  const backupInputRef = useRef<HTMLInputElement>(null);

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

  const handleImportBackup = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    const input = event.target;
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      if (
        !raw ||
        typeof raw !== "object" ||
        !raw.daily ||
        !raw.copper ||
        !Array.isArray(raw.daily.transactions) ||
        !Array.isArray(raw.copper.transactions)
      )
        throw new Error("Invalid ledger backup");
      const nextData = sanitizeBackup(raw);
      if (!(await reviewImport(nextData, "all"))) return;
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
      <button className="ui-button" onClick={exportSnapshot}>
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
        <div
          hidden={currentView !== ViewType.DAILY}
          aria-hidden={currentView !== ViewType.DAILY}
          className={`warm-ui module-panel ${theme === "dark" ? "theme-dark" : ""}`}
          data-module="daily"
        >
          <ModuleUiScope value={currentView === ViewType.DAILY}>
            <DailyLedger
              data={ledger.daily}
              setData={setDailyData}
              theme={theme}
              appControls={appControls}
            />
          </ModuleUiScope>
        </div>
        <div
          hidden={currentView !== ViewType.COPPER}
          aria-hidden={currentView !== ViewType.COPPER}
          className={`warm-ui module-panel module-business ${theme === "dark" ? "theme-dark" : ""}`}
          data-module="copper"
        >
          <ModuleUiScope value={currentView === ViewType.COPPER}>
            <CopperShop
              data={ledger.copper}
              setData={setCopperData}
              theme={theme}
              appControls={appControls}
            />
          </ModuleUiScope>
        </div>
      </main>
      <nav className="app-tabs" aria-label="账本模块">
        <button
          aria-current={currentView === ViewType.DAILY ? "page" : undefined}
          onClick={() => switchView(ViewType.DAILY)}
        >
          <Calendar size={20} />
          生活预算
        </button>
        <button
          aria-current={currentView === ViewType.COPPER ? "page" : undefined}
          onClick={() => switchView(ViewType.COPPER)}
        >
          <Briefcase size={20} />
          铜钱生意
        </button>
      </nav>
    </>
  );
};

const LedgerApp: React.FC<LedgerProps> = (props) => {
  const [ledger, setLedger] = useState<AppLedgerData>(() =>
    readLocalLedgerData(),
  );
  useEffect(() => {
    writeLocalLedgerData(ledger);
  }, [ledger]);
  return (
    <BackupProvider data={ledger}>
      <LedgerPanels {...props} ledger={ledger} setLedger={setLedger} />
    </BackupProvider>
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
