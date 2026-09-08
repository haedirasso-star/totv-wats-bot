// ══════════════════════════════════════════════════════════════
//  مسار المبيعات — آلة حالات ثابتة
//  ──────────────────────────────────────────────────────────────
//  لماذا ليس بالذكاء الاصطناعي؟ لأن هذا المسار يتعامل مع نقود
//  وأكواد. نموذج اللغة قد يخترع سعراً أو يتخطّى خطوة أو يعد بشيء
//  لا نستطيع الوفاء به. الخطوات هنا محدّدة سطراً بسطر.
//
//  المسار:
//   idle → يطلب الأسعار → choosing
//   choosing → يختار باقة → awaiting_payment
//   awaiting_payment → يرسل صورة → awaiting_email
//   awaiting_email → يرسل إيميل → pending_admin (تحويل لتلجرام)
//   pending_admin → الإدارة توافق → إرسال الكود → done
// ══════════════════════════════════════════════════════════════

import {
  plansMessage, paymentMessage, findPlan, extractEmail,
  RECEIPT_ACK, EMAIL_ACK, WELCOME, codeMessage, PLANS,
} from './knowledge.js';
import { getSession, setSession, pushHistory } from './session.js';
import { askAI } from './ai.js';
import * as WA from './whatsapp.js';
import * as TG from './telegram.js';
import { logOrder, checkSubscription } from './supabase.js';
import { CFG } from './config.js';

const isPlansIntent = t => /سعر|أسعار|اسعار|باقة|باقات|اشتراك|اشترك|كم|شكد|بكم|price/i.test(t);
const isDownload    = t => /تحميل|حمل|رابط|لينك|تطبيق|download|apk/i.test(t);
const isGreeting    = t => /^(هلا|هلو|السلام|مرحبا|مرحبتين|اهلا|أهلا|هاي|hi|hello|صباح|مساء)/i.test(t.trim());

/**
 * المعالج الرئيسي لرسالة واردة.
 * @param {{from:string,name:string,text:string,type:string,mediaId:string|null}} msg
 */
export async function handleMessage(msg) {
  const { from, name, text, type, mediaId } = msg;
  const s = getSession(from);
  if (name && !s.name) setSession(from, { name });

  // ── 1. صورة (وصل تحويل) ───────────────────────────────────
  if (type === 'image' || type === 'document') {
    return handleReceipt(from, mediaId, text);
  }

  const t = (text || '').trim();
  if (!t) {
    await WA.sendText(from, 'ممكن تكتب سؤالك؟ 🙂');
    return;
  }
  pushHistory(from, 'user', t);

  // ── 2. اختيار باقة (له أولوية أثناء مرحلة الاختيار) ───────
  if (s.stage === 'choosing') {
    const plan = findPlan(t);
    if (plan) {
      setSession(from, { plan, stage: 'awaiting_payment' });
      await WA.sendText(from, paymentMessage(plan));
      await logOrder({ wa: from, name: s.name || name, plan: plan.id, note: 'اختار باقة' });
      return;
    }
    // لم يختر رقماً — أكمل بالذكاء الاصطناعي لكن أبقِ المرحلة
  }

  // ── 3. إيميل مُرسَل ───────────────────────────────────────
  const email = extractEmail(t);
  if (email) {
    return handleEmail(from, email, s);
  }

  // ── 4. طلب الأسعار صراحةً ─────────────────────────────────
  if (isPlansIntent(t)) {
    setSession(from, { stage: 'choosing' });
    await WA.sendText(from, plansMessage());
    return;
  }

  // ── 5. طلب رابط التحميل ───────────────────────────────────
  if (isDownload(t)) {
    await WA.sendText(from,
      `📥 *تحميل TOTV+*\n\n${CFG.downloadUrl}\n\n` +
      `• نسخة للهاتف ونسخة للشاشات\n` +
      `• للآيفون: فيه حل خاص، اسألني عنه\n\n` +
      `بعد التحميل تحتاج كود تفعيل — اكتب *أسعار* لعرض الباقات.`);
    return;
  }

  // ── 6. تحية أولى ──────────────────────────────────────────
  if (isGreeting(t) && !s.greeted) {
    setSession(from, { greeted: true });
    await WA.sendText(from, WELCOME);
    return;
  }

  // ── 7. أي شيء آخر → الذكاء الاصطناعي ──────────────────────
  const ai = await askAI(t, s.history);
  pushHistory(from, 'model', ai.reply);

  if (ai.showPlans) {
    setSession(from, { stage: 'choosing' });
    await WA.sendText(from, plansMessage());
    return;
  }

  if (ai.reply) await WA.sendText(from, ai.reply);

  if (ai.escalate) {
    await escalate(from, s, t, ai.reply);
  }
}

