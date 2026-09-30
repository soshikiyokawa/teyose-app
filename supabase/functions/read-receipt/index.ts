// レシート・購入明細（写真・スクリーンショット・PDF）を読み取って品目に起こすEdge Function。
//
// ネットショップの明細はPDFやスクリーンショットのことが多いので、画像とPDFの両方を受ける。
// 読み取り結果は「道具（tool）」の形で受け取る。文章からJSONを探す方式だと、
// 説明文が付いたり途中で切れたりして失敗することがあったため（read-quote と同じ作り）。
// 読めなかったときは理由（reason）を返し、画面で何が起きたか分かるようにする。

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `これはレシート・購入明細（ネットショップの注文明細を含む）です。
品目の行をすべて読み取って、save_receipt_items の道具で返してください。

読み取り方:
- 単価・金額は、明細にそのまま書かれている数字を使う（税を足したり引いたりしない）
- そのうえで、明細の単価・金額が税込か税抜かを taxIncluded で必ず答える
  ・「合計」とは別に「消費税」の行がある → 明細は税抜（false）
  ・単価や金額に「(税込)」と書いてある、または合計＝明細の合計 → 税込（true）
  ・レシートに「※印は軽減税率」のような但し書きだけがある場合、日本のレシートは
    ふつう税込表示なので true
- 送料・手数料・代引き手数料なども1つの品目として含める
- 単価が書かれていなければ 金額÷数量 で計算する
- 数量・単位が読めないときは qty:1, unit:"式"
- 小計・消費税・合計・ポイント・値引きの行は含めない
- 読めない金額は推測せず、その品目の price と amount を省く

税率（taxRate）の見分け方（1品目ずつ必ず答える）:
- 10 … ふつうの品物・工具・材料・送料・手数料
- 8  … 軽減税率のもの。飲食料品（お茶・弁当・お菓子・飲み物など）と定期購読の新聞
       ・「※」「*」「軽」などの印が付いている行
       ・レシートの下に「※は軽減税率対象」と書いてあることが多い
       ・「8%対象 ¥○○」という小計があれば、その金額に合う行が8%
       ・お酒・外食・イートインは 10
- 0  … 消費税がかからないもの（非課税・不課税）
       切手・はがき・収入印紙・証紙、商品券・プリペイドカード・図書カード、
       保険料、行政や役所への手数料（登記・証明書など）、
       駐車場の料金のうち税がかからないもの、香典・お祝い金
       ・レシートに「非課税」「内税対象外」「不課税」と書いてある行
- 印や但し書きが無く判断できないときは 10
- 「8%対象」「10%対象」の小計がレシートにある場合は、各品目の税率の合計が
  それぞれの小計と合うかを確かめてから答える

レシートに印字されている合計も、そのまま写してください（ここがいちばん大事）:
- paidTotal … 最終的に支払った金額（「合計」「お買上げ計」「ご請求額」「お支払金額」など）
  ・値引き後・ポイント使用前の、税込の支払額
  ・クレジット払いなら、カードで切った金額
- taxTotals … 税率ごとの「対象額」と「消費税額」が印字されていれば、その数字をそのまま
  ・例：「10%対象 ¥19,800（内消費税 ¥1,800）」→ {rate:10, target:19800, tax:1800}
  ・target が税込か税抜かは targetTaxIncluded で答える（内税表示なら true）
  ・印字が無ければ taxTotals は空でよい（推測して埋めない）
- 数字が読めないときは、その項目を省く（推測しない）`;

const TOOL = {
  name: "save_receipt_items",
  description: "レシートから読み取った品目を保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      shop: { type: "string", description: "店名・ショップ名。分からなければ空文字" },
      taxIncluded: {
        type: "boolean",
        description: "明細の単価・金額が税込かどうか。消費税の行が別にあるなら false",
      },
      taxIncludedReason: {
        type: "string",
        description: "税込・税抜をそう判断した理由を、レシートのどこを見たかで一言（例：合計とは別に消費税の行があった）",
      },
      paidTotal: {
        type: "number",
        description: "レシートに印字された、最終的に支払った税込金額。読めなければ省く",
      },
      taxTotals: {
        type: "array",
        description: "税率ごとの対象額と消費税額。レシートに印字されているものだけ。無ければ空",
        items: {
          type: "object",
          properties: {
            rate: { type: "number", enum: [10, 8, 0], description: "税率" },
            target: { type: "number", description: "その税率の対象額（印字されたまま）" },
            tax: { type: "number", description: "その税率の消費税額（印字されたまま）" },
            targetTaxIncluded: { type: "boolean", description: "target が税込（内税）なら true" },
          },
          required: ["rate", "target"],
        },
      },
      items: {
        type: "array",
        description: "品目の行",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "品目名" },
            qty: { type: "number", description: "数量" },
            unit: { type: "string", description: "単位" },
            price: { type: "number", description: "単価。明細に書かれているまま" },
            amount: { type: "number", description: "金額。明細に書かれているまま" },
            taxRate: {
              type: "number",
              enum: [10, 8, 0],
              description: "この品目の消費税率。10＝ふつう／8＝軽減税率（飲食料品・新聞）／0＝非課税（切手・印紙・商品券など）",
            },
          },
          required: ["name", "taxRate"],
        },
      },
    },
    required: ["items", "taxIncluded"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── 呼び出し元が、ログイン済みの社員であることを確認する ──
    //
    // Supabase の verify_jwt だけでは足りない。公開されている接続キー（anon key）も
    // 正しいJWTなので通ってしまい、誰でもAI利用料を使えてしまう。
    // ここで本当に「人」がログインしているかを見る。
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
        // 税率は 10／8／0 のどれか。読めなかったものは、ふつうの 10 として扱う
        const rate = [10, 8, 0].includes(Number(it.taxRate)) ? Number(it.taxRate) : 10;
        return {
          name: String(it.name || "").trim(),
          qty,
          unit: String(it.unit || "式").trim() || "式",
          price: price ?? 0,
          amount: amount ?? (price !== null ? Math.round(price * qty) : 0),
          taxRate: rate,
        };
      })
      .filter((it: any) => it.name);

    return json({
      shop: String(use.input?.shop || "").trim(),
      // 読めなかったときは、日本のレシートで多い税込として扱う
      taxIncluded: use.input?.taxIncluded !== false,
      taxIncludedReason: String(use.input?.taxIncludedReason || "").trim(),
      // レシートに印字された支払額と、税率ごとの内訳。合わせ込みの「正」に使う
      paidTotal: num(use.input?.paidTotal),
      taxTotals: ((use.input?.taxTotals) || [])
        .map((t: any) => ({
          rate: [10, 8, 0].includes(Number(t?.rate)) ? Number(t.rate) : null,
          target: num(t?.target),
          tax: num(t?.tax),
          targetTaxIncluded: t?.targetTaxIncluded !== false,
        }))
        .filter((t: any) => t.rate !== null && t.target !== null),
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
