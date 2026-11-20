// =====================================================
// storage.js — the copy of the data kept on this device,
// and merging it with the copy from the cloud.
//
// Every account and operation has `updatedAt` (a timestamp).
// Deleted ones aren't removed but marked { deleted: true },
// so the other device also learns they were deleted.
// =====================================================

const USER_KEY = id => `spendings-v3-${id}`;
const LAST_USER_KEY = 'spendings-last-user';
const OLD_KEYS = ['spendings-v2', 'spendings-v1'];   // data from before accounts existed

export function defaultState() {
  return {
    accounts: [
      { id: 'mono_white', group: 'mono', style: 'white', currency: 'UAH', start: 0, savings: false, updatedAt: 0 },
      { id: 'mono_black', group: 'mono', style: 'black', currency: 'UAH', start: 0, savings: false, updatedAt: 0 },
      { id: 'mono_usd', group: 'mono', style: 'usd', currency: 'USD', start: 0, savings: false, updatedAt: 0 },
      { id: 'privat', group: 'other', style: 'privat', currency: 'UAH', start: 0, savings: false, updatedAt: 0 },
      { id: 'pumb', group: 'other', style: 'pumb', currency: 'UAH', start: 0, savings: false, updatedAt: 0 },
      { id: 'cash', group: 'other', style: 'cash', currency: 'UAH', start: 0, savings: false, updatedAt: 0 }
    ],
    // { id, type: 'expense' | 'income', amount, account, category, date: 'YYYY-MM-DD', note, createdAt, updatedAt }
    // amount is in the account's own currency
    operations: [],
    monthlyLimit: 5000,
    limitUpdatedAt: 0,
    // UAH per 1 unit of currency; refreshed from monobank
    rates: { USD: 41.5, EUR: 48, updatedAt: null }
  };
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the cloud copy still has everything
  }
}

// Turns data from the older versions of the app into the current shape
function upgrade(old) {
  const state = defaultState();
  const accountMap = { mono: 'mono_white' };   // v1 had a single "mono" account
  for (const acc of old.accounts ?? []) {
    const id = accountMap[acc.id] ?? acc.id;
    const existing = state.accounts.find(a => a.id === id);
    const stamped = { ...acc, id, updatedAt: acc.updatedAt ?? Date.now() };
    if (existing) Object.assign(existing, stamped);
    else state.accounts.push(stamped);
  }
  state.operations = (old.operations ?? []).map(op => ({
    ...op,
    account: accountMap[op.account] ?? op.account,
    updatedAt: op.updatedAt ?? op.createdAt ?? Date.now()
  }));
  if (old.monthlyLimit !== undefined) {
    state.monthlyLimit = old.monthlyLimit;
    state.limitUpdatedAt = Date.now();
  }
  if (old.rates) state.rates = old.rates;
  return state;
}

// Data of this user on this device. On the very first login,
// data entered before accounts existed is taken along.
export function loadState(userId) {
  const saved = read(USER_KEY(userId));
  if (saved) return { ...defaultState(), ...saved };

  for (const key of OLD_KEYS) {
    const old = read(key);
    if (old) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return upgrade(old);
    }
  }
  return defaultState();
}

export function saveState(state, userId) {
  write(USER_KEY(userId), state);
}

// Remembers who was logged in, so the app can open offline
export function rememberUser(user) {
  write(LAST_USER_KEY, user ? { id: user.id, email: user.email } : null);
}

export function lastUser() {
  return read(LAST_USER_KEY);
}

// For each id keeps the version that was changed most recently
function mergeById(a = [], b = []) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt ?? 0) > (prev.updatedAt ?? 0)) map.set(item.id, item);
  }
  return [...map.values()];
}

// Combines this device's data with the cloud's data
export function mergeStates(local, remote) {
  if (!remote) return local;
  const remoteLimitNewer = (remote.limitUpdatedAt ?? 0) > (local.limitUpdatedAt ?? 0);
  const remoteRatesNewer = (remote.rates?.updatedAt ?? 0) > (local.rates?.updatedAt ?? 0);
  return {
    ...local,
    accounts: mergeById(local.accounts, remote.accounts),
    operations: mergeById(local.operations, remote.operations),
    monthlyLimit: remoteLimitNewer ? remote.monthlyLimit : local.monthlyLimit,
    limitUpdatedAt: Math.max(local.limitUpdatedAt ?? 0, remote.limitUpdatedAt ?? 0),
    rates: remoteRatesNewer ? remote.rates : local.rates
  };
}