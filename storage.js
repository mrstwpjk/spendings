// =====================================================
// storage.js — where the data is stored
// Now: in the browser (localStorage).
// Later: these two functions get replaced with Supabase calls,
// and the rest of the app won't notice the difference.
// =====================================================

const STORAGE_KEY = 'spendings-v2';
const OLD_KEY = 'spendings-v1';

// Initial data when the app is opened for the first time.
// Built-in accounts have no `name`: their names come from the dictionary (acc_<id>).
function defaultState() {
  return {
    accounts: [
      { id: 'mono_white', group: 'mono', style: 'white', currency: 'UAH', start: 0, savings: false },
      { id: 'mono_black', group: 'mono', style: 'black', currency: 'UAH', start: 0, savings: false },
      { id: 'mono_usd', group: 'mono', style: 'usd', currency: 'USD', start: 0, savings: false },
      { id: 'privat', group: 'other', style: 'privat', currency: 'UAH', start: 0, savings: false },
      { id: 'pumb', group: 'other', style: 'pumb', currency: 'UAH', start: 0, savings: false },
      { id: 'cash', group: 'other', style: 'cash', currency: 'UAH', start: 0, savings: false }
    ],
    // Each operation:
    // { id, type: 'expense' | 'income', amount, account, category, date: 'YYYY-MM-DD', note, createdAt }
    // amount is in the account's own currency
    operations: [],
    monthlyLimit: 5000,
    // UAH per 1 unit of currency; refreshed from monobank
    rates: { USD: 41.5, EUR: 48, updatedAt: null }
  };
}

// Moves data from the first version of the app (accounts mono/privat/pumb/cash)
function migrateFromV1(old) {
  const state = defaultState();
  const accountMap = { mono: 'mono_white', privat: 'privat', pumb: 'pumb', cash: 'cash' };
  for (const acc of old.accounts ?? []) {
    const target = state.accounts.find(a => a.id === accountMap[acc.id]);
    if (target) target.start = acc.start ?? 0;
  }
  state.operations = (old.operations ?? []).map(op => ({ ...op, account: accountMap[op.account] ?? op.account }));
  state.monthlyLimit = old.monthlyLimit ?? state.monthlyLimit;
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };

    const oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw) return migrateFromV1(JSON.parse(oldRaw));
  } catch {
    // Corrupted data or no storage — start fresh instead of crashing
  }
  return defaultState();
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Saving failed (e.g. private mode) — data lives until the tab is closed
  }
}