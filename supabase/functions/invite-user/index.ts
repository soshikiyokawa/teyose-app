// アカウント新規作成（メール招待）用Edge Function。
//
// アカウント権限画面（管理者専用）から呼ばれ、
//   ① 指定メールアドレスへ招待メールを送信（Supabaseの招待リンク）
//   ② profiles に権限（role）・表示名・所属発注先・勤怠区分を作成
// する。招待された人はメール内のリンクからアプリを開き、パスワードを設定して利用開始。
//
// 認証：呼び出し元のJWTを検証し、profiles.role = 'staff'（管理者）のみ実行可。

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
    // ── 呼び出し元が管理者（staff）であることを確認 ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "認証が必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProf } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (callerProf?.role !== "staff") return json({ error: "アカウントの追加は管理者のみ可能です" }, 403);

    // ── 入力チェック ──
    const { email, displayName, role, supplierId, workGroup } = await req.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "メールアドレスが正しくありません" });
    if (!displayName) return json({ error: "表示名を入力してください" });
    if (!["staff", "carpenter", "supplier"].includes(role)) return json({ error: "権限の指定が正しくありません" });
    if (workGroup && !["役員", "一般社員", "訓練校生"].includes(workGroup)) return json({ error: "勤怠区分の指定が正しくありません" });

    // ── 招待メールを送信（リンクは呼び出し元のアプリURLへ戻す） ──
    const redirectTo = req.headers.get("origin") || undefined;
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (invErr) {
      const msg = /already/i.test(invErr.message)
        ? "このメールアドレスは既に登録されています"
        : "招待メールの送信に失敗しました：" + invErr.message;
      return json({ error: msg });
    }

    // ── プロフィール（権限・表示名・所属・勤怠区分）を作成 ──
    const { error: profErr } = await admin.from("profiles").upsert({
      id: invited.user.id,
      role,
      display_name: displayName,
      supplier_id: role === "supplier" ? (supplierId || null) : null,
      work_group: role === "supplier" ? "" : (workGroup || ""),
    });
    if (profErr) return json({ error: "プロフィールの作成に失敗しました：" + profErr.message });

    return json({ ok: true });
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
