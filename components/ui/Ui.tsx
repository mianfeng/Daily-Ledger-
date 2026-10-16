import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Download, Upload, X } from "lucide-react";
import { registerOverlayHistory } from "./overlayHistory";

type ConfirmOptions = {
  title?: string;
  body: string;
  content?: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
};
type UiContextValue = {
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  notify: (message: string) => void;
  appearance: string;
};
const UiContext = createContext<UiContextValue | null>(null);
export const useUi = () => {
  const value = useContext(UiContext);
  if (!value) throw new Error("UiProvider is required");
  return value;
};

export const UiProvider: React.FC<{
  theme: "light" | "dark";
  business: boolean;
  children: React.ReactNode;
}> = ({ theme, business, children }) => {
  const [request, setRequest] = useState<
    (ConfirmOptions & { resolve: (answer: boolean) => void }) | null
  >(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const [toast, setToast] = useState("");
  const appearance = `warm-ui ${theme === "dark" ? "theme-dark" : ""} ${business ? "module-business" : ""}`;
  const confirm = useCallback(
    (options: string | ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // Reject a replaced request rather than leaving its Promise unresolved.
        pending.current?.(false);
        pending.current = resolve;
        const normalized =
          typeof options === "string" ? { body: options } : options;
        setRequest({
          title: "确认操作",
          danger: /删除|覆盖|取消.*销售|回滚/.test(normalized.body),
          ...normalized,
          resolve,
        });
      }),
    [],
  );
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => pending.current?.(false), []);
  const answer = (result: boolean) => {
    request?.resolve(result);
    pending.current = null;
    setRequest(null);
  };
  return (
    <UiContext.Provider value={{ confirm, notify, appearance }}>
      {children}
      {request && (
        <Overlay
          title={request.title ?? "确认操作"}
          variant="confirm"
          onClose={() => answer(false)}
        >
          <p className="ui-confirm-copy">{request.body}</p>
          {request.content}
          <div className="ui-confirm-actions">
            <button
              className="ui-button"
              onClick={() => answer(false)}
              autoFocus
            >
              取消
            </button>
            <button
              className={request.danger ? "ui-danger" : "ui-key"}
              onClick={() => answer(true)}
            >
              {request.confirmLabel ?? "确认"}
            </button>
          </div>
        </Overlay>
      )}
      {toast &&
        !request &&
        createPortal(
          <div className={`${appearance} ui-toast`} role="status">
            <Check size={18} />
            {toast}
          </div>,
          document.body,
        )}
    </UiContext.Provider>
  );
};

const focusableSelector =
  'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]';
let overlayCount = 0;
let originalOverflow = "";