// ══════════════════════════════════════════════════════════════
//  استلام صورة الوصل
// ══════════════════════════════════════════════════════════════
async function handleReceipt(from, mediaId, caption) {
  const s = getSession(from);
  setSession(from, { receiptId: mediaId });

  // إن كان الإيميل موجوداً مسبقاً → أرسل للإدارة فوراً
  if (s.email) {
    await WA.sendText(from, EMAIL_ACK);
    setSession(from, { stage: 'pending_admin' });
    await forwardToAdmin(from, mediaId, caption);
    return;
  }

  await WA.sendText(from, RECEIPT_ACK);
  setSession(from, { stage: 'awaiting_email' });
  // نحوّل الصورة الآن ليراها الأدمن، ويصله الإيميل لاحقاً
  await forwardToAdmin(from, mediaId, caption);
}

// ══════════════════════════════════════════════════════════════
//  استلام الإيميل
// ══════════════════════════════════════════════════════════════
async function handleEmail(from, email, s) {
  setSession(from, { email });

  // لو ما زال بلا وصل → قد يكون يسأل عن اشتراكه
  if (!s.receiptId) {
    const sub = await checkSubscription(email);
    if (sub?.found) {
      const msg = sub.active
        ? `اشتراكك فعّال ✅\n📦 الباقة: ${sub.plan || '—'}\n⏳ المتبقي: ${sub.days_left} يوم`
        : `اشتراكك على هذا الإيميل *منتهي* ⛔\nاكتب *أسعار* للتجديد.`;
      await WA.sendText(from, msg);
      return;
    }
    await WA.sendText(from,
      `ما لقيت اشتراك على هذا الإيميل.\n` +
      `إذا محوّل مبلغ، أرسل *صورة* الوصل وراح نفعّله فوراً.\n` +
      `أو اكتب *أسعار* لعرض الباقات.`);
    await logOrder({ wa: from, name: s.name, email, note: 'إيميل بلا وصل' });
    return;
  }

  await WA.sendText(from, EMAIL_ACK);
  setSession(from, { stage: 'pending_admin' });
  await forwardToAdmin(from, s.receiptId, `الإيميل: ${email}`);
}

// ══════════════════════════════════════════════════════════════
//  تحويل الطلب للإدارة على تلجرام
// ══════════════════════════════════════════════════════════════
async function forwardToAdmin(from, mediaId, note = '') {
  const s = getSession(from);
  const planTxt = s.plan ? `${s.plan.name} — ${s.plan.priceText}` : 'لم يحدّد';

  const caption =
    `🧾 *طلب اشتراك جديد*\n\n` +
    `👤 ${s.name || 'بلا اسم'}\n` +
    `📱 \`${from}\`\n` +
    `📧 ${s.email || '— لم يرسل الإيميل بعد —'}\n` +
    `📦 ${planTxt}\n` +
    (note ? `📝 ${note}\n` : '') +
    `\nاختر الباقة للتفعيل 👇`;

  const kb = TG.approvalKeyboard(from, s.plan?.id);

  if (mediaId) {
    const media = await WA.downloadMedia(mediaId);
    if (media) {
      await TG.tgReceipt({ ...media, caption, keyboard: kb });
      return;
    }
  }
  await TG.tgText(caption, { reply_markup: kb });
}

// ══════════════════════════════════════════════════════════════
//  تصعيد شكوى للدعم البشري
// ══════════════════════════════════════════════════════════════
async function escalate(from, s, userText, botReply) {
  await TG.tgText(
    `⚠️ *شكوى تحتاج تدخّل*\n\n` +
    `👤 ${s.name || 'بلا اسم'}\n` +
    `📱 \`${from}\`\n` +
    `📧 ${s.email || '—'}\n\n` +
    `💬 *المستخدم:* ${userText.slice(0, 400)}\n` +
    `🤖 *ردّ البوت:* ${(botReply || '').slice(0, 300)}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '💬 مراسلة العميل', url: `https://wa.me/${from}` },
        ]],
      },
    });
}

// ══════════════════════════════════════════════════════════════
//  موافقة الإدارة → إصدار الكود وإرساله للعميل
// ══════════════════════════════════════════════════════════════
export async function approveAndSend(waNumber, planId, issueFn) {
  const s   = getSession(waNumber);
  const plan = PLANS.find(p => p.id === planId) || s.plan || PLANS[0];

  const res = await issueFn({
    plan: plan.id,
    wa: waNumber,
    email: s.email || '',
    name: s.name || '',
  });

  if (!res?.ok) {
    const why = res?.error === 'NO_STOCK'
      ? `لا توجد أكواد متاحة لباقة *${plan.name}* — ولّد أكواداً من صفحة الأدمن`
      : `تعذّر إصدار الكود (${res?.error || 'خطأ'})`;
    return { ok: false, message: why };
  }

  setSession(waNumber, { stage: 'done', plan });
  await WA.sendText(waNumber, codeMessage(res.code, plan.name));
  return { ok: true, code: res.code, plan: plan.name };
}

export async function rejectOrder(waNumber) {
  await WA.sendText(waNumber,
    `للأسف ما قدرنا نأكّد التحويل 🙏\n\n` +
    `ممكن ترسل صورة أوضح للوصل؟ أو تتواصل معنا مباشرة وراح نساعدك.`);
  setSession(waNumber, { stage: 'awaiting_payment' });
  return { ok: true };
}
