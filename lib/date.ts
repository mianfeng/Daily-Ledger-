const pad = (value: number) => String(value).padStart(2, '0');

const formatUtcDate = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const getTodayDate = () => formatLocalDate(new Date());

export const formatMonthKey = (year: number, month: number) =>
  `${year}-${pad(month)}`;

export const normalizeDateInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const isoPrefix = trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
  const directMatch = isoPrefix.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (directMatch) {
    const [, year, month, day] = directMatch;
    return `${year}-${pad(Number(month))}-${pad(Number(day))}`;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${pad(Number(month))}-${pad(Number(day))}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return formatLocalDate(parsed);
  }

  return '';
};

export const parseSpreadsheetDate = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpochMs = Date.UTC(1899, 11, 30);
    return formatUtcDate(new Date(excelEpochMs + Math.round(value * 86400000)));
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDate(value);
  }

  if (typeof value === 'string') {
    return normalizeDateInput(value);
  }

  return '';
};

export const isDateInMonth = (value: string, year: number, month: number) =>
  normalizeDateInput(value).startsWith(formatMonthKey(year, month));

export const getDayOfMonth = (value: string) => {
  const normalized = normalizeDateInput(value);
  return normalized ? Number(normalized.slice(8, 10)) : 0;
};

export const getMonthKey = (value: string) => normalizeDateInput(value).slice(0, 7);

export const formatDisplayDate = (value: string) => {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    return value;
  }

  const [year, month, day] = normalized.split('-');
  return `${year}/${Number(month)}/${Number(day)}`;
};
