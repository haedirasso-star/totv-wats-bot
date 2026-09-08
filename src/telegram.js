// ══════════════════════════════════════════════════════════════
//  طبقة تلجرام — تحويل الطلبات للإدارة مع أزرار موافقة
// ══════════════════════════════════════════════════════════════

import { CFG } from './config.js';

const API = () => `https://api.telegram.org/bot${CFG.tgToken}`;

async function call(method, payload) {
  if (!CFG.tgToken || !CFG.tgAdmin) {
    console.warn('[tg] لم تُضبط بيانات تلجرام — تخطّي');
    return null;
  }
  try {
    const r = await fetch(`${API()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!d.ok) console.error('[tg]', method, JSON.stringify(d).slice(0, 250));
    return d;
  } catch (e) {
    console.error('[tg] error:', e?.message || e);
    return null;
  }
}

export function tgText(text, extra = {}) {
  return call('sendMessage', {
    chat_id: CFG.tgAdmin,
    text,
    parse_mode: 'Markdown',
    ...extra,
  });
}

/** يرسل صورة الوصل مع أزرار الموافقة */
export async function tgReceipt({ buffer, mime, caption, keyboard }) {
  if (!CFG.tgToken || !CFG.tgAdmin) return null;
  try {
    const form = new FormData();
    form.append('chat_id', CFG.tgAdmin);
    form.append('caption', caption.slice(0, 1000));
    form.append('parse_mode', 'Markdown');
    if (keyboard) form.append('reply_markup', JSON.stringify(keyboard));
    form.append('photo', new Blob([buffer], { type: mime || 'image/jpeg' }), 'receipt.jpg');

    const r = await fetch(`${API()}/sendPhoto`, { method: 'POST', body: form });
    const d = await r.json();
    if (!d.ok) console.error('[tg] photo', JSON.stringify(d).slice(0, 250));
    return d;
  } catch (e) {
    console.error('[tg] receipt:', e?.message || e);
    return null;
  }
}

/** لوحة أزرار الموافقة على طلب اشتراك */
export function approvalKeyboard(waNumber, planId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ تفعيل شهري',  callback_data: `ok:${waNumber}:monthly` },
        { text: '✅ 3 أشهر',      callback_data: `ok:${waNumber}:quarterly` },
      ],
      [
        { text: '✅ تفعيل سنوي',  callback_data: `ok:${waNumber}:yearly` },
      ],
      [
        { text: '❌ رفض الطلب',   callback_data: `no:${waNumber}:${planId || 'none'}` },
        { text: '💬 مراسلة',      url: `https://wa.me/${waNumber}` },
      ],
    ],
  };
}

export function answerCallback(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });
}

export function editKeyboard(chatId, messageId, text) {
  return call('editMessageCaption', {
    chat_id: chatId, message_id: messageId,
    caption: text, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [] },
  });
}

export async function setWebhook(url) {
  return call('setWebhook', {
    url,
    allowed_updates: ['message', 'callback_query'],
  });
}
