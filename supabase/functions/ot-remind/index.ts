// 承認待ちリマインド用Edge Function（残業・休日出勤・有給）。
//
// Supabaseのpg_cronから1時間ごとに呼ばれ（migration-genba3.sql参照）、
// 承認待ちが残っている間、それぞれの承認者の端末へプッシュ通知を送り続ける。
// 残業・休日出勤＝申請時に選ばれた承認者宛／有給＝清川創史宛。
// 日本時間21時〜翌7時は送らない。
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

// 残業・休日出勤の承認者（js/genba/genba-nippo.js の OT_APPROVERS と合わせること）
const APPROVERS = ["清川創史", "清川太視", "清川説志", "清川伸二", "原口晴郎"];
// 有給の承認者（js/genba/genba-leave.js の LEAVE_APPROVER と合わせること）
const LEAVE_APPROVER = "清川創史";

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

    // 承認者ごとに承認待ちの件数を集計する {表示名: {ot, holiday, leave}}
    const countByName: Record<string, { ot: number; holiday: number; leave: number }> = {};
    const bump = (name: string, kind: "ot" | "holiday" | "leave") => {
      countByName[name] = countByName[name] || { ot: 0, holiday: 0, leave: 0 };
      countByName[name][kind]++;
    };

    // 残業（申請時に選ばれた承認者宛。未指定の古い申請は5人全員へ）
    const { data: otRows } = await admin.from("daily_reports").select("ot_approver_name").eq("ot_status", "pending");
    for (const row of otRows || []) {
      const names = row.ot_approver_name && APPROVERS.includes(row.ot_approver_name) ? [row.ot_approver_name] : APPROVERS;
      for (const name of names) bump(name, "ot");
    }
    // 休日出勤（申請時に選ばれた承認者宛）
    const { data: hRows } = await admin.from("holiday_requests").select("approver_name").eq("status", "pending");
    for (const row of hRows || []) {
      const names = row.approver_name && APPROVERS.includes(row.approver_name) ? [row.approver_name] : APPROVERS;
      for (const name of names) bump(name, "holiday");
    }
    // 有給（清川創史宛）
    const { count: leaveCount } = await admin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    for (let i = 0; i < (leaveCount || 0); i++) bump(LEAVE_APPROVER, "leave");

    const totalPending = Object.values(countByName).reduce((s, c) => s + c.ot + c.holiday + c.leave, 0);
    if (!totalPending) return json({ sent: 0, pending: 0 });

    // 表示名 → ユーザーID → 購読端末。自分宛の内訳だけを知らせる
    const { data: profiles } = await admin.from("profiles").select("id, display_name");
    let sent = 0;
    await Promise.all(
      (profiles || [])
        .filter((p: any) => countByName[p.display_name])
        .map(async (p: any) => {
          const c = countByName[p.display_name];
          const parts = [
            c.ot ? `残業${c.ot}件` : "",
            c.holiday ? `休日出勤${c.holiday}件` : "",
            c.leave ? `有給${c.leave}件` : "",
          ].filter(Boolean).join("・");
          // タップ時に開くタブ（件数が多い種類を優先：残業→休日出勤→有給の順）
          const tab = c.ot ? "genba/nippo" : c.holiday ? "genba/holiday" : "genba/leave";
          const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", p.id);
          await Promise.all(
            (subs || []).map(async (sub: any) => {
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  JSON.stringify({
                    title: "承認待ちのリマインド",
                    body: `あなた宛の承認待ちがあります（${parts}）。手寄の勤怠日報から承認してください。`,
                    tab,
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

    return json({ sent, pending: totalPending });
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
