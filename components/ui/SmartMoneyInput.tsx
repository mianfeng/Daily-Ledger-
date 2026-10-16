import React, { useId } from "react";
import { evaluateMoneyExpression, formatMoneyValue } from "./money";

export const SmartMoneyInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  badge?: React.ReactNode;
}> = ({ label, value, onChange, badge }) => {
  const id = useId();
  const result = evaluateMoneyExpression(value);
  const expression = /[+−-]/.test(value.slice(1));
  const invalid = value.trim() !== "" && result === null;
  return (
    <div className="smart-money">
      <div className="smart-money-heading">
        <label htmlFor={id}>{label}</label>
        {badge}
      </div>
      <div className="ui-amount-field">
        <span>¥</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={160}
          placeholder="0.00"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (result !== null) onChange(result.toFixed(2));
          }}
        />
        {expression && result !== null && (
          <output className="ui-badge" aria-live="polite">
            = {formatMoneyValue(result)}
          </output>
        )}
      </div>
      {invalid ? (
        <p id={`${id}-error`} className="money-error" role="alert">
          请输入最多两位小数的金额，支持加减算式，如 38+12−5。
        </p>
      ) : (
        <p className="ui-help" id={`${id}-hint`}>
          支持加减算式 · 金额保留两位小数
        </p>
      )}
      <div className="money-chips" aria-label={`${label}快捷增减`}>
        {[10, 50, 100, -5].map((amount) => (
          <button
            key={amount}
            type="button"
            className="ui-chip"
            disabled={invalid}
            onClick={() => onChange(((result ?? 0) + amount).toFixed(2))}
          >
            {amount < 0 ? "−" : "+"}¥{Math.abs(amount)}
          </button>
        ))}
      </div>
    </div>
  );
};
