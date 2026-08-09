// タスクの期限リマインド用Edge Function。
//
// Supabaseのpg_cronから毎朝7時（JST）に呼ばれ（migration-genba43.sql参照）、
// 期限が「今日」または「明日」の未済タスクを、担当者ごとにまとめて通知する。
//
// 担当者は表示名の配列で入っている。発注先は会社名で入っていることもあるので、
// 表示名と会社名の両方で宛先を引く（案件の参加メンバーと同じ考え方）。
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

    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const today = jstNow.toISOString().slice(0, 10);
    const tomorrow = new Date(jstNow.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 期限が今日・明日の未済タスク（期限切れは毎朝送り続けないよう対象外）
    const { data: tasks, error } = await admin.from("tasks")
      .select("id, title, assignees, due_date, project_id")
      .eq("status", "open")
      .in("due_date", [today, tomorrow]);
    if (error) return json({ error: error.message }, 500);
    if (!tasks?.length) return json({ sent: 0, tasks: 0 });

    // 案件名（タスクにひとこと添えるため）
    const projectIds = [...new Set(tasks.map((t: any) => t.project_id).filter(Boolean))];
    const projectName: Record<string, string> = {};
    if (projectIds.length) {
      const { data: projs } = await admin.from("projects").select("id, name").in("id", projectIds);
      for (const p of projs || []) projectName[String(p.id)] = p.name || "";
    }

    // 宛先の名前（表示名／発注先の会社名）→ ユーザーID
    const { data: profiles } = await admin.from("profiles").select("id, role, supplier_id, display_name");
    const { data: sups } = await admin.from("suppliers").select("id, name");
    const supplierNameById: Record<string, string> = {};
    for (const s of sups || []) supplierNameById[String(s.id)] = s.name || "";
    const idsByName: Record<string, string[]> = {};
    const add = (name: string, id: string) => {
      if (!name) return;
      (idsByName[name] = idsByName[name] || []).push(id);
    };
    for (const p of profiles || []) {
      add(p.display_name || "", p.id);
      if (p.role === "supplier" && p.supplier_id != null) add(supplierNameById[String(p.supplier_id)], p.id);
    }

    // 人ごとに「今日ぶん」「明日ぶん」を集める
    type Bucket = { today: string[]; tomorrow: string[] };
    const byUser = new Map<string, Bucket>();
    for (const t of tasks) {
      const label = t.title + (t.project_id && projectName[String(t.project_id)]
        ? `（${projectName[String(t.project_id)]}）` : "");
      for (const name of (t.assignees || [])) {
        for (const uid of (idsByName[name] || [])) {
          const b = byUser.get(uid) || { today: [], tomorrow: [] };
          (t.due_date === today ? b.today : b.tomorrow).push(label);
          byUser.set(uid, b);
        }
      }
    }
    if (!byUser.size) return json({ sent: 0, tasks: tasks.length });

    let sent = 0;
    await Promise.all([...byUser.entries()].map(async ([uid, b]) => {
      // 同じタスクに2回入ることがあるので（表示名と会社名の両方で一致した場合）重複を消す
      const td = [...new Set(b.today)];
      const tm = [...new Set(b.tomorrow)];
      const parts = [
        td.length ? `今日が期限：${td.slice(0, 3).join("／")}${td.length > 3 ? ` ほか${td.length - 3}件` : ""}` : "",
        tm.length ? `明日が期限：${tm.slice(0, 3).join("／")}${tm.length > 3 ? ` ほか${tm.length - 3}件` : ""}` : "",
      ].filter(Boolean);
      const title = td.length
        ? `今日が期限のタスクが${td.length}件あります`
        : `明日が期限のタスクが${tm.length}件あります`;
      const body = parts.join("　");

      await logNotifications(admin, [uid], { title, body, tab: "task" }, "task-remind");

      const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", uid);
      await Promise.all((subs || []).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body, tab: "task" }),
          );
          sent++;
        } catch (e: any) {
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }));
    }));

    return json({ sent, tasks: tasks.length, users: byUser.size });
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
