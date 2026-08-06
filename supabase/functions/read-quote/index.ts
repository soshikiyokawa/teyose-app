// 業者からの見積（PDF・写真）を読み取って、明細の行に起こすEdge Function。
//
// 読み取るのは「工種・品目・規格・数量・単位・単価」。
// 業者の見積の単価は、こちらにとっては原価になるので、そのまま原価の候補として返す。
// 合計・小計・消費税の行は入れない。
//
// 読み取り結果は「道具（tool）」の形で受け取る。文章の中からJSONを探す方式だと、
// 説明文が付いたり途中で切れたりして失敗することがあったため。
// 読めなかったときは理由（reason）を返して、画面で何が起きたか分かるようにする。

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `これは建築工事の見積書です。明細の行をすべて読み取って、save_quote_items の道具で返してください。

読み取り方:
- 金額の列が2つある表（原価と売価、仕入と見積など）は、
  cost に「原価・仕入」側、price に「売価・見積」側を入れる。列が1つなら cost だけ入れる
- 単価(cost)は「税抜」を使う。税抜が無ければ税込のままでよい
- 金額(amount)は数量×単価。書かれていなければ計算する
- 工種(section)は見積書の見出し・分類をそのまま使う。分類が無ければ空文字
- 規格(spec)はサイズ・品番・仕様など。無ければ空文字
- 数量・単位が読めないときは qty:1, unit:"式"
- 小計・合計・消費税・値引き・諸経費の合計行は含めない（諸経費が明細の1行なら含める）
- 手書きや不鮮明で読めない金額は cost を省く（0や推測値を入れない）
- 表が何ページにも分かれている場合は、全ページ分をまとめて返す`;

const TOOL = {
  name: "save_quote_items",
  description: "見積書から読み取った明細を保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      supplier: { type: "string", description: "見積を出した会社名。分からなければ空文字" },
      total: { type: "number", description: "見積書の合計金額（税抜）。分からなければ省く" },
      items: {
        type: "array",
        description: "明細の行",
        items: {
          type: "object",
          properties: {
            section: { type: "string", description: "工種・分類名" },
            name: { type: "string", description: "品目名" },
            spec: { type: "string", description: "規格・仕様" },
            qty: { type: "number", description: "数量" },
            unit: { type: "string", description: "単位" },
            cost: { type: "number", description: "原価・仕入の単価（税抜）。読めなければ省く" },
            price: { type: "number", description: "売価・見積の単価。売価の列が無ければ省く" },
            amount: { type: "number", description: "金額" },
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
    const { file, mediaType, fileName } = await req.json();
    if (!file) return json({ error: "ファイルがありません" }, 400);

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    // スマホから選ぶと種類が空のことがあるので、ファイル名でも判断する
    const mt = String(mediaType || "");
    const isPdf = mt.includes("pdf") || /\.pdf$/i.test(String(fileName || "")) ||
      (!mt.startsWith("image/") && String(file).startsWith("JVBER"));   // PDFの先頭は %PDF
    const imageType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";

    // 原価明細のように300行近い表でも切れないよう、多めに受け取る。
    // 長い返答は時間がかかるため、ストリーミングで受け取って最後にまとめる
    const message = await client.messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 32000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "save_quote_items" },
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file } }
            : { type: "image", source: { type: "base64", media_type: imageType, data: file } },
          { type: "text", text: PROMPT },
        ],
      }],
    }).finalMessage();

    const use: any = message.content.find((c: any) => c.type === "tool_use");
    if (!use) {
      // 道具を使わずに文章を返してきた場合（読めなかった／断られた）
      const said = message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").slice(0, 300);
      return json({
        items: [], reason: message.stop_reason === "max_tokens"
          ? "明細が多すぎて途中で切れました。ページを分けて読み込んでください"
          : (said || "明細の表を見つけられませんでした"),
        stopReason: message.stop_reason,
      });
    }

    const num = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    const items = ((use.input?.items) || [])
      .map((it: any) => ({
        section: String(it.section || "").trim(),
        name: String(it.name || "").trim(),
        spec: String(it.spec || "").trim(),
        qty: num(it.qty) ?? 1,
        unit: String(it.unit || "式").trim() || "式",
        cost: num(it.cost),
        price: num(it.price),
        amount: num(it.amount),
      }))
      .filter((it: any) => it.name);

    return json({
      supplier: String(use.input?.supplier || "").trim(),
      total: num(use.input?.total),
      items,
      // 途中で切れた場合は画面で知らせる（読めた分は使える）
      reason: message.stop_reason === "max_tokens"
        ? "明細が多く、途中までしか読み取れていない可能性があります。ページを分けて読み込むと確実です" : "",
      stopReason: message.stop_reason,
      kind: isPdf ? "pdf" : "image",
    });
  } catch (err) {
    const msg = String((err as any)?.message || err);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
