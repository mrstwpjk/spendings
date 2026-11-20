// =====================================================
// app.js — main logic: login, screens, sync and user actions
// =====================================================

import {
  t, getLang, setLang, applyStaticTexts, locale,
  formatMoney, currencySymbol, formatDay, formatMonth, formatMonthShort, weekdayNames
} from './i18n.js';
import { defaultState, loadState, saveState, mergeStates, rememberUser, lastUser } from './storage.js';
import { isConfigured, getUser, signIn, signUp, signOut, pullRemote, pushRemote } from './sync.js';

// ---------- Categories ----------
// Categories live in the data (state.categories), so you can add and delete them.
// These are the colors you can pick for a new category.
const CATEGORY_COLORS = [
  '#F28CA2', '#FFB3C1', '#FF9E7A', '#FFD08A', '#B9E59A',
  '#9EE6C9', '#A9C8FF', '#8FA8FF', '#C9B6FF', '#C9CEDB'
];

// ---------- App state ----------
let user = null;              // { id, email } of the logged-in user
let state = defaultState();

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();       // 0 = January
let selectedDay = todayISO();          // day picked in the calendar
let currentView = 'home';

// New/edited operation in the dialog. editingId = null means "new"
let draft = { editingId: null, type: 'expense', amount: '', account: null, category: null };

let authMode = 'login';                // 'login' or 'signup'
let syncStatus = 'ok';                 // 'ok' | 'syncing' | 'offline' | 'error'
let syncTimer = null;
let syncErrorText = '';               // why the last sync failed (shown in the profile)

const $ = id => document.getElementById(id);

// ---------- Helpers ----------

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return isoDate(new Date());
}

function monthPrefix(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function parseAmount(text) {
  return parseFloat(String(text).replace(/\s/g, '').replace(',', '.'));
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Deleted items stay in the data (so the other device learns about it), but are hidden
function liveAccounts() {
  return state.accounts.filter(a => !a.deleted);
}

function liveOps() {
  return state.operations.filter(op => !op.deleted);
}

function accountById(id) {
  return state.accounts.find(a => a.id === id);
}

function accountName(account) {
  return account.name ?? t('acc_' + account.id);
}

// Full name for lists: 'mono · Біла' for monobank accounts
function accountLabel(account) {
  if (!account) return '';
  return account.group === 'mono' ? `mono · ${accountName(account)}` : accountName(account);
}

// Includes deleted categories, so old transactions still show their name
function categoryById(id) {
  return state.categories.find(c => c.id === id) ?? { id, color: '#C9CEDB' };
}

// Categories you can pick right now for 'expense' or 'income'
function liveCategories(type) {
  return state.categories.filter(c => !c.deleted && c.type === type);
}

// Built-in categories are translated; your own ones have a name
function categoryName(id) {
  const category = categoryById(id);
  return category.name ?? t('cat_' + id);
}

// Converts an amount in any currency to hryvnias using the saved rate
function toUAH(amount, currency) {
  if (currency === 'UAH') return amount;
  return amount * (state.rates[currency] ?? 1);
}

function opInUAH(op) {
  const account = accountById(op.account);
  return toUAH(op.amount, account?.currency ?? 'UAH');
}

// How much all recorded operations changed an account: income − expenses
function operationsTotal(account) {
  return liveOps()
    .filter(op => op.account === account.id)
    .reduce((sum, op) => op.type === 'income' ? sum + op.amount : sum - op.amount, 0);
}

// Money on the account right now, in its own currency
function accountBalance(account) {
  return round2(account.start + operationsTotal(account));
}

// "There's X on this account now": the starting amount is adjusted so the
// balance becomes exactly X, while all operations stay as they are
function setCurrentBalance(account, current) {
  const newStart = round2(current - operationsTotal(account));
  if (newStart === account.start) return false;
  account.start = newStart;
  account.updatedAt = Date.now();
  return true;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Only everyday accounts count towards spending and the limit, not savings
function isSpendingOp(op) {
  const account = accountById(op.account);
  return account && !account.deleted && !account.savings;
}

function operationsInMonth(year, month) {
  const prefix = monthPrefix(year, month);
  return liveOps().filter(op => op.date.startsWith(prefix) && isSpendingOp(op));
}

function sumUAH(operations, type) {
  return operations.filter(op => op.type === type).reduce((sum, op) => sum + opInUAH(op), 0);
}

function dayLabel(iso) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === todayISO()) return t('today');
  if (iso === isoDate(y)) return t('yesterday');
  return formatDay(iso);
}

// '1250.5' → '1250,5' — how an amount looks on the keypad display
function amountToText(amount) {
  return String(amount).replace('.', ',');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Saving and syncing ----------

// Called after every change: save on the device now, sync a moment later
function persist() {
  saveState(state, user.id);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 800);
}

// Download the cloud copy, merge it with this device's copy, upload the result
async function syncNow() {
  if (!user) return;
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }
  setSyncStatus('syncing');
  try {
    const remote = await pullRemote(user.id);
    state = mergeStates(state, remote);
    saveState(state, user.id);
    await pushRemote(user.id, state);
    syncErrorText = '';
    setSyncStatus('ok');
    renderAll();
  } catch (error) {
    // Keep the technical reason to show it in the profile
    syncErrorText = error?.message ?? String(error);
    setSyncStatus(navigator.onLine ? 'error' : 'offline');
  }
}

