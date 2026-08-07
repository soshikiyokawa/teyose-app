// 日報の不備チェック通知。
//
//  mode=monthly（毎月20日10時JST）：前月21日〜当月20日の日報に不備がないか、管理者(staff)へ確認依頼。
//  mode=weekly （毎週金曜10時JST）：その週(月〜木)に出勤日なのに日報も有給も無い日がある人へ、本人に通知。
//
// 出勤日 ＝ 勤務カレンダー(work_holidays)に無い日。全日有給・振替休日は除外。
// 認証：x-remind-secret ヘッダーが Secrets(OT_REMIND_SECRET) と一致する場合のみ。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { logNotifications } from "../_shared/notify-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const dstr = (d: Date) => d.toISOString().slice(0, 10);
function dateRange(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  for (const d = new Date(startStr + "T00:00:00Z"); dstr(d) <= endStr; d.setUTCDate(d.getUTCDate() + 1)) out.push(dstr(d));
  return out;
}
function mdLabel(s: string) { const [, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; }

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    const mode = new URL(req.url).searchParams.get("mode") ?? "";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = jst.getUTCFullYear(), m = jst.getUTCMonth(), day = jst.getUTCDate();

    // 対象期間の決定
    let start: string, end: string;
    if (mode === "monthly") {
      start = dstr(new Date(Date.UTC(y, m - 1, 21)));
      end = dstr(new Date(Date.UTC(y, m, 20)));
    } else if (mode === "weekly") {
      const dow = jst.getUTCDay(); // 0=日
      const monday = new Date(Date.UTC(y, m, day - ((dow + 6) % 7))); // 今週の月曜
      const yesterday = new Date(Date.UTC(y, m, day - 1));
      start = dstr(monday);
      end = dstr(yesterday);
    } else {
      return new Response(JSON.stringify({ error: "mode は monthly か weekly" }), { status: 400 });
    }
    if (end < start) return json({ ok: true, skipped: "no-range" });
    const days = dateRange(start, end);

    // 勤務カレンダー（休日）
    const { data: hol } = await admin.from("work_holidays").select("cal, holiday_date");
    const calConfigured: Record<string, boolean> = { regular: false, trainee: false };
    const holidaySet: Record<string, Set<string>> = { regular: new Set(), trainee: new Set() };
    for (const h of hol || []) { calConfigured[h.cal] = true; holidaySet[h.cal].add(h.holiday_date); }
    const calOf = (wg: string) => (wg === "訓練校生" ? "trainee" : "regular");

    // 対象者（勤怠区分あり）
    const { data: profiles } = await admin.from("profiles").select("id, display_name, work_group")
      .in("work_group", ["役員", "一般社員", "訓練校生"]);

    // 期間内の日報・全日有給・振替休日
    const { data: reports } = await admin.from("daily_reports").select("user_id, work_date").gte("work_date", start).lte("work_date", end);
    const hasReport = new Set((reports || []).map((r: any) => `${r.user_id}|${r.work_date}`));
    const { data: leaves } = await admin.from("leave_requests").select("user_id, start_date, end_date, leave_type")
      .eq("status", "approved").eq("leave_type", "全日").lte("start_date", end).gte("end_date", start);
    const { data: subs } = await admin.from("holiday_requests").select("user_id, substitute_date")
      .eq("status", "approved").gte("substitute_date", start).lte("substitute_date", end);
    const onSub = new Set((subs || []).map((s: any) => `${s.user_id}|${s.substitute_date}`));
    const onLeave = (uid: string, d: string) => (leaves || []).some((l: any) => l.user_id === uid && l.start_date <= d && l.end_date >= d);

    // 各人の「不備日」（出勤日なのに日報も有給も無い）
    const missingByUser: Record<string, { name: string; dates: string[] }> = {};
    for (const p of profiles || []) {
      const cal = calOf(p.work_group);
      if (!calConfigured[cal]) continue; // カレンダー未設定はスキップ
      const miss: string[] = [];
      for (const d of days) {
        if (holidaySet[cal].has(d)) continue;               // 休日
        if (hasReport.has(`${p.id}|${d}`)) continue;         // 日報あり
        if (onLeave(p.id, d)) continue;                      // 全日有給
        if (onSub.has(`${p.id}|${d}`)) continue;             // 振替休日
        miss.push(d);
      }
      if (miss.length) missingByUser[p.id] = { name: p.display_name || "", dates: miss };
    }

    const pushTo = async (userIds: string[], title: string, body: string) => {
      if (!userIds.length) return 0;
      await logNotifications(admin, userIds, { title, body, tab: "genba/nippo" }, "nippo-check");
      const { data: subsPush } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);
      let sent = 0;
      await Promise.all((subsPush || []).map(async (s: any) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body, tab: "genba/nippo" }));
          sent++;
        } catch (e: any) { if (e?.statusCode === 410 || e?.statusCode === 404) await admin.from("push_subscriptions").delete().eq("id", s.id); }
      }));
      return sent;
    };

    if (mode === "monthly") {
      // 管理者(staff)へ確認依頼
      const { data: staff } = await admin.from("profiles").select("id").eq("role", "staff");
      const total = Object.values(missingByUser).reduce((s, u) => s + u.dates.length, 0);
      const body = `${mdLabel(start)}〜${mdLabel(end)}の日報を確認してください（20日締め）。`
        + (total ? `未記入の可能性がある日：${total}件。手寄の出面表・勤怠日報でご確認を。` : "未記入の可能性がある日はありません。");
      const sent = await pushTo((staff || []).map((p: any) => p.id), "日報チェックのお願い", body);
      return json({ ok: true, mode, missingDays: total, sent });
    }

    // weekly：各人へ本人の記入もれを通知
    let sent = 0;
    for (const uid of Object.keys(missingByUser)) {
      const u = missingByUser[uid];
      const body = `今週 ${u.dates.map(mdLabel).join("・")} の日報がありません。出勤日は日報か有給の記入をお願いします。`;
      sent += await pushTo([uid], "日報の記入もれ", body);
    }
    return json({ ok: true, mode, users: Object.keys(missingByUser).length, sent });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
