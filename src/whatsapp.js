// ══════════════════════════════════════════════════════════════
//  طبقة واتساب — Meta Cloud API الرسمي
//  ★ كل الاتصال بواتساب معزول في هذا الملف. لو قررت لاحقاً
//    استخدام مزوّد آخر، بدّل هذا الملف وحده ولا تلمس بقية النظام.
// ══════════════════════════════════════════════════════════════

import { CFG } from './config.js';

const API = 'https://graph.facebook.com/v21.0';

async function send(payload) {
  if (!CFG.waToken || !CFG.waPhoneId) {
    console.warn('[wa] لم تُضبط بيانات واتساب — تخطّي الإرسال');
    return null;
  }
  try {
    const r = await fetch(`${API}/${CFG.waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CFG.waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) console.error('[wa] send failed', r.status, JSON.stringify(d).slice(0, 300));
    return d;
  } catch (e) {
    console.error('[wa] send error:', e?.message || e);
    return null;
  }
}

export function sendText(to, body) {
  return send({
    to,
    type: 'text',
    text: { preview_url: true, body: String(body).slice(0, 4000) },
  });
}

/** أزرار سريعة — ثلاثة كحدّ أقصى حسب قيود واتساب */
export function sendButtons(to, body, buttons) {
  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body).slice(0, 1020) },
      action: {
        buttons: buttons.slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: b.id, title: String(b.title).slice(0, 20) },
        })),
      },
    },
  });
}

export function markRead(messageId) {
  return send({ status: 'read', message_id: messageId });
}

/** ينزّل وسائط واتساب ويُعيدها كـ Buffer لتحويلها إلى تلجرام */
export async function downloadMedia(mediaId) {
  if (!CFG.waToken) return null;
  try {
    const metaRes = await fetch(`${API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${CFG.waToken}` },
    });
    const meta = await metaRes.json();
    if (!meta?.url) return null;

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${CFG.waToken}` },
    });
    const buf = Buffer.from(await fileRes.arrayBuffer());
    return { buffer: buf, mime: meta.mime_type || 'image/jpeg' };
  } catch (e) {
    console.error('[wa] media download:', e?.message || e);
    return null;
  }
}

/** يستخرج رسالة واحدة مبسّطة من حمولة الويبهوك */
export function parseIncoming(body) {
  try {
    const entry  = body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg    = change?.messages?.[0];
    if (!msg) return null;

    const from    = msg.from;
    const name    = change?.contacts?.[0]?.profile?.name || '';
    const type    = msg.type;
    let   text    = '';
    let   mediaId = null;

    if (type === 'text')        text = msg.text?.body || '';
    else if (type === 'image')  { mediaId = msg.image?.id; text = msg.image?.caption || ''; }
    else if (type === 'document') { mediaId = msg.document?.id; text = msg.document?.caption || ''; }
    else if (type === 'interactive') {
      text = msg.interactive?.button_reply?.title
          || msg.interactive?.list_reply?.title || '';
    }
    else if (type === 'button') text = msg.button?.text || '';

    return { id: msg.id, from, name, type, text: text.trim(), mediaId };
  } catch (e) {
    console.error('[wa] parse:', e?.message || e);
    return null;
  }
}
