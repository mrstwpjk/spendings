// =====================================================
// i18n.js — translations and money/date formatting
// =====================================================

// {name} parts are placeholders that t() fills in.
const translations = {
  uk: {
    title: 'Spendings',
    auth_tagline: 'Твої витрати на всіх пристроях',
    auth_title_login: 'Вхід',
    auth_title_signup: 'Реєстрація',
    email: 'Пошта',
    password: 'Пароль',
    auth_login_btn: 'Увійти',
    auth_signup_btn: 'Створити акаунт',
    auth_switch_to_signup: 'Немає акаунта? Зареєструватися',
    auth_switch_to_login: 'Вже є акаунт? Увійти',
    auth_bad_email: 'Введи пошту',
    auth_short_password: 'Пароль має бути щонайменше 6 символів',
    auth_invalid: 'Неправильна пошта або пароль',
    auth_exists: 'Акаунт з такою поштою вже є — увійди',
    auth_not_confirmed: 'Спершу підтвердь пошту: відкрий лист від Supabase',
    auth_check_email: 'Майже готово! Відкрий лист на пошті, натисни посилання для підтвердження, а потім увійди тут.',
    auth_not_configured: 'Supabase ще не налаштовано: впиши адресу й ключ у config.js.',
    auth_offline: 'Немає інтернету. Для входу потрібен інтернет.',
    auth_generic: 'Не вдалося: {msg}',
    wait: 'Зачекай…',
    account: 'Акаунт',
    logout: 'Вийти',
    sync_ok: 'Усе синхронізовано',
    sync_syncing: 'Синхронізація…',
    sync_offline: 'Офлайн: зміни збережено на пристрої й синхронізуються, щойно з\'явиться інтернет',
    sync_error: 'Не вдалося синхронізувати. Спробую ще раз пізніше',
    edit_operation: 'Редагувати операцію',
    delete_operation: 'Видалити операцію',
        balance_edit_title: 'Баланс рахунку',
    balance_now: 'Скільки зараз на «{name}», {cur}',
    balance_hint: 'Записані витрати й надходження не зміняться: застосунок лише підлаштує рахунок під реальну суму.',
    error_balance: 'Введи суму, наприклад 1250 або 1250,50',
    nav_home: 'Головна',
    nav_calendar: 'Календар',
    nav_stats: 'Статистика',
    nav_profile: 'Профіль',
    add: 'Додати',
    total_balance: 'Загальний баланс',
    total_note_usd: 'з них {foreign} ≈ {uah} за курсом mono',
    group_mono: 'monobank',
    group_other: 'Інші',
    add_account: 'Додати рахунок',
    savings: 'Накопичення',
    savings_hint: 'не входять у витрати',
    savings_empty: 'Відкриєш рахунок для накопичень — додай його тут і познач «для накопичень».',
    goal_progress: '{have} з {goal}',
    limit_title: '{month} · ліміт {limit}',
    limit_none: 'Ліміт не встановлено',
    limit_spent: '{spent} витрачено',
    limit_left: 'Ще {left} · ~{perDay} на день',
    limit_over: 'Перевищено на {over}',
    recent: 'Останні операції',
    all_operations: 'Усі операції',
    empty: 'Поки що порожньо. Натисни «+», щоб додати першу операцію.',
    empty_day: 'Цього дня операцій немає.',
    prev_month: 'Попередній місяць',
    next_month: 'Наступний місяць',
    expenses: 'Витрати',
    incomes: 'Надходження',
    spent: 'Витрачено',
    no_expenses: 'У цьому місяці витрат ще немає.',
    month_by_month: 'Місяць за місяцем',
    monthly_limit: 'Ліміт витрат на місяць, грн',
    start_balances: 'Скільки грошей зараз на кожному рахунку',
    save: 'Зберегти',
    saved: 'Збережено',
    cancel: 'Скасувати',
    delete: 'Видалити',
    exchange_rate: 'Курс валют',
    rate_line: '1 {cur} = {rate} · оновлено {when}',
    rate_fallback: 'Не вдалося отримати курс mono, тому поки використовується приблизний: 1 $ = {usd}, 1 € = {eur}.',
    new_operation: 'Нова операція',
    expense: 'Витрата',
    income: 'Надходження',
    date: 'Дата',
    note: 'Коментар',
    note_placeholder: 'Коментар, наприклад «шаурма біля корпусу»',
    erase: 'Стерти',
    error_amount: 'Введи суму, більшу за 0',
    account_name: 'Назва',
    account_name_placeholder: 'Наприклад, «Банка на ноутбук»',
    error_name: 'Введи назву рахунку',
    currency: 'Валюта',
    current_balance: 'Скільки там зараз',
    is_savings: 'Це рахунок для накопичень',
    goal: 'Ціль (необов\'язково), у валюті рахунку',
    today: 'Сьогодні',
    yesterday: 'Вчора',

    acc_mono_white: 'Біла',
    acc_mono_black: 'Чорна',
    acc_mono_usd: 'Доларова',
    acc_privat: 'Приват',
    acc_pumb: 'ПУМБ',
    acc_cash: 'Готівка',

    cat_food: 'Їжа',
    cat_transport: 'Транспорт',
    cat_study: 'Навчання',
    cat_fun: 'Розваги',
    cat_clothes: 'Одяг',
    cat_health: 'Здоров\'я',
    cat_gifts: 'Подарунки',
    cat_subscriptions: 'Підписки',
    cat_other: 'Інше',
    cat_scholarship: 'Стипендія',
    cat_family: 'Від родини',
    cat_job: 'Підробіток',
    cat_other_income: 'Інше'
  },

  en: {
    title: 'Spendings',
    auth_tagline: 'Your spending on every device',
    auth_title_login: 'Log in',
    auth_title_signup: 'Sign up',
    email: 'Email',
    password: 'Password',
    auth_login_btn: 'Log in',
    auth_signup_btn: 'Create account',
    auth_switch_to_signup: 'No account yet? Sign up',
    auth_switch_to_login: 'Already have an account? Log in',
    auth_bad_email: 'Enter your email',
    auth_short_password: 'The password needs at least 6 characters',
    auth_invalid: 'Wrong email or password',
    auth_exists: 'This email already has an account — log in',
    auth_not_confirmed: 'Confirm your email first: open the email from Supabase',
    auth_check_email: 'Almost done! Open the email, tap the confirmation link, then log in here.',
    auth_not_configured: 'Supabase isn\'t set up yet: add the URL and key to config.js.',
    auth_offline: 'No internet. Logging in needs a connection.',
    auth_generic: 'Something went wrong: {msg}',
    wait: 'Wait…',
    account: 'Account',
    logout: 'Log out',
    sync_ok: 'Everything is synced',
    sync_syncing: 'Syncing…',
    sync_offline: 'Offline: changes are saved on this device and will sync once you\'re online',
    sync_error: 'Couldn\'t sync. Will try again later',
    edit_operation: 'Edit transaction',
    delete_operation: 'Delete transaction',
        balance_edit_title: 'Account balance',
    balance_now: 'How much is on “{name}” now, {cur}',
    balance_hint: 'Your recorded transactions stay as they are — the app only adjusts the account to the real amount.',
    error_balance: 'Enter an amount, e.g. 1250 or 1250.50',
    nav_home: 'Home',
    nav_calendar: 'Calendar',
    nav_stats: 'Stats',
    nav_profile: 'Profile',
    add: 'Add',
    total_balance: 'Total balance',
    total_note_usd: 'incl. {foreign} ≈ {uah} at the mono rate',
    group_mono: 'monobank',
    group_other: 'Other',
    add_account: 'Add account',
    savings: 'Savings',
    savings_hint: 'not counted as spending',
    savings_empty: 'Opened a savings account? Add it here and mark it as savings.',
    goal_progress: '{have} of {goal}',
    limit_title: '{month} · limit {limit}',
    limit_none: 'No limit set',
    limit_spent: '{spent} spent',
    limit_left: '{left} left · ~{perDay} a day',
    limit_over: 'Over by {over}',
    recent: 'Recent transactions',
    all_operations: 'All transactions',
    empty: 'Nothing here yet. Tap “+” to add your first transaction.',
    empty_day: 'No transactions on this day.',
    prev_month: 'Previous month',
    next_month: 'Next month',
    expenses: 'Expenses',
    incomes: 'Income',
    spent: 'Spent',
    no_expenses: 'No expenses this month yet.',
    month_by_month: 'Month by month',
    monthly_limit: 'Monthly spending limit, UAH',
    start_balances: 'How much money is on each account right now',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    delete: 'Delete',
    exchange_rate: 'Exchange rates',
    rate_line: '1 {cur} = {rate} · updated {when}',
    rate_fallback: 'Couldn\'t get the mono rate, so an approximate one is used: 1 $ = {usd}, 1 € = {eur}.',
    new_operation: 'New transaction',
    expense: 'Expense',
    income: 'Income',
    date: 'Date',
    note: 'Note',
    note_placeholder: 'Note, e.g. “lunch near campus”',
    erase: 'Erase',
    error_amount: 'Enter an amount greater than 0',
    account_name: 'Name',
    account_name_placeholder: 'e.g. “Laptop fund”',
    error_name: 'Enter an account name',
    currency: 'Currency',
    current_balance: 'Current balance',
    is_savings: 'This is a savings account',
    goal: 'Goal (optional), in the account currency',
    today: 'Today',
    yesterday: 'Yesterday',

    acc_mono_white: 'White',
    acc_mono_black: 'Black',
    acc_mono_usd: 'Dollar',
    acc_privat: 'PrivatBank',
    acc_pumb: 'PUMB',
    acc_cash: 'Cash',

    cat_food: 'Food',
    cat_transport: 'Transport',
    cat_study: 'Study',
    cat_fun: 'Fun',
    cat_clothes: 'Clothes',
    cat_health: 'Health',
    cat_gifts: 'Gifts',
    cat_subscriptions: 'Subscriptions',
    cat_other: 'Other',
    cat_scholarship: 'Scholarship',
    cat_family: 'From family',
    cat_job: 'Side job',
    cat_other_income: 'Other'
  }
};

