// 業者からの見積（PDF・写真）を読み取って、明細の行に起こすEdge Function。
//
// 読み取るのは「工種・品目・規格・数量・単位・単価」。
// 業者の見積の単価は、こちらにとっては原価になるので、そのまま原価の候補として返す。
// 合計・小計・消費税の行は入れない。
//
// PDFはそのまま渡せる（document）。写真の場合は画像として渡す。

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `これは建築工事の見積書です。明細の行を読み取ってJSONで返してください。

形式:
{"supplier":"見積を出した会社名","total":見積の合計金額(税抜。分からなければnull),
 "items":[{"section":"工種・分類名","name":"品目名","spec":"規格・仕様","qty":数量,"unit":"単位","cost":単価,"amount":金額}]}

決まりごと:
- 単価(cost)は「税抜」を使う。税込しか無い場合は税込のままでよい
- 金額(amount)は数量×単価。書かれていなければ計算する
- 工種(section)は見積書の見出し・分類をそのまま使う。分類が無ければ ""
- 規格(spec)はサイズ・品番・仕様など。無ければ ""
- 数量・単位が読めないときは qty:1, unit:"式"
- 小計・合計・消費税・値引きの行は含めない
- 手書きや不鮮明で読めない値は null にする（推測で埋めない）
- JSONのみ返す（説明文は不要）`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file, mediaType } = await req.json();
    if (!file) return json({ error: "ファイルがありません" }, 400);

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
    const isPdf = String(mediaType || "").includes("pdf");

    const message = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file } }
            : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: file } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const m = text.match(/\{[\s\S]*\}/);
    let out: any = { items: [] };
    if (m) { try { out = JSON.parse(m[0]); } catch (_) { out = { items: [] }; } }

    // 数値になっていないものを整える。読めなかった項目はそのまま null で返す
    const num = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const items = (out.items || [])
      .map((it: any) => ({
        section: String(it.section || "").trim(),
        name: String(it.name || "").trim(),
        spec: String(it.spec || "").trim(),
        qty: num(it.qty) ?? 1,
        unit: String(it.unit || "式").trim() || "式",
        cost: num(it.cost),
        amount: num(it.amount),
      }))
      .filter((it: any) => it.name);

    return json({ supplier: String(out.supplier || "").trim(), total: num(out.total), items });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