function setSyncStatus(status) {
  syncStatus = status;
  const dot = $('sync-dot');
  dot.className = 'sync-dot ' + status;
  dot.title = t('sync_' + status);
  dot.setAttribute('aria-label', t('sync_' + status));
  const details = status === 'error' && syncErrorText ? ` (${syncErrorText})` : '';
  $('sync-text').textContent = t('sync_' + status) + details;
}

// ---------- Exchange rate from monobank ----------
// Public endpoint, no token needed. mono allows one request per few minutes,
// so the rate is cached and refreshed at most once an hour.
async function refreshRates() {
  const hour = 60 * 60 * 1000;
  if (state.rates.updatedAt && Date.now() - state.rates.updatedAt < hour) return;
  try {
    const response = await fetch('https://api.monobank.ua/bank/currency');
    if (!response.ok) return;
    const list = await response.json();
    const find = code => list.find(r => r.currencyCodeA === code && r.currencyCodeB === 980);
    const usd = find(840);
    const eur = find(978);
    if (usd) state.rates.USD = usd.rateSell ?? usd.rateCross;
    if (eur) state.rates.EUR = eur.rateSell ?? eur.rateCross;
    state.rates.updatedAt = Date.now();
    persist();
    renderAll();
  } catch {
    // No internet or the request was blocked — keep the saved rate
  }
}

// ---------- Login / sign up ----------

function showAuth(message) {
  $('app').hidden = true;
  $('auth').hidden = false;
  renderAuth();
  if (message) showAuthError(message);
}

function renderAuth() {
  const signup = authMode === 'signup';
  $('auth-title').textContent = t(signup ? 'auth_title_signup' : 'auth_title_login');
  $('auth-submit').textContent = t(signup ? 'auth_signup_btn' : 'auth_login_btn');
  $('auth-switch').textContent = t(signup ? 'auth_switch_to_login' : 'auth_switch_to_signup');
  $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
}

function showAuthError(text) {
  $('auth-info').hidden = true;
  $('auth-error').textContent = text;
  $('auth-error').hidden = false;
}

function showAuthInfo(text) {
  $('auth-error').hidden = true;
  $('auth-info').textContent = text;
  $('auth-info').hidden = false;
}

// Turns Supabase's English error messages into friendly ones
function authErrorText(error) {
  const msg = String(error?.message ?? error);
  if (msg === 'not_configured') return t('auth_not_configured');
  if (/invalid login credentials/i.test(msg)) return t('auth_invalid');
  if (/already registered|already exists/i.test(msg)) return t('auth_exists');
  if (/email not confirmed/i.test(msg)) return t('auth_not_confirmed');
  if (/failed to fetch|network|load failed|import/i.test(msg)) return t('auth_offline');
  return t('auth_generic', { msg });
}

async function submitAuth(event) {
  event.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email.includes('@')) return showAuthError(t('auth_bad_email'));
  if (password.length < 6) return showAuthError(t('auth_short_password'));

  const button = $('auth-submit');
  button.disabled = true;
  button.textContent = t('wait');
  try {
    if (authMode === 'signup') {
      const result = await signUp(email, password);
      if (result.needsConfirmation) {
        authMode = 'login';
        renderAuth();
        showAuthInfo(t('auth_check_email'));
        return;
      }
      await enterApp(result.user);
    } else {
      await enterApp(await signIn(email, password));
    }
  } catch (error) {
    showAuthError(authErrorText(error));
  } finally {
    button.disabled = false;
    if (!$('auth').hidden) renderAuth();
  }
}

async function enterApp(loggedIn) {
  user = { id: loggedIn.id, email: loggedIn.email };
  rememberUser(user);
  state = loadState(user.id);
  $('auth').hidden = true;
  $('app').hidden = false;
  $('auth-password').value = '';
  $('auth-error').hidden = true;
  $('auth-info').hidden = true;
  showView('home');
  setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
  await syncNow();
  refreshRates();
}

async function logout() {
  try {
    await syncNow();       // upload the last changes first
    await signOut();
  } catch {
    // Offline — the session is still cleared on this device below
  }
  rememberUser(null);
  user = null;
  state = defaultState();
  authMode = 'login';
  showAuth();
}

// ---------- Home ----------

function renderBalance() {
  const everyday = liveAccounts().filter(a => !a.savings);
  let total = 0;
  const foreign = {};
  for (const account of everyday) {
    const balance = accountBalance(account);
    total += toUAH(balance, account.currency);
    if (account.currency !== 'UAH' && balance !== 0) {
      foreign[account.currency] = (foreign[account.currency] ?? 0) + balance;
    }
  }
  $('total').textContent = formatMoney(Math.round(total));

  const parts = Object.entries(foreign);
  if (parts.length) {
    const foreignText = parts.map(([cur, sum]) => formatMoney(sum, cur)).join(' + ');
    const uahText = formatMoney(Math.round(parts.reduce((s, [cur, sum]) => s + toUAH(sum, cur), 0)));
    $('total-note').textContent = t('total_note_usd', { foreign: foreignText, uah: uahText });
  } else {
    $('total-note').textContent = '';
  }
}