// Current language: the saved one, otherwise Ukrainian
let lang = 'uk';
try {
  lang = localStorage.getItem('lang') || 'uk';
} catch {
  // Storage unavailable — keep Ukrainian
}

export function getLang() {
  return lang;
}

export function setLang(newLang) {
  lang = newLang;
  try {
    localStorage.setItem('lang', newLang);
  } catch {
    // Couldn't save the choice — the language still switches
  }
}

// t('limit_spent', { spent: '100 ₴' }) → '100 ₴ витрачено'
export function t(key, vars = {}) {
  let text = translations[lang][key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

// 'uk' → 'uk-UA', 'en' → 'en-US' (needed by Intl)
export function locale() {
  return lang === 'uk' ? 'uk-UA' : 'en-US';
}

const SYMBOLS = { UAH: '₴', USD: '$', EUR: '€' };

// formatMoney(1250) → '1 250 ₴' ; formatMoney(12, 'USD') → '$12'
export function formatMoney(amount, currency = 'UAH') {
  const number = new Intl.NumberFormat(locale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Math.abs(amount));
  const sign = amount < 0 ? '−' : '';
  const symbol = SYMBOLS[currency] ?? currency;
  return currency === 'UAH' ? `${sign}${number} ${symbol}` : `${sign}${symbol}${number}`;
}

export function currencySymbol(currency) {
  return SYMBOLS[currency] ?? currency;
}

// '2026-11-19' → 'Чт, 19 листопада'
export function formatDay(isoDate) {
  const date = new Date(isoDate + 'T00:00:00');
  return capitalize(date.toLocaleDateString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'long'
  }));
}

// (2026, 10) → 'Листопад 2026 р.'  (months are 0-based)
export function formatMonth(year, month) {
  return capitalize(new Date(year, month, 1).toLocaleDateString(locale(), {
    month: 'long',
    year: 'numeric'
  }));
}

// (2026, 10) → 'Лист.' / 'Nov' — short label for the bar chart
export function formatMonthShort(year, month) {
  return capitalize(new Date(year, month, 1).toLocaleDateString(locale(), { month: 'short' }));
}

// Weekday names starting from Monday: ['Пн', 'Вт', ...]
export function weekdayNames() {
  const monday = new Date(2024, 0, 1); // 1 Jan 2024 was a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return capitalize(d.toLocaleDateString(locale(), { weekday: 'short' }));
  });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Translates every element tagged with data-i18n / data-i18n-placeholder / data-i18n-aria
export function applyStaticTexts() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  document.documentElement.lang = lang;
  // The language buttons show the language you can switch to
  document.querySelectorAll('#lang-switch, #auth-lang').forEach(btn => {
    btn.textContent = lang === 'uk' ? 'EN' : 'UA';
  });
}