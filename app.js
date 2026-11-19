// =====================================================
// app.js — main logic: render screens and handle user actions
// =====================================================

import {
  t, getLang, setLang, applyStaticTexts, locale,
  formatMoney, currencySymbol, formatDay, formatMonth, formatMonthShort, weekdayNames
} from './i18n.js';
import { loadState, saveState } from './storage.js';

// ---------- Categories ----------
// color = letter color in the badge and the slice color in the chart
const CATEGORIES = {
  expense: [
    { id: 'food', color: '#F28CA2' },
    { id: 'transport', color: '#8FA8FF' },
    { id: 'study', color: '#C9B6FF' },
    { id: 'fun', color: '#FFB3C1' },
    { id: 'subscriptions', color: '#A9C8FF' },
    { id: 'clothes', color: '#9EE6C9' },
    { id: 'health', color: '#B9E59A' },
    { id: 'gifts', color: '#FFD08A' },
    { id: 'other', color: '#C9CEDB' }
  ],
  income: [
    { id: 'scholarship', color: '#8FA8FF' },
    { id: 'family', color: '#FFB3C1' },
    { id: 'job', color: '#9EE6C9' },
    { id: 'other_income', color: '#C9CEDB' }
  ]
};
const ALL_CATEGORIES = [...CATEGORIES.expense, ...CATEGORIES.income];

// ---------- App state ----------
let state = loadState();

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();       // 0 = January
let selectedDay = todayISO();          // day picked in the calendar
let currentView = 'home';

// New-operation dialog state
let draft = { type: 'expense', amount: '', account: null, category: null };

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

function categoryById(id) {
  return ALL_CATEGORIES.find(c => c.id === id) ?? { id, color: '#C9CEDB' };
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

// Money in the account's own currency: start + income − expenses
function accountBalance(account) {
  return state.operations
    .filter(op => op.account === account.id)
    .reduce((sum, op) => op.type === 'income' ? sum + op.amount : sum - op.amount, account.start);
}

// Only everyday accounts count towards spending and the limit, not savings
function isSpendingOp(op) {
  const account = accountById(op.account);
  return account && !account.savings;
}

function operationsInMonth(year, month) {
  const prefix = monthPrefix(year, month);
  return state.operations.filter(op => op.date.startsWith(prefix) && isSpendingOp(op));
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
    saveState(state);
    renderAll();
  } catch {
    // No internet or the request was blocked — keep the saved rate
  }
}

// ---------- Home ----------

