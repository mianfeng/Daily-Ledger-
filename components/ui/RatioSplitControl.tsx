import React from "react";
import { CopperRatios } from "../../types";
import { formatMoneyValue } from "./money";

export const RatioSplitControl: React.FC<{
  value: CopperRatios;
  onChange: (value: CopperRatios) => void;
}> = ({ value, onChange }) => {
  const change = (account: "liquid" | "reserve", raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = Math.round(Math.max(0, Math.min(100, parsed)) * 100) / 100;
    onChange(
      account === "liquid"
        ? { liquid: next, reserve: Math.round((100 - next) * 100) / 100 }
        : { reserve: next, liquid: Math.round((100 - next) * 100) / 100 },
    );
  };
  return (
    <div className="ratio-control">
      <div className="ratio-fields">
        <label>
          流动库 %
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={value.liquid}
            onChange={(event) => change("liquid", event.target.value)}
          />
        </label>
        <label>
          存储库 %
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={value.reserve}
            onChange={(event) => change("reserve", event.target.value)}
          />
        </label>
      </div>
      <input
        aria-label="流动库利润比例"
        className="ratio-slider"
        type="range"
        min="0"
        max="100"
        step="5"
        value={value.liquid}
        onChange={(event) => change("liquid", event.target.value)}
      />
      <div className="money-chips">
        {[
          [70, 30, "常规"],
          [50, 50, "稳健"],
          [100, 0, "全回流"],
        ].map(([liquid, reserve, label]) => (
          <button
            type="button"
            className="ui-chip"
            key={label}
            aria-pressed={value.liquid === liquid}
            onClick={() =>
              onChange({ liquid: Number(liquid), reserve: Number(reserve) })
            }
          >
            {liquid}:{reserve} {label}
          </button>
        ))}
      </div>
      <p className="ui-help">
        总和 100% · 每产生 ¥1,000 毛利：流动库分得{" "}
        {formatMoneyValue(value.liquid * 10)} · 存储库沉淀{" "}
        {formatMoneyValue(value.reserve * 10)}
      </p>
    </div>
  );
};
