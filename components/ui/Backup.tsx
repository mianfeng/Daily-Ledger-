import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppLedgerData, CopperData, DailyData } from "../../types";
import { useUi } from "./Ui";

const BACKUP_TIME_KEY = "daily_ledger_last_backup_at";
type Scope = "all" | "daily" | "copper";
type ImportCandidate = { daily?: DailyData; copper?: CopperData };
type Summary = { count: number; latest: string };
type Comparison = {
  current: { daily: Summary; copper: Summary };
  next: { daily: Summary; copper: Summary };
  scope: Scope;
  older: boolean;
};
const summary = (data: { transactions: { date: string }[] }): Summary => ({
  count: data.transactions.length,
  latest: data.transactions.reduce(
    (last, row) => (row.date > last ? row.date : last),
    "",
  ),
});
export const compareBackup = (
  current: AppLedgerData,
  next: ImportCandidate,
  scope: Scope,
): Comparison => {
  const before = {
    daily: summary(current.daily),
    copper: summary(current.copper),
  };
  const after = {
    daily: summary(next.daily ?? current.daily),
    copper: summary(next.copper ?? current.copper),
  };
  const keys: ("daily" | "copper")[] =
    scope === "all" ? ["daily", "copper"] : [scope];
  return {
    current: before,
    next: after,
    scope,
    older: keys.some(
      (key) =>
        after[key].count < before[key].count ||
        after[key].latest < before[key].latest,
    ),
  };
};
type BackupValue = {
  lastBackupAt: number | null;
  overdue: boolean;
  ageDays: number | null;
  markBackup: () => void;
  exportSnapshot: () => void;
  reviewImport: (next: ImportCandidate, scope: Scope) => Promise<boolean>;
};
const BackupContext = createContext<BackupValue | null>(null);
export const useBackup = () => {
  const value = useContext(BackupContext);
  if (!value) throw new Error("BackupProvider is required");
  return value;
};
const ImportComparison: React.FC<{
  comparison: Comparison;
  onSafetyChange: (checked: boolean) => void;
}> = ({ comparison, onSafetyChange }) => {
  const [safe, setSafe] = useState(comparison.older);
  return (
    <div className="import-preview">
      <div className="import-preview-grid">
        {(["current", "next"] as const).map((kind) => (
          <section key={kind}>
            <h3>{kind === "current" ? "当前浏览器账本" : "待导入备份文件"}</h3>
            {(["daily", "copper"] as const).map((module) => (
              <div key={module} className="import-summary">
                <b>
                  {module === "daily" ? "生活" : "生意"}{" "}
                  {comparison[kind][module].count} 笔
                </b>
                <span>
                  最新日期：{comparison[kind][module].latest || "无记录"}
                  {comparison.scope !== "all" && comparison.scope !== module
                    ? "（不替换）"
                    : ""}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      {comparison.older && (
        <p className="ui-warning" role="status">
          备份记录更少或最新日期更早，可能覆盖当前较新的记录。请核对文件。
        </p>
      )}
      <label className="backup-safety">
        <input
          type="checkbox"
          checked={safe}
          onChange={(event) => {
            setSafe(event.target.checked);
            onSafetyChange(event.target.checked);
          }}
        />
        <span>先自动导出当前整站备份，再执行恢复</span>
      </label>
    </div>
  );
};

export const BackupProvider: React.FC<{
  data: AppLedgerData;
  children: React.ReactNode;
}> = ({ data, children }) => {
  const { confirm, notify } = useUi();
  const currentRef = useRef(data);
  currentRef.current = data;
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(BACKUP_TIME_KEY);
      const value = Number(raw);
      return raw && Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const markBackup = useCallback(() => {
    const value = Date.now();
    setLastBackupAt(value);
    setNow(value);
    try {
      localStorage.setItem(BACKUP_TIME_KEY, String(value));
    } catch {
      /* Reminder metadata is optional. */
    }
  }, []);
  const exportSnapshot = useCallback(() => {
    const value = new Date();
    const stamp = `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}_${String(value.getHours()).padStart(2, "0")}${String(value.getMinutes()).padStart(2, "0")}`;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            exportedAt: value.toISOString(),
            origin: window.location.origin,
            ...currentRef.current,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-ledger-backup_${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    markBackup();
  }, [markBackup]);
  const reviewImport = useCallback(
    async (next: ImportCandidate, scope: Scope) => {
      const comparison = compareBackup(currentRef.current, next, scope);
      let saveFirst = comparison.older;
      const body =
        scope === "all"
          ? "生活预算与铜钱生意两个模块当前全部数据都会被覆盖。请核对导入前差异。"
          : `本次将覆盖${scope === "daily" ? "生活预算" : "铜钱生意"}当前全部数据，另一个模块不受影响。`;
      const accepted = await confirm({
        title: scope === "all" ? "恢复整站备份？" : "导入前差异预检",
        body,
        danger: true,
        confirmLabel: scope === "all" ? "覆盖并恢复" : "确认",
        content: (
          <ImportComparison
            comparison={comparison}
            onSafetyChange={(checked) => {
              saveFirst = checked;
            }}
          />
        ),
      });
      if (!accepted) return false;
      if (saveFirst) {
        try {
          exportSnapshot();
        } catch {
          notify("当前备份导出失败，未执行恢复。");
          return false;
        }
      }
      return true;
    },
    [confirm, exportSnapshot, notify],
  );
  const ageDays =
    lastBackupAt === null
      ? null
      : Math.max(0, Math.floor((now - lastBackupAt) / 86400000));
  return (
    <BackupContext.Provider
      value={{
        lastBackupAt,
        ageDays,
        overdue: lastBackupAt === null || now - lastBackupAt > 7 * 86400000,
        markBackup,
        exportSnapshot,
        reviewImport,
      }}
    >
      {children}
    </BackupContext.Provider>
  );
};

export const BackupDot: React.FC = () => {
  const { overdue } = useBackup();
  return overdue ? (
    <span
      role="status"
      className="backup-dot"
      aria-label="建议导出备份"
      title="建议导出备份"
    />
  ) : null;
};
export const BackupHealth: React.FC = () => {
  const { lastBackupAt, ageDays, overdue } = useBackup();
  return (
    <p className={overdue ? "ui-warning" : "ui-help"}>
      {lastBackupAt === null
        ? "尚未导出备份，建议先保存一份整站备份。"
        : `距离上次备份已 ${ageDays} 天。`}
      {overdue && lastBackupAt !== null ? " 建议导出新备份。" : ""}
    </p>
  );
};