function renderBalance() {
  const everyday = state.accounts.filter(a => !a.savings);
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
  const groups = [
    { key: 'mono', accounts: state.accounts.filter(a => !a.savings && a.group === 'mono') },
    { key: 'other', accounts: state.accounts.filter(a => !a.savings && a.group !== 'mono') }
  ];
  for (const group of groups) {
    if (!group.accounts.length) continue;
    box.append(el('p', 'group-title muted small', t('group_' + group.key)));
    const grid = el('div', 'accounts');
    for (const account of group.accounts) {
      const card = el('div', `acc acc-${account.style ?? 'custom'}`);
      card.append(el('span', 'acc-name', accountName(account)));
      card.append(el('strong', 'acc-sum', formatMoney(accountBalance(account), account.currency)));
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

  const savings = state.accounts.filter(a => a.savings);
  if (!savings.length) {
    box.append(el('p', 'muted small', t('savings_empty')));
    return;
  }
  for (const account of savings) {
    const balance = accountBalance(account);
    const row = el('div', 'row-between');
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

// One transaction row (used on Home and in the Calendar)
function renderOperationRow(op, showDate) {
  const account = accountById(op.account);
  const category = categoryById(op.category);
  const row = el('div', 'op');

  const badge = el('span', 'badge', t('cat_' + op.category).charAt(0));
  badge.style.color = category.color;

  const info = el('div', 'op-info');
  info.append(el('span', 'op-title', op.note || t('cat_' + op.category)));
  // If there's no note, the category is already the title, so don't repeat it
  const details = op.note ? [t('cat_' + op.category), accountLabel(account)] : [accountLabel(account)];
  if (showDate) details.unshift(dayLabel(op.date));
  // textContent (not innerHTML) so a note can't inject HTML
  info.append(el('span', 'muted small ellipsis', details.join(' · ')));

  const sign = op.type === 'income' ? '+' : '−';
  const amount = el('span', 'op-amount ' + (op.type === 'income' ? 'pos' : 'neg'),
    sign + formatMoney(op.amount, account?.currency ?? 'UAH'));

  const del = el('button', 'icon-btn del', '×');
  del.setAttribute('aria-label', t('delete'));
  del.addEventListener('click', () => deleteOperation(op.id));

  row.append(badge, info, amount, del);
  return row;
}

function renderRecent() {
  const box = $('recent');
  box.innerHTML = '';
  const recent = [...state.operations]
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
  const ops = state.operations
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
  svg.setAttribute('aria-label', rows.map(([id, sum]) => `${t('cat_' + id)} ${Math.round((sum / total) * 100)}%`).join(', ') || t('no_expenses'));

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
    name.append(dot, document.createTextNode(t('cat_' + id)));
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
  $('limit-input').value = state.monthlyLimit || '';
  const box = $('start-balances');
  box.innerHTML = '';
  for (const account of state.accounts) {
    const row = el('div', 'start-row');
    const label = el('label');
    label.append(el('span', '', `${accountLabel(account)} (${currencySymbol(account.currency)})`));
    const input = el('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = account.start;
    input.dataset.account = account.id;
    label.append(input);
    row.append(label);
    // Built-in accounts have no name; only accounts you added can be deleted
    if (account.name) {
      const del = el('button', 'icon-btn del', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `${t('delete')}: ${account.name}`);
      del.addEventListener('click', () => deleteAccount(account.id));
      row.append(del);
    }
    box.append(row);
  }

  const time = state.rates.updatedAt
    ? new Date(state.rates.updatedAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  $('rate-info').textContent = time
    ? `${t('rate_line', { cur: '$', rate: formatMoney(state.rates.USD), when: time })}\n${t('rate_line', { cur: '€', rate: formatMoney(state.rates.EUR), when: time })}`
    : t('rate_fallback', { usd: formatMoney(state.rates.USD), eur: formatMoney(state.rates.EUR) });
}

// ---------- Rendering everything ----------

const VIEW_TITLES = { home: 'title', calendar: 'nav_calendar', stats: 'nav_stats', profile: 'nav_profile' };

const laptop = window.matchMedia('(min-width: 900px)');

function renderAll() {
  // On a laptop the app name is already in the sidebar, so Home gets its own title
  const titleKey = currentView === 'home' && laptop.matches ? 'nav_home' : VIEW_TITLES[currentView];
  $('view-title').textContent = t(titleKey);
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

// ---------- Actions ----------

function deleteOperation(id) {
  state.operations = state.operations.filter(op => op.id !== id);
  saveState(state);
  renderAll();
}

function deleteAccount(id) {
  state.accounts = state.accounts.filter(a => a.id !== id);
  state.operations = state.operations.filter(op => op.account !== id);
  saveState(state);
  renderAll();
}

// ---------- New-operation dialog (keypad) ----------

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
  $('amount-text').textContent = draft.amount || '0';
  $('amount-cur').textContent = currencySymbol(account?.currency ?? 'UAH');

  document.querySelectorAll('.segment button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === draft.type);
    btn.setAttribute('aria-pressed', btn.dataset.type === draft.type);
  });

  const chips = $('op-accounts');
  chips.innerHTML = '';
  for (const acc of state.accounts) {
    const chip = el('button', 'chip-btn' + (acc.id === draft.account ? ' active' : ''), accountLabel(acc));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', acc.id === draft.account);
    chip.addEventListener('click', () => { draft.account = acc.id; renderDraft(); });
    chips.append(chip);
  }

  const grid = $('op-categories');
  grid.innerHTML = '';
  for (const cat of CATEGORIES[draft.type]) {
    const btn = el('button', 'cat' + (cat.id === draft.category ? ' active' : ''));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', cat.id === draft.category);
    const badge = el('span', 'badge big', t('cat_' + cat.id).charAt(0));
    badge.style.color = cat.color;
    btn.append(badge, el('span', 'cat-label', t('cat_' + cat.id)));
    btn.addEventListener('click', () => { draft.category = cat.id; renderDraft(); });
    grid.append(btn);
  }
}

function openOperationDialog() {
  draft = {
    type: 'expense',
    amount: '',
    account: draft.account && accountById(draft.account) ? draft.account : state.accounts[0]?.id,
    category: CATEGORIES.expense[0].id
  };
  $('op-date').value = currentView === 'calendar' ? selectedDay : todayISO();
  $('op-note').value = '';
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
  const date = $('op-date').value || todayISO();
  state.operations.push({
    id: makeId(),
    type: draft.type,
    amount: Math.round(amount * 100) / 100,
    account: draft.account,
    category: draft.category,
    date,
    note: $('op-note').value.trim(),
    createdAt: Date.now()
  });
  saveState(state);
  selectedDay = date;
  $('op-dialog').close();
  renderAll();
}

// Typing on a laptop keyboard works too while the dialog is open
function handleDialogKeys(event) {
  if (!$('op-dialog').open) return;
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
    goal: savings && goal > 0 ? goal : null
  });
  saveState(state);
  $('acc-dialog').close();
  renderAll();
}

// ---------- Settings ----------

function saveSettings(event) {
  event.preventDefault();
  const limit = parseAmount($('limit-input').value);
  state.monthlyLimit = limit > 0 ? limit : 0;
  $('start-balances').querySelectorAll('input').forEach(input => {
    const account = accountById(input.dataset.account);
    const value = parseAmount(input.value);
    if (account) account.start = Number.isFinite(value) ? value : 0;
  });
  saveState(state);
  renderAll();
  const saved = $('settings-saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 2000);
}

// ---------- Event listeners ----------

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
$('nav-add').addEventListener('click', openOperationDialog);
$('all-ops').addEventListener('click', () => showView('calendar'));
document.querySelectorAll('.month-prev').forEach(b => b.addEventListener('click', () => changeMonth(-1)));
document.querySelectorAll('.month-next').forEach(b => b.addEventListener('click', () => changeMonth(1)));

document.querySelectorAll('.segment button').forEach(btn => {
  btn.addEventListener('click', () => {
    draft.type = btn.dataset.type;
    draft.category = CATEGORIES[draft.type][0].id;
    renderDraft();
  });
});
$('op-form').addEventListener('submit', saveOperation);
$('op-close').addEventListener('click', () => $('op-dialog').close());
document.addEventListener('keydown', handleDialogKeys);

$('add-account-btn').addEventListener('click', openAccountDialog);
$('acc-form').addEventListener('submit', saveAccount);
$('acc-close').addEventListener('click', () => $('acc-dialog').close());
$('acc-savings').addEventListener('change', e => { $('acc-goal-wrap').hidden = !e.target.checked; });
$('acc-name').addEventListener('input', () => { $('acc-error').hidden = true; });

$('settings-form').addEventListener('submit', saveSettings);

$('lang-switch').addEventListener('click', () => {
  setLang(getLang() === 'uk' ? 'en' : 'uk');
  applyStaticTexts();
  buildKeypad();
  renderAll();
  if ($('op-dialog').open) renderDraft();
});

laptop.addEventListener('change', renderAll);

// ---------- Start ----------
applyStaticTexts();
buildKeypad();
showView('home');
refreshRates();

// Save the app on the device so it also opens without internet
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Not supported or blocked (e.g. opened as a plain file) — the app still works online
  });
}