function renderAccounts() {
  const box = $('account-groups');
  box.innerHTML = '';
  const everyday = liveAccounts().filter(a => !a.savings);
  const groups = [
    { key: 'mono', accounts: everyday.filter(a => a.group === 'mono') },
    { key: 'other', accounts: everyday.filter(a => a.group !== 'mono') }
  ];
  for (const group of groups) {
    if (!group.accounts.length) continue;
    box.append(el('p', 'group-title muted small', t('group_' + group.key)));
    const grid = el('div', 'accounts');
    for (const account of group.accounts) {
      // Tapping a card lets you correct its balance or delete it
      const card = el('button', `acc acc-${account.style ?? 'custom'}`);
      card.type = 'button';
      card.append(el('span', 'acc-name', accountName(account)));
      card.append(el('strong', 'acc-sum', formatMoney(accountBalance(account), account.currency)));
      card.setAttribute('aria-label', `${t('balance_edit_title')}: ${accountName(account)}, ${formatMoney(accountBalance(account), account.currency)}`);
      card.addEventListener('click', () => openBalanceDialog(account.id));
      grid.append(card);
    }
    box.append(grid);
  }
}

function renderSavings() {
  const box = $('savings');
  box.innerHTML = '';
  const head = el('div', 'row-between');
  head.append(el('span', 'strong', t('savings')), el('span', 'muted small', t('savings_hint')));
  box.append(head);

  const savings = liveAccounts().filter(a => a.savings);
  if (!savings.length) {
    box.append(el('p', 'muted small', t('savings_empty')));
    return;
  }
  for (const account of savings) {
    const balance = accountBalance(account);
    const row = el('button', 'row-between savings-row');
    row.type = 'button';
    row.addEventListener('click', () => openBalanceDialog(account.id));
    row.append(el('span', '', accountName(account)));
    const value = account.goal
      ? t('goal_progress', { have: formatMoney(balance, account.currency), goal: formatMoney(account.goal, account.currency) })
      : formatMoney(balance, account.currency);
    row.append(el('span', 'accent-text', value));
    box.append(row);
    if (account.goal) {
      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      fill.style.width = Math.min(Math.max(balance / account.goal, 0), 1) * 100 + '%';
      bar.append(fill);
      box.append(bar);
    }
  }
}

function renderLimit() {
  // The limit always shows the real current month
  const d = new Date();
  const spent = sumUAH(operationsInMonth(d.getFullYear(), d.getMonth()), 'expense');
  const limit = state.monthlyLimit;
  const ring = $('limit-ring');
  const circumference = 2 * Math.PI * 17;

  $('limit-spent').textContent = t('limit_spent', { spent: formatMoney(Math.round(spent)) });
  ring.classList.remove('over');

  if (!limit) {
    $('limit-title').textContent = t('limit_none');
    $('limit-left').textContent = '';
    ring.style.strokeDasharray = `0 ${circumference}`;
    return;
  }

  $('limit-title').textContent = t('limit_title', {
    month: formatMonth(d.getFullYear(), d.getMonth()).split(' ')[0],
    limit: formatMoney(limit)
  });
  const ratio = spent / limit;
  ring.style.strokeDasharray = `${Math.min(ratio, 1) * circumference} ${circumference}`;

  const left = $('limit-left');
  if (ratio >= 1) {
    ring.classList.add('over');
    left.className = 'small neg';
    left.textContent = t('limit_over', { over: formatMoney(Math.round(spent - limit)) });
  } else {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - d.getDate() + 1;
    left.className = 'small pos';
    left.textContent = t('limit_left', {
      left: formatMoney(Math.round(limit - spent)),
      perDay: formatMoney(Math.round((limit - spent) / daysLeft))
    });
  }
}

// One transaction row (Home and Calendar). Tapping it opens the edit dialog.
function renderOperationRow(op, showDate) {
  const account = accountById(op.account);
  const category = categoryById(op.category);
  const row = el('button', 'op');
  row.type = 'button';
  row.addEventListener('click', () => openOperationDialog(op));

  const badge = el('span', 'badge', categoryName(op.category).charAt(0).toUpperCase());
  badge.style.color = category.color;

  const info = el('span', 'op-info');
  info.append(el('span', 'op-title', op.note || categoryName(op.category)));
  // If there's no note, the category is already the title, so don't repeat it
  const details = op.note ? [categoryName(op.category), accountLabel(account)] : [accountLabel(account)];
  if (showDate) details.unshift(dayLabel(op.date));
  // textContent (not innerHTML) so a note can't inject HTML
  info.append(el('span', 'muted small ellipsis', details.join(' · ')));

  const sign = op.type === 'income' ? '+' : '−';
  const amount = el('span', 'op-amount ' + (op.type === 'income' ? 'pos' : 'neg'),
    sign + formatMoney(op.amount, account?.currency ?? 'UAH'));

  row.setAttribute('aria-label', `${t('edit_operation')}: ${op.note || categoryName(op.category)}, ${amount.textContent}`);
  row.append(badge, info, amount);
  return row;
}

