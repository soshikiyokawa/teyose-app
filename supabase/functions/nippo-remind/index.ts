// 日報の提出リマインド用Edge Function。
//
// Supabaseのpg_cronから毎日19時・20時（JST）に呼ばれ（migration-genba9.sql参照）、
// 当日の日報が未提出の社員へプッシュ通知を送る。
//
// 対象：profiles.work_group が設定された人（役員・一般社員・訓練校生）。
// カレンダー：訓練校生 → 'trainee'／役員・一般社員 → 'regular'。
// 出勤日の判定：work_holidays（休日テーブル）に当日が「無ければ」出勤日。
//   ・work_holidays にそのカレンダーの行が1件も無い場合は未設定とみなしスキップ（誤送信防止）
//   ・当日が承認済みの休日出勤 → 出勤日として扱う（カレンダー上の休日でも対象）
//   ・当日が承認済みの全日有給 → 除外（半休は対象のまま）
//   ・当日が承認済みの振替休日 → 除外
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

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 対象：work_group が設定された人（役員・一般社員・訓練校生）
    const { data: profiles } = await admin.from("profiles").select("id, display_name, work_group")
      .in("work_group", ["役員", "一般社員", "訓練校生"]);
    if (!profiles?.length) return json({ sent: 0, targets: 0 });

    // 勤務カレンダーの休日（当日分）。カレンダーごとに「未設定か」も判定する
    const { data: holidays } = await admin.from("work_holidays").select("cal, holiday_date");
    const calConfigured: Record<string, boolean> = { regular: false, trainee: false };
    const isHolidayToday: Record<string, boolean> = { regular: false, trainee: false };
    for (const h of holidays || []) {
      calConfigured[h.cal] = true;
      if (h.holiday_date === today) isHolidayToday[h.cal] = true;
    }
    const calOf = (p: any) => (p.work_group === "訓練校生" ? "trainee" : "regular");

    // 当日の日報を提出済みの人
    const { data: reports } = await admin.from("daily_reports").select("user_id").eq("work_date", today);
    const submitted = new Set((reports || []).map((r: any) => r.user_id));

    // 承認済みの全日有給（当日を含む）の人は除外
    const { data: leaves } = await admin.from("leave_requests")
      .select("user_id, leave_type").eq("status", "approved")
      .lte("start_date", today).gte("end_date", today);
    const onLeave = new Set((leaves || []).filter((l: any) => l.leave_type === "全日").map((l: any) => l.user_id));

    // 承認済みの休日出勤（当日）＝カレンダー休日でも対象／振替休日（当日）＝除外
    const { data: holidayWork } = await admin.from("holiday_requests")
      .select("user_id").eq("status", "approved").eq("work_date", today);
    const workingHoliday = new Set((holidayWork || []).map((h: any) => h.user_id));
    const { data: substitutes } = await admin.from("holiday_requests")
      .select("user_id").eq("status", "approved").eq("substitute_date", today);
    const onSubstitute = new Set((substitutes || []).map((h: any) => h.user_id));

    const targets = profiles.filter((p: any) => {
      const cal = calOf(p);
      if (!calConfigured[cal]) return false;       // カレンダー未設定はスキップ（誤送信防止）
      if (submitted.has(p.id)) return false;       // 提出済み
      if (onLeave.has(p.id)) return false;         // 全日有給
      if (onSubstitute.has(p.id)) return false;    // 振替休日
      if (workingHoliday.has(p.id)) return true;   // 承認済み休日出勤は休日でも対象
      return !isHolidayToday[cal];                 // カレンダー上の出勤日のみ対象
    });
    if (!targets.length) return json({ sent: 0, targets: 0 });

    const label = `${jstNow.getUTCMonth() + 1}/${jstNow.getUTCDate()}`;
    let sent = 0;
    await Promise.all(
      targets.map(async (p: any) => {
        const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", p.id);
        await Promise.all(
          (subs || []).map(async (sub: any) => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify({
                  title: "日報リマインド",
                  body: `本日（${label}）の日報がまだ提出されていません。手寄の勤怠日報から提出してください。`,
                  tab: "genba/nippo",
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

    return json({ sent, targets: targets.length });
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
