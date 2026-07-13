import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image, mediaType } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "画像データがありません" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType || "image/jpeg", data: image },
          },
          {
            type: "text",
            text: `このレシート・購入明細から品目を読み取ってJSON配列で返してください。
各要素の形式: {"name":"品目名","qty":数量,"unit":"単位","price":単価,"amount":合計金額}
- 必ず税込金額を使用してください（税抜・税込が両方ある場合も税込を優先）
- 送料・手数料なども品目として含める
- 単価が不明な場合はamount÷qtyで計算
- 数量・単位が不明なら qty:1, unit:"式"
- 合計行・税額行は含めない
- JSONのみ返してください（説明文不要）`,
          },
        ],
      }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    let items = [];
    if (jsonMatch) {
      try { items = JSON.parse(jsonMatch[0]); } catch (_) { items = []; }
    }

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
