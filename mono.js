// =====================================================
// mono.js — reading your own monobank transactions with a personal token.
//
// The token is created at https://api.monobank.ua (free, read-only:
// it can only look at balances and transactions, never move money).
// It is kept only on this device, never in the cloud.
//
// monobank allows one request per 60 seconds, so the app asks for one
// card at a time and waits a minute before the next request.
// =====================================================

const API = 'https://api.monobank.ua';
const SETTINGS_KEY = userId => `spendings-mono-${userId}`;
export const MONO_WAIT = 61 * 1000;        // a bit more than mono's 60 seconds

// ---------- Settings on this device ----------
// { token, accounts: [{ id, type, currency, pan, link, since }], lastRequest, lastSync, error }
//   link  = id of the Spendings account this card is imported into (null = don't import)
//   since = Unix time (seconds) up to which transactions were already imported

export function loadMonoSettings(userId) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY(userId))) ?? null;
  } catch {
    return null;
  }
}

export function saveMonoSettings(userId, settings) {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY(userId), JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS_KEY(userId));
  } catch {
    // Storage blocked — the connection just won't be remembered
  }
}

// ---------- Requests ----------

async function request(token, path) {
  let response;
  try {
    response = await fetch(API + path, { headers: { 'X-Token': token } });
  } catch {
    throw new Error('mono_network');
  }
  if (response.status === 401 || response.status === 403) throw new Error('mono_bad_token');
  if (response.status === 429) throw new Error('mono_too_often');
  if (!response.ok) throw new Error('mono_http_' + response.status);
  return response.json();
}

const CURRENCIES = { 980: 'UAH', 840: 'USD', 978: 'EUR' };

// Your cards: [{ id, type: 'black' | 'white' | ..., currency: 'UAH', pan: '•• 1234' }]
export async function fetchMonoCards(token) {
  const info = await request(token, '/personal/client-info');
  return (info.accounts ?? []).map(acc => ({
    id: acc.id,
    type: acc.type,
    currency: CURRENCIES[acc.currencyCode] ?? String(acc.currencyCode),
    pan: acc.maskedPan?.[0] ? '•• ' + acc.maskedPan[0].slice(-4) : ''
  }));
}

// Transactions of one card between two Unix times (mono allows at most 31 days)
export function fetchMonoStatement(token, accountId, from, to) {
  return request(token, `/personal/statement/${accountId}/${from}/${to}`);
}

// ---------- Which category a purchase goes to ----------
// MCC = a 4-digit code of the kind of shop, sent by the bank with every payment
const MCC_CATEGORIES = [
  { category: 'food', codes: [5411, 5412, 5422, 5441, 5451, 5462, 5499, 5811, 5812, 5813, 5814, 5921] },
  { category: 'transport', codes: [4111, 4112, 4121, 4131, 4511, 4582, 4784, 4789, 5541, 5542, 5983, 7523] },
  { category: 'clothes', codes: [5611, 5621, 5631, 5641, 5651, 5655, 5661, 5681, 5691, 5697, 5698, 5699, 5948] },
  { category: 'health', codes: [5047, 5122, 5912, 5975, 5976, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099] },
  { category: 'subscriptions', codes: [4814, 4816, 4899, 5815, 5816, 5817, 5818, 5968] },
  { category: 'fun', codes: [7832, 7841, 7911, 7922, 7929, 7932, 7933, 7941, 7991, 7992, 7993, 7994, 7996, 7997, 7998, 7999] },
  { category: 'study', codes: [2741, 5111, 5192, 5942, 5943, 5994, 8211, 8220, 8241, 8244, 8249, 8299] },
  { category: 'gifts', codes: [5947, 5992, 5944, 5945] }
];

export function categoryForMcc(mcc) {
  return MCC_CATEGORIES.find(group => group.codes.includes(mcc))?.category ?? 'other';
}

// Which Spendings account a mono card most likely is
export function guessLink(card, accounts) {
  const has = id => accounts.some(a => a.id === id && !a.deleted);
  if (card.currency === 'USD' && has('mono_usd')) return 'mono_usd';
  if (card.currency === 'UAH' && card.type === 'black' && has('mono_black')) return 'mono_black';
  if (card.currency === 'UAH' && card.type === 'white' && has('mono_white')) return 'mono_white';
  return null;
}