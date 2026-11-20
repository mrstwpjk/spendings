// =====================================================
// sync.js — accounts and cloud sync through Supabase
// Each user has one row in the user_data table with all their data.
// =====================================================

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-') && !SUPABASE_KEY.includes('YOUR-');

let supabase = null;

// The Supabase library is loaded only when needed, so the app
// still starts if it can't be downloaded (for example, offline).
async function client() {
  if (!isConfigured) throw new Error('not_configured');
  if (!supabase) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

// The logged-in user, or null
export async function getUser() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function signUp(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  // data.session is null when Supabase asks to confirm the email first
  return { user: data.user, needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}

// Downloads the user's data (or null if there's nothing yet)
export async function pullRemote(userId) {
  const sb = await client();
  const { data, error } = await sb.from('user_data').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

// Uploads the user's data (creates the row the first time)
export async function pushRemote(userId, state) {
  const sb = await client();
  const { error } = await sb.from('user_data').upsert({
    user_id: userId,
    data: state,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}