const ModuleActiveContext = createContext(true);
export const ModuleUiScope = ModuleActiveContext.Provider;
type OverlayProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  variant?: "sheet" | "page" | "confirm";
  footer?: React.ReactNode;
  protectEdits?: boolean;
  error?: string;
  onClearError?: () => void;
  saved?: boolean;
};
export const Overlay: React.FC<OverlayProps> = (props) => {
  const active = useContext(ModuleActiveContext);
  return active ? <ActiveOverlay {...props} /> : null;
};
const ActiveOverlay: React.FC<OverlayProps> = ({
  title,
  children,
  onClose,
  variant = "sheet",
  footer,
  protectEdits = false,
  error,
  onClearError,
  saved,
}) => {
  const { appearance, confirm } = useUi();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(false);
  const closingRef = useRef(false);
  const dragStart = useRef<number | null>(null);
  const [dragDistance, setDragDistance] = useState(0);
  const [viewport, setViewport] = useState({
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
  });
  useEffect(() => {
    if (saved) dirtyRef.current = false;
  }, [saved]);
  useEffect(() => {
    if (error)
      dialogRef.current
        ?.querySelector(".ui-error")
        ?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (
      !protectEdits ||
      !dirtyRef.current ||
      (await confirm({
        title: "放弃未保存输入？",
        body: "当前输入尚未记入账本，关闭后不会提交。",
        confirmLabel: "放弃输入",
        danger: true,
      }))
    )
      closeRef.current();
    closingRef.current = false;
  }, [confirm, protectEdits]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(
    () =>
      registerOverlayHistory(() => {
        void requestCloseRef.current();
      }),
    [],
  );
  useEffect(() => {
    const update = () =>
      setViewport({
        height: window.visualViewport?.height ?? window.innerHeight,
        top: window.visualViewport?.offsetTop ?? 0,
      });
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = document.getElementById("root");
    if (overlayCount++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      if (root) root.inert = true;
    }
    const dialog = dialogRef.current;
    const isTop = () =>
      Array.from(document.querySelectorAll("[data-overlay-dialog]")).at(-1) ===
      dialog;
    const getTargets = (): HTMLElement[] =>
      Array.from<HTMLElement>(
        dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((node) => node.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      (
        dialog?.querySelector<HTMLElement>("[autofocus]") ??
        getTargets()[0] ??
        dialog
      )?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void requestCloseRef.current();
      }
      if (event.key === "Tab") {
        const targets = getTargets();
        const first = targets[0];
        const last = targets.at(-1);
        if (!first) {
          event.preventDefault();
          dialog?.focus();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (
        isTop() &&
        event.target instanceof Node &&
        !dialog?.contains(event.target)
      )
        (getTargets()[0] ?? dialog)?.focus();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      if (--overlayCount === 0) {
        document.body.style.overflow = originalOverflow;
        if (root) root.inert = false;
      }
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className={`${appearance} ui-overlay ui-overlay-${variant}`}
      style={{ height: viewport.height, top: viewport.top }}
      onClick={(event) => {
        if (event.target === event.currentTarget) void requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`ui-dialog ui-dialog-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-overlay-dialog
        style={
          variant === "sheet"
            ? {
                transform: `translateY(${dragDistance}px)`,
                transition: dragDistance ? "none" : undefined,
              }
            : undefined
        }
        onChangeCapture={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === "file"
          )
            return;
          dirtyRef.current = true;
          onClearError?.();
        }}
        onClickCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button[aria-pressed]")
          )
            dirtyRef.current = true;
        }}
      >
        {variant === "sheet" && (
          <div
            className="ui-drag-zone"
            role="group"
            aria-label="向下拖动关闭弹层"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragStart.current = event.clientY;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dragStart.current !== null)
                setDragDistance(Math.max(0, event.clientY - dragStart.current));
            }}
            onPointerCancel={() => {
              dragStart.current = null;
              setDragDistance(0);
            }}
            onPointerUp={(event) => {
              const delta =
                dragStart.current === null
                  ? 0
                  : event.clientY - dragStart.current;
              dragStart.current = null;
              setDragDistance(0);
              if (delta > 90) void requestClose();
            }}
          >
            <div className="ui-handle" />
          </div>
        )}
        <header className="ui-dialog-header">
          {variant === "page" && (
            <button
              className="ui-icon-button"
              onClick={() => void requestClose()}
              aria-label="返回"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h2 id={titleId}>{title}</h2>
          {variant !== "page" && (
            <button
              className="ui-icon-button"
              onClick={() => void requestClose()}
              aria-label="关闭"
            >
              <X size={20} />
            </button>
          )}
        </header>
        <div className="ui-dialog-scroll">
          {children}
          {error && <InlineError message={error} />}
        </div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

export const InlineError: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <p className="ui-error" role="alert">
      {message}
    </p>
  ) : null;

export const BackupSection: React.FC<{
  moduleName: string;
  appControls?: React.ReactNode;
  onExport: () => void;
  health?: React.ReactNode;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ moduleName, appControls, onExport, onImport, health }) => (
  <section className="ui-backup">
    <h3>数据与备份</h3>
    {health}
    <p className="ui-help">
      数据保存在当前浏览器，没有登录和云同步。换设备或清理浏览器前，请先导出备份。
    </p>
    <div className="ui-card">
      <h4>整站备份 · JSON</h4>
      <p className="ui-help">包含生活预算与铜钱生意两个模块。</p>
      {appControls}
    </div>
    <div className="ui-card">
      <h4>{moduleName} · Excel</h4>
      <p className="ui-help">仅本模块；导入会覆盖本模块当前数据。</p>
      <div className="ui-control-row">
        <button className="ui-button" onClick={onExport}>
          <Download size={16} />
          导出{moduleName}
        </button>
        <label className="ui-button ui-file-button">
          <Upload size={16} />
          导入旧备份
          <input
            aria-label={`导入${moduleName} Excel`}
            type="file"
            accept=".xlsx,.xls"
            onChange={onImport}
          />
        </label>
      </div>
    </div>
  </section>
);
