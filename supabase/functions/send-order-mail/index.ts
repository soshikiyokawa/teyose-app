// 発注書をメールで送るためのEdge Function（Resend経由）。
//
// 発注先マスタで送付先に「メール」を選んでいる発注先に対して、発注を確定したときに呼ばれる。
// 本文に発注の要約を書き、発注書PDFを添付する。
//
// 送り先のメールアドレスは、呼び出し元から受け取らずSupabaseの発注先マスタから引く。
// （画面側から宛先を差し替えられないようにするため）
//
// 必要な設定（Supabase → Edge Functions → Secrets）
//   RESEND_API_KEY      … Resendで発行したAPIキー
//   ORDER_MAIL_FROM     … 送信元。例: 株式会社きよかわ <order@kiyokawanoie.com>
//                         ここのドメインはResendで認証済みである必要がある
//   ORDER_MAIL_BCC      … （任意）控えを受け取るアドレス
//   ORDER_MAIL_REPLY_TO … （任意）返信先。未設定なら送信元と同じ

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("ORDER_MAIL_FROM") || "";
const MAIL_BCC = Deno.env.get("ORDER_MAIL_BCC") || "";
const MAIL_REPLY_TO = Deno.env.get("ORDER_MAIL_REPLY_TO") || "";

const COMPANY = {
  name: "株式会社きよかわ",
  zip: "〒731-0221",
  address: "広島県広島市安佐北区可部2-13-31-1",
  tel: "082-815-6080",
  url: "kiyokawanoie.com",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const ymd = (s: string) => String(s || "").replace(/-/g, "/");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // ── 呼び出し元が、ログイン済みの社内（staff）ユーザーであることを確認する ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "認証が必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role, display_name")
      .eq("id", userData.user.id).single();
    if (!profile || profile.role !== "staff") return json({ error: "権限がありません" }, 403);

    // ── 設定がまだなら、何が足りないかを返す ──
    const missing: string[] = [];
    if (!RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!MAIL_FROM) missing.push("ORDER_MAIL_FROM");
    if (missing.length) {
      return json({ error: `メール送信の設定がまだです（${missing.join("・")} が未登録）` }, 400);
    }

    const { order, pdfUrl } = await req.json();
    if (!order?.no) return json({ error: "発注の内容がありません" }, 400);

    // ── 宛先は発注先マスタから引く（画面から差し替えられないように） ──
    const { data: sup } = await admin.from("suppliers")
      .select("id, name, contact, email, order_channels")
      .eq("name", order.suppliers).maybeSingle();
    if (!sup) return json({ error: "発注先が見つかりません" }, 400);
    if (!sup.email) return json({ error: `${sup.name}にメールアドレスが登録されていません` }, 400);
    const channels: string[] = Array.isArray(sup.order_channels) && sup.order_channels.length
      ? sup.order_channels : ["chat"];
    if (!channels.includes("email")) {
      return json({ error: `${sup.name}は発注書の送付先にメールが選ばれていません` }, 400);
    }

    // ── 発注書PDFを取ってきて添付する ──
    let attachments: Array<Record<string, string>> = [];
    if (pdfUrl) {
      try {
        const res = await fetch(pdfUrl);
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer());
          attachments = [{ filename: `発注書_${order.no}.pdf`, content: toBase64(buf) }];
        }
      } catch (_) { /* PDFが取れなくても本文だけは送る */ }
    }

    const subject = `【発注書】${order.no}　${order.project || ""}　${COMPANY.name}`;

    // ── Resendへ送る ──
    const payload: Record<string, unknown> = {
      from: MAIL_FROM,
      to: [sup.email],
      subject,
      text: buildText(order, sup, profile.display_name || ""),
      html: buildHtml(order, sup, profile.display_name || ""),
    };
    if (MAIL_BCC) payload.bcc = [MAIL_BCC];
    if (MAIL_REPLY_TO) payload.reply_to = [MAIL_REPLY_TO];
    if (attachments.length) payload.attachments = attachments;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ error: `メールを送れませんでした：${(body as any)?.message || r.status}` }, 502);
    }

    return json({ ok: true, id: (body as any)?.id || "", to: sup.email, attached: attachments.length > 0 });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

// 本文に入れる品目（多いときは先頭だけ出して「ほか◯品目」とする）
function itemLines(order: any, max = 10): string[] {
  const items = Array.isArray(order.items) ? order.items : [];
  const head = items.slice(0, max).map((i: any) =>
    `・${i.name}　${i.qty}${i.unit || ""}　¥${fmt((i.price || 0) * (i.qty || 0))}`);
  if (items.length > max) head.push(`・ほか${items.length - max}品目（詳細は添付の発注書をご覧ください）`);
  return head;
}

function buildText(order: any, sup: any, staffName: string): string {
  return [
    `${sup.name} 御中`,
    sup.contact ? `${sup.contact} 様` : "",
    "",
    "いつもお世話になっております。",
    `${COMPANY.name}${staffName ? "の" + staffName : ""}です。`,
    "",
    "下記のとおり発注いたします。詳しくは添付の発注書をご確認ください。",
    "",
    `発注番号：${order.no}`,
    `発注日　：${ymd(order.date)}`,
    order.dueDate ? `納品希望：${ymd(order.dueDate)}` : "",
    `現　場　：${order.project || ""}`,
    `合　計　：¥${fmt(order.total)}（税込）`,
    "",
    "【品目】",
    ...itemLines(order),
    "",
    `納品場所：${order.project || ""} 現場`,
    "ご納品の際は現場担当者へご連絡ください。",
    "",
    "──────────",
    COMPANY.name,
    `${COMPANY.zip} ${COMPANY.address}`,
    `TEL ${COMPANY.tel}`,
    COMPANY.url,
  ].filter((l) => l !== "").join("\n");
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(order: any, sup: any, staffName: string): string {
  const rows = itemLines(order).map((l) => `<div>${esc(l)}</div>`).join("");
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.9;color:#333">
  <div>${esc(sup.name)} 御中</div>
  ${sup.contact ? `<div>${esc(sup.contact)} 様</div>` : ""}
  <p>いつもお世話になっております。<br>${esc(COMPANY.name)}${staffName ? "の" + esc(staffName) : ""}です。</p>
  <p>下記のとおり発注いたします。詳しくは添付の発注書をご確認ください。</p>
  <table cellpadding="4" style="border-collapse:collapse;font-size:14px">
    <tr><td style="color:#777">発注番号</td><td><b>${esc(order.no)}</b></td></tr>
    <tr><td style="color:#777">発注日</td><td>${esc(ymd(order.date))}</td></tr>
    ${order.dueDate ? `<tr><td style="color:#777">納品希望</td><td>${esc(ymd(order.dueDate))}</td></tr>` : ""}
    <tr><td style="color:#777">現場</td><td>${esc(order.project || "")}</td></tr>
    <tr><td style="color:#777">合計</td><td><b>¥${fmt(order.total)}</b>（税込）</td></tr>
  </table>
  <p style="margin-bottom:4px"><b>品目</b></p>
  ${rows}
  <p>納品場所：${esc(order.project || "")} 現場<br>ご納品の際は現場担当者へご連絡ください。</p>
  <hr style="border:none;border-top:1px solid #ddd">
  <div style="font-size:12px;color:#777">
    ${esc(COMPANY.name)}<br>
    ${esc(COMPANY.zip)} ${esc(COMPANY.address)}<br>
    TEL ${esc(COMPANY.tel)}　${esc(COMPANY.url)}
  </div>
</div>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