function renderRecent() {
  const box = $('recent');
  box.innerHTML = '';
  const recent = liveOps()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, 6);
  if (!recent.length) {
    box.append(el('p', 'muted small empty', t('empty')));
    return;
  }
  for (const op of recent) box.append(renderOperationRow(op, true));
}

// ---------- Calendar ----------

function renderMonthLabels() {
  document.querySelectorAll('.month-label').forEach(h => {
    h.textContent = formatMonth(viewYear, viewMonth);
  });
}

function renderCalendar() {
  const ops = operationsInMonth(viewYear, viewMonth);
  $('cal-expense').textContent = '−' + formatMoney(Math.round(sumUAH(ops, 'expense')));
  $('cal-income').textContent = '+' + formatMoney(Math.round(sumUAH(ops, 'income')));

  const weekdays = $('weekdays');
  weekdays.innerHTML = '';
  for (const name of weekdayNames()) weekdays.append(el('span', 'weekday muted small', name));

  // Spending per day, in UAH
  const perDay = {};
  for (const op of ops) {
    if (op.type === 'expense') perDay[op.date] = (perDay[op.date] ?? 0) + opInUAH(op);
  }
  const max = Math.max(0, ...Object.values(perDay));

  const grid = $('cal-grid');
  grid.innerHTML = '';
  const firstDay = new Date(viewYear, viewMonth, 1);
  const offset = (firstDay.getDay() + 6) % 7;   // Monday = 0
  for (let i = 0; i < offset; i++) grid.append(el('span'));

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = todayISO();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${monthPrefix(viewYear, viewMonth)}-${String(day).padStart(2, '0')}`;
    const spent = perDay[iso] ?? 0;
    // Heat level 0–3: the darker the cell, the more was spent
    const level = spent === 0 ? 0 : spent < max / 3 ? 1 : spent < (max * 2) / 3 ? 2 : 3;

    const cell = el('button', `day heat-${level}`);
    if (iso > today) cell.classList.add('future');
    if (iso === selectedDay) cell.classList.add('selected');
    cell.append(el('span', 'day-num', String(day)));
    if (spent) cell.append(el('span', 'day-sum', String(Math.round(spent))));
    cell.setAttribute('aria-label', `${formatDay(iso)}: ${formatMoney(Math.round(spent))}`);
    cell.addEventListener('click', () => {
      selectedDay = iso;
      renderCalendar();
    });
    grid.append(cell);
  }

  renderDay();
}

function renderDay() {
  const ops = liveOps()
    .filter(op => op.date === selectedDay)
    .sort((a, b) => b.createdAt - a.createdAt);
  $('day-title').textContent = dayLabel(selectedDay);
  const spent = sumUAH(ops.filter(isSpendingOp), 'expense');
  $('day-total').textContent = spent ? '−' + formatMoney(Math.round(spent)) : '';

  const box = $('day-list');
  box.innerHTML = '';
  if (!ops.length) {
    box.append(el('p', 'muted small empty', t('empty_day')));
    return;
  }
  for (const op of ops) box.append(renderOperationRow(op, false));
}

// ---------- Stats ----------

function renderStats() {
  const ops = operationsInMonth(viewYear, viewMonth).filter(op => op.type === 'expense');
  const total = ops.reduce((s, op) => s + opInUAH(op), 0);
  $('donut-total').textContent = formatMoney(Math.round(total));

  // Sum per category, biggest first
  const byCategory = {};
  for (const op of ops) byCategory[op.category] = (byCategory[op.category] ?? 0) + opInUAH(op);
  const rows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  // Donut: one circle per category, shifted with stroke-dashoffset
  const svg = $('donut');
  const r = 66;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  let markup = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="20"></circle>`;
  for (const [id, sum] of rows) {
    const length = (sum / total) * circumference;
    const gap = rows.length > 1 ? 3 : 0;
    markup += `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${categoryById(id).color}" stroke-width="20"
      stroke-dasharray="${Math.max(length - gap, 0)} ${circumference}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 90 90)"></circle>`;
    offset += length;
  }
  svg.innerHTML = markup;
  svg.setAttribute('aria-label', rows.map(([id, sum]) => `${categoryName(id)} ${Math.round((sum / total) * 100)}%`).join(', ') || t('no_expenses'));

  const list = $('cat-list');
  list.innerHTML = '';
  if (!rows.length) {
    list.append(el('p', 'muted small empty', t('no_expenses')));
  }
  for (const [id, sum] of rows) {
    const pct = Math.round((sum / total) * 100);
    const item = el('div', 'cat-row');
    const top = el('div', 'row-between');
    const name = el('span', 'cat-name');
    const dot = el('i', 'dot');
    dot.style.background = categoryById(id).color;
    name.append(dot, document.createTextNode(categoryName(id)));
    top.append(name, el('span', 'muted small', `${formatMoney(Math.round(sum))} · ${pct}%`));
    const bar = el('div', 'bar');
    const fill = el('div', 'bar-fill');
    fill.style.width = pct + '%';
    fill.style.background = categoryById(id).color;
    bar.append(fill);
    item.append(top, bar);
    list.append(item);
  }

  renderBars();
}

