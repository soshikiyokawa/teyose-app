-- ════ 請求書を「受け取って終わり」から先へ進める ════
--
--   ① 発注額との突き合わせ … 発注先ごとの締め日が要るので suppliers に足す
--   ② AIでの読み取り       … 読み取った登録番号を invoices に持つ
--   ③ 支払管理             … 支払予定日・支払日・支払額を invoices に持つ
--   ④ 未着のお知らせ       … 新しい列は不要（発注と請求書を突き合わせるだけ）
--   ⑤ インボイス制度の確認 … suppliers に適格請求書発行事業者の登録番号を持つ

-- ── 発注先：締め日と登録番号 ──
alter table public.suppliers
  add column if not exists closing_day smallint not null default 0;
comment on column public.suppliers.closing_day is
  '請求の締め日。0＝月末、20＝前月21日〜当月20日、のように使う';

alter table public.suppliers
  add column if not exists invoice_reg_no text not null default '';
comment on column public.suppliers.invoice_reg_no is
  '適格請求書発行事業者の登録番号（T＋13桁）。届いた請求書の番号と突き合わせる';

-- 締め日は決まった値だけ（画面の選択肢と合わせる）
alter table public.suppliers drop constraint if exists suppliers_closing_day_ck;
alter table public.suppliers add constraint suppliers_closing_day_ck
  check (closing_day in (0,5,10,15,20,25));

-- ── 請求書：読み取り結果と支払の記録 ──
alter table public.invoices add column if not exists reg_no      text not null default '';
alter table public.invoices add column if not exists due_on      date;
alter table public.invoices add column if not exists paid_on     date;
alter table public.invoices add column if not exists paid_amount integer;
alter table public.invoices add column if not exists read_by_ai  boolean not null default false;

comment on column public.invoices.reg_no is '請求書に書かれていた登録番号（AIで読み取ったもの）';
comment on column public.invoices.due_on is '支払予定日';
comment on column public.invoices.paid_on is '実際に支払った日。入っていれば支払済み';
comment on column public.invoices.paid_amount is '実際に支払った金額';
comment on column public.invoices.read_by_ai is 'AIで金額などを読み取ったかどうか';

-- ── 支払の記録を書けるのは管理者だけ ──
-- （これまで invoices に更新の許可が無く、誰も直せなかった）
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update using (app_user_role() = 'staff') with check (app_user_role() = 'staff');

-- 発注先が自分の請求書を直接いじれないようにする。
-- 送り直しは新しく送ってもらい、間違いは管理者に消してもらう。
create or replace function public.invoices_supplier_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() = 'supplier' then
    raise exception '請求書を直せるのはきよかわの担当者だけです';
  end if;
  return new;
end
$$;

drop trigger if exists invoices_supplier_guard_trg on public.invoices;
create trigger invoices_supplier_guard_trg
  before update on public.invoices
  for each row execute function public.invoices_supplier_guard();

-- 支払の一覧を出すときに使う
create index if not exists invoices_paid_idx on public.invoices(paid_on);
create index if not exists invoices_due_idx  on public.invoices(due_on);

-- ── ④請求書の未着のお知らせ（毎月6日9時 JST） ──
--
-- 先月ぶんの発注があるのに請求書が届いていない発注先を、管理者へ通知する。
-- 6日にしているのは、月初に届くことが多いためひととおり出そろってから知らせるため。
-- 先に Edge Function をデプロイしておくこと：
--   npx supabase functions deploy invoice-remind

select cron.unschedule('invoice-remind-monthly') where exists (
  select 1 from cron.job where jobname = 'invoice-remind-monthly'
);
select cron.schedule(
  'invoice-remind-monthly',
  '0 0 6 * *',                                   -- UTC 0:00 ＝ JST 9:00
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/invoice-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
