// お客様（施主）アカウントのご案内メール用Edge Function。
//
// 案件情報の「チャット案内」ボタンから呼ばれ、
//   ① そのお客様のアカウントを作り（既にあれば作らない）
//   ② 案件に紐づけ（projects.client_user_id）
//   ③ パスワードを決めてもらうご案内メールを送る
// お客様は「チャットだけ」の役割で、案件・見積・発注などは一切見られない
// （migration-genba69.sql）。
//
// 送り方は invite-user と同じ2通り。
//   A. Resendが設定してあるとき（RESEND_API_KEY と INVITE_MAIL_FROM）… 自前のご案内メール
//   B. まだのとき … Supabaseの標準の招待メール
// お客様には登録マニュアル（社員向け）は添えない。
//
// 認証：呼び出し元のJWTを検証し、きよかわの社員（staff / carpenter）のみ実行可。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || Deno.env.get("ORDER_MAIL_FROM") || "";
const MAIL_BCC = Deno.env.get("INVITE_MAIL_BCC") || "";
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
    // ── 呼び出したのが、きよかわの社員か ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: caller } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!(caller?.role === "staff" || caller?.role === "carpenter")) {
      return json({ error: "お客様のご案内はきよかわの社員のみ行えます" }, 403);
    }

    const { projectId, email, displayName, redirectTo: wantRedirect } = await req.json();
    if (!projectId) return json({ error: "案件が指定されていません" });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "メールアドレスが正しくありません" });

    const { data: project, error: projErr } = await admin.from("projects")
      .select("id, name, client_name, client_user_id").eq("id", projectId).single();
    if (projErr || !project) return json({ error: "案件が見つかりません" }, 404);

    // 画面に出す名前。指定が無ければ案件の施主名から作る
    const name = String(displayName || "").trim()
      || (project.client_name ? `${project.client_name} 様` : "お客様");

    const origin = req.headers.get("origin") || "";
    const redirectTo = (typeof wantRedirect === "string" && origin && wantRedirect.startsWith(origin))
      ? wantRedirect : undefined;

    // ── 既にそのメールアドレスのアカウントがあるか ──
    // お客様が2件目の案件を建てる場合など。社員・業者のアドレスは受け付けない
    const existing = await findUserByEmail(admin, email);
    let userId = existing?.id || "";
    let mailNote = "";
    let created = false;

    if (userId) {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).single();
      if (prof && prof.role !== "client") {
        return json({ error: "このメールアドレスは、きよかわの社員または業者のアカウントで使われています" });
      }
      mailNote = "このメールアドレスのお客様アカウントは既にあります。案件に紐づけ、ご案内メールを送り直しました。";
      // 既にある人には「パスワード再設定」のリンクを送る（招待リンクは新規のみ）
      const link = await makeLink(admin, "recovery", email, redirectTo);
      if (link.error) return json({ error: link.error });
      const sent = await sendClientMail(email, name, project.name, link.url, true);
      if (sent.error) mailNote = `ご案内メールを送れませんでした（${sent.error}）。`;
    } else {
      created = true;
      if (RESEND_API_KEY && MAIL_FROM) {
        const link = await makeLink(admin, "invite", email, redirectTo);
        if (link.error) return json({ error: link.error });
        userId = link.userId;
        const sent = await sendClientMail(email, name, project.name, link.url, false);
        if (sent.error) {
          mailNote = `アカウントは作りましたが、メールを送れませんでした（${sent.error}）。`
                   + `お客様に「パスワードをお忘れの方」から設定していただくこともできます。`;
        }
      } else {
        const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (invErr) return json({ error: inviteErrorMessage(invErr.message) });
        userId = invited.user.id;
        mailNote = "Supabaseの標準メールで送りました。文面をきよかわのものにするには、"
                 + "Edge Functions の Secrets に RESEND_API_KEY と INVITE_MAIL_FROM を登録してください。";
      }
    }

    // ── お客様の権限（チャットだけ）と、案件への紐づけ ──
    const { error: profErr } = await admin.from("profiles")
      .upsert({ id: userId, role: "client", display_name: name, supplier_id: null, work_group: "" });
    if (profErr) return json({ error: "お客様の登録に失敗しました：" + profErr.message });

    const { error: linkErr } = await admin.from("projects")
      .update({ client_user_id: userId, client_email: email }).eq("id", projectId);
    if (linkErr) return json({ error: "案件への紐づけに失敗しました：" + linkErr.message });

    return json({ ok: true, created, userId, note: mailNote });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

// メールアドレスからアカウントを探す（見つからなければ null）
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

async function makeLink(admin: any, type: "invite" | "recovery", email: string, redirectTo?: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type, email, options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) return { url: "", userId: "", error: inviteErrorMessage(error.message) };
  return { url: (data.properties as any)?.action_link || "", userId: data.user?.id || "", error: "" };
}

function inviteErrorMessage(m: string): string {
  return /already|registered|exists/i.test(m)
    ? "このメールアドレスは既に登録されています"
    : "ご案内メールの送信に失敗しました：" + m;
}

// お客様へのご案内メール。専門用語を使わず、やることを1つだけにする
async function sendClientMail(to: string, name: string, projectName: string, link: string, again: boolean) {
  const title = again ? "チャットのご案内（パスワードの再設定）" : "チャットのご案内（パスワードの設定）";
  const lead = again
    ? "すでにご登録いただいているアカウントです。下のボタンからパスワードを設定し直してご利用ください。"
    : "工事の進み具合のご連絡や、ご質問のやりとりに、チャットをご用意しました。";
  const html = `<div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.9;color:#16161a">
  <p>${esc(name)}</p>
  <p>いつもお世話になっております。${COMPANY}です。<br>${esc(lead)}</p>
  <p style="margin:6px 0 2px"><b>対象の工事</b>：${esc(projectName)}</p>
  <p style="margin:20px 0">
    <a href="${link}" style="display:inline-block;background:#415e2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700">
      パスワードを設定してはじめる
    </a>
  </p>
  <p style="font-size:13px;color:#5a5a63">
    ボタンを押すと画面が開きますので、お好きなパスワードをお決めください。<br>
    次回からは、メールアドレスとそのパスワードでご利用いただけます。<br>
    ご覧いただけるのは、${COMPANY}とのチャットのみです。
  </p>
  <p style="font-size:13px;color:#5a5a63">
    リンクが開けない場合は、お手数ですが下のURLをブラウザに貼り付けてください。<br>
    <span style="word-break:break-all">${esc(link)}</span>
  </p>
  <p style="font-size:12px;color:#8a8a93">このメールにお心当たりがない場合は、お手数ですが破棄してください。</p>
</div>`;
  const text = `${name}\n\nいつもお世話になっております。${COMPANY}です。\n${lead}\n\n`
    + `対象の工事：${projectName}\n\n下のURLを開いて、パスワードをお決めください。\n${link}\n\n`
    + `次回からは、メールアドレスとそのパスワードでご利用いただけます。\n`
    + `ご覧いただけるのは、${COMPANY}とのチャットのみです。\n`;

  const payload: Record<string, unknown> = {
    from: MAIL_FROM, to: [to], subject: `【${COMPANY}】${title}`, html, text,
  };
  if (MAIL_BCC) payload.bcc = [MAIL_BCC];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 200)}` };
    return { error: "" };
  } catch (e) {
    return { error: String((e as any)?.message || e) };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
