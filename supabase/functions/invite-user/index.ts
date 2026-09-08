// アカウント新規作成（メール招待）用Edge Function。
//
// アカウント権限画面（管理者専用）から呼ばれ、
//   ① 指定メールアドレスへ招待メールを送信
//   ② profiles に権限（role）・表示名・所属発注先・勤怠区分を作成
// する。招待された人はメール内のリンクからアプリを開き、パスワードを設定して利用開始。
//
// 招待メールの送り方は2通りある。
//   A. Resendが設定してあるとき（RESEND_API_KEY と INVITE_MAIL_FROM）
//      招待リンクだけを作り、登録マニュアル（PDF）を添えた自前のメールを送る。
//      Supabaseの標準メールは添付ができないので、添付したいときはこちら。
//      標準メールの通数制限（1時間に数通）にも縛られない。
//   B. 設定がまだのとき
//      これまでどおりSupabaseの招待メールを送る（マニュアルは添付されない）。
//      設定が済むまで招待そのものが止まらないよう、こちらに落とす。
//
// 必要な設定（Supabase → Edge Functions → Secrets）
//   RESEND_API_KEY      … Resendで発行したAPIキー（発注メールと同じもので可）
//   INVITE_MAIL_FROM    … 送信元。例: 株式会社きよかわ <info@kiyokawanoie.com>
//                         未設定なら ORDER_MAIL_FROM を使う。ドメインはResendで認証済みのこと
//   INVITE_MAIL_BCC     … （任意）控えを受け取るアドレス
//   INVITE_MANUAL_URL   … （任意）添える登録マニュアルPDFの場所。未設定なら下の既定値
//
// 認証：呼び出し元のJWTを検証し、profiles.role = 'staff'（管理者）のみ実行可。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || Deno.env.get("ORDER_MAIL_FROM") || "";
const MAIL_BCC = Deno.env.get("INVITE_MAIL_BCC") || "";
const MANUAL_URL = Deno.env.get("INVITE_MANUAL_URL")
  || `${SUPABASE_URL}/storage/v1/object/public/assets/docs/teyose-manual.pdf`;

const MANUAL_NAME = "手寄 登録マニュアル.pdf";
const COMPANY = "株式会社きよかわ";

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
    const { email, displayName, role, supplierId, workGroup, redirectTo: wantRedirect } = await req.json();
    if (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) === false) return json({ error: "メールアドレスが正しくありません" });
    if (!displayName) return json({ error: "表示名を入力してください" });
    if (!["staff", "carpenter", "supplier"].includes(role)) return json({ error: "権限の指定が正しくありません" });
    if (workGroup && !["役員", "一般社員", "訓練校生"].includes(workGroup)) return json({ error: "勤怠区分の指定が正しくありません" });

    // ── 招待リンクの戻り先 ──
    //
    // origin だけでは https://soshikiyokawa.github.io になり、アプリのある
    // /teyose-app/ に届かない（存在しないページに飛ばされ、パスワードを決められない）。
    // 画面から渡してもらったアプリのURLを使い、それが無いときはSupabase側の
    // Site URL に任せる（undefined を渡すとSite URLが使われる）。
    const origin = req.headers.get("origin") || "";
    const redirectTo =
      typeof wantRedirect === "string" && origin && wantRedirect.startsWith(origin)
        ? wantRedirect
        : undefined;

    const canSendOurselves = !!(RESEND_API_KEY && MAIL_FROM);
    let userId = "";
    let attached = false;
    let mailNote = "";

    if (canSendOurselves) {
      // ── A. 自前で送る（マニュアルを添える） ──
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: redirectTo ? { redirectTo } : undefined,
      });
      if (linkErr) return json({ error: inviteErrorMessage(linkErr.message) });
      userId = link.user.id;

      const actionLink = (link.properties as any)?.action_link || "";
      const sent = await sendInviteMail(email, displayName, actionLink);
      attached = sent.attached;
      if (sent.error) {
        // メールだけ落ちた場合、アカウントは作られている。
        // 消してしまうと「もう一度招待」もできなくなるので残し、そのことを伝える
        mailNote = `アカウントは作りましたが、メールを送れませんでした（${sent.error}）。`
                 + `「パスワードをお忘れの方」から本人に設定してもらってください。`;
      }
    } else {
      // ── B. Supabaseの招待メール（マニュアルは添付できない） ──
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (invErr) return json({ error: inviteErrorMessage(invErr.message) });
      userId = invited.user.id;
      // 何が足りないのかを名指しで伝える（両方の名前を並べると探しにくいため）
      const missing = [
        !RESEND_API_KEY ? "RESEND_API_KEY" : "",
        !MAIL_FROM ? "INVITE_MAIL_FROM（送信元。例：株式会社きよかわ <info@example.com>）" : "",
      ].filter(Boolean);
      mailNote = `Supabaseの標準メールで送りました。登録マニュアルは添付されていません。\n\n`
               + `添付するには、Supabase → Edge Functions → Secrets に次を登録してください。\n`
               + missing.map((m) => "・" + m).join("\n");
    }

    // ── プロフィール（権限・表示名・所属・勤怠区分）を作成 ──
    const { error: profErr } = await admin.from("profiles").upsert({
      id: userId,
      role,
      display_name: displayName,
      supplier_id: role === "supplier" ? (supplierId || null) : null,
      work_group: role === "supplier" ? "" : (workGroup || ""),
    });
    if (profErr) return json({ error: "プロフィールの作成に失敗しました：" + profErr.message });

    return json({ ok: true, attached, note: mailNote });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function inviteErrorMessage(m: string): string {
  return /already|registered|exists/i.test(m)
    ? "このメールアドレスは既に登録されています"
    : "招待メールの送信に失敗しました：" + m;
}

