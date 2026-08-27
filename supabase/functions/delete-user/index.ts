// 管理者が、アカウントを削除するためのEdge Function。
//
// 注意：アカウントを消すと、その人にぶら下がっているデータも一緒に消える。
//   日報／有給申請／休日出勤申請／給与／資格／通知／通知の宛先／既読
// 日報が消えると出面表と現場別労務費も変わってしまうので、
// 中身があるアカウントは、件数を返して一度止める（confirmed を付けて呼び直すと消す）。
//
// 図面・現場写真・フォルダは「誰が入れたか」が空になるだけで、中身は残る。
//
// やること
//   ① 呼び出したのが、ログイン済みの管理者（staff）かを確認する
//   ② 一緒に消えるものの件数を数える
//   ③ 件数があって confirmed が無ければ、消さずに件数だけ返す
//   ④ 消す（auth側を消すと、ぶら下がっているものも連鎖して消える）

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 消えると困るもの。件数を数えて画面に出す
const RELATED: Array<[string, string, string]> = [
  ["daily_reports", "user_id", "日報"],
  ["leave_requests", "user_id", "有給申請"],
  ["holiday_requests", "user_id", "休日出勤の申請"],
  ["employee_salaries", "user_id", "給与の登録"],
  ["licenses", "user_id", "資格・免許"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // ── ① 呼び出し元が管理者（staff）であることを確認 ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: caller } = await admin.from("profiles")
      .select("role, display_name").eq("id", userData.user.id).single();
    if (caller?.role !== "staff") return json({ error: "アカウントの削除は管理者のみ可能です" }, 403);

    const { userId, confirmed } = await req.json();
    if (!userId) return json({ error: "対象のアカウントが指定されていません" }, 400);
    if (userId === userData.user.id) return json({ error: "自分のアカウントは削除できません" }, 400);

    const { data: target } = await admin.from("profiles")
      .select("display_name, role").eq("id", userId).single();
    if (!target) return json({ error: "そのアカウントが見つかりません" }, 404);

    // 管理者が一人もいなくなるのを防ぐ
    if (target.role === "staff") {
      const { count } = await admin.from("profiles")
        .select("id", { count: "exact", head: true }).eq("role", "staff");
      if ((count ?? 0) <= 1) return json({ error: "管理者が一人もいなくなるため削除できません" }, 400);
    }

    // ── ② 一緒に消えるものを数える ──
    const related: Array<{ label: string; count: number }> = [];
    for (const [table, col, label] of RELATED) {
      const { count, error } = await admin.from(table)
        .select("id", { count: "exact", head: true }).eq(col, userId);
      if (error) continue;   // まだ無い表は飛ばす
      if ((count ?? 0) > 0) related.push({ label, count: count ?? 0 });
    }

    // ── ③ 中身があるのに確認していなければ、消さずに返す ──
    if (related.length && confirmed !== true) {
      return json({ needsConfirm: true, displayName: target.display_name || "", related });
    }

    // ── ④ 削除 ──
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: "削除に失敗しました：" + delErr.message }, 500);
    // profiles は auth 側と連鎖して消えるが、念のため残っていれば消す
    await admin.from("profiles").delete().eq("id", userId);

    console.log(
      `アカウントを削除：対象=${target.display_name || userId} 実行者=${caller.display_name || userData.user.email}`,
    );
    return json({ ok: true, displayName: target.display_name || "", related });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
