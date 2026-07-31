// 運転免許証・自動車保険証券の読み取り用Edge Function。
//
// 撮影した画像をClaudeに渡し、必要な項目だけを取り出してJSONで返す。
// kind: 'license'（免許証）／'insurance'（自動車保険証券）
//
// ※ 画像はここでは保存しない（保存はアプリ側から license-files バケットへ）。

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT_LICENSE = `この画像は日本の運転免許証です。次の項目だけを読み取ってJSONで返してください。
{"licenseNo":"免許証番号（数字12桁。ハイフンや空白は除く）","expire":"有効期限（YYYY-MM-DD）","name":"氏名"}
- 有効期限は「令和○年○月○日まで有効」の表記を西暦に変換してください（令和1年＝2019年、平成1年＝1989年）
- 読み取れない項目は空文字 "" にしてください（推測して埋めないこと）
- JSONのみ返してください（説明文は不要）`;

const PROMPT_INSURANCE = `この画像は日本の自動車保険の保険証券（または契約内容のお知らせ）です。
次の項目だけを読み取ってJSONで返してください。
{"insurer":"保険会社名","liabilityPerson":"対人賠償の保険金額","liabilityObject":"対物賠償の保険金額","expire":"保険期間の満了日（YYYY-MM-DD）"}
- 対人賠償・対物賠償は証券の表記のまま返してください（例：「無制限」「3,000万円」「1億円」）
- 保険期間が「2025年10月1日 午後4時から2026年10月1日 午後4時まで」のように書かれている場合、満了日は終了側の日付です
- 読み取れない項目は空文字 "" にしてください（推測して埋めないこと）
- JSONのみ返してください（説明文は不要）`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image, mediaType, kind } = await req.json();
    if (!image) return json({ error: "画像データがありません" }, 400);

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const message = await client.messages.create({
      // 免許証番号や金額を間違えないよう、読み取り精度の高いモデルを使う
      model: "claude-sonnet-5",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: kind === "insurance" ? PROMPT_INSURANCE : PROMPT_LICENSE },
        ],
      }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    const m = text.match(/\{[\s\S]*\}/);
    let result: Record<string, string> = {};
    if (m) { try { result = JSON.parse(m[0]); } catch (_) { result = {}; } }

    // 免許証番号は数字だけに整える
    if (typeof result.licenseNo === "string") result.licenseNo = result.licenseNo.replace(/[^0-9]/g, "");
    // 日付が YYYY/MM/DD などで返っても YYYY-MM-DD に整える
    for (const k of ["expire"]) {
      const v = result[k];
      if (typeof v === "string") {
        const d = v.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
        result[k] = d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "";
      }
    }

    return json({ result });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
