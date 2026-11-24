// =====================================================
// app.js — main logic: login, screens, sync and user actions
// =====================================================

import {
  t, getLang, setLang, applyStaticTexts, locale,
  formatMoney, currencySymbol, formatDay, formatMonth, formatMonthShort, weekdayNames, formatShortDate
} from './i18n.js';
import { defaultState, loadState, saveState, mergeStates, rememberUser, lastUser } from './storage.js';
import { isConfigured, getUser, signIn, signUp, signOut, pullRemote, pushRemote } from './sync.js';
import { getTheme, setTheme, getAccent, setAccent, applyTheme, ACCENTS } from './theme.js';
import {
  MONO_WAIT, loadMonoSettings, saveMonoSettings, fetchMonoCards, fetchMonoStatement, categoryForMcc, guessLink
} from './mono.js';

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

// Stats: which kind of period, and the day it starts from
let statsPeriod = 'month';            // 'week' | 'month' | 'year' | 'custom'
let statsAnchor = new Date(now.getFullYear(), now.getMonth(), 1);
let customFrom = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
let customTo = todayISO();

// New/edited operation in the dialog. editingId = null means "new"
let draft = { editingId: null, type: 'expense', amount: '', account: null, category: null, toAccount: null };

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

// How much all recorded operations changed an account:
// + income, − expenses, − transfers out, + transfers in
function operationsTotal(account) {
  let sum = 0;
  for (const op of liveOps()) {
    if (op.type === 'transfer') {
      if (op.account === account.id) sum -= op.amount;
      if (op.toAccount === account.id) sum += op.toAmount ?? op.amount;
    } else if (op.account === account.id) {
      sum += op.type === 'income' ? op.amount : -op.amount;
    }
  }
  return sum;
}

// Converts between two currencies through hryvnias: convert(100, 'USD', 'UAH') ≈ 4150
function convert(amount, from, to) {
  if (from === to) return amount;
  const uah = toUAH(amount, from);
  return to === 'UAH' ? uah : uah / (state.rates[to] ?? 1);
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
  mono = loadMonoSettings(user.id);
  $('auth').hidden = true;
  $('app').hidden = false;
  $('auth-password').value = '';
  $('auth-error').hidden = true;
  $('auth-info').hidden = true;
  showView('home');
  setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
  await syncNow();
  handleLinks();
  refreshRates();
  scheduleMono(3000);
}

async function logout() {
  try {
    await syncNow();       // upload the last changes first
    await signOut();
  } catch {
    // Offline — the session is still cleared on this device below
  }
  clearTimeout(monoTimer);
  mono = null;
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
      // Tapping a card lets you correct its balance
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
  if (op.type === 'transfer') return renderTransferRow(op, showDate);
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

// A transfer: '⇄', 'Біла → Готівка', the amount in a neutral color
function renderTransferRow(op, showDate) {
  const from = accountById(op.account);
  const to = accountById(op.toAccount);
  const row = el('button', 'op');
  row.type = 'button';
  row.addEventListener('click', () => openOperationDialog(op));

  const badge = el('span', 'badge transfer-badge', '⇄');
  const info = el('span', 'op-info');
  info.append(el('span', 'op-title', op.note || t('transfer')));
  const details = [`${accountLabel(from)} → ${accountLabel(to)}`];
  if (showDate) details.unshift(dayLabel(op.date));
  info.append(el('span', 'muted small ellipsis', details.join(' · ')));
  const amount = el('span', 'op-amount', formatMoney(op.amount, from?.currency ?? 'UAH'));

  row.setAttribute('aria-label', `${t('edit_operation')}: ${t('transfer')}, ${details.join(', ')}, ${amount.textContent}`);
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Monday of the week that contains this date
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, -((d.getDay() + 6) % 7));
}

// The chosen period as two dates 'YYYY-MM-DD' (both included) and its title
function statsRange() {
  const a = statsAnchor;
  if (statsPeriod === 'week') {
    const start = weekStart(a);
    const end = addDays(start, 6);
    return { from: isoDate(start), to: isoDate(end), label: `${formatShortDate(isoDate(start))} – ${formatShortDate(isoDate(end), true)}` };
  }
  if (statsPeriod === 'year') {
    return { from: `${a.getFullYear()}-01-01`, to: `${a.getFullYear()}-12-31`, label: String(a.getFullYear()) };
  }
  if (statsPeriod === 'custom') {
    const [from, to] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { from, to, label: `${formatShortDate(from)} – ${formatShortDate(to, true)}` };
  }
  const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { from: isoDate(a), to: isoDate(end), label: formatMonth(a.getFullYear(), a.getMonth()) };
}