// ── 招待メールを自前で送る（登録マニュアルPDFを添える） ──
async function sendInviteMail(to: string, displayName: string, link: string) {
  let attachments: Array<Record<string, string>> = [];
  try {
    const res = await fetch(MANUAL_URL);
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length && buf.length < 8 * 1024 * 1024) {
        attachments = [{ filename: MANUAL_NAME, content: toBase64(buf) }];
      }
    }
  } catch (_) { /* マニュアルが取れなくても、招待そのものは送る */ }

  const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

  const html = `<div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.9;color:#16161a">
  <p>${esc(displayName)} 様</p>
  <p>${COMPANY}の業務アプリ「手寄（てよせ）」のアカウントをお作りしました。<br>
  下のボタンから、最初のパスワードを決めてください。</p>
  <p style="margin:24px 0">
    <a href="${esc(link)}" style="display:inline-block;background:#415e2e;color:#ffffff;
      text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">パスワードを設定する</a>
  </p>
  <p style="font-size:12px;color:#5a5a63">ボタンが押せないときは、次のURLをブラウザに貼り付けてください。<br>
    <span style="word-break:break-all">${esc(link)}</span></p>
  <p style="font-size:12px;color:#5a5a63">このリンクは時間がたつと使えなくなります。
    切れてしまった場合は、ログイン画面の「パスワードをお忘れの方」から設定し直せます。</p>
  <hr style="border:0;border-top:1px solid #dcdce1;margin:24px 0">
  <p style="font-size:13px">${attachments.length
    ? "使い方は、添付の「手寄 登録マニュアル.pdf」をご覧ください。パソコン・スマートフォンそれぞれの始め方と、パスワードの決め方を書いています。"
    : "使い方は、別途お渡しする登録マニュアルをご覧ください。"}</p>
  <p style="font-size:12px;color:#8a8a93">${COMPANY}</p>
</div>`;

  const text = [
    `${displayName} 様`, "",
    `${COMPANY}の業務アプリ「手寄（てよせ）」のアカウントをお作りしました。`,
    "下のURLを開いて、最初のパスワードを決めてください。", "",
    link, "",
    "このリンクは時間がたつと使えなくなります。",
    "切れてしまった場合は、ログイン画面の「パスワードをお忘れの方」から設定し直せます。", "",
    attachments.length
      ? "使い方は、添付の「手寄 登録マニュアル.pdf」をご覧ください。"
      : "使い方は、別途お渡しする登録マニュアルをご覧ください。",
    "", COMPANY,
  ].join("\n");

  const payload: Record<string, unknown> = {
    from: MAIL_FROM,
    to: [to],
    subject: `【手寄】アカウントのご案内（パスワードの設定をお願いします）`,
    html, text,
  };
  if (MAIL_BCC) payload.bcc = [MAIL_BCC];
  if (attachments.length) payload.attachments = attachments;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { attached: false, error: (body as any)?.message || `送信エラー（${r.status}）` };
    return { attached: attachments.length > 0, error: "" };
  } catch (e) {
    return { attached: false, error: String((e as any)?.message || e) };
  }
}

// 大きなファイルでも積み上がらないよう、少しずつ変換する
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
