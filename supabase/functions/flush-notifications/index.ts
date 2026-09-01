// 夜のあいだ預かった通知を、翌朝まとめて届けるEdge Function。
//
// Supabaseのpg_cronから毎朝7時（JST）に呼ばれる（migration-genba60-cron.sql参照）。
// 21時〜翌7時に起きた通知は send-push が pending_notifications に預けている。
// それをここで送り、通知履歴にも残す。
//
// 同じ人に何件も溜まっている場合は、1通にまとめて鳴らす（夜中の分が連続で鳴らないように）。
// 通知履歴には1件ずつ残すので、あとから中身を読み返せる。
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

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: waiting, error } = await admin.from("pending_notifications")
      .select("*").is("sent_at", null).order("created_at");
    if (error) return json({ error: error.message }, 500);
    if (!waiting?.length) return json({ sent: 0, people: 0 });

    // 人ごとにまとめる
    const byUser = new Map<string, any[]>();
    for (const n of waiting) {
      if (!byUser.has(n.user_id)) byUser.set(n.user_id, []);
      byUser.get(n.user_id)!.push(n);
    }

    let sent = 0;
    for (const [userId, list] of byUser) {
      // 通知履歴は1件ずつ残す（あとから中身を読み返せるように）
      for (const n of list) {
        await logNotifications(admin, [userId], { title: n.title, body: n.body, tab: n.tab }, n.kind || "");
      }

      // 鳴らすのは1通にまとめる。1件だけならそのままの文面で
      const one = list.length === 1;
      const title = one ? list[0].title : `夜のあいだのお知らせが${list.length}件あります`;
      const body = one
        ? list[0].body
        : list.slice(0, 3).map((n: any) => n.title).join("／") + (list.length > 3 ? ` ほか${list.length - 3}件` : "");
      const tab = one ? list[0].tab : null;

      const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
      await Promise.all((subs || []).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body, tab }),
          );
          sent++;
        } catch (e: any) {
          // 端末が通知を受け取れなくなっている場合は登録を消す
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
        }
      }));

      // 送れた・送れなかったにかかわらず、預かりは済みにする（翌朝以降に持ち越さない）
      await admin.from("pending_notifications")
        .update({ sent_at: new Date().toISOString() })
        .in("id", list.map((n: any) => n.id));
    }

    return json({ sent, people: byUser.size, notifications: waiting.length });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
