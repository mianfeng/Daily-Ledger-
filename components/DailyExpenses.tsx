import React, { useMemo, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExpenseDay, getExpenseMonths } from "../lib/dailyExpenses";
import { formatDisplayDate } from "../lib/date";
import { DailyTransaction } from "../types";
import { Overlay } from "./ui/Ui";

interface Props {
  days: ExpenseDay[];
  today: string;
  formatAmount: (amount: number) => string;
  onAllTransactions: () => void;
  renderTransaction: (transaction: DailyTransaction) => React.ReactNode;
}

export const DailyExpenses: React.FC<Props> = ({
  days,
  today,
  formatAmount,
  onAllTransactions,
  renderTransaction,
}) => {
  const [monthOpen, setMonthOpen] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const monthDays = useMemo(
    () => days.filter((day) => day.date.startsWith(`${month}-`)),
    [days, month],
  );
  const monthCents = monthDays.reduce((sum, day) => sum + day.cents, 0);
  const selectedDay = days.find((day) => day.date === selectedDate);
  const months = useMemo(
    () => getExpenseMonths(days, year, today),
    [days, year, today],
  );
  const yearCents = months.reduce((sum, item) => sum + item.cents, 0);
  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(y, m - 1 + offset, 1);
    setMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    );
  };
  const dayRows = (items: ExpenseDay[]) => (
    <ul className="expense-days">
      {items.map((day) => (
        <li key={day.date}>
          <button
            className="expense-day"
            onClick={() => setSelectedDate(day.date)}
            aria-label={`查看 ${day.date} 支出明细`}
          >
            <span className="expense-day-date">
              {formatDisplayDate(day.date)}
              <small>{day.transactions.length} 笔支出</small>
            </span>
            <strong>{formatAmount(day.cents / 100)}</strong>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <section className="life-section expense-summary">
        <div className="expense-heading">
          <h2>
            <ReceiptText size={16} />
            每日支出
          </h2>
          <button
            className="expense-text-button"
            onClick={() => setMonthOpen(true)}
          >
            查看全部
          </button>
        </div>
        <p className="expense-caption">最近 7 个有支出的日期 · 按付款日期</p>
        {dayRows(days.slice(0, 7))}
        {days.length === 0 && (
          <p className="expense-empty">暂无支出，记一笔后会在这里按天汇总。</p>
        )}
        <button className="expense-all-button" onClick={onAllTransactions}>
          全部流水
          <ChevronRight size={16} />
        </button>
      </section>

      <section
        className="life-section expense-summary"
        aria-label="月度支出统计"
      >
        <div className="expense-heading">
          <h2>
            <BarChart3 size={16} />
            月度支出
          </h2>
        </div>
        <div className="expense-period">
          <button aria-label="上一年" onClick={() => setYear(year - 1)}>
            <ChevronLeft size={18} />
          </button>
          <strong aria-live="polite">{year} 年</strong>
          <button aria-label="下一年" onClick={() => setYear(year + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="expense-total">
          <span>年度支出合计</span>
          <strong>{formatAmount(yearCents / 100)}</strong>
        </div>
        <p className="expense-caption">
          按付款月份 · 退款不抵减 · 轻触柱形查看金额
        </p>
        <div
          className="expense-chart"
          role="group"
          aria-label={`${year} 年每月支出柱状图`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              accessibilityLayer
              data={months}
              margin={{ top: 16, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--line)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                interval={0}
                tickFormatter={(label: string) => label.replace("月", "")}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                width={44}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) =>
                  Number(value) >= 10000
                    ? `${Number(value) / 10000}万`
                    : String(value)
                }
              />
              <Tooltip
                trigger="click"
                formatter={(value: number) => [
                  formatAmount(Number(value)),
                  "支出",
                ]}
                labelFormatter={(label) => `${year} 年 ${label}`}
                contentStyle={{
                  background: "var(--card)",
                  color: "var(--text)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="amount"
                name="支出"
                fill="var(--accent)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {yearCents === 0 && <p className="expense-empty">该年暂无支出记录</p>}
        <details className="expense-month-values">
          <summary>查看每月金额</summary>
          <dl>
            {months.map((item) => (
              <div key={item.month}>
                <dt>{item.label}</dt>
                <dd>
                  {item.amount === null ? "—" : formatAmount(item.amount)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
        <p className="expense-caption">
          横轴为月份；无支出月份显示 0，未来无记录月份显示 —。
        </p>
      </section>

      {monthOpen && (
        <Overlay
          title="每日支出"
          variant="page"
          onClose={() => setMonthOpen(false)}
        >
          <div className="expense-period">
            <button aria-label="上个月" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={18} />
            </button>
            <input
              type="month"
              aria-label="选择支出月份"
              value={month}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value))
                  setMonth(event.target.value);
              }}
            />
            <button aria-label="下个月" onClick={() => shiftMonth(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="expense-total">
            <span>当月支出 · {monthDays.length} 天</span>
            <strong>{formatAmount(monthCents / 100)}</strong>
          </div>
          {dayRows(monthDays)}
          {monthDays.length === 0 && (
            <p className="expense-empty">这个月暂无支出</p>
          )}
        </Overlay>
      )}

      {selectedDate && (
        <Overlay
          title="当天支出明细"
          variant="page"
          onClose={() => setSelectedDate(null)}
        >
          <div className="expense-detail-summary">
            <p>{formatDisplayDate(selectedDate)}</p>
            <strong>{formatAmount((selectedDay?.cents ?? 0) / 100)}</strong>
            <span>
              {selectedDay?.transactions.length ?? 0} 笔支出 · 按付款日期
            </span>
          </div>
          <ul className="space-y-2">
            {selectedDay?.transactions.map(renderTransaction)}
          </ul>
          {!selectedDay && <p className="expense-empty">这一天已无支出记录</p>}
        </Overlay>
      )}
    </>
  );
};
