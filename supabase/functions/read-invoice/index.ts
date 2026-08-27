// 届いた請求書（PDF・写真）を読み取って、請求額などを取り出すEdge Function。
//
// 発注先が金額を入れ忘れても合計が出るように、また登録番号（インボイス）の
// 確認ができるようにするためのもの。読み取るのは要点だけで、明細の行は読まない
// （原価は発注のときに登録済みのため）。
//
// 呼び出し方は他と違い、ファイルの中身ではなく「保管場所の場所（filePath）」を受ける。
// 請求書はすでに invoices バケットに入っているので、そこから読み出したほうが
// 大きなファイルを送り直さずに済む。
//
// 読み取り結果は「道具（tool）」の形で受け取る（read-receipt と同じ作り）。

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `これは取引先から届いた請求書です。要点だけを save_invoice の道具で返してください。

読み取り方:
- total は「ご請求金額」「合計」など、実際に支払う税込の総額（1つだけ）
- subtotal は税抜の小計、tax は消費税額。書かれていなければ省く
- regNo は適格請求書発行事業者の登録番号。「T」＋数字13桁の形。
  「登録番号」「インボイス番号」などの見出しの近くにある。無ければ空文字
- month は請求の対象月。「2026年8月分」「8月度」などから 2026-08 の形にする。
  年が書かれていなければ、請求日の年を使う。分からなければ空文字
- issuer は請求書を出した会社名（自社ではなく相手先）
- dueOn は支払期限の日付（2026-09-30 の形）。無ければ空文字
- 金額は書かれている数字をそのまま使い、計算し直さない
- 読めないものは推測せず省く`;

const TOOL = {
  name: "save_invoice",
  description: "請求書から読み取った要点を保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      total: { type: "number", description: "請求金額（税込の総額）" },
      subtotal: { type: "number", description: "税抜の小計" },
      tax: { type: "number", description: "消費税額" },
      regNo: { type: "string", description: "登録番号（T＋数字13桁）。無ければ空文字" },
      month: { type: "string", description: "請求の対象月（YYYY-MM）。無ければ空文字" },
      issuer: { type: "string", description: "請求書を出した会社名" },
      dueOn: { type: "string", description: "支払期限（YYYY-MM-DD）。無ければ空文字" },
    },
    required: ["total"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 呼び出し元が、ログイン済みの社員であることを確認する ──
    // verify_jwt だけでは足りない。公開されている接続キーも正しいJWTなので通ってしまい、
    // 誰でもAI利用料を使えてしまうため。
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role")
      .eq("id", userData.user.id).single();
    if (!profile || (profile.role !== "staff" && profile.role !== "carpenter")) {
      return json({ error: "この機能を使えるのは社員だけです" }, 403);
    }

    const { filePath } = await req.json();
    if (!filePath || typeof filePath !== "string") return json({ error: "請求書が指定されていません" }, 400);

    // 保管場所から読み出す（社員は全社分を見られるので、そのまま取り出してよい）
    const { data: blob, error: dlErr } = await admin.storage.from("invoices").download(filePath);
    if (dlErr || !blob) return json({ error: "請求書を読み出せませんでした：" + (dlErr?.message || "") }, 404);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!bytes.length) return json({ error: "この請求書は中身が空です" }, 400);
    if (bytes.length > 20 * 1024 * 1024) {
      return json({ error: "ファイルが大きすぎて読み取れません（20MBまで）" }, 400);
    }
    const file = base64(bytes);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 500);
    const client = new Anthropic({ apiKey: key });

    // 種類は保管時のものを使い、分からなければファイル名と中身の先頭で判断する
    const mt = String(blob.type || "");
    const isPdf = mt.includes("pdf") || /\.pdf$/i.test(filePath) ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);   // %PDF
    const imageType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "save_invoice" },
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file } }
            : { type: "image", source: { type: "base64", media_type: imageType, data: file } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const use: any = message.content.find((c: any) => c.type === "tool_use");
    if (!use) {
      const said = message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").slice(0, 300);
      return json({ error: said || "請求金額を見つけられませんでした" }, 200);
    }

    const num = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const regNo = String(use.input?.regNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const month = String(use.input?.month || "").trim();
    const dueOn = String(use.input?.dueOn || "").trim();

    return json({
      total: num(use.input?.total),
      subtotal: num(use.input?.subtotal),
      tax: num(use.input?.tax),
      regNo: /^T\d{13}$/.test(regNo) ? regNo : "",
      month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
      dueOn: /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn : "",
      issuer: String(use.input?.issuer || "").trim(),
      kind: isPdf ? "pdf" : "image",
    });
  } catch (err) {
    const raw = String((err as any)?.message || err);
    let msg = raw;
    if (/authentication_error|API key is invalid|401/.test(raw)) {
      msg = "ANTHROPIC_API_KEY が無効です。Supabase の Edge Functions の設定でキーを入れ直してください";
    } else if (/rate_limit|429/.test(raw)) {
      msg = "読み取りの利用が混み合っています。少し待ってからもう一度お試しください";
    } else if (/credit balance|billing/.test(raw)) {
      msg = "Anthropic の残高が不足しています。請求設定をご確認ください";
    } else if (/too large|request_too_large|413/.test(raw)) {
      msg = "ファイルが大きすぎます。ページを分けてお試しください";
    }
    return json({ error: msg, detail: raw.slice(0, 300) }, 500);
  }
});

// 大きなファイルでも積み上がらないよう、少しずつ変換する
function base64(bytes: Uint8Array): string {
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
