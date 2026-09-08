// إعدادات مركزية — كلها من متغيّرات البيئة، لا أسرار في الكود
import dotenv from 'dotenv';
dotenv.config();

const req = (k, fallback = '') => process.env[k] || fallback;

export const CFG = {
  port: Number(req('PORT', 3000)),

  geminiKey:   req('GEMINI_API_KEY'),
  geminiModel: req('GEMINI_MODEL', 'gemini-2.0-flash'),

  waToken:  req('WA_TOKEN'),
  waPhoneId: req('WA_PHONE_ID'),
  waVerify: req('WA_VERIFY_TOKEN', 'totv_webhook_2026'),

  tgToken: req('TG_BOT_TOKEN'),
  tgAdmin: req('TG_ADMIN_CHAT'),

  supaUrl: req('SUPABASE_URL'),
  supaKey: req('SUPABASE_SERVICE_KEY'),

  supportWa:   req('SUPPORT_WHATSAPP', '9647714415816'),
  tgChannel:   req('TELEGRAM_CHANNEL', ''),
  downloadUrl: req('DOWNLOAD_URL', 'https://totv.app/download.html'),
};

export function checkConfig() {
  const missing = [];
  if (!CFG.geminiKey)  missing.push('GEMINI_API_KEY');
  if (!CFG.waToken)    missing.push('WA_TOKEN');
  if (!CFG.waPhoneId)  missing.push('WA_PHONE_ID');
  if (!CFG.tgToken)    missing.push('TG_BOT_TOKEN');
  if (!CFG.tgAdmin)    missing.push('TG_ADMIN_CHAT');
  if (!CFG.supaKey)    missing.push('SUPABASE_SERVICE_KEY');

  if (missing.length) {
    console.warn('⚠️  متغيّرات ناقصة:', missing.join(', '));
    console.warn('   البوت راح يشتغل لكن بعض المزايا معطّلة.');
  } else {
    console.log('✅ كل الإعدادات مكتملة');
  }
  // ★ حارس: منع تشغيل مفتاح عام مكان الخدمي
  if (CFG.supaKey && CFG.supaKey.startsWith('sb_publishable_')) {
    console.error('🛑 SUPABASE_SERVICE_KEY يحمل مفتاحاً عاماً — البوت يحتاج service_role');
  }
  return missing;
}