// Expenses/incomes of everyday accounts between two dates (transfers don't count)
function operationsBetween(from, to) {
  return liveOps().filter(op => op.date >= from && op.date <= to && isSpendingOp(op));
}

function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
}

function changeStatsPeriod(step) {
  const a = statsAnchor;
  if (statsPeriod === 'week') statsAnchor = addDays(weekStart(a), step * 7);
  else if (statsPeriod === 'year') statsAnchor = new Date(a.getFullYear() + step, 0, 1);
  else statsAnchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
  renderStats();
}

function setStatsPeriod(period) {
  statsPeriod = period;
  const today = new Date();
  // Each kind of period starts from the current one
  if (period === 'week') statsAnchor = weekStart(today);
  else if (period === 'year') statsAnchor = new Date(today.getFullYear(), 0, 1);
  else if (period === 'month') statsAnchor = new Date(today.getFullYear(), today.getMonth(), 1);
  renderStats();
}

function renderStats() {
  const range = statsRange();
  document.querySelectorAll('#period-tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === statsPeriod);
    btn.setAttribute('aria-pressed', btn.dataset.period === statsPeriod);
  });
  $('stats-label').textContent = range.label;
  $('stats-prev').hidden = statsPeriod === 'custom';
  $('stats-next').hidden = statsPeriod === 'custom';
  $('stats-custom').hidden = statsPeriod !== 'custom';
  $('stats-from').value = customFrom;
  $('stats-to').value = customTo;

  const all = operationsBetween(range.from, range.to);
  $('stats-expense').textContent = '−' + formatMoney(Math.round(sumUAH(all, 'expense')));
  $('stats-income').textContent = '+' + formatMoney(Math.round(sumUAH(all, 'income')));

  const ops = all.filter(op => op.type === 'expense');
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

  renderBars(range);
  renderHeatmap(Number((statsPeriod === 'custom' ? range.to : range.from).slice(0, 4)));
}