function renderBars() {
  // The viewed month and the 5 before it
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(viewYear, viewMonth - i, 1);
    const ops = operationsInMonth(d.getFullYear(), d.getMonth());
    months.push({
      label: formatMonthShort(d.getFullYear(), d.getMonth()),
      income: sumUAH(ops, 'income'),
      expense: sumUAH(ops, 'expense')
    });
  }
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));

  const box = $('bars');
  box.innerHTML = '';
  for (const m of months) {
    const col = el('div', 'bar-col');
    const pair = el('div', 'bar-pair');
    const inc = el('div', 'bar-v pos-bg');
    inc.style.height = (m.income / max) * 100 + '%';
    inc.title = '+' + formatMoney(Math.round(m.income));
    const exp = el('div', 'bar-v neg-bg');
    exp.style.height = (m.expense / max) * 100 + '%';
    exp.title = '−' + formatMoney(Math.round(m.expense));
    pair.append(inc, exp);
    col.append(pair, el('span', 'muted small', m.label));
    box.append(col);
  }
}

// ---------- Profile ----------

function renderProfile() {
  $('profile-email').textContent = user?.email ?? '';
  renderAvatar($('profile-avatar'));
  // Don't overwrite the name while it's being typed
  if (document.activeElement !== $('profile-name')) $('profile-name').value = state.profile.name;
  $('photo-remove').hidden = !state.profile.photo;
  renderCategoryManager();
  setSyncStatus(syncStatus);

  $('limit-input').value = state.monthlyLimit || '';
  const box = $('start-balances');
  box.innerHTML = '';
  for (const account of liveAccounts()) {
    const row = el('div', 'start-row');
    const label = el('label');
    label.append(el('span', '', `${accountLabel(account)} (${currencySymbol(account.currency)})`));
    const input = el('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = accountBalance(account);     // the balance right now, not the starting amount
    input.dataset.account = account.id;
    label.append(input);
    row.append(label);
    // Any account can be deleted, after a confirmation
    const del = el('button', 'icon-btn del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', `${t('delete')}: ${accountLabel(account)}`);
    del.addEventListener('click', () => askDeleteAccount(account.id));
    row.append(del);
    box.append(row);
  }

  const time = state.rates.updatedAt
    ? new Date(state.rates.updatedAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  $('rate-info').textContent = time
    ? `${t('rate_line', { cur: '$', rate: formatMoney(state.rates.USD), when: time })}\n${t('rate_line', { cur: '€', rate: formatMoney(state.rates.EUR), when: time })}`
    : t('rate_fallback', { usd: formatMoney(state.rates.USD), eur: formatMoney(state.rates.EUR) });
}

// ---------- Name and photo ----------

// Puts the photo into a round avatar, or the first letter of the name/email
function renderAvatar(node) {
  node.innerHTML = '';
  if (state.profile.photo) {
    const img = el('img');
    img.src = state.profile.photo;
    img.alt = '';
    node.append(img);
  } else {
    const source = state.profile.name || user?.email || '?';
    node.textContent = source.charAt(0).toUpperCase();
  }
}

function saveName() {
  const name = $('profile-name').value.trim();
  if (name === state.profile.name) return;
  state.profile = { ...state.profile, name, updatedAt: Date.now() };
  persist();
  renderAll();
}

// Shrinks the chosen photo to a 256×256 square, so it's small enough to sync
function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      // Cut the middle square out of the photo
      canvas.getContext('2d').drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, size, size
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad_image'));
    };
    img.src = url;
  });
}

async function choosePhoto(event) {
  const file = event.target.files[0];
  event.target.value = '';           // lets you pick the same file again later
  if (!file) return;
  $('photo-error').hidden = true;
  try {
    const photo = await loadPhoto(file);
    state.profile = { ...state.profile, photo, updatedAt: Date.now() };
    persist();
    renderAll();
  } catch {
    $('photo-error').hidden = false;
  }
}

function removePhoto() {
  state.profile = { ...state.profile, photo: null, updatedAt: Date.now() };
  persist();
  renderAll();
}

// ---------- Categories: list in the profile, create, delete ----------

function renderCategoryManager() {
  for (const type of ['expense', 'income']) {
    const box = $('cat-manage-' + type);
    box.innerHTML = '';
    for (const cat of liveCategories(type)) {
      const row = el('div', 'cat-manage-row');
      const name = el('span', 'cat-name');
      const dot = el('i', 'dot');
      dot.style.background = cat.color;
      name.append(dot, document.createTextNode(categoryName(cat.id)));
      const del = el('button', 'icon-btn del', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `${t('delete')}: ${categoryName(cat.id)}`);
      del.addEventListener('click', () => askDeleteCategory(cat.id));
      row.append(name, del);
      box.append(row);
    }
  }
}

function askDeleteCategory(id) {
  const category = categoryById(id);
  if (liveCategories(category.type).length <= 1) {
    alert(t('category_last'));
    return;
  }
  if (!confirm(t('delete_category_confirm', { name: categoryName(id) }))) return;
  Object.assign(category, { deleted: true, updatedAt: Date.now() });
  persist();
  renderAll();
}

