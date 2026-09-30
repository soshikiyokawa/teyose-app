// アカウントの「名前」と「メールアドレス」を後から変えるためのEdge Function。
//
// 勤怠日報 → アカウント権限 → 各行の「変更」から呼ばれる。
//
//   名前          … app_rename_user() を呼ぶ。名簿だけでなく、案件の参加メンバー・
//                   チャット・日報など「名前そのもの」で持っている所も一度に付け替える
//                   （migration-genba74.sql）
//   メールアドレス … ログインに使うアドレスそのもの。管理者権限で差し替える。
//                   お客様（client）の場合は、案件ごとのお客様（project_clients）の
//                   アドレスも合わせて直す
//
// 変えたことは、新しいアドレスと元のアドレスの両方にお知らせする。
// 身に覚えのない変更に気づけるようにするため。
//
// 認証：呼び出し元のJWTを検証し、管理者（staff）のみ実行可。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || Deno.env.get("ORDER_MAIL_FROM") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://soshikiyokawa.github.io/teyose-app/";
const COMPANY = "株式会社きよかわ";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (s: string) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: caller } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (caller?.role !== "staff") return json({ error: "アカウントの変更は管理者のみです" }, 403);

    const body = await req.json();
    const userId = String(body?.userId || "");
    if (!userId) return json({ error: "アカウントが指定されていません" });

    const { data: target } = await admin.from("profiles").select("role, display_name").eq("id", userId).single();
    if (!target) return json({ error: "そのアカウントが見つかりません" }, 404);
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const nowEmail = String(authUser?.user?.email || "");

    // 読むだけ（変更の画面を開くとき、いまのアドレスを出すのに使う）
    if (body?.read) {
      return json({ ok: true, displayName: target.display_name || "", email: nowEmail });
    }

    const wantName = typeof body?.displayName === "string" ? body.displayName.trim() : null;
    const wantMail = typeof body?.email === "string" ? body.email.trim() : null;
    const done: string[] = [];

    // ── ① メールアドレス ──
    if (wantMail !== null && wantMail.toLowerCase() !== nowEmail.toLowerCase()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wantMail)) return json({ error: "メールアドレスの形が正しくありません" });
      const taken = await findUserByEmail(admin, wantMail);
      if (taken && taken.id !== userId) return json({ error: "そのメールアドレスは、ほかのアカウントで使われています" });

      const { error: mailErr } = await admin.auth.admin.updateUserById(userId, {
        email: wantMail,
        email_confirm: true,   // 確認メールを待たずに、すぐ新しいアドレスでログインできるようにする
      });
      if (mailErr) return json({ error: "メールアドレスを変えられませんでした：" + mailErr.message });

      // お客様は、案件ごとのお客様の一覧にもアドレスを持っている
      if (target.role === "client") {
        await admin.from("project_clients").update({ email: wantMail }).eq("user_id", userId);
      }
      done.push(`メールアドレス：${nowEmail || "（未設定）"} → ${wantMail}`);
      await sendChangeMail(wantMail, nowEmail, target.display_name || "", wantName);
    }

    // ── ② 名前（名前で持っている所もまとめて付け替える） ──
    if (wantName !== null && wantName !== (target.display_name || "")) {
      // 呼び出した人のJWTのまま呼ぶ。app_rename_user の中でも管理者かを見ているので、
      // service_role で呼ぶと auth.uid() が空になり、そのチェックに引っかかってしまう
      const { data: renamed, error: nameErr } = await userClient.rpc("app_rename_user", {
        p_user_id: userId, p_new_name: wantName,
      });
      if (nameErr) return json({ error: "名前を変えられませんでした：" + nameErr.message });
      if ((renamed as any)?.changed) done.push(`名前：${(renamed as any).from} → ${(renamed as any).to}`);
    }

    if (!done.length) return json({ ok: true, changed: false, note: "変更はありませんでした" });
    return json({ ok: true, changed: true, done });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

async function findUserByEmail(admin: any, email: string) {
  const want = String(email).toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const hit = (data?.users || []).find((u: any) => String(u.email || "").toLowerCase() === want);
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

// アドレスが変わったことを、新しいアドレスへ（元のアドレスにも控えを）知らせる
async function sendChangeMail(to: string, oldMail: string, name: string, newName: string | null) {
  if (!RESEND_API_KEY || !MAIL_FROM) return;
  const shownName = (newName || name || "").trim();
  const html = `<div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.9;color:#16161a">
  <p>${esc(shownName)} 様</p>
  <p>手寄（てよせ）にログインするメールアドレスを変更しました。</p>
  <p style="margin:6px 0 2px">新しいメールアドレス：<b>${esc(to)}</b><br>
  ${oldMail ? `これまでのメールアドレス：${esc(oldMail)}` : ""}</p>
  <p style="font-size:13px;color:#5a5a63">パスワードはこれまでと同じです。次回から、新しいメールアドレスでログインしてください。</p>
  <p style="margin:18px 0"><a href="${APP_URL}" style="display:inline-block;background:#415e2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:700">手寄をひらく</a></p>
  <p style="font-size:12px;color:#8a8a93">お心当たりがない場合は、${COMPANY}までご連絡ください。</p>
</div>`;
  const text = `${shownName} 様\n\n手寄にログインするメールアドレスを変更しました。\n\n`
    + `新しいメールアドレス：${to}\n${oldMail ? `これまでのメールアドレス：${oldMail}\n` : ""}\n`
    + `パスワードはこれまでと同じです。次回から、新しいメールアドレスでログインしてください。\n${APP_URL}\n\n`
    + `お心当たりがない場合は、${COMPANY}までご連絡ください。\n`;
  const payload: Record<string, unknown> = {
    from: MAIL_FROM, to: [to], subject: `【${COMPANY}】手寄のログイン用メールアドレスを変更しました`, html, text,
  };
  if (oldMail && oldMail.toLowerCase() !== to.toLowerCase()) payload.bcc = [oldMail];
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) { /* 知らせが送れなくても、変更そのものは成り立っている */ }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