// The columns of the bar chart for the chosen period
function barBuckets(range) {
  const buckets = [];
  const days = daysBetween(range.from, range.to);
  if (statsPeriod === 'month') {
    // The viewed month and the 5 before it
    for (let i = 5; i >= 0; i--) {
      const d = new Date(statsAnchor.getFullYear(), statsAnchor.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      buckets.push({ from: isoDate(d), to: isoDate(end), label: formatMonthShort(d.getFullYear(), d.getMonth()) });
    }
  } else if (days <= 31) {
    // One column per day
    const names = weekdayNames();
    for (let i = 0; i < days; i++) {
      const d = addDays(new Date(range.from + 'T00:00:00'), i);
      const iso = isoDate(d);
      const label = statsPeriod === 'week' ? names[i] : String(d.getDate());
      buckets.push({ from: iso, to: iso, label });
    }
  } else {
    // One column per month
    const start = new Date(range.from + 'T00:00:00');
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (isoDate(d) <= range.to) {
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      buckets.push({
        from: isoDate(d) < range.from ? range.from : isoDate(d),
        to: isoDate(end) > range.to ? range.to : isoDate(end),
        label: formatMonthShort(d.getFullYear(), d.getMonth())
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return buckets;
}

function renderBars(range) {
  $('bars-title').textContent = t(statsPeriod === 'month' ? 'month_by_month' : 'dynamics');
  const columns = barBuckets(range).map(b => {
    const ops = operationsBetween(b.from, b.to);
    return { label: b.label, income: sumUAH(ops, 'income'), expense: sumUAH(ops, 'expense') };
  });
  const max = Math.max(1, ...columns.flatMap(m => [m.income, m.expense]));
  // With many columns only every n-th label is shown, so they don't overlap
  const labelEvery = Math.ceil(columns.length / 8);

  const box = $('bars');
  box.innerHTML = '';
  box.style.gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr))`;
  box.classList.toggle('dense', columns.length > 12);
  columns.forEach((m, i) => {
    const col = el('div', 'bar-col');
    const pair = el('div', 'bar-pair');
    const inc = el('div', 'bar-v pos-bg');
    inc.style.height = (m.income / max) * 100 + '%';
    inc.title = '+' + formatMoney(Math.round(m.income));
    const exp = el('div', 'bar-v neg-bg');
    exp.style.height = (m.expense / max) * 100 + '%';
    exp.title = '−' + formatMoney(Math.round(m.expense));
    pair.append(inc, exp);
    col.append(pair, el('span', 'muted small bar-label', i % labelEvery === 0 ? m.label : ''));
    box.append(col);
  });
}

// GitHub-style map of the whole year: one square per day, darker = more spent
function renderHeatmap(year) {
  $('heatmap-title').textContent = t('heatmap_title', { year });
  const perDay = {};
  for (const op of operationsBetween(`${year}-01-01`, `${year}-12-31`)) {
    if (op.type === 'expense') perDay[op.date] = (perDay[op.date] ?? 0) + opInUAH(op);
  }
  const max = Math.max(0, ...Object.values(perDay));

  const grid = $('heatmap');
  grid.innerHTML = '';
  const first = weekStart(new Date(year, 0, 1));     // the Monday before 1 January
  const today = todayISO();
  let todayColumn = 0;
  let lastMonth = -1;
  for (let i = 0, d = first; d.getFullYear() <= year; i++, d = addDays(first, i)) {
    const column = Math.floor(i / 7) + 1;
    const row = (i % 7) + 2;                         // row 1 holds the month names
    if (d.getFullYear() < year) continue;
    const iso = isoDate(d);

    // Month name above the week where the month starts
    if (d.getMonth() !== lastMonth && d.getDate() <= 7 && row === 2) {
      lastMonth = d.getMonth();
      const label = el('span', 'hm-month', formatMonthShort(year, d.getMonth()));
      label.style.gridColumn = `${column} / span 4`;
      label.style.gridRow = '1';
      grid.append(label);
    }

    const spent = perDay[iso] ?? 0;
    const level = spent === 0 ? 0 : Math.min(4, Math.ceil((spent / max) * 4));
    const cell = el('button', `hm hm-${level}` + (iso > today ? ' future' : '') + (iso === today ? ' today' : ''));
    cell.type = 'button';
    cell.style.gridColumn = String(column);
    cell.style.gridRow = String(row);
    cell.title = `${formatDay(iso)}: ${formatMoney(Math.round(spent))}`;
    cell.setAttribute('aria-label', cell.title);
    cell.addEventListener('click', () => openDayInCalendar(iso));
    grid.append(cell);
    if (iso === today) todayColumn = column;
  }

  // Scroll so the current part of the year is visible
  const scroller = $('heatmap-scroll');
  requestAnimationFrame(() => {
    const target = todayColumn ? todayColumn * 13 - scroller.clientWidth / 2 : scroller.scrollWidth;
    scroller.scrollLeft = Math.max(0, target);
  });
}

function openDayInCalendar(iso) {
  const d = new Date(iso + 'T00:00:00');
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  selectedDay = iso;
  showView('calendar');
}

// ---------- Period summary (like Spotify Wrapped) ----------

function summaryTile(label, value, note, wide = false) {
  const tile = el('div', 'summary-tile' + (wide ? ' wide' : ''));
  tile.append(el('span', 'muted small', label), el('strong', '', value));
  if (note) tile.append(el('span', 'muted small', note));
  return tile;
}

function openSummary() {
  const range = statsRange();
  const all = operationsBetween(range.from, range.to);
  const expenses = all.filter(op => op.type === 'expense');
  const box = $('summary-body');
  box.innerHTML = '';

  const head = el('div', 'summary-head');
  head.append(el('span', 'small', range.label));
  box.append(head);

  if (!expenses.length) {
    box.append(el('p', 'muted', t('summary_empty')));
    $('summary-dialog').showModal();
    return;
  }

  const spent = sumUAH(all, 'expense');
  const earned = sumUAH(all, 'income');
  head.append(el('span', 'summary-big', formatMoney(Math.round(spent))), el('span', 'small', t('summary_spent')));

  // Days counted only up to today, so a half-finished month isn't "cheap"
  const lastDay = range.to < todayISO() ? range.to : todayISO();
  const days = Math.max(1, daysBetween(range.from, lastDay));

  const perDay = {};
  const perCategory = {};
  const perNote = {};
  let biggest = expenses[0];
  for (const op of expenses) {
    const uah = opInUAH(op);
    perDay[op.date] = (perDay[op.date] ?? 0) + uah;
    perCategory[op.category] = (perCategory[op.category] ?? 0) + uah;
    if (op.note) {
      const key = op.note.toLowerCase();
      perNote[key] = { name: op.note, count: (perNote[key]?.count ?? 0) + 1 };
    }
    if (uah > opInUAH(biggest)) biggest = op;
  }
  const [topDay, topDaySum] = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
  const [topCat, topCatSum] = Object.entries(perCategory).sort((a, b) => b[1] - a[1])[0];
  const favorite = Object.values(perNote).sort((a, b) => b.count - a.count)[0];
  const freeDays = days - Object.keys(perDay).filter(d => d <= lastDay).length;

  const grid = el('div', 'summary-grid');
  const diff = earned - spent;
  grid.append(
    summaryTile(t('summary_earned'), formatMoney(Math.round(earned)),
      diff >= 0 ? `${t('summary_saved')}: ${formatMoney(Math.round(diff))}` : `${t('summary_overspent')}: ${formatMoney(Math.round(-diff))}`, true),
    summaryTile(t('summary_top_category'), categoryName(topCat), t('summary_of_total', { pct: Math.round((topCatSum / spent) * 100) }), true),
    summaryTile(t('summary_per_day'), formatMoney(Math.round(spent / days))),
    summaryTile(t('summary_count'), String(expenses.length)),
    summaryTile(t('summary_top_day'), formatShortDate(topDay), formatMoney(Math.round(topDaySum))),
    summaryTile(t('summary_biggest'), formatMoney(biggest.amount, accountById(biggest.account)?.currency ?? 'UAH'), biggest.note || categoryName(biggest.category)),
    summaryTile(t('summary_free_days'), String(Math.max(0, freeDays)))
  );
  if (favorite && favorite.count > 1) {
    grid.append(summaryTile(t('summary_favorite'), favorite.name, t('summary_times', { n: favorite.count })));
  }
  box.append(grid);
  $('summary-dialog').showModal();
}

// ---------- Profile ----------

function renderProfile() {
  $('profile-email').textContent = user?.email ?? '';
  renderAvatar($('profile-avatar'));
  // Don't overwrite the name while it's being typed
  if (document.activeElement !== $('profile-name')) $('profile-name').value = state.profile.name;
  $('photo-remove').hidden = !state.profile.photo;
  renderCategoryManager();
  renderAppearance();
  renderMono();
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

// Opens the chosen file as a picture. Very large photos are made smaller
// first, so moving them around in the crop window stays smooth.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600;
      const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * ratio);
      canvas.height = Math.round(img.naturalHeight * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
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
    openCropDialog(await loadImage(file));
  } catch {
    $('photo-error').hidden = false;
  }
}

// ---------- Cropping the photo ----------
// The picture lies under a square window. x, y = where its top-left corner is
// (in window pixels), scale = how much it's enlarged. Whatever is inside the
// circle when you press Save becomes the profile photo.

const crop = { img: null, size: 0, baseScale: 1, zoom: 1, x: 0, y: 0 };
const pointers = new Map();          // fingers / mouse currently on the photo
let pinchStart = null;

function cropScale() {
  return crop.baseScale * crop.zoom;
}

// Doesn't let the photo move so far that an empty edge shows in the window
function clampCrop() {
  const w = crop.img.width * cropScale();
  const h = crop.img.height * cropScale();
  crop.x = Math.min(0, Math.max(crop.size - w, crop.x));
  crop.y = Math.min(0, Math.max(crop.size - h, crop.y));
}

function drawCrop() {
  const canvas = $('crop-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, crop.size, crop.size);
  ctx.drawImage(crop.img, crop.x, crop.y, crop.img.width * cropScale(), crop.img.height * cropScale());
}

// Zooms in or out keeping the point (px, py) of the window in place
function setZoom(zoom, px = crop.size / 2, py = crop.size / 2) {
  const before = cropScale();
  crop.zoom = Math.min(4, Math.max(1, zoom));
  const after = cropScale();
  crop.x = px - ((px - crop.x) / before) * after;
  crop.y = py - ((py - crop.y) / before) * after;
  clampCrop();
  $('crop-zoom').value = crop.zoom;
  drawCrop();
}

function openCropDialog(img) {
  $('crop-dialog').showModal();
  // The window's size is known only once the dialog is visible
  const size = $('crop-area').clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const canvas = $('crop-canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  // Start with the photo just covering the window, centered
  Object.assign(crop, {
    img,
    size,
    baseScale: Math.max(size / img.width, size / img.height),
    zoom: 1
  });
  crop.x = (size - img.width * cropScale()) / 2;
  crop.y = (size - img.height * cropScale()) / 2;
  $('crop-zoom').value = 1;
  pointers.clear();
  pinchStart = null;
  drawCrop();
}

// Position of a finger inside the window
function pointerPos(event) {
  const rect = $('crop-area').getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  };
}

function cropPointerDown(event) {
  $('crop-area').setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, pointerPos(event));
  if (pointers.size === 2) pinchStart = { ...pinchInfo(), zoom: crop.zoom };
}

function cropPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  const prev = pointers.get(event.pointerId);
  const pos = pointerPos(event);
  pointers.set(event.pointerId, pos);
  if (pointers.size === 1) {
    // One finger: move the photo
    crop.x += pos.x - prev.x;
    crop.y += pos.y - prev.y;
    clampCrop();
    drawCrop();
  } else if (pointers.size === 2 && pinchStart) {
    // Two fingers: zoom by how far apart they are
    const now = pinchInfo();
    setZoom(pinchStart.zoom * (now.distance / pinchStart.distance), now.mid.x, now.mid.y);
  }
}

function cropPointerUp(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStart = null;
}

// Mouse wheel / trackpad on a laptop zooms too
function cropWheel(event) {
  event.preventDefault();
  const pos = pointerPos(event);
  setZoom(crop.zoom * Math.exp(-event.deltaY / 300), pos.x, pos.y);
}

// Cuts out what's in the window and saves it as a 256×256 photo
function saveCrop(event) {
  event.preventDefault();
  const scale = cropScale();
  const out = document.createElement('canvas');
  out.width = 256;
  out.height = 256;
  out.getContext('2d').drawImage(
    crop.img,
    -crop.x / scale, -crop.y / scale, crop.size / scale, crop.size / scale,
    0, 0, 256, 256
  );
  const photo = out.toDataURL('image/jpeg', 0.85);
  state.profile = { ...state.profile, photo, updatedAt: Date.now() };
  persist();
  $('crop-dialog').close();
  crop.img = null;                   // free the big picture from memory
  renderAll();
}

function removePhoto() {
  state.profile = { ...state.profile, photo: null, updatedAt: Date.now() };
  persist();
  renderAll();
}

// ---------- Appearance: theme and accent color (kept on this device) ----------

function renderAppearance() {
  document.querySelectorAll('#theme-choice button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === getTheme());
    btn.setAttribute('aria-pressed', btn.dataset.theme === getTheme());
  });
  const box = $('accent-choice');
  box.innerHTML = '';
  for (const [name, color] of Object.entries(ACCENTS)) {
    const swatch = el('button', 'swatch' + (name === getAccent() ? ' active' : ''));
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', t('accent_' + name));
    swatch.setAttribute('aria-pressed', name === getAccent());
    swatch.addEventListener('click', () => {
      setAccent(name);
      renderAppearance();
    });
    box.append(swatch);
  }
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
    if ((op.account === id || op.toAccount === id) && !op.deleted) Object.assign(op, { deleted: true, updatedAt: stamp });
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
  const isTransfer = draft.type === 'transfer';
  $('op-title').textContent = t(draft.editingId ? 'edit_operation' : draft.pay ? 'pay_title' : 'new_operation');
  $('op-delete').hidden = !draft.editingId;
  $('amount-text').textContent = draft.amount || '0';
  $('amount-cur').textContent = currencySymbol(account?.currency ?? 'UAH');

  document.querySelectorAll('#op-type button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === draft.type);
    btn.setAttribute('aria-pressed', btn.dataset.type === draft.type);
  });

  // Account chips ("From" for a transfer)
  $('op-from-label').hidden = !isTransfer;
  renderAccountChips($('op-accounts'), draft.account, id => {
    draft.account = id;
    if (draft.toAccount === id) draft.toAccount = null;
    renderDraft();
  });

  // Transfer: where the money goes, and how much arrived if the currency differs
  $('op-transfer').hidden = !isTransfer;
  $('op-categories').hidden = isTransfer;
  if (isTransfer) {
    const others = liveAccounts().filter(a => a.id !== draft.account);
    if (!others.some(a => a.id === draft.toAccount)) draft.toAccount = others[0]?.id ?? null;
    renderAccountChips($('op-to-accounts'), draft.toAccount, id => {
      draft.toAccount = id;
      $('op-to-amount').value = '';
      renderDraft();
    }, draft.account);
    const to = accountById(draft.toAccount);
    const otherCurrency = account && to && account.currency !== to.currency;
    $('op-to-amount-wrap').hidden = !otherCurrency;
    if (otherCurrency) {
      $('op-to-amount-label').textContent = t('transfer_to_amount', { name: accountLabel(to), cur: currencySymbol(to.currency) });
      // Hint: the amount converted at the saved rate (used if you leave the field empty)
      const estimate = convert(parseAmount(draft.amount) || 0, account.currency, to.currency);
      $('op-to-amount').placeholder = amountToText(round2(estimate));
    }
    return;
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

// A row of account chips; skipId = an account not to show (the "From" one)
function renderAccountChips(box, selectedId, onPick, skipId) {
  box.innerHTML = '';
  for (const acc of liveAccounts()) {
    if (acc.id === skipId) continue;
    const chip = el('button', 'chip-btn' + (acc.id === selectedId ? ' active' : ''), accountLabel(acc));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', acc.id === selectedId);
    chip.addEventListener('click', () => onPick(acc.id));
    box.append(chip);
  }
}

// op = an existing operation to edit, or nothing for a new one
function openOperationDialog(op) {
  if (op && op.id) {
    draft = {
      editingId: op.id,
      type: op.type,
      amount: amountToText(op.amount),
      account: op.account,
      category: op.category,
      toAccount: op.toAccount ?? null
    };
    $('op-date').value = op.date;
    $('op-note').value = op.note ?? '';
    $('op-to-amount').value = op.type === 'transfer' && op.toAmount != null ? amountToText(op.toAmount) : '';
  } else {
    const firstAccount = liveAccounts()[0]?.id;
    draft = {
      editingId: null,
      type: 'expense',
      amount: '',
      account: draft.account && accountById(draft.account) && !accountById(draft.account).deleted ? draft.account : firstAccount,
      category: liveCategories('expense')[0]?.id,
      toAccount: null
    };
    $('op-date').value = currentView === 'calendar' ? selectedDay : todayISO();
    $('op-note').value = '';
    $('op-to-amount').value = '';
  }
  $('op-error').hidden = true;
  $('op-transfer-error').hidden = true;
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
    toAccount: null,
    toAmount: null,
    date: $('op-date').value || todayISO(),
    note: $('op-note').value.trim(),
    updatedAt: Date.now()
  };

  if (draft.type === 'transfer') {
    const from = accountById(draft.account);
    const to = accountById(draft.toAccount);
    if (!to || to.id === draft.account) {
      $('op-transfer-error').hidden = false;
      return;
    }
    fields.category = null;
    fields.toAccount = to.id;
    // Same currency: the same amount arrives. Different: what you typed, or the converted amount
    const typed = parseAmount($('op-to-amount').value);
    fields.toAmount = from.currency === to.currency
      ? fields.amount
      : round2(typed > 0 ? typed : convert(fields.amount, from.currency, to.currency));
  }

  if (draft.pay) rememberPay(draft.pay, fields);

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

// ---------- Apple Pay (iPhone Shortcuts automation) ----------
// After an Apple Pay payment, the iPhone opens a link like
//   .../spendings/?amount=₴85,00&merchant=Silpo&card=Black
// and the app opens a new expense with the amount and shop already filled in.

// Shortcuts write amounts in different ways: '₴85,00', '1 250,50 ₴', 'UAH 85.00'.
// A comma or dot followed by 1–2 digits at the end is the decimal part,
// any other ones are thousands separators.
function parseLooseAmount(text) {
  let s = String(text ?? '').replace(/[^\d.,]/g, '');
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (last !== -1 && s.length - last - 1 <= 2) {
    s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
  } else {
    s = s.replace(/[.,]/g, '');
  }
  return round2(parseFloat(s));
}

// Read once when the page opens; kept until the user is logged in
let pendingPay = (() => {
  const params = new URLSearchParams(location.search);
  if (!params.has('amount')) return null;
  return {
    amount: parseLooseAmount(params.get('amount')),
    merchant: (params.get('merchant') ?? '').trim(),
    card: (params.get('card') ?? '').trim()
  };
})();

// Home-screen shortcut: .../spendings/?new=expense (or income / transfer)
let pendingNew = (() => {
  const type = new URLSearchParams(location.search).get('new');
  return ['expense', 'income', 'transfer'].includes(type) ? type : null;
})();

// Runs after login: opens what the link in the address asked for
function handleLinks() {
  if (!pendingPay && !pendingNew) return;
  // Remove it from the address, so a page reload doesn't repeat it
  history.replaceState(null, '', location.pathname);
  if (pendingPay) {
    pendingNew = null;
    handlePayLink();
    return;
  }
  const type = pendingNew;
  pendingNew = null;
  if (!liveAccounts().length) {
    openAccountDialog();
    return;
  }
  openOperationDialog();
  if (type !== 'expense') {
    draft.type = type;
    if (type === 'income') draft.category = liveCategories('income')[0]?.id;
    renderDraft();
  }
}

function handlePayLink() {
  if (!pendingPay) return;
  const pay = pendingPay;
  pendingPay = null;
  if (!(pay.amount > 0) || !liveAccounts().length) return;

  // Already imported from monobank? Then open that one to pick the category
  const memory = state.payMemory;
  const linkedId = memory.cards[pay.card];
  const imported = liveOps().find(op => op.monoId && op.account === linkedId && op.type === 'expense'
    && op.amount === pay.amount && op.date === todayISO() && Date.now() - op.createdAt < 30 * 60 * 1000);
  if (imported) {
    openOperationDialog(imported);
    draft.pay = pay;
    renderDraft();
    return;
  }

  openOperationDialog();
  // The account and category picked last time for this card / this shop
  const account = accountById(memory.cards[pay.card]);
  const category = categoryById(memory.merchants[pay.merchant.toLowerCase()]);
  if (account && !account.deleted) draft.account = account.id;
  if (category.type === 'expense' && !category.deleted) draft.category = category.id;
  draft.amount = amountToText(pay.amount);
  draft.pay = pay;
  $('op-note').value = pay.merchant;
  renderDraft();
}

// Remembers the choices, so next time this card and this shop are pre-selected
function rememberPay(pay, fields) {
  const cards = { ...state.payMemory.cards };
  const merchants = { ...state.payMemory.merchants };
  if (pay.card) cards[pay.card] = fields.account;
  if (pay.merchant && fields.type === 'expense') merchants[pay.merchant.toLowerCase()] = fields.category;
  state.payMemory = { cards, merchants, updatedAt: Date.now() };
}

// ---------- monobank: automatic import ----------

let mono = null;          // settings of the logged-in user on this device (see mono.js)
let monoTimer = null;
let monoBusy = false;

function monoErrorText(code) {
  if (['mono_bad_token', 'mono_too_often', 'mono_network'].includes(code)) return t(code);
  return t('mono_generic', { code });
}

function monoCardName(card) {
  const key = 'mono_type_' + card.type;
  const name = t(key) === key ? card.type : t(key);
  return [name, currencySymbol(card.currency), card.pan].filter(Boolean).join(' · ');
}

async function connectMono() {
  const token = $('mono-token').value.trim();
  const error = $('mono-error');
  if (!token) {
    error.textContent = t('mono_need_token');
    error.hidden = false;
    return;
  }
  const button = $('mono-connect');
  button.disabled = true;
  button.textContent = t('wait');
  error.hidden = true;
  try {
    const cards = await fetchMonoCards(token);
    const nowSec = Math.floor(Date.now() / 1000);
    mono = {
      token,
      // start = from when this card is imported, since = imported up to
      accounts: cards.map(card => ({ ...card, link: guessLink(card, state.accounts), start: nowSec, since: nowSec })),
      lastRequest: Date.now(),
      lastSync: null,
      error: ''
    };
    saveMonoSettings(user.id, mono);
    $('mono-token').value = '';
    renderMono();
    scheduleMono(MONO_WAIT);
  } catch (e) {
    error.textContent = monoErrorText(e.message);
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = t('mono_connect');
  }
}

function disconnectMono() {
  if (!confirm(t('mono_disconnect_confirm'))) return;
  clearTimeout(monoTimer);
  mono = null;
  saveMonoSettings(user.id, null);
  renderMono();
}

function renderMono() {
  $('mono-off').hidden = !!mono;
  $('mono-on').hidden = !mono;
  if (!mono) return;

  const box = $('mono-cards');
  box.innerHTML = '';
  for (const card of mono.accounts) {
    const label = el('label');
    label.append(el('span', '', monoCardName(card)));
    const select = el('select');
    select.append(new Option(t('mono_skip'), ''));
    for (const acc of liveAccounts()) select.append(new Option(accountLabel(acc), acc.id));
    select.value = card.link && accountById(card.link) && !accountById(card.link).deleted ? card.link : '';
    select.addEventListener('change', () => {
      card.link = select.value || null;
      // A newly linked card is imported from now on, not from the past
      const nowSec = Math.floor(Date.now() / 1000);
      card.start = nowSec;
      card.since = nowSec;
      saveMonoSettings(user.id, mono);
      scheduleMono(1000);
    });
    label.append(select);
    box.append(label);
  }

  let status;
  if (mono.error) status = monoErrorText(mono.error);
  else if (mono.lastSync) {
    const time = new Date(mono.lastSync).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    status = t('mono_last', { time });
  } else status = t('mono_waiting');
  $('mono-status').textContent = status;
  $('mono-status').className = 'small ' + (mono.error ? 'error' : 'muted');
}

function scheduleMono(delay = 1000) {
  clearTimeout(monoTimer);
  if (!mono || !user || document.visibilityState !== 'visible') return;
  monoTimer = setTimeout(monoStep, delay);
}

// One request to mono: new transactions of the card that was checked longest ago
async function monoStep() {
  if (!mono || !user || monoBusy) return;
  if (!navigator.onLine) return scheduleMono(MONO_WAIT);
  const linked = mono.accounts.filter(card => {
    const account = accountById(card.link);
    return account && !account.deleted;
  });
  if (!linked.length) return;
  const wait = (mono.lastRequest ?? 0) + MONO_WAIT - Date.now();
  if (wait > 0) return scheduleMono(wait);

  const card = linked.sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))[0];
  const to = Math.floor(Date.now() / 1000);
  // An hour of overlap catches transactions mono shows a little late;
  // already imported ones are recognised by their id and skipped
  const from = Math.max(card.start, card.since - 3600, to - 31 * 24 * 3600);
  monoBusy = true;
  mono.lastRequest = Date.now();
  try {
    const items = await fetchMonoStatement(mono.token, card.id, from, to);
    let changed = false;
    for (const item of items) {
      if (item.time >= card.start && importMonoItem(item, card.link)) changed = true;
    }
    card.since = to;
    card.checkedAt = Date.now();
    mono.lastSync = Date.now();
    mono.error = '';
    if (changed) {
      persist();
      renderAll();
    }
  } catch (e) {
    mono.error = e.message;
  } finally {
    monoBusy = false;
    saveMonoSettings(user.id, mono);
    if (currentView === 'profile') renderMono();
    scheduleMono(MONO_WAIT);
  }
}

// Adds one mono transaction. Returns true if something changed.
function importMonoItem(item, accountId) {
  const id = 'mono_' + item.id;
  if (state.operations.some(op => op.id === id || op.monoId === item.id)) return false;
  const amount = round2(Math.abs(item.amount) / 100);
  if (!amount) return false;
  const type = item.amount < 0 ? 'expense' : 'income';
  const date = isoDate(new Date(item.time * 1000));
  const note = String(item.description ?? '').trim();

  // Added by hand already (e.g. through Apple Pay)? Link it instead of adding a copy
  const twin = liveOps().find(op => !op.monoId && op.account === accountId && op.type === type
    && op.amount === amount && Math.abs(daysBetween(op.date, date) - 1) <= 1);
  if (twin) {
    Object.assign(twin, { monoId: item.id, note: twin.note || note, updatedAt: Date.now() });
    return true;
  }

  state.operations.push({
    id,
    monoId: item.id,
    type,
    amount,
    account: accountId,
    category: monoCategory(type, note, item.mcc),
    date,
    note,
    createdAt: item.time * 1000,
    updatedAt: Date.now()
  });
  return true;
}

// The category you used for this shop before, or a guess from the kind of shop
function monoCategory(type, note, mcc) {
  const live = liveCategories(type);
  const isLive = id => live.some(c => c.id === id);
  if (type === 'income') return isLive('other_income') ? 'other_income' : live[0]?.id;
  const remembered = state.payMemory.merchants[note.toLowerCase()];
  if (isLive(remembered)) return remembered;
  const guess = categoryForMcc(mcc);
  if (isLive(guess)) return guess;
  return isLive('other') ? 'other' : live[0]?.id;
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

document.querySelectorAll('#op-type button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (draft.type === btn.dataset.type) return;
    draft.type = btn.dataset.type;
    if (draft.type !== 'transfer') draft.category = liveCategories(draft.type)[0]?.id;
    $('op-transfer-error').hidden = true;
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

$('crop-form').addEventListener('submit', saveCrop);
$('crop-close').addEventListener('click', () => $('crop-dialog').close());
$('crop-zoom').addEventListener('input', e => setZoom(parseFloat(e.target.value)));
$('crop-area').addEventListener('pointerdown', cropPointerDown);
$('crop-area').addEventListener('pointermove', cropPointerMove);
$('crop-area').addEventListener('pointerup', cropPointerUp);
$('crop-area').addEventListener('pointercancel', cropPointerUp);
$('crop-area').addEventListener('wheel', cropWheel, { passive: false });

$('add-category-btn').addEventListener('click', () => openCategoryDialog('expense'));
$('cat-form').addEventListener('submit', saveCategory);
$('cat-close').addEventListener('click', () => $('cat-dialog').close());
$('cat-name').addEventListener('input', () => { $('cat-error').hidden = true; });

document.querySelectorAll('#period-tabs button').forEach(btn => {
  btn.addEventListener('click', () => setStatsPeriod(btn.dataset.period));
});
$('stats-prev').addEventListener('click', () => changeStatsPeriod(-1));
$('stats-next').addEventListener('click', () => changeStatsPeriod(1));
$('stats-from').addEventListener('change', e => { if (e.target.value) { customFrom = e.target.value; renderStats(); } });
$('stats-to').addEventListener('change', e => { if (e.target.value) { customTo = e.target.value; renderStats(); } });
$('summary-btn').addEventListener('click', openSummary);
$('summary-close').addEventListener('click', () => $('summary-dialog').close());

document.querySelectorAll('#theme-choice button').forEach(btn => {
  btn.addEventListener('click', () => {
    setTheme(btn.dataset.theme);
    renderAppearance();
  });
});

$('mono-connect').addEventListener('click', connectMono);
$('mono-disconnect').addEventListener('click', disconnectMono);
$('mono-refresh').addEventListener('click', () => {
  if (!mono) return;
  const wait = (mono.lastRequest ?? 0) + MONO_WAIT - Date.now();
  if (wait > 0) $('mono-status').textContent = t('mono_next', { s: Math.ceil(wait / 1000) });
  scheduleMono(Math.max(0, wait));
});

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
  if (document.visibilityState === 'visible') {
    syncNow();
    scheduleMono(1000);
  } else {
    clearTimeout(monoTimer);
  }
});

// ---------- Start ----------

async function start() {
  applyTheme();
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