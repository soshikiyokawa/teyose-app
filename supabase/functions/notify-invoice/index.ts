// 請求書が登録されたことを、きよかわの管理者にメールで知らせるEdge Function。
//
// 受発注の「請求書」で登録（発注先が送る／社内が代わりに登録する）と、その直後に呼ばれる。
// スマホの通知は消してしまうと読み返せないので、メールでも必ず残るようにしている。
// アプリ内の通知（プッシュ・通知履歴）はこれまでどおり send-push が受け持つ。
//
// 送り先：
//   Secrets の INVOICE_MAIL_TO（カンマ区切り）があればそこへ。
//   無ければ、管理者（profiles.role = 'staff'）のアカウントのメールアドレス全員へ。
//   いずれも、登録した本人には送らない（自分の操作の通知は要らないため）。
//
// 認証：呼び出し元のJWTを検証し、ログインしている人のみ。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAIL_FROM = Deno.env.get("INVITE_MAIL_FROM") || Deno.env.get("ORDER_MAIL_FROM") || "";
const MAIL_TO = Deno.env.get("INVOICE_MAIL_TO") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://soshikiyokawa.github.io/teyose-app/";
const COMPANY = "株式会社きよかわ";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (s: string) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const yen = (n: number | null) => (n == null ? "—" : "¥" + Math.round(n).toLocaleString("ja-JP"));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "ログインが必要です" }, 401);

    const { invoiceId } = await req.json();
    if (!invoiceId) return json({ error: "請求書が指定されていません" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: inv, error: invErr } = await admin.from("invoices")
      .select("id, supplier_name, month, amount, note, created_at, uploaded_by, due_on")
      .eq("id", invoiceId).single();
    if (invErr || !inv) return json({ error: "請求書が見つかりません" }, 404);

    if (!RESEND_API_KEY || !MAIL_FROM) {
      return json({ ok: true, mailed: 0, note: "メールの設定（RESEND_API_KEY / INVITE_MAIL_FROM）がありません" });
    }

    // ── 送り先を決める ──
    const me = String(userData.user.email || "").toLowerCase();
    let to: string[];
    if (MAIL_TO) {
      to = MAIL_TO.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const { data: staff } = await admin.from("profiles").select("id").eq("role", "staff");
      const want = new Set((staff || []).map((p: any) => p.id));
      to = (await allUsers(admin)).filter((u) => want.has(u.id)).map((u) => String(u.email || "")).filter(Boolean);
    }
    to = [...new Set(to.filter((a) => a.toLowerCase() !== me))];
    if (!to.length) return json({ ok: true, mailed: 0, note: "送り先がありません" });

    const [y, m] = String(inv.month || "").split("-");
    const monthLabel = y && m ? `${y}年${m}月` : String(inv.month || "");
    const who = String(inv.uploaded_by || "").trim();
    const subject = `【${COMPANY}】請求書が登録されました：${inv.supplier_name}　${monthLabel}`;
    const rows: [string, string][] = [
      ["発注先", String(inv.supplier_name || "")],
      ["請求月", monthLabel],
      ["請求額", yen(inv.amount == null ? null : Number(inv.amount))],
      ["支払期限", String(inv.due_on || "") || "—"],
      ["登録した人", who || "—"],
      ["メモ", String(inv.note || "") || "—"],
    ];
    const html = `<div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;font-size:14px;line-height:1.9;color:#16161a">
  <p>請求書が登録されました。</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:4px 14px 4px 0;color:#5a5a63;white-space:nowrap">${esc(k)}</td>
      <td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("")}
  </table>
  <p style="margin:20px 0">
    <a href="${APP_URL}" style="display:inline-block;background:#415e2e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:700">手寄をひらく</a>
  </p>
  <p style="font-size:13px;color:#5a5a63">受発注 → 請求書 から、中身の確認と支払予定の登録ができます。</p>
</div>`;
    const text = `請求書が登録されました。\n\n`
      + rows.map(([k, v]) => `${k}：${v}`).join("\n")
      + `\n\n手寄をひらく：${APP_URL}\n受発注 → 請求書 から、中身の確認と支払予定の登録ができます。\n`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to, subject, html, text }),
    });
    if (!r.ok) return json({ error: `${r.status} ${(await r.text()).slice(0, 200)}` }, 502);
    return json({ ok: true, mailed: to.length });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

// アカウント一覧（メールアドレスを引くため）
async function allUsers(admin: any) {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    out.push(...(data?.users || []));
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
