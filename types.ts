export type CopperAccount = 'liquid' | 'reserve';

export interface CopperBreakdown {
  liquid: number;
  reserve: number;
}

export type CopperRatios = CopperBreakdown;
export type CopperBalances = CopperBreakdown;

interface BaseTransaction {
  id: number;
  date: string; // Local date string YYYY-MM-DD
  amount: number;
  desc: string;
}

export interface DailyTransaction extends BaseTransaction {
  type: 'income' | 'expense';
}

export interface CopperTransaction extends BaseTransaction {
  type: 'income' | 'expense' | 'inventory_adjustment';
  cost?: number;
  profit?: number;
  cashAllocation?: CopperBreakdown;
  inventoryDelta?: number;
  ratiosSnapshot?: CopperRatios;
  previousInventoryCost?: number;
  nextInventoryCost?: number;
  isLegacyLocked?: boolean;
}

export type Transaction = DailyTransaction;

export interface CopperData {
  ratios: CopperRatios;
  balances: CopperBalances;
  inventoryCost: number;
  transactions: CopperTransaction[];
}

export interface DailyData {
  dailyLimit: number;
  transactions: DailyTransaction[];
}

export interface AppBackup {
  version: number;
  exportedAt: string;
  origin?: string;
  copper: CopperData;
  daily: DailyData;
}

export enum ViewType {
  COPPER = 'copper',
  DAILY = 'daily'
}
