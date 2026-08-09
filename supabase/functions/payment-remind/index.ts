// 入金の督促（未入金のお知らせ）用Edge Function。
//
// Supabaseのpg_cronから毎週月曜9時（JST）に呼ばれ（migration-genba37.sql参照）、
// 「入金予定日を過ぎているのに、入金が予定額に届いていない」ものを管理者へ通知する。
//
// 入金の予定と実績は見積（estimates）の payments に入っている：
//   [{label:'着工金', date:予定日, amount:予定額, actualDate:入金日, actualAmount:入金額}, …]
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

const yen = (n: number) => "¥" + n.toLocaleString("ja-JP");

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: estimates, error } = await admin.from("estimates")
      .select("id, project_name, client_name, status, payments, contract_info, updated_at");
    if (error) return json({ error: error.message }, 500);

    // 同じ案件に見積が複数あるときは、いちばん新しく更新したものだけを見る
    const newest = new Map<string, any>();
    for (const e of estimates || []) {
      const key = e.project_name || `#${e.id}`;
      const cur = newest.get(key);
      if (!cur || new Date(e.updated_at || 0) > new Date(cur.updated_at || 0)) newest.set(key, e);
    }

    type Late = { project: string; client: string; label: string; date: string; left: number };
    const lates: Late[] = [];
    for (const e of newest.values()) {
      // 受注前（下書き・提出済み）の見積は督促の対象にしない
      if (!["approved", "construction", "completed"].includes(e.status)) continue;
      for (const p of (e.payments || [])) {
        const amount = Number(p?.amount) || 0;
        const actual = Number(p?.actualAmount) || 0;
        const left = amount - actual;
        if (amount <= 0 || left <= 0) continue;
        if (!p?.date || p.date >= today) continue;   // 予定日がまだ来ていない
        lates.push({
          project: e.project_name || "（案件名なし）",
          client: e.client_name || "",
          label: p.label || "入金",
          date: p.date,
          left,
        });
      }
    }
    if (!lates.length) return json({ sent: 0, late: 0 });

    lates.sort((a, b) => a.date.localeCompare(b.date));
    const total = lates.reduce((s, l) => s + l.left, 0);
    const head = lates.slice(0, 3)
      .map((l) => `${l.project}（${l.label} ${l.date.replace(/-/g, "/")}・${yen(l.left)}）`).join("／");
    const title = `未入金が${lates.length}件あります`;
    const body = `合計${yen(total)}。${head}${lates.length > 3 ? ` ほか${lates.length - 3}件` : ""}`;

    // 管理者（staff）へ送る
    const { data: profiles } = await admin.from("profiles").select("id, role");
    const staffIds = (profiles || []).filter((p: any) => p.role === "staff").map((p: any) => p.id);
    if (!staffIds.length) return json({ sent: 0, late: lates.length });

    await logNotifications(admin, staffIds, { title, body, tab: "estimate/list" }, "payment-remind");

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", staffIds);
    let sent = 0;
    await Promise.all((subs || []).map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, tab: "estimate/list" }),
        );
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }));

    return json({ sent, late: lates.length, total });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
