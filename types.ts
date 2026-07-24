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

export type DailyExpenseCategory =
  | 'daily'
  | 'dining'
  | 'other'
  | 'unplanned'
  | 'large'
  | 'fixed'
  | 'unrecorded';

export type DailyIncomeKind = 'main' | 'casual' | 'refund' | 'correction';

export type DailyExpenseTiming = 'prepaid';

export type DailyTransferKind = 'weeklyRollover' | 'cycleRollover';

export interface DailyTransactionAllocation {
  week: number;
  buffer: number;
  advance: number;
  reserve: number;
  fixed: number;
  reserveDeposit?: number;
  reserveRecovery?: number;
}

export interface DailyTransactionBalanceAfter {
  spendable: number;
  weekRemaining: number;
  futureSpendable: number;
  buffer: number;
  reserve: number;
  fixedReserved: number;
}

export interface DailyTransaction extends BaseTransaction {
  type: 'income' | 'expense' | 'transfer';
  createdAt?: string;
  category?: DailyExpenseCategory;
  incomeKind?: DailyIncomeKind;
  transferKind?: DailyTransferKind;
  expenseTiming?: DailyExpenseTiming;
  effectiveDate?: string;
  allocation?: DailyTransactionAllocation;
  fixedExpenseId?: number;
  cycleId?: number;
  weekIndex?: number;
  previousCycle?: BudgetCycle | null;
  previousPockets?: LifeBudgetPockets;
  balanceBefore?: DailyTransactionBalanceAfter;
  balanceAfter?: DailyTransactionBalanceAfter;
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
  confirmationStatus?: 'pending' | 'confirmed' | 'cancelled';
  confirmedAt?: string;
  cancelledAt?: string;
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
  budget?: LifeBudgetState;
}

export interface LifeBudgetSettings {
  expectedPayday: number;
  savingsRate: number;
  bufferRate: number;
  reserveFixedAmount: number;
  bufferFixedAmount: number;
  reserveRecoveryRate: number;
  weeklyRolloverReserveRate: number;
  reserveGoal: number;
  bufferCap: number;
  minimumWeeklyLiving: number;
  reserveMinimumOverride: number | null;
  largeExpenseAbsoluteThreshold: number;
  largeExpenseWeeklyRate: number;
}

export interface LifeBudgetPockets {
  spendable: number;
  buffer: number;
  reserve: number;
  fixedReserved: number;
}

export interface BudgetWeek {
  index: number;
  startDate: string;
  endDate: string;
  allowance: number;
}

export interface BudgetCycle {
  id: number;
  startDate: string;
  plannedEndDate: string;
  plannedNextIncomeDate: string;
  status: 'active' | 'extended' | 'closed';
  mainIncome: number;
  fixedReserved: number;
  reserveDeposit: number;
  reserveRecovery: number;
  startingBuffer: number;
  weeklyAllowance: number;
  rolledOverWeekIndexes: number[];
  weeks: BudgetWeek[];
}

export interface FixedExpense {
  id: number;
  name: string;
  amount: number;
  dueDay: number;
  isActive: boolean;
  paidCycleId?: number;
  paidDate?: string;
}

export interface LifeBudgetState {
  initialized: boolean;
  settings: LifeBudgetSettings;
  pockets: LifeBudgetPockets;
  currentCycle: BudgetCycle | null;
  archivedCycles: BudgetCycle[];
  fixedExpenses: FixedExpense[];
}

export interface AppLedgerData {
  copper: CopperData;
  daily: DailyData;
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
