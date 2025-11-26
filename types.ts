export interface Transaction {
  id: number;
  date: string; // ISO string YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;
  desc: string;
  source?: 'liquid' | 'reserve' | 'collection'; // For Copper Shop
}

export interface CopperData {
  ratios: {
    liquid: number;
    reserve: number;
    collection: number;
  };
  balances: {
    liquid: number;
    reserve: number;
    collection: number;
  };
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
