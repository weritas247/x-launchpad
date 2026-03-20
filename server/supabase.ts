import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Service role client for Storage operations (bypasses RLS)
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : supabase;

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
  const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
  // PGRST205: table not found — supabase not set up yet, skip gracefully
  if (error && error.code !== 'PGRST205') throw error;
  cachedUserCount = count ?? 0;
}

export function getUserCount(): number {
  return cachedUserCount;
}

export async function createUser(
  email: string,
  passwordHash: string,
  name: string
): Promise<number> {
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
    .select('id, email, password_hash, name, created_at, updated_at')
    .eq('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as UserRow | null;
}

export async function getUserById(id: number): Promise<Omit<UserRow, 'password_hash'> | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, created_at, updated_at')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as Omit<UserRow, 'password_hash'> | null;
}

export interface PlanRow {
  id: string;
  user_id: number;
  title: string;
  content: string;
  category: string;
  status: string;
  ai_done: boolean;
  use_worktree: boolean;
  use_headless: boolean;
  created_at: string;
  updated_at: string;
}

export async function getPlans(userId: number): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PlanRow[];
}

export async function getPlan(userId: number, planId: string): Promise<PlanRow | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as PlanRow | null;
}

export async function createPlan(
  userId: number,
  plan: { id: string; title: string; content: string; category: string; status?: string }
): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .insert({
      id: plan.id,
      user_id: userId,
      title: plan.title,
      content: plan.content,
      category: plan.category,
      status: plan.status || 'todo',
    })
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export async function updatePlan(
  userId: number,
  planId: string,
  updates: { title?: string; content?: string; category?: string; status?: string; use_worktree?: boolean; use_headless?: boolean }
): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export async function deletePlan(userId: number, planId: string): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', planId).eq('user_id', userId);
  if (error) throw error;
}

export async function updatePlanStatus(
  userId: number,
  planId: string,
  status: string
): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .update({ status, ai_done: false, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export interface PlanLogRow {
  id: number;
  plan_id: string;
  type: string;
  content: string;
  commit_hash: string | null;
  created_at: string;
}

export async function getPlanLogs(userId: number, planId: string): Promise<PlanLogRow[]> {
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (planErr || !plan) throw planErr || new Error('Plan not found');
  const { data, error } = await supabase
    .from('plan_logs')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PlanLogRow[];
}

export async function appendPlanLog(
  userId: number,
  log: { plan_id?: string; type: string; content: string; commit_hash?: string }
): Promise<{ plan: PlanRow | null; log: PlanLogRow | null }> {
  let planId = log.plan_id;
  if (!planId) {
    const { data: doingPlans } = await supabase
      .from('plans')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'doing')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (!doingPlans || doingPlans.length === 0) return { plan: null, log: null };
    planId = doingPlans[0].id;
  } else {
    const { data: plan } = await supabase
      .from('plans')
      .select('id')
      .eq('id', planId)
      .eq('user_id', userId)
      .single();
    if (!plan) throw new Error('Plan not found');
  }
  const { data: logRow, error: logErr } = await supabase
    .from('plan_logs')
    .insert({
      plan_id: planId,
      type: log.type,
      content: log.content,
      commit_hash: log.commit_hash || null,
    })
    .select()
    .single();
  if (logErr) throw logErr;
  let plan: PlanRow | null;
  if (log.type === 'summary') {
    const { data: updated } = await supabase
      .from('plans')
      .update({ ai_done: true, status: 'done' })
      .eq('id', planId)
      .select()
      .single();
    plan = updated as PlanRow;
  } else {
    const { data: current } = await supabase.from('plans').select('*').eq('id', planId).single();
    plan = current as PlanRow;
  }
  return { plan, log: logRow as PlanLogRow };
}

// ─── Plan Images (Supabase Storage) ─────────────────────────────
const PLAN_IMAGES_BUCKET = 'plan-images';

export async function ensurePlanImagesBucket(): Promise<void> {
  const { error } = await supabaseAdmin.storage.createBucket(PLAN_IMAGES_BUCKET, { public: true });
  if (error && !error.message.includes('already exists')) {
    console.warn('[supabase] Failed to create plan-images bucket:', error.message);
  }
}

export async function uploadPlanImage(
  userId: number,
  planId: string,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<{ path: string; url: string }> {
  // Verify plan belongs to user
  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (!plan) throw new Error('Plan not found');

  const storagePath = `${userId}/${planId}/${filename}`;
  const { error } = await supabaseAdmin.storage
    .from(PLAN_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
  if (error) throw error;

  const { data: urlData } = supabaseAdmin.storage
    .from(PLAN_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  return { path: storagePath, url: urlData.publicUrl };
}

export async function listPlanImages(
  userId: number,
  planId: string
): Promise<{ name: string; url: string }[]> {
  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (!plan) throw new Error('Plan not found');

  const prefix = `${userId}/${planId}`;
  const { data, error } = await supabaseAdmin.storage.from(PLAN_IMAGES_BUCKET).list(prefix);
  if (error) throw error;
  return (data || []).map((f) => {
    const { data: urlData } = supabaseAdmin.storage
      .from(PLAN_IMAGES_BUCKET)
      .getPublicUrl(`${prefix}/${f.name}`);
    return { name: f.name, url: urlData.publicUrl };
  });
}

export async function deletePlanImage(
  userId: number,
  planId: string,
  filename: string
): Promise<void> {
  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (!plan) throw new Error('Plan not found');

  const storagePath = `${userId}/${planId}/${filename}`;
  const { error } = await supabaseAdmin.storage.from(PLAN_IMAGES_BUCKET).remove([storagePath]);
  if (error) throw error;
}
