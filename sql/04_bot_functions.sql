-- ════════════════════════════════════════════════════════════════
--  TOTV+ — دوال بوت واتساب
--  شغّلها في Supabase → SQL Editor بعد الملفات 01 و 02 و 03
-- ════════════════════════════════════════════════════════════════

-- ── سجل طلبات البوت ────────────────────────────────────────────
create table if not exists public.bot_orders (
  id           bigserial primary key,
  wa_number    text not null,
  wa_name      text,
  email        text,
  plan         text,
  status       text not null default 'pending',  -- pending | approved | rejected
  code         text,
  receipt_tg   text,           -- معرّف رسالة تلجرام
  note         text,
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   text
);
create index if not exists idx_bot_orders_wa     on public.bot_orders(wa_number);
create index if not exists idx_bot_orders_status on public.bot_orders(status);
create index if not exists idx_bot_orders_time   on public.bot_orders(created_at desc);

alter table public.bot_orders enable row level security;
revoke all on public.bot_orders from anon, authenticated;

drop policy if exists p_bot_orders_admin on public.bot_orders;
create policy p_bot_orders_admin on public.bot_orders
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.bot_orders to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ════════════════════════════════════════════════════════════════
--  إصدار كود جاهز من المخزون
--  يأخذ أول كود غير مستخدم من الباقة المطلوبة ويحجزه.
--  ★ FOR UPDATE SKIP LOCKED — يمنع إعطاء نفس الكود لطلبين متزامنين.
-- ════════════════════════════════════════════════════════════════
create or replace function public.bot_issue_code(
  p_plan      text,
  p_wa        text,
  p_email     text default '',
  p_name      text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_days int;
begin
  select code, days into v_code, v_days
    from public.activation_codes
   where plan = p_plan
     and used = false
     and coalesce(disabled, false) = false
   order by created_at
   limit 1
   for update skip locked;

  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'NO_STOCK',
      'msg', 'لا توجد أكواد متاحة لهذه الباقة — ولّد أكواداً جديدة من صفحة الأدمن');
  end if;

  update public.activation_codes
     set note = trim(coalesce(note,'') || ' | bot:' || p_wa),
         agent = coalesce(nullif(agent,''), 'whatsapp-bot')
   where code = v_code;

  insert into public.bot_orders (wa_number, wa_name, email, plan, status, code, handled_at)
  values (p_wa, p_name, lower(p_email), p_plan, 'approved', v_code, now());

  return jsonb_build_object('ok', true, 'code', v_code, 'plan', p_plan, 'days', v_days);
end; $$;

-- ── تسجيل طلب جديد (قبل الموافقة) ──────────────────────────────
create or replace function public.bot_log_order(
  p_wa text, p_name text, p_email text, p_plan text, p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.bot_orders (wa_number, wa_name, email, plan, status, note)
  values (p_wa, p_name, lower(nullif(p_email,'')), nullif(p_plan,''), 'pending', p_note)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- ── التحقق من اشتراك عميل بالإيميل ─────────────────────────────
create or replace function public.bot_check_subscription(p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.subscriptions%rowtype; d int;
begin
  select * into s from public.subscriptions
   where lower(email) = lower(trim(p_email)) limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'found', false);
  end if;
  d := greatest(0, extract(day from (s.expiry_date - now()))::int);
  return jsonb_build_object(
    'ok', true, 'found', true,
    'plan', s.tier, 'days_left', d,
    'expiry', s.expiry_date,
    'active', s.expiry_date > now());
end; $$;

-- ── مخزون الأكواد المتاحة ──────────────────────────────────────
create or replace function public.bot_stock()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return (
    select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb)
      from (select plan, count(*) as n
              from public.activation_codes
             where used = false and coalesce(disabled,false) = false
             group by plan) t);
end; $$;

-- ── الصلاحيات ──────────────────────────────────────────────────
revoke execute on function public.bot_issue_code(text,text,text,text) from anon, authenticated;
revoke execute on function public.bot_log_order(text,text,text,text,text) from anon, authenticated;
revoke execute on function public.bot_check_subscription(text) from anon;
revoke execute on function public.bot_stock() from anon;
grant  execute on function public.bot_check_subscription(text) to authenticated;
grant  execute on function public.bot_stock() to authenticated;

-- ملاحظة: البوت يتصل بمفتاح service_role الذي يتجاوز RLS،
-- لذلك لا يحتاج grant. لا تمنح هذه الدوال لـ anon إطلاقاً.

select 'bot functions ready' as status;
