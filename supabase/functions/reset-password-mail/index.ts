// パスワード再設定メール（自社送信）用Edge Function。
//
// ログイン画面の「パスワードをお忘れの方」から呼ばれる。
// Supabaseの標準メールは1時間に数通しか送れず、届かないことがあるため
// （2026-09、実際に再設定できない状態になった）、Resendで自社から送る。
//
// 誰でも呼べる（ログイン前に使うため）。そのかわり、
//   ・そのアドレスが登録されているかどうかは返さない（総当たりで調べられないように）
//   ・同じアドレスへは2分に1通まで
// にしてある。
//
// 必要な設定（Supabase → Edge Functions → Secrets）
//   RESEND_API_KEY   … Resendで発行したAPIキー
//   INVITE_MAIL_FROM … 送信元（招待メールと同じもの）。未設定なら ORDER_MAIL_FROM
//
// デプロイは --no-verify-jwt（ログイン前に呼ぶため）。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || Deno.env.get("ORDER_MAIL_FROM") || "";
const COMPANY = "株式会社きよかわ";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 同じアドレスへの送りすぎを防ぐ（2分に1通）。関数が立ち上がっている間だけ覚える
const lastSent = new Map<string, number>();
const TOO_SOON_MS = 2 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = await req.json();

    const { email, redirectTo } = payload || {};
    const to = String(email || "").trim().toLowerCase();
    // 送れたかどうかに関わらず同じ返事にする（どのアドレスが登録されているかを知られないため）
    const ok = () => json({ ok: true });
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "メールアドレスが正しくありません" });

    const prev = lastSent.get(to) || 0;
    if (Date.now() - prev < TOO_SOON_MS) return ok();
    lastSent.set(to, Date.now());

    if (!RESEND_API_KEY || !MAIL_FROM) {
      return json({ error: "メールの送信設定（RESEND_API_KEY / INVITE_MAIL_FROM）がまだです" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const safeRedirect = typeof redirectTo === "string" && /^https:\/\/[^\s]+$/.test(redirectTo) ? redirectTo : undefined;

    // 登録が無いアドレスはここで失敗するが、返事は変えない
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery", email: to, options: safeRedirect ? { redirectTo: safeRedirect } : undefined,
    });
    if (error || !(data?.properties as any)?.action_link) return ok();

    const link = (data.properties as any).action_link as string;
    const name = await displayNameOf(admin, data.user?.id);
    await sendMail(to, name, link);
    return ok();
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

async function displayNameOf(admin: any, id?: string): Promise<string> {
  if (!id) return "";
  const { data } = await admin.from("profiles").select("display_name").eq("id", id).single();
  return data?.display_name || "";
}

async function sendMail(to: string, name: string, link: string) {
  const hello = name ? `${esc(name)} 様` : "";
  const html = `<div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.9;color:#16161a">
  ${hello ? `<p>${hello}</p>` : ""}
  <p>手寄（てよせ）のパスワード再設定のご案内です。<br>下のボタンから、新しいパスワードをお決めください。</p>
  <p style="margin:20px 0">
    <a href="${link}" style="display:inline-block;background:#415e2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700">
      パスワードを設定する
    </a>
  </p>
  <p style="font-size:13px;color:#5a5a63">
    リンクが開けない場合は、下のURLをブラウザに貼り付けてください。<br>
    <span style="word-break:break-all">${esc(link)}</span>
  </p>
  <p style="font-size:12px;color:#8a8a93">
    このリンクには期限があります。切れていた場合は、もう一度「パスワードをお忘れの方」からお試しください。<br>
    お心当たりがない場合は、このメールを破棄してください。パスワードは変わりません。
  </p>
  <p style="font-size:12px;color:#8a8a93">${COMPANY}</p>
</div>`;
  const text = `${name ? name + " 様\n\n" : ""}手寄（てよせ）のパスワード再設定のご案内です。\n`
    + `下のURLを開いて、新しいパスワードをお決めください。\n\n${link}\n\n`
    + `このリンクには期限があります。切れていた場合は、もう一度「パスワードをお忘れの方」からお試しください。\n`
    + `お心当たりがない場合は破棄してください。パスワードは変わりません。\n\n${COMPANY}\n`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: "【手寄】パスワード再設定のご案内", html, text }),
    });
    if (!r.ok) console.log("reset-password-mail", JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 200) }));
  } catch (e) {
    console.log("reset-password-mail", JSON.stringify({ error: String((e as any)?.message || e) }));
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