let newCategoryColor = CATEGORY_COLORS[0];
let categoryFromOperation = false;   // true = opened from the transaction dialog

function renderColorChoices() {
  const box = $('cat-colors');
  box.innerHTML = '';
  for (const color of CATEGORY_COLORS) {
    const swatch = el('button', 'swatch' + (color === newCategoryColor ? ' active' : ''));
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', color);
    swatch.setAttribute('aria-pressed', color === newCategoryColor);
    swatch.addEventListener('click', () => {
      newCategoryColor = color;
      renderColorChoices();
    });
    box.append(swatch);
  }
}

function openCategoryDialog(type = 'expense', fromOperation = false) {
  categoryFromOperation = fromOperation;
  $('cat-form').reset();
  $('cat-type').value = type;
  $('cat-error').hidden = true;
  // A color that's not used yet, if there is one
  const used = new Set(liveCategories(type).map(c => c.color));
  newCategoryColor = CATEGORY_COLORS.find(c => !used.has(c)) ?? CATEGORY_COLORS[0];
  renderColorChoices();
  $('cat-dialog').showModal();
  $('cat-name').focus();
}

function saveCategory(event) {
  event.preventDefault();
  const name = $('cat-name').value.trim();
  if (!name) {
    $('cat-error').hidden = false;
    $('cat-name').focus();
    return;
  }
  const category = {
    id: makeId(),
    type: $('cat-type').value,
    name,
    color: newCategoryColor,
    updatedAt: Date.now()
  };
  state.categories.push(category);
  persist();
  $('cat-dialog').close();
  // Opened from the transaction dialog — pick the new category there right away
  if (categoryFromOperation && $('op-dialog').open) {
    draft.type = category.type;
    draft.category = category.id;
    renderDraft();
  }
  renderAll();
}

// ---------- Rendering everything ----------

const VIEW_TITLES = { home: 'title', calendar: 'nav_calendar', stats: 'nav_stats', profile: 'nav_profile' };

const laptop = window.matchMedia('(min-width: 900px)');

function renderAll() {
  if (!user) return;
  // On a laptop the app name is already in the sidebar, so Home gets its own title
  const titleKey = currentView === 'home' && laptop.matches ? 'nav_home' : VIEW_TITLES[currentView];
  $('view-title').textContent = t(titleKey);
  renderAvatar($('top-avatar'));
  renderMonthLabels();
  if (currentView === 'home') {
    renderBalance();
    renderAccounts();
    renderSavings();
    renderLimit();
    renderRecent();
  } else if (currentView === 'calendar') {
    renderCalendar();
  } else if (currentView === 'stats') {
    renderStats();
  } else {
    renderProfile();
  }
}

function showView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(section => {
    section.hidden = section.id !== 'view-' + view;
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
    if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  renderAll();
}

function changeMonth(step) {
  viewMonth += step;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  const firstOfMonth = `${monthPrefix(viewYear, viewMonth)}-01`;
  selectedDay = selectedDay.startsWith(monthPrefix(viewYear, viewMonth)) ? selectedDay : firstOfMonth;
  renderAll();
}

// ---------- Deleting ----------

function deleteOperation(id) {
  const op = state.operations.find(o => o.id === id);
  if (op) Object.assign(op, { deleted: true, updatedAt: Date.now() });
  persist();
  renderAll();
}

function deleteAccount(id) {
  const stamp = Date.now();
  const account = accountById(id);
  if (account) Object.assign(account, { deleted: true, updatedAt: stamp });
  for (const op of state.operations) {
    if (op.account === id && !op.deleted) Object.assign(op, { deleted: true, updatedAt: stamp });
  }
  persist();
  renderAll();
}

// Asks first, because the account's transactions are deleted too
function askDeleteAccount(id) {
  const account = accountById(id);
  if (!account) return false;
  if (!confirm(t('delete_account_confirm', { name: accountLabel(account) }))) return false;
  deleteAccount(id);
  return true;
}

// ---------- Operation dialog: new or edit (keypad) ----------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'];

function buildKeypad() {
  const pad = $('keypad');
  pad.innerHTML = '';
  for (const key of KEYS) {
    const btn = el('button', 'key', key);
    btn.type = 'button';
    if (key === '⌫') btn.setAttribute('aria-label', t('erase'));
    btn.addEventListener('click', () => pressKey(key));
    pad.append(btn);
  }
}

function pressKey(key) {
  let a = draft.amount;
  if (key === '⌫') a = a.slice(0, -1);
  else if (key === ',' || key === '.') { if (!a.includes(',')) a = (a || '0') + ','; }
  else {
    const decimals = a.includes(',') ? a.split(',')[1].length : 0;
    if (decimals < 2 && a.replace(',', '').length < 9) a = a === '0' ? key : a + key;
  }
  draft.amount = a;
  $('op-error').hidden = true;
  renderDraft();
}

function renderDraft() {
  const account = accountById(draft.account);
  $('op-title').textContent = t(draft.editingId ? 'edit_operation' : 'new_operation');
  $('op-delete').hidden = !draft.editingId;
  $('amount-text').textContent = draft.amount || '0';
  $('amount-cur').textContent = currencySymbol(account?.currency ?? 'UAH');

  document.querySelectorAll('.segment button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === draft.type);
    btn.setAttribute('aria-pressed', btn.dataset.type === draft.type);
  });

  const chips = $('op-accounts');
  chips.innerHTML = '';
  for (const acc of liveAccounts()) {
    const chip = el('button', 'chip-btn' + (acc.id === draft.account ? ' active' : ''), accountLabel(acc));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', acc.id === draft.account);
    chip.addEventListener('click', () => { draft.account = acc.id; renderDraft(); });
    chips.append(chip);
  }

  const grid = $('op-categories');
  grid.innerHTML = '';
  for (const cat of liveCategories(draft.type)) {
    const btn = el('button', 'cat' + (cat.id === draft.category ? ' active' : ''));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', cat.id === draft.category);
    const badge = el('span', 'badge big', categoryName(cat.id).charAt(0).toUpperCase());
    badge.style.color = cat.color;
    btn.append(badge, el('span', 'cat-label', categoryName(cat.id)));
    btn.addEventListener('click', () => { draft.category = cat.id; renderDraft(); });
    grid.append(btn);
  }
  // Last tile: create a new category right here
  const add = el('button', 'cat add');
  add.type = 'button';
  add.append(el('span', 'badge big', '+'), el('span', 'cat-label', t('new_short')));
  add.setAttribute('aria-label', t('new_category'));
  add.addEventListener('click', () => openCategoryDialog(draft.type, true));
  grid.append(add);
}

