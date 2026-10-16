// Small decimal-only calculator. Never execute user input as JavaScript.
export const evaluateMoneyExpression = (input: string): number | null => {
  const text = input.replace(/\s/g, "").replace(/−/g, "-");
  if (
    !text ||
    text.length > 160 ||
    !/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})(?:[+-](?:\d+(?:\.\d{0,2})?|\.\d{1,2}))*$/.test(
      text,
    )
  )
    return null;
  const terms = text.match(/[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})/g) ?? [];
  let cents = 0;
  for (const term of terms) {
    const next = Math.round(Number(term) * 100);
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(cents + next))
      return null;
    cents += next;
  }
  return cents / 100;
};

export const moneyValue = (value: string) =>
  evaluateMoneyExpression(value) ?? Number.NaN;
export const formatMoneyValue = (value: number) =>
  `${value < 0 ? "−" : ""}¥${Math.abs(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
