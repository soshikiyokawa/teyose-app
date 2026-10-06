// チャットの未読が続いている人に、もう一度お知らせする。
//
// pg_cron が20分おきに叩く（migration-genba92.sql）。
//   ① 30分たっても読まれていないチャットを、人とやりとりごとにまとめる
//   ② 同じやりとりについては3時間に1回まで
//   ③ 夜（21時〜翌7時）は送らない
//
// お知らせに本文は入れない。件数だけにしてある。
//   ・読み返しは手寄の中でしていただく
//   ・通知は端末のロック画面に出るので、中身を繰り返し出したくない
//
// 認証：x-remind-secret ヘッダーが Secrets（OT_REMIND_SECRET）と一致する場合のみ動く。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { logNotifications } from "../_shared/notify-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const MIN_AGE  = "30 minutes";   // これだけ読まれていなければ対象
const MAX_AGE  = "3 days";       // これより前のものは、もう追いかけない
const AGAIN_MS = 3 * 3600 * 1000; // 同じやりとりへの間隔

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);
    if (isQuietHoursJST()) return json({ sent: 0, reason: "quiet-hours" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: rows, error } = await admin.rpc("app_chat_unread_digest", {
      p_min_age: MIN_AGE, p_max_age: MAX_AGE,
    });
    if (error) return json({ error: "未読をまとめられませんでした：" + error.message }, 500);
    if (!rows?.length) return json({ sent: 0 });

    // 直近に送ったものは、間を空ける
    const { data: already } = await admin.from("chat_reminders").select("user_id, thread, last_sent_at");
    const lastAt = new Map<string, number>();
    for (const r of already || []) lastAt.set(`${r.user_id}|${r.thread}`, new Date(r.last_sent_at).getTime());

    const now = Date.now();
    const due = (rows as any[]).filter((r) => {
      const t = lastAt.get(`${r.user_id}|${r.thread}`);
      return !t || now - t >= AGAIN_MS;
    });
    if (!due.length) return json({ sent: 0, reason: "too-soon" });

    // 人ごとにまとめる（1人に何通も送らない）
    const byUser = new Map<string, any[]>();
    for (const r of due) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id)!.push(r);
    }

    const labels = await threadLabels(admin);
    let sent = 0;

    for (const [userId, list] of byUser) {
      list.sort((a, b) => b.cnt - a.cnt);
      const total = list.reduce((s, r) => s + r.cnt, 0);
      const parts = list.slice(0, 3).map((r) => `${labels(r.thread)} ${r.cnt}件`);
      const more = list.length > 3 ? ` ほか${list.length - 3}件のやりとり` : "";
      const title = `未読のチャットが${total}件あります`;
      const body = parts.join("　") + more;
      // いちばん溜まっているやりとりへ飛ばす
      const tab = "talk:" + list[0].thread;

      await logNotifications(admin, [userId], { title, body, tab }, "chat-remind");
      sent += await pushTo(admin, userId, { title, body, tab });

      for (const r of list) {
        await admin.from("chat_reminders")
          .upsert({ user_id: userId, thread: r.thread, last_sent_at: new Date().toISOString() },
                  { onConflict: "user_id,thread" });
      }
    }

    return json({ sent, users: byUser.size });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

// やりとりの合い印 → 画面に出す名前
async function threadLabels(admin: any) {
  const [{ data: sups }, { data: projs }, { data: groups }] = await Promise.all([
    admin.from("suppliers").select("id, name"),
    admin.from("projects").select("id, name"),
    admin.from("chat_groups").select("id, name"),
  ]);
  const s = new Map((sups || []).map((x: any) => [String(x.id), x.name || ""]));
  const p = new Map((projs || []).map((x: any) => [String(x.id), x.name || ""]));
  const g = new Map((groups || []).map((x: any) => [String(x.id), x.name || ""]));
  return (key: string) => {
    const i = key.indexOf(":");
    const kind = i < 0 ? key : key.slice(0, i);
    const id = i < 0 ? "" : key.slice(i + 1);
    if (kind === "internal") return "社内";
    if (kind === "supplier") return s.get(id) || "発注先";
    if (kind === "project")  return p.get(id) || "案件";
    if (kind === "group")    return g.get(id) || "グループ";
    if (kind === "client")   return "お客様（" + (p.get(id) || "") + "）";
    if (kind === "direct")   return "個別";
    return "チャット";
  };
}

async function pushTo(admin: any, userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  let n = 0;
  await Promise.all((subs || []).map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      n++;
    } catch (e: any) {
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }));
  return n;
}

// 日本時間で21時〜翌7時かどうか
function isQuietHoursJST() {
  const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  return h >= 21 || h < 7;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
