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
  return liveOps()
    .filter(op => op.account === account.id)
    .reduce((sum, op) => op.type === 'income' ? sum + op.amount : sum - op.amount, account.start);
}

// Only everyday accounts count towards spending and the limit, not savings
function isSpendingOp(op) {
  const account = accountById(op.account);
  return account && !account.deleted && !account.savings;
}

function operationsInMonth(year, month) {
  const prefix =