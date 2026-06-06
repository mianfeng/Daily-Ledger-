import { AppBackup, AppLedgerData, CopperData, DailyData } from '../types';
import { sanitizeCopperData } from './copper';
import { sanitizeDailyData } from './daily';

export const COPPER_STORAGE_KEY = 'coinShopData_v5';
export const DAILY_STORAGE_KEY = 'dailyBookData_v5';

export const DEFAULT_COPPER_DATA: CopperData = {
  ratios: { liquid: 60, reserve: 40 },
  balances: { liquid: 4, reserve: 100 },
  inventoryCost: 0,
  transactions: [],
};

export const DEFAULT_DAILY_DATA: DailyData = {
  dailyLimit: 30,
  transactions: [],
};

export const DEFAULT_LEDGER_DATA: AppLedgerData = {
  copper: DEFAULT_COPPER_DATA,
  daily: DEFAULT_DAILY_DATA,
};

export const sanitizeLedgerData = (raw: unknown): AppLedgerData => {
  const value =
    typeof raw === 'object' && raw !== null
      ? (raw as Partial<AppLedgerData>)
      : {};

  return {
    copper: sanitizeCopperData(value.copper, DEFAULT_COPPER_DATA),
    daily: sanitizeDailyData(value.daily, DEFAULT_DAILY_DATA),
  };
};

export const sanitizeBackup = (raw: unknown): AppLedgerData => {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Partial<AppBackup>) : {};
  return sanitizeLedgerData({
    copper: value.copper,
    daily: value.daily,
  });
};

export const readLocalLedgerData = (): AppLedgerData => {
  const readStored = <T>(
    key: string,
    fallback: T,
    sanitize: (raw: unknown, fallback: T) => T,
  ) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? sanitize(JSON.parse(raw), fallback) : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    copper: readStored(COPPER_STORAGE_KEY, DEFAULT_COPPER_DATA, sanitizeCopperData),
    daily: readStored(DAILY_STORAGE_KEY, DEFAULT_DAILY_DATA, sanitizeDailyData),
  };
};

export const hasLocalLedgerData = () => {
  try {
    return (
      window.localStorage.getItem(COPPER_STORAGE_KEY) !== null ||
      window.localStorage.getItem(DAILY_STORAGE_KEY) !== null
    );
  } catch {
    return false;
  }
};
