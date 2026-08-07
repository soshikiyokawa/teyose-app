// 免許証・自動車保険の期限リマインド用Edge Function。
//
// Supabaseのpg_cronから毎日9時（JST）に呼ばれ（migration-genba22.sql参照）、
// 有効期限の「1か月前・2週間前・1週間前」に当たる人へ本人あてのプッシュ通知を送る。
// 期限当日と、期限切れの状態が続いている場合も知らせる。
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

// 'YYYY-MM-DD' の日付計算（時差でずれないようUTCで扱う）
function addDays(s: string, n: number) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(s: string, n: number) {
  const [y, m, dd] = s.split("-").map(Number);
  let ny = y, nm = m + n;
  ny += Math.floor((nm - 1) / 12);
  nm = ((nm - 1) % 12 + 12) % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
}
function label(s: string) { return s.replace(/-/g, "/"); }

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: rows } = await admin.from("licenses").select("*");
    if (!rows?.length) return json({ sent: 0 });

    // 通知する日：期限の1か月前／2週間前／1週間前／当日
    const timings = (expire: string) => [
      { date: addMonths(expire, -1), text: "1か月前" },
      { date: addDays(expire, -14), text: "2週間前" },
      { date: addDays(expire, -7), text: "1週間前" },
      { date: expire, text: "本日が期限" },
    ];

    type Msg = { userId: string; title: string; body: string };
    const msgs: Msg[] = [];

    for (const r of rows) {
      const targets: Array<[string, string]> = [
        ["運転免許証", r.license_expire],
        ["自動車保険", r.insurance_expire],
      ];
      for (const [kind, expire] of targets) {
        if (!expire) continue;
        const hit = timings(expire).find((t) => t.date === today);
        if (hit) {
          msgs.push({
            userId: r.user_id,
            title: `${kind}の更新`,
            body: hit.text === "本日が期限"
              ? `${kind}の有効期限は本日（${label(expire)}）です。更新をお願いします。`
              : `${kind}の有効期限まで${hit.text}です（${label(expire)}）。更新の手配をお願いします。`,
          });
        } else if (expire < today) {
          // 期限切れのまま：週1回（月曜）だけ知らせる
          if (jstNow.getUTCDay() === 1) {
            msgs.push({
              userId: r.user_id,
              title: `${kind}の期限切れ`,
              body: `${kind}の有効期限（${label(expire)}）が過ぎています。更新後、写真を登録してください。`,
            });
          }
        }
      }
    }

    if (!msgs.length) return json({ sent: 0 });

    for (const m of msgs) {
      await logNotifications(admin, [m.userId], { title: m.title, body: m.body, tab: "genba/license" }, "license-remind");
    }

    const { data: subs } = await admin.from("push_subscriptions").select("*")
      .in("user_id", [...new Set(msgs.map((m) => m.userId))]);

    let sent = 0;
    await Promise.all(msgs.flatMap((m) =>
      (subs || []).filter((s: any) => s.user_id === m.userId).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: m.title, body: m.body, tab: "genba/license" }),
          );
          sent++;
        } catch (e: any) {
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      })
    ));

    return json({ sent, targets: msgs.length });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
