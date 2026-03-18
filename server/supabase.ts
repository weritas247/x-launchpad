import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// Cached user count - loaded at server start, incremented on registration
let cachedUserCount = 0;

export async function initUserCount(): Promise<void> {
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  cachedUserCount = count ?? 0;
}

export function getUserCount(): number {
  return cachedUserCount;
}

export async function createUser(email: string, passwordHash: string, name: string): Promise<number> {
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, name })
    .select('id')
    .single();
  if (error) throw error;
  cachedUserCount++;
  return data.id;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as UserRow | null;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as UserRow | null;
}
