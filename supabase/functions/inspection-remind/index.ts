// 定期点検のリマインド用Edge Function。
//
// Supabaseのpg_cronから毎日9時（JST）に呼ばれ（migration-genba30.sql参照）、
// 管理者（staff）へプッシュ通知を送る。
//
//   3月1日   … 今年度に点検予定の物件をまとめて知らせる
//   毎週金曜 … 今年度の点検で「案内完了」がまだのものが残っていれば催促する
//
// 点検の予定日は「引渡日＋3か月／1年／3年／5年／10年／15年／20年」で計算する。
// 年度は毎年3月1日開始。
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

const PLAN = [
  { kind: "3か月", months: 3 },
  { kind: "1年", months: 12 },
  { kind: "3年", months: 36 },
  { kind: "5年", months: 60 },
  { kind: "10年", months: 120 },
  { kind: "15年", months: 180 },
  { kind: "20年", months: 240 },
];

function addMonths(s: string, n: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return "";
  let y = +m[1], mo = +m[2] + n;
  const d = +m[3];
  y += Math.floor((mo - 1) / 12);
  mo = ((mo - 1) % 12 + 12) % 12 + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
// 年度（毎年3月1日が新年度）
function fiscalYear(s: string) {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  return +m[2] >= 3 ? +m[1] : +m[1] - 1;
}
const label = (s: string) => s.replace(/-/g, "/");

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);
    const isMar1 = today.slice(5) === "03-01";
    const isFriday = jstNow.getUTCDay() === 5;
    if (!isMar1 && !isFriday) return json({ sent: 0, skipped: "対象日ではありません" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: projects } = await admin.from("projects").select("id, name, handover_date");
    if (!projects?.length) return json({ sent: 0 });
    const { data: records } = await admin.from("inspection_records").select("project_id, kind, guided_date");

    const fy = fiscalYear(today)!;
    // 今年度に予定されている点検を集める
    type Row = { name: string; kind: string; due: string; guided: boolean };
    const rows: Row[] = [];
    for (const p of projects) {
      if (!p.handover_date) continue;
      for (const pl of PLAN) {
        const due = addMonths(p.handover_date, pl.months);
        if (!due || fiscalYear(due) !== fy) continue;
        const rec = (records || []).find((r: any) => r.project_id === p.id && r.kind === pl.kind);
        rows.push({ name: p.name, kind: pl.kind, due, guided: !!rec?.guided_date });
      }
    }
    if (!rows.length) return json({ sent: 0, targets: 0 });

    const notGuided = rows.filter((r) => !r.guided).sort((a, b) => a.due.localeCompare(b.due));

    let title = "", body = "";
    if (isMar1) {
      title = `${fy}年度の定期点検`;
      const head = notGuided.slice(0, 3).map((r) => `${r.name}（${r.kind}・${label(r.due)}）`).join("／");
      body = `今年度の点検予定は${rows.length}件です。${head}${notGuided.length > 3 ? ` ほか${notGuided.length - 3}件` : ""}。お客様へのご案内をお願いします。`;
    } else {
      // 金曜：案内がまだ残っているときだけ
      if (!notGuided.length) return json({ sent: 0, targets: 0 });
      title = "定期点検の案内が未完了です";
      const head = notGuided.slice(0, 3).map((r) => `${r.name}（${r.kind}・${label(r.due)}）`).join("／");
      body = `${fy}年度の点検で、お客様へのご案内が${notGuided.length}件残っています。${head}${notGuided.length > 3 ? ` ほか${notGuided.length - 3}件` : ""}`;
    }

    // 管理者（staff）へ送る
    const { data: profiles } = await admin.from("profiles").select("id, role");
    const staffIds = (profiles || []).filter((p: any) => p.role === "staff").map((p: any) => p.id);
    if (!staffIds.length) return json({ sent: 0 });

    await logNotifications(admin, staffIds, { title, body, tab: "estimate/inspection" }, "inspection-remind");

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", staffIds);
    let sent = 0;
    await Promise.all((subs || []).map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, tab: "estimate/inspection" }),
        );
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }));

    return json({ sent, total: rows.length, notGuided: notGuided.length });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
