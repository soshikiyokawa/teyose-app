// レシート・購入明細（写真・スクリーンショット・PDF）を読み取って品目に起こすEdge Function。
//
// ネットショップの明細はPDFやスクリーンショットのことが多いので、画像とPDFの両方を受ける。
// 読み取り結果は「道具（tool）」の形で受け取る。文章からJSONを探す方式だと、
// 説明文が付いたり途中で切れたりして失敗することがあったため（read-quote と同じ作り）。
// 読めなかったときは理由（reason）を返し、画面で何が起きたか分かるようにする。

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `これはレシート・購入明細（ネットショップの注文明細を含む）です。
品目の行をすべて読み取って、save_receipt_items の道具で返してください。

読み取り方:
- 金額は必ず税込を使う（税抜・税込が両方あるときは税込）
- 送料・手数料・代引き手数料なども1つの品目として含める
- 単価が書かれていなければ 金額÷数量 で計算する
- 数量・単位が読めないときは qty:1, unit:"式"
- 小計・消費税・合計・ポイント・値引きの行は含めない
- 読めない金額は推測せず、その品目の price と amount を省く`;

const TOOL = {
  name: "save_receipt_items",
  description: "レシートから読み取った品目を保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      shop: { type: "string", description: "店名・ショップ名。分からなければ空文字" },
      items: {
        type: "array",
        description: "品目の行",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "品目名" },
            qty: { type: "number", description: "数量" },
            unit: { type: "string", description: "単位" },
            price: { type: "number", description: "単価（税込）" },
            amount: { type: "number", description: "金額（税込）" },
          },
          required: ["name"],
        },
      },
    },
    required: ["items"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    // image は昔の呼び方。file でも受ける
    const file = body.file || body.image;
    const { mediaType, fileName } = body;
    if (!file) return json({ error: "ファイルがありません" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 500);
    const client = new Anthropic({ apiKey: key });

    // スマホから選ぶと種類が空のことがあるので、ファイル名でも判断する
    const mt = String(mediaType || "");
    const isPdf = mt.includes("pdf") || /\.pdf$/i.test(String(fileName || "")) ||
      (!mt.startsWith("image/") && String(file).startsWith("JVBER"));   // PDFの先頭は %PDF
    const imageType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "save_receipt_items" },
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
      return json({
        items: [],
        reason: message.stop_reason === "max_tokens"
          ? "品目が多すぎて途中で切れました。分けて読み込んでください"
          : (said || "品目の表を見つけられませんでした"),
      });
    }

    const num = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const items = ((use.input?.items) || [])
      .map((it: any) => {
        const qty = num(it.qty) ?? 1;
        const amount = num(it.amount);
        const price = num(it.price) ?? (amount !== null && qty ? Math.round(amount / qty) : null);
        return {
          name: String(it.name || "").trim(),
          qty,
          unit: String(it.unit || "式").trim() || "式",
          price: price ?? 0,
          amount: amount ?? (price !== null ? Math.round(price * qty) : 0),
        };
      })
      .filter((it: any) => it.name);

    return json({
      shop: String(use.input?.shop || "").trim(),
      items,
      reason: message.stop_reason === "max_tokens"
        ? "品目が多く、途中までしか読み取れていない可能性があります" : "",
      kind: isPdf ? "pdf" : "image",
    });
  } catch (err) {
    // Anthropic からのエラーはそのままでは分かりにくいので、よくあるものを日本語にする
    const raw = String((err as any)?.message || err);
    let msg = raw;
    if (/authentication_error|API key is invalid|401/.test(raw)) {
      msg = "ANTHROPIC_API_KEY が無効です。Supabase の Edge Functions の設定でキーを入れ直してください";
    } else if (/rate_limit|429/.test(raw)) {
      msg = "読み取りの利用が混み合っています。少し待ってからもう一度お試しください";
    } else if (/credit balance|billing/.test(raw)) {
      msg = "Anthropic の残高が不足しています。請求設定をご確認ください";
    } else if (/too large|request_too_large|413/.test(raw)) {
      msg = "ファイルが大きすぎます。写真を撮り直すか、PDFのページを分けてください";
    }
    return json({ error: msg, detail: raw.slice(0, 300) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