// op = an existing operation to edit, or nothing for a new one
function openOperationDialog(op) {
  if (op && op.id) {
    draft = {
      editingId: op.id,
      type: op.type,
      amount: amountToText(op.amount),
      account: op.account,
      category: op.category
    };
    $('op-date').value = op.date;
    $('op-note').value = op.note ?? '';
  } else {
    const firstAccount = liveAccounts()[0]?.id;
    draft = {
      editingId: null,
      type: 'expense',
      amount: '',
      account: draft.account && accountById(draft.account) && !accountById(draft.account).deleted ? draft.account : firstAccount,
      category: liveCategories('expense')[0]?.id
    };
    $('op-date').value = currentView === 'calendar' ? selectedDay : todayISO();
    $('op-note').value = '';
  }
  $('op-error').hidden = true;
  renderDraft();
  $('op-dialog').showModal();
}

function saveOperation(event) {
  event.preventDefault();
  const amount = parseAmount(draft.amount);
  if (!(amount > 0)) {
    $('op-error').hidden = false;
    return;
  }
  const fields = {
    type: draft.type,
    amount: Math.round(amount * 100) / 100,
    account: draft.account,
    category: draft.category,
    date: $('op-date').value || todayISO(),
    note: $('op-note').value.trim(),
    updatedAt: Date.now()
  };

  if (draft.editingId) {
    const op = state.operations.find(o => o.id === draft.editingId);
    if (op) Object.assign(op, fields);
  } else {
    state.operations.push({ id: makeId(), createdAt: Date.now(), ...fields });
  }
  persist();
  selectedDay = fields.date;
  $('op-dialog').close();
  renderAll();
}

function deleteFromDialog() {
  if (!draft.editingId) return;
  deleteOperation(draft.editingId);
  $('op-dialog').close();
}

// Typing on a laptop keyboard works too while the dialog is open
function handleDialogKeys(event) {
  if (!$('op-dialog').open || $('cat-dialog').open) return;
  if (event.target.tagName === 'INPUT') return;    // let the note/date fields work normally
  if (/^[0-9]$/.test(event.key)) pressKey(event.key);
  else if (event.key === ',' || event.key === '.') pressKey(',');
  else if (event.key === 'Backspace') pressKey('⌫');
  else return;
  event.preventDefault();
}

// ---------- New-account dialog ----------

function openAccountDialog() {
  $('acc-form').reset();
  $('acc-start').value = '0';
  $('acc-goal-wrap').hidden = true;
  $('acc-error').hidden = true;
  $('acc-dialog').showModal();
}

function saveAccount(event) {
  event.preventDefault();
  const name = $('acc-name').value.trim();
  if (!name) {
    $('acc-error').hidden = false;
    $('acc-name').focus();
    return;
  }
  const savings = $('acc-savings').checked;
  const goal = parseAmount($('acc-goal').value);
  const start = parseAmount($('acc-start').value);
  state.accounts.push({
    id: makeId(),
    name,
    group: 'other',
    style: savings ? 'savings' : 'custom',
    currency: $('acc-currency').value,
    start: Number.isFinite(start) ? start : 0,
    savings,
    goal: savings && goal > 0 ? goal : null,
    updatedAt: Date.now()
  });
  persist();
  $('acc-dialog').close();
  renderAll();
}

// ---------- Balance dialog (tap on an account card) ----------

let balanceAccountId = null;

