export type CopperAccount = 'liquid' | 'reserve' | 'collection';

export interface CopperBreakdown {
  liquid: number;
  reserve: number;
  collection: number;
}

export type CopperRatios = CopperBreakdown;
export type CopperBalances = CopperBreakdown;

export interface Transaction {
  id: number;
  date: string; // Local date string YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;
  desc: string;
  source?: CopperAccount;
  allocation?: CopperBreakdown;
  isLegacyLocked?: boolean;
}

export interface CopperData {
  ratios: CopperRatios;
  balances: CopperBalances;
  transactions: Transaction[];
}

export interface DailyData {
  dailyLimit: number;
  transactions: Transaction[];
}

export enum ViewType {
  COPPER = 'copper',
  DAILY = 'daily'
}
