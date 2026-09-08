// ══════════════════════════════════════════════════════════════
//  TOTV+ WhatsApp Bot — نقطة الدخول
//  ──────────────────────────────────────────────────────────────
//  مسارات الخادم:
//    GET  /                  فحص الحالة
//    GET  /webhook           تحقّق واتساب من الرابط
//    POST /webhook           رسائل واتساب الواردة
//    POST /tg                ردود أزرار تلجرام
//    GET  /stock             مخزون الأكواد (للمراقبة)
// ══════════════════════════════════════════════════════════════

import express from 'express';
import { CFG, checkConfig } from './config.js';
import * as WA from './whatsapp.js';
import * as TG from './telegram.js';
import { issueCode, stock } from './supabase.js';
import { handleMessage, approveAndSend, rejectOrder } from './flows.js';
import { sessionCount } from './session.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── منع معالجة الرسالة نفسها مرتين (واتساب يعيد الإرسال) ──────
const SEEN = new Set();
function seen(id) {
  if (!id) return false;
  if (SEEN.has(id)) return true;
  SEEN.add(id);
  if (SEEN.size > 3000) {
    // احتفظ بآخر 1500 فقط
    const keep = [...SEEN].slice(-1500);
    SEEN.clear(); keep.forEach(k => SEEN.add(k));
  }
  return false;
}

// ══════════════════════════ الحالة ══════════════════════════
app.get('/', (_req, res) => {
  res.json({
    service: 'TOTV+ WhatsApp Bot',
    status: 'running',
    sessions: sessionCount(),
    time: new Date().toISOString(),
  });
});

app.get('/stock', async (_req, res) => {
  res.json(await stock());
});

// ══════════════════════ تحقّق واتساب ═══════════════════════
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === CFG.waVerify) {
    console.log('✅ تم التحقق من ويبهوك واتساب');
    return res.status(200).send(challenge);
  }
  console.warn('❌ فشل التحقق من الويبهوك');
  return res.sendStatus(403);
});

// ══════════════════ رسائل واتساب الواردة ═══════════════════
app.post('/webhook', async (req, res) => {
  // ★ ردّ فوري — واتساب يعيد الإرسال إن تأخّرنا أكثر من 20 ثانية
  res.sendStatus(200);

  try {
    const msg = WA.parseIncoming(req.body);
    if (!msg) return;
    if (seen(msg.id)) return;

    console.log(`[wa] ← ${msg.from} (${msg.type}): ${msg.text.slice(0, 80)}`);
    WA.markRead(msg.id).catch(() => {});
    await handleMessage(msg);
  } catch (e) {
    console.error('[webhook] error:', e?.message || e);
  }
});

// ════════════════ أزرار تلجرام (موافقة/رفض) ════════════════
app.post('/tg', async (req, res) => {
  res.sendStatus(200);
  try {
    const cb = req.body?.callback_query;
    if (!cb) return;

    // ★ الأمان: نقبل الأوامر من حساب الأدمن وحده
    const fromId = String(cb.from?.id || '');
    if (fromId !== String(CFG.tgAdmin)) {
      await TG.answerCallback(cb.id, 'غير مصرّح لك');
      console.warn('[tg] رفض أمر من', fromId);
      return;
    }

    const [action, waNumber, planId] = String(cb.data || '').split(':');
    if (!waNumber) return;

    if (action === 'ok') {
      const r = await approveAndSend(waNumber, planId, issueCode);
      await TG.answerCallback(cb.id, r.ok ? `✅ ${r.code}` : `❌ ${r.message}`);
      if (cb.message) {
        const cap = (cb.message.caption || cb.message.text || '') +
          (r.ok
            ? `\n\n✅ *تم التفعيل*\n🔑 \`${r.code}\`\n📦 ${r.plan}`
            : `\n\n❌ ${r.message}`);
        await TG.editKeyboard(cb.message.chat.id, cb.message.message_id, cap);
      }
      console.log(`[tg] approve ${waNumber} ${planId} → ${r.ok ? r.code : r.message}`);
      return;
    }

    if (action === 'no') {
      await rejectOrder(waNumber);
      await TG.answerCallback(cb.id, 'تم إرسال طلب صورة أوضح');
      if (cb.message) {
        const cap = (cb.message.caption || cb.message.text || '') + `\n\n❌ *مرفوض*`;
        await TG.editKeyboard(cb.message.chat.id, cb.message.message_id, cap);
      }
      return;
    }
  } catch (e) {
    console.error('[tg] error:', e?.message || e);
  }
});

// ══════════════════════════ التشغيل ═════════════════════════
app.listen(CFG.port, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   TOTV+ WhatsApp Bot                     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`🚀 يعمل على المنفذ ${CFG.port}`);
  checkConfig();
  console.log('');
  console.log('الخطوات المتبقية:');
  console.log(`  1. اربط ويبهوك واتساب بـ  https://<نطاقك>/webhook`);
  console.log(`     رمز التحقق: ${CFG.waVerify}`);
  console.log(`  2. اربط ويبهوك تلجرام:`);
  console.log(`     https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<نطاقك>/tg`);
  console.log('');
});

// لا تسمح لخطأ غير متوقّع بإسقاط البوت
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]', e?.message || e));