function openBalanceDialog(accountId) {
  const account = accountById(accountId);
  if (!account) return;
  balanceAccountId = accountId;
  $('bal-label').textContent = t('balance_now', {
    name: accountLabel(account),
    cur: currencySymbol(account.currency)
  });
  $('bal-input').value = String(accountBalance(account)).replace('.', ',');
  $('bal-error').hidden = true;
  $('bal-dialog').showModal();
  $('bal-input').select();
}

function saveBalance(event) {
  event.preventDefault();
  const account = accountById(balanceAccountId);
  const value = parseAmount($('bal-input').value);
  if (!Number.isFinite(value)) {
    $('bal-error').hidden = false;
    return;
  }
  if (account && setCurrentBalance(account, value)) persist();
  $('bal-dialog').close();
  renderAll();
}

// ---------- Settings ----------

function saveSettings(event) {
  event.preventDefault();
  const stamp = Date.now();
  const limit = parseAmount($('limit-input').value);
  const newLimit = limit > 0 ? limit : 0;
  if (newLimit !== state.monthlyLimit) {
    state.monthlyLimit = newLimit;
    state.limitUpdatedAt = stamp;
  }
  $('start-balances').querySelectorAll('input').forEach(input => {
    const account = accountById(input.dataset.account);
    const value = parseAmount(input.value);
    // Only accounts whose balance really changed get updated
    if (account && Number.isFinite(value)) setCurrentBalance(account, value);
  });
  persist();
  renderAll();
  const saved = $('settings-saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 2000);
}

// ---------- Event listeners ----------

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
$('nav-add').addEventListener('click', () => {
  // No accounts left — create one first
  if (!liveAccounts().length) openAccountDialog();
  else openOperationDialog();
});
$('all-ops').addEventListener('click', () => showView('calendar'));
document.querySelectorAll('.month-prev').forEach(b => b.addEventListener('click', () => changeMonth(-1)));
document.querySelectorAll('.month-next').forEach(b => b.addEventListener('click', () => changeMonth(1)));

document.querySelectorAll('.segment button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (draft.type === btn.dataset.type) return;
    draft.type = btn.dataset.type;
    draft.category = liveCategories(draft.type)[0]?.id;
    renderDraft();
  });
});
$('op-form').addEventListener('submit', saveOperation);
$('op-close').addEventListener('click', () => $('op-dialog').close());
$('op-delete').addEventListener('click', deleteFromDialog);
document.addEventListener('keydown', handleDialogKeys);

$('add-account-btn').addEventListener('click', openAccountDialog);
$('acc-form').addEventListener('submit', saveAccount);
$('acc-close').addEventListener('click', () => $('acc-dialog').close());
$('acc-savings').addEventListener('change', e => { $('acc-goal-wrap').hidden = !e.target.checked; });
$('acc-name').addEventListener('input', () => { $('acc-error').hidden = true; });

$('settings-form').addEventListener('submit', saveSettings);
$('bal-form').addEventListener('submit', saveBalance);
$('bal-close').addEventListener('click', () => $('bal-dialog').close());
$('bal-delete').addEventListener('click', () => {
  if (askDeleteAccount(balanceAccountId)) $('bal-dialog').close();
});
$('bal-input').addEventListener('input', () => { $('bal-error').hidden = true; });
$('logout').addEventListener('click', logout);

$('top-avatar').addEventListener('click', () => showView('profile'));
$('profile-name').addEventListener('change', saveName);
$('photo-choose').addEventListener('click', () => $('photo-input').click());
$('photo-input').addEventListener('change', choosePhoto);
$('photo-remove').addEventListener('click', removePhoto);

$('add-category-btn').addEventListener('click', () => openCategoryDialog('expense'));
$('cat-form').addEventListener('submit', saveCategory);
$('cat-close').addEventListener('click', () => $('cat-dialog').close());
$('cat-name').addEventListener('input', () => { $('cat-error').hidden = true; });

$('auth-form').addEventListener('submit', submitAuth);
$('auth-switch').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  $('auth-error').hidden = true;
  $('auth-info').hidden = true;
  renderAuth();
});

function switchLanguage() {
  setLang(getLang() === 'uk' ? 'en' : 'uk');
  applyStaticTexts();
  buildKeypad();
  renderAuth();
  if (user) {
    setSyncStatus(syncStatus);
    renderAll();
  }
  if ($('op-dialog').open) renderDraft();
}
$('lang-switch').addEventListener('click', switchLanguage);
$('auth-lang').addEventListener('click', switchLanguage);

laptop.addEventListener('change', renderAll);

// Sync when the internet comes back and when the app is opened again
window.addEventListener('online', syncNow);
window.addEventListener('offline', () => user && setSyncStatus('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});

// ---------- Start ----------

async function start() {
  applyStaticTexts();
  buildKeypad();
  if (!isConfigured) {
    showAuth(t('auth_not_configured'));
    return;
  }
  let current = null;
  try {
    current = await getUser();
  } catch {
    // Offline and the login library isn't available — use the last logged-in user
    current = lastUser();
  }
  if (current) await enterApp(current);
  else showAuth();
}

start();

// Save the app on the device so it also opens without internet
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Not supported or blocked (e.g. opened as a plain file) — the app still works online
  });
}