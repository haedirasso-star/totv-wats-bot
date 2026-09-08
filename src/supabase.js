// ══════════════════════════════════════════════════════════════
//  طبقة Supabase — إصدار الأكواد والتحقق من الاشتراكات
//  ★ يستخدم service_role لأنه سيرفر خلفي مغلق. هذا المفتاح
//    ممنوع منعاً باتاً في التطبيق أو صفحة الأدمن.
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { CFG } from './config.js';

let sb = null;
function client() {
  if (sb) return sb;
  if (!CFG.supaUrl || !CFG.supaKey) return null;
  sb = createClient(CFG.supaUrl, CFG.supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return sb;
}

async function rpc(fn, args) {
  const c = client();
  if (!c) { console.warn('[supa] غير مضبوط'); return null; }
  try {
    const { data, error } = await c.rpc(fn, args);
    if (error) { console.error(`[supa] ${fn}:`, error.message); return null; }
    return data;
  } catch (e) {
    console.error(`[supa] ${fn}:`, e?.message || e);
    return null;
  }
}

/** يصدر كوداً جاهزاً من المخزون ويحجزه لهذا العميل */
export async function issueCode({ plan, wa, email = '', name = '' }) {
  const d = await rpc('bot_issue_code', {
    p_plan: plan, p_wa: wa, p_email: email, p_name: name,
  });
  if (!d) return { ok: false, error: 'CONNECTION' };
  return d;
}

/** يسجّل طلباً معلّقاً قبل موافقة الإدارة */
export async function logOrder({ wa, name = '', email = '', plan = '', note = '' }) {
  return rpc('bot_log_order', {
    p_wa: wa, p_name: name, p_email: email, p_plan: plan, p_note: note,
  });
}

/** يتحقق من اشتراك عميل بالإيميل */
export async function checkSubscription(email) {
  const d = await rpc('bot_check_subscription', { p_email: email });
  return d || { ok: false };
}

/** مخزون الأكواد المتاحة لكل باقة */
export async function stock() {
  const d = await rpc('bot_stock', {});
  return d || {};
}
