// =====================================================
// theme.js — dark / light theme and the accent (button) color.
// Kept on this device only: the phone and the laptop can look different.
// =====================================================

const THEME_KEY = 'spendings-theme';
const ACCENT_KEY = 'spendings-accent';

// Accent colors you can choose; the first one is the default
export const ACCENTS = {
  burgundy: '#A3173B',
  sapphire: '#3B5BDB',
  rose: '#D6336C',
  emerald: '#0F8A6A',
  violet: '#7048E8',
  amber: '#C2620A'
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function read(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked — the choice works until the page is closed
  }
}

export function getTheme() {
  return read(THEME_KEY, 'dark');            // 'dark' | 'light' | 'auto'
}

export function getAccent() {
  const accent = read(ACCENT_KEY, 'burgundy');
  return accent in ACCENTS ? accent : 'burgundy';
}

export function setTheme(theme) {
  write(THEME_KEY, theme);
  applyTheme();
}

export function setAccent(accent) {
  write(ACCENT_KEY, accent);
  applyTheme();
}

// Puts data-theme / data-accent on <html>; style.css does the rest
export function applyTheme() {
  const theme = getTheme();
  const resolved = theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.accent = getAccent();
  // Color of the phone's status bar
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'light' ? '#F4F5FA' : '#0A0D1A';
}

// "Like my phone": follow the phone when it switches between dark and light
darkQuery.addEventListener('change', () => {
  if (getTheme() === 'auto') applyTheme();
});