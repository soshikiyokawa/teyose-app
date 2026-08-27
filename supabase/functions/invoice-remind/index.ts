// 請求書の未着のお知らせ用Edge Function。
//
// Supabaseのpg_cronから毎月6日9時（JST）に呼ばれる（migration-genba55-cron.sql参照）。
// 「先月ぶんの発注があるのに、その発注先から請求書が届いていない」ものを管理者へ通知する。
//
// 締めの期間は発注先ごとの締め日（suppliers.closing_day）で決める。
//   0＝月末締め … 1日〜末日
//   20＝20日締め … 前月21日〜当月20日
//
// 認証：x-remind-secretヘッダーがSecrets（OT_REMIND_SECRET）と一致する場合のみ動作。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { logNotifications } from "../_shared/notify-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 請求月にあたる期間（画面側の invPeriod と同じ考え方）
function period(month: string, closingDay: number) {
  const [y, m] = month.split("-").map(Number);
  if (!closingDay) return { from: `${month}-01`, to: fmtDate(new Date(y, m, 0)) };
  return { from: fmtDate(new Date(y, m - 2, closingDay + 1)), to: fmtDate(new Date(y, m - 1, closingDay)) };
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    // 対象は先月ぶん（指定があればその月）。日本時間で数える
    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const prev = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth() - 1, 1));
    const target = typeof body?.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)
      ? body.month
      : `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

    const { data: suppliers } = await admin.from("suppliers").select("id, name, closing_day");
    const { data: orders } = await admin.from("orders").select("supplier_id, date, total");
    const { data: invoices } = await admin.from("invoices").select("supplier_id, month");

    const sent = new Set((invoices || []).filter((v: any) => v.month === target).map((v: any) => String(v.supplier_id)));

    type Miss = { name: string; count: number; total: number };
    const missing: Miss[] = [];
    for (const s of suppliers || []) {
      if (!s.name || s.name === "在庫分") continue;
      if (sent.has(String(s.id))) continue;
      const p = period(target, Number(s.closing_day) || 0);
      const mine = (orders || []).filter((o: any) =>
        String(o.supplier_id) === String(s.id) && o.date >= p.from && o.date <= p.to);
      if (!mine.length) continue;    // その期間に発注が無い先は対象外
      missing.push({ name: s.name, count: mine.length, total: mine.reduce((t: number, o: any) => t + (Number(o.total) || 0), 0) });
    }
    if (!missing.length) return json({ sent: 0, missing: 0, month: target });

    missing.sort((a, b) => b.total - a.total);
    const total = missing.reduce((t, m) => t + m.total, 0);
    const [y, mo] = target.split("-");
    const head = missing.slice(0, 3).map((m) => `${m.name}（${yen(m.total)}）`).join("／");
    const title = `${y}年${mo}月分の請求書が${missing.length}件届いていません`;
    const bodyText = `発注の合計${yen(total)}。${head}${missing.length > 3 ? ` ほか${missing.length - 3}件` : ""}`;

    const { data: profiles } = await admin.from("profiles").select("id, role");
    const staffIds = (profiles || []).filter((p: any) => p.role === "staff").map((p: any) => p.id);
    if (!staffIds.length) return json({ sent: 0, missing: missing.length, month: target });

    await logNotifications(admin, staffIds, { title, body: bodyText, tab: "order/invoice" }, "invoice-remind");

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", staffIds);
    let pushed = 0;
    await Promise.all((subs || []).map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body: bodyText, tab: "order/invoice" }),
        );
        pushed++;
      } catch (e: any) {
        // 端末が通知を受け取れなくなっている場合は登録を消す
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }));

    return json({ sent: pushed, missing: missing.length, month: target, suppliers: missing.map((m) => m.name) });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
