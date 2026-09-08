// ══════════════════════════════════════════════════════════════
//  طبقة الذكاء الاصطناعي (Gemini)
//  ──────────────────────────────────────────────────────────────
//  مبدأ التصميم: الذكاء الاصطناعي يجيب على الأسئلة الحرّة فقط.
//  الأسعار والأكواد والدفع تمرّ عبر مسار ثابت في flows.js — لأن
//  نموذج اللغة قد يخترع سعراً أو يعد بشيء لا نستطيع الوفاء به.
// ══════════════════════════════════════════════════════════════

import { GoogleGenerativeAI } from '@google/generative-ai';
import { CFG } from './config.js';
import { APP_FACTS, TROUBLESHOOT, PLANS, PLAN_FEATURES } from './knowledge.js';

let model = null;

function getModel() {
  if (model) return model;
  if (!CFG.geminiKey) return null;
  const genAI = new GoogleGenerativeAI(CFG.geminiKey);
  model = genAI.getGenerativeModel({
    model: CFG.geminiModel,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.55,      // منخفضة — نريد ثباتاً لا إبداعاً
      maxOutputTokens: 420,   // ردود واتساب قصيرة
      topP: 0.9,
    },
  });
  return model;
}

const PRICE_TABLE = PLANS
  .map(p => `- ${p.name}: ${p.priceText} (${p.days} يوم)${p.note ? ' — ' + p.note : ''}`)
  .join('\n');

const SYSTEM_PROMPT = `
أنت موظف دعم ومبيعات في خدمة "TOTV+" العراقية لبثّ الأفلام والمسلسلات والقنوات.
تردّ على واتساب. اسمك في المحادثة: دعم TOTV+.

## أسلوبك
- تكلّم باللهجة العراقية البسيطة الودودة، ومع من يكتب بالفصحى ردّ بالفصحى،
  ومع من يكتب بالإنجليزية ردّ بالإنجليزية.
- ردود قصيرة جداً: سطران إلى أربعة أسطر كحدّ أقصى. هذه واتساب لا مقالة.
- استخدم إيموجي بسيط ومناسب، بلا مبالغة.
- كن دافئاً ومباشراً. لا تكرر التحية في كل رسالة.
- لا تستخدم عناوين أو تنسيق معقّد.

## الأسعار — التزم بها حرفياً ولا تخترع غيرها
${PRICE_TABLE}

كل الباقات تشمل نفس المحتوى بالكامل، والفرق في المدة فقط:
${PLAN_FEATURES.map(f => '- ' + f).join('\n')}

## معلومات المنتج
${APP_FACTS}

## حلّ المشاكل
${TROUBLESHOOT}

## قواعد صارمة
1. لا تذكر أي سعر غير الموجود في الجدول أعلاه. إن سُئلت عن خصم أو سعر خاص
   قل إن الأسعار ثابتة، ولا تعِد بأي تخفيض.
2. لا تخترع كود تفعيل أبداً ولا تعطي أرقاماً تشبه الأكواد. الأكواد تصدر من
   الإدارة بعد تأكيد الدفع فقط.
3. إذا طلب المستخدم الاشتراك أو الأسعار أو الدفع، لا تشرح بنفسك — اكتب فقط
   السطر التالي وحده بلا أي كلام إضافي:
   [[SHOW_PLANS]]
4. إذا كانت المشكلة تقنية ولم تُحلّ بالخطوات المعروفة، أو كان المستخدم غاضباً،
   أو يطلب استرداد مبلغ، أو يشكو من كود لا يعمل، اكتب في نهاية ردّك سطراً
   منفصلاً: [[ESCALATE]]
5. لا تَعِد بمواعيد محددة لإصلاح الأعطال. قل "راح نتابعها ونردّ عليك".
6. إذا لم تعرف الجواب، قل ذلك بصراحة واعرض تحويله للدعم. لا تخمّن.
7. لا تتحدث عن أي منافس ولا تقارن بخدمات أخرى.
8. لا تطلب معلومات حسّاسة مثل كلمات المرور أو أرقام البطاقات كاملة.
`.trim();

/**
 * يولّد ردّاً على رسالة المستخدم.
 * @param {string} text نص المستخدم
 * @param {Array} history سجل المحادثة [{role:'user'|'model', text}]
 * @returns {Promise<{reply:string, showPlans:boolean, escalate:boolean}>}
 */
export async function askAI(text, history = []) {
  const m = getModel();
  if (!m) {
    return {
      reply: 'المساعد الذكي غير مفعّل حالياً. راح يوصلك ردّ من الدعم قريباً 🙏',
      showPlans: false,
      escalate: true,
    };
  }

  try {
    const chat = m.startChat({
      history: history.slice(-10).map(h => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.text }],
      })),
    });

    const res = await chat.sendMessage(text);
    let out = (res.response.text() || '').trim();

    const showPlans = out.includes('[[SHOW_PLANS]]');
    const escalate  = out.includes('[[ESCALATE]]');
    out = out.replace(/\[\[SHOW_PLANS\]\]/g, '')
             .replace(/\[\[ESCALATE\]\]/g, '')
             .trim();

    // حارس أخير: لو ذكر النموذج رقماً يشبه كود تفعيل، احذفه.
    if (/\bTOTV[-\s]?[A-Z0-9]{4}/i.test(out)) {
      out = out.replace(/\bTOTV[-\s]?[A-Z0-9]{4}[-\s]?[A-Z0-9]{4}\b/gi, '(كود التفعيل يصدر من الإدارة)');
    }

    return {
      reply: out || 'ممكن توضّح سؤالك أكثر؟ 🙂',
      showPlans,
      escalate,
    };
  } catch (e) {
    console.error('[ai] error:', e?.message || e);
    return {
      reply: 'صار عندي خلل بسيط 🙏 ممكن تعيد سؤالك؟ أو راح أحوّلك للدعم.',
      showPlans: false,
      escalate: true,
    };
  }
}
