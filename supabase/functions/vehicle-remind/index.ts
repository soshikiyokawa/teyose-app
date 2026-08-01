// 車両管理のリマインド用Edge Function。
//
// Supabaseのpg_cronから毎日9時（JST）に呼ばれ（migration-genba26.sql参照）、
// 車両の点検責任者と管理者（staff）へプッシュ通知を送る。
// 管理者あての本文には「（担当：〇〇）」を付けて、誰の担当かが分かるようにする。
//
//   車検        … 満了日の3か月前・1か月前
//   オイル交換  … 4月1日／10月1日。実施が登録されるまで、以降は毎週金曜に催促
//   夏タイヤ交換… 4月1日。          実施が登録されるまで、以降は毎週金曜に催促
//   冬タイヤ交換… 12月1日。         実施が登録されるまで、以降は毎週金曜に催促
//
// 認証：x-remind-secretヘッダーがSecrets（OT_REMIND_SECRET）と一致する場合のみ動作。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function addMonths(s: string, n: number) {
  const [y, m, d] = s.split("-").map(Number);
  let ny = y, nm = m + n;
  ny += Math.floor((nm - 1) / 12);
  nm = ((nm - 1) % 12 + 12) % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const label = (s: string) => s.replace(/-/g, "/");

// 実施時期（シーズン）の開始日を求める。today がそのシーズンの中にいるか判定する。
//   オイル交換：4/1〜9/30 と 10/1〜3/31 の2シーズン
//   夏タイヤ  ：4/1 から次の12/1 まで
//   冬タイヤ  ：12/1 から次の4/1 まで
function seasonStart(kind: string, today: string): string | null {
  const [y, m, d] = today.split("-").map(Number);
  const md = m * 100 + d;
  if (kind === "オイル交換") {
    if (md >= 1001) return `${y}-10-01`;
    if (md >= 401) return `${y}-04-01`;
    return `${y - 1}-10-01`;              // 1/1〜3/31 は前年10/1のシーズン
  }
  if (kind === "夏タイヤ") {
    if (md >= 1201) return null;          // 12/1以降は冬タイヤの季節
    if (md >= 401) return `${y}-04-01`;
    return null;                          // 1/1〜3/31 は冬タイヤの季節
  }
  if (kind === "冬タイヤ") {
    if (md >= 1201) return `${y}-12-01`;
    if (md < 401) return `${y - 1}-12-01`; // 1/1〜3/31 は前年12/1のシーズン
    return null;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) return json({ error: "unauthorized" }, 401);

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);
    const isFriday = jstNow.getUTCDay() === 5;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: vehicles } = await admin.from("vehicles").select("*");
    if (!vehicles?.length) return json({ sent: 0 });
    const { data: records } = await admin.from("vehicle_records").select("vehicle_id, kind, done_date");

    // 点検責任者の名前 → user_id ／ 管理者（staff）にも同じ内容を送る
    const { data: profiles } = await admin.from("profiles").select("id, display_name, role");
    const idByName: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { if (p.display_name) idByName[p.display_name] = p.id; });
    const staffIds = (profiles || []).filter((p: any) => p.role === "staff").map((p: any) => p.id);

    type Msg = { userId: string; title: string; body: string };
    const msgs: Msg[] = [];
    const push = (v: any, title: string, body: string) => {
      const managerId = idByName[v.manager_name || ""];
      // 点検責任者＋管理者。同じ人が重ならないようにまとめる
      const targets = new Set<string>(staffIds);
      if (managerId) targets.add(managerId);
      // 管理者へは、誰の担当かが分かるように車両名のあとへ責任者名を添える
      const who = v.manager_name ? `（担当：${v.manager_name}）` : "（担当：未設定）";
      targets.forEach((uid) => {
        msgs.push({ userId: uid, title, body: uid === managerId ? body : body + who });
      });
    };

    for (const v of vehicles) {
      const name = v.name || "車両";

      // ① 車検：満了日の3か月前・1か月前
      if (v.inspection_date) {
        if (today === addMonths(v.inspection_date, -3)) {
          push(v, "車検の準備", `${name}の車検は${label(v.inspection_date)}までです（3か月前）。予約の手配をお願いします。`);
        } else if (today === addMonths(v.inspection_date, -1)) {
          push(v, "車検が近づいています", `${name}の車検は${label(v.inspection_date)}までです（1か月前）。まだの場合は至急ご手配ください。`);
        }
      }

      // ② オイル交換・夏／冬タイヤ：シーズン開始日と、未実施なら毎週金曜
      for (const kind of ["オイル交換", "夏タイヤ", "冬タイヤ"]) {
        const start = seasonStart(kind, today);
        if (!start) continue;
        const done = (records || []).some((r: any) =>
          r.vehicle_id === v.id && r.kind === kind && r.done_date >= start
        );
        if (done) continue;
        const what = kind === "オイル交換" ? "オイル交換" : `${kind}への交換`;
        if (today === start) {
          push(v, `${what}の時期です`, `${name}の${what}をお願いします。終わったらアプリに実施登録してください。`);
        } else if (isFriday) {
          push(v, `${what}が未登録です`, `${name}の${what}がまだ登録されていません（${label(start)}から）。実施済みの場合は登録をお願いします。`);
        }
      }
    }

    if (!msgs.length) return json({ sent: 0 });

    const { data: subs } = await admin.from("push_subscriptions").select("*")
      .in("user_id", [...new Set(msgs.map((m) => m.userId))]);

    let sent = 0;
    await Promise.all(msgs.flatMap((m) =>
      (subs || []).filter((s: any) => s.user_id === m.userId).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: m.title, body: m.body, tab: "genba/vehicle" }),
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
