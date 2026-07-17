// 残業の承認待ちリマインド用Edge Function。
//
// Supabaseのpg_cronから1時間ごとに呼ばれ（migration-genba3.sql参照）、
// 承認待ち（ot_status = 'pending'）の日報が残っている間、承認者の端末へ
// プッシュ通知を送り続ける。日本時間21時〜翌7時は送らない。
//
// 認証：JWT検証なしでデプロイする代わりに、x-remind-secretヘッダーが
// Secrets（OT_REMIND_SECRET）と一致する場合のみ動作する。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

// 残業の承認者（js/genba/genba-nippo.js の OT_APPROVERS と合わせること）
const APPROVERS = ["清川創史", "清川太視", "清川説志", "清川伸二", "原口晴郎"];

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    // 日本時間21時〜翌7時は通知しない
    const jstHour = (new Date().getUTCHours() + 9) % 24;
    if (jstHour >= 21 || jstHour < 7) {
      return json({ skipped: "quiet-hours", jstHour });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 承認待ちの残業がなければ何もしない（＝承認完了でリマインド停止）
    const { data: pendings } = await admin
      .from("daily_reports")
      .select("ot_approver_name")
      .eq("ot_status", "pending");
    if (!pendings?.length) return json({ sent: 0, pending: 0 });

    // 申請時に選ばれた承認者ごとに件数を集計（承認者未指定の古い申請は5人全員に数える）
    const countByName: Record<string, number> = {};
    for (const row of pendings) {
      const names = row.ot_approver_name && APPROVERS.includes(row.ot_approver_name)
        ? [row.ot_approver_name] : APPROVERS;
      for (const name of names) countByName[name] = (countByName[name] || 0) + 1;
    }

    // 表示名 → ユーザーID → 購読端末。自分宛の件数だけを知らせる
    const { data: profiles } = await admin.from("profiles").select("id, display_name");
    let sent = 0;
    await Promise.all(
      (profiles || [])
        .filter((p: any) => countByName[p.display_name])
        .map(async (p: any) => {
          const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", p.id);
          await Promise.all(
            (subs || []).map(async (sub: any) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  JSON.stringify({
                    title: "残業承認のリマインド",
                    body: `あなた宛の残業承認待ちが${countByName[p.display_name]}件あります。手寄の勤怠日報から承認してください。`,
                  }),
                );
                sent++;
              } catch (e: any) {
                if (e?.statusCode === 410 || e?.statusCode === 404) {
                  await admin.from("push_subscriptions").delete().eq("id", sub.id);
                }
              }
            }),
          );
        }),
    );

    return json({ sent, pending: pendings.length });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
