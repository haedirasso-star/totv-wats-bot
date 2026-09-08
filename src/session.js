// ══════════════════════════════════════════════════════════════
//  حالة المحادثة لكل مستخدم
//  في الذاكرة — يكفي لآلاف المستخدمين. للاستمرارية بعد إعادة
//  التشغيل يمكن نقلها إلى Supabase لاحقاً (جدول bot_sessions).
// ══════════════════════════════════════════════════════════════

const SESSIONS = new Map();
const TTL_MS = 1000 * 60 * 60 * 12;   // 12 ساعة

export function getSession(id) {
  const now = Date.now();
  let s = SESSIONS.get(id);
  if (!s || now - s.updated > TTL_MS) {
    s = {
      id,
      stage: 'idle',      // idle | choosing | awaiting_payment | awaiting_email | pending_admin | done
      plan: null,         // كائن الباقة المختارة
      email: null,
      receiptId: null,    // معرّف صورة الوصل في واتساب
      name: null,
      history: [],        // سجل المحادثة للذكاء الاصطناعي
      greeted: false,
      created: now,
    };
    SESSIONS.set(id, s);
  }
  s.updated = now;
  return s;
}

export function setSession(id, patch) {
  const s = getSession(id);
  Object.assign(s, patch, { updated: Date.now() });
  SESSIONS.set(id, s);
  return s;
}

export function pushHistory(id, role, text) {
  const s = getSession(id);
  s.history.push({ role, text });
  if (s.history.length > 20) s.history = s.history.slice(-20);
  s.updated = Date.now();
}

export function resetSession(id) {
  SESSIONS.delete(id);
}

export function sessionCount() { return SESSIONS.size; }

// تنظيف دوري للجلسات المنتهية
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of SESSIONS) {
    if (now - v.updated > TTL_MS) SESSIONS.delete(k);
  }
}, 1000 * 60 * 30);
