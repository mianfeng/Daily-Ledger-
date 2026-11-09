import { DailyTransaction } from "../types";
import { normalizeDateInput } from "./date";

export interface ExpenseDay {
  date: string;
  cents: number;
  transactions: DailyTransaction[];
}

// Accept history in display order, preserving the existing within-day ordering.
// Payment date is deliberately independent of budget effectiveDate.
export const getExpenseDays = (
  transactions: DailyTransaction[],
): ExpenseDay[] => {
  const days = new Map<string, ExpenseDay>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const date = normalizeDateInput(transaction.date);
    if (!date) continue;
    const day = days.get(date) ?? { date, cents: 0, transactions: [] };
    day.cents += Math.round(transaction.amount * 100);
    day.transactions.push(transaction);
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
};

export const getExpenseMonths = (
  days: ExpenseDay[],
  year: number,
  today: string,
) =>
  Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const matching = days.filter((day) => day.date.startsWith(`${month}-`));
    const cents = matching.reduce((total, day) => total + day.cents, 0);
    return {
      month,
      label: `${index + 1}月`,
      cents,
      amount:
        month > today.slice(0, 7) && matching.length === 0 ? null : cents / 100,
    };
  });
