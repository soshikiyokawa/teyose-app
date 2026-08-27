// 管理者が、他の人のパスワードを決めるためのEdge Function。
//
// 本来はご本人が招待メール・再設定メールのリンクから決めるのが望ましい。
// ただし発注先の方などで、メールが使えない・急ぎで使い始めたい場合があるため、
// 管理者（staff）だけがこの手段を使えるようにしてある。
//
// やること
//   ① 呼び出したのが、ログイン済みの管理者（staff）かを確認する
//   ② パスワードを差し替え、あわせてメールアドレスを確認済みにする
//      （招待を受けたまま未確認だと、パスワードがあってもログインできないため）
//   ③ 誰が誰のパスワードを変えたかを記録する（パスワードそのものは残さない）
//
// パスワードはこの関数の中だけを通り、ログにも記録にも残さない。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (caller?.role !== "staff") {
      return json({ error: "パスワードの設定は管理者のみ可能です" }, 403);
    }

    const { userId, password } = await req.json();
    if (!userId) return json({ error: "対象のアカウントが指定されていません" }, 400);
    if (typeof password !== "string" || password.length < 8) {
      return json({ error: "パスワードは8文字以上にしてください" }, 400);
    }
    if (password.length > 72) {
      return json({ error: "パスワードは72文字までです" }, 400);
    }

    const { data: target } = await admin.from("profiles")
      .select("display_name").eq("id", userId).single();
    if (!target) return json({ error: "そのアカウントが見つかりません" }, 404);

    // ── ② パスワードを差し替える ──
    // email_confirm も立てるのは、招待を受けたまま未確認の人が
    // パスワードだけ設定してもログインできないため
    const { data: updated, error: upErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (upErr) return json({ error: "設定に失敗しました：" + upErr.message }, 500);

    // ── ③ 記録（パスワードそのものは残さない） ──
    console.log(
      `パスワードを設定：対象=${updated?.user?.email || userId} 実行者=${caller.display_name || userData.user.email}`,
    );

    return json({ ok: true, email: updated?.user?.email || "", displayName: target.display_name || "" });
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
