// 日報で集まった写真を「Instagramに載せるのに向いているか」で採点するEdge Function。
//
// 写真そのものはすでに site-files（公開バケット）にあるので、URLから読み出して見せる。
// 点数と一言コメントを nippo_photos に書き戻す。
//
// 書き戻しはサービスロールで行う。誰の写真でも社員なら採点を頼めるが、
// 写真の追加・削除は日報を直せる人だけ、という決まりは変えないため。
//
// 一度に頼めるのは12枚まで。多いときは画面側で分けて呼ぶ。

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_AT_ONCE = 12;

// ════ 採点の基準 ════
//
// 画面の「採点基準」もここを取りに来る（criteria:true で呼ぶ）。
// AIに渡す指示文もここから組み立てるので、見せている基準と実際の採点が食い違わない。
const CRITERIA = {
  intro: "工務店（新築・リフォームの木工事）の職人が現場で撮った写真を、"
       + "会社のInstagramに載せる写真としてどのくらい向いているかで採点します。"
       + "まず「何が写っているか」で基準の点を置き、そこから「写真としての出来」で上下させます。",

  // ① 何が写っているか。ここがいちばん効く
  subjects: [
    { stars: 5, base: 85, title: "大工＋手元＋木",       reason: "きよかわらしさが最も出る" },
    { stars: 5, base: 85, title: "若手に教えている瞬間", reason: "技術継承という会社の物語になる" },
    { stars: 5, base: 85, title: "完成後に隠れる仕事",   reason: "一般のお客さまが見る機会がない" },
    { stars: 4, base: 75, title: "木組み・納まりのアップ", reason: "技術力が伝わる" },
    { stars: 4, base: 75, title: "上棟中の大工",         reason: "動きと迫力がある" },
    { stars: 4, base: 75, title: "加工中の手・道具",     reason: "写真として強い" },
    { stars: 4, base: 75, title: "整理された現場",       reason: "仕事への姿勢が伝わる" },
    { stars: 3, base: 62, title: "材料・木材",           reason: "素材の話につなげやすい" },
    { stars: 3, base: 62, title: "建築途中の空間",       reason: "設計の説明に使える" },
    { stars: 2, base: 50, title: "現場全景",             reason: "記録感が強くなりやすい" },
  ],
  subjectOther: { base: 45, label: "上のどれにも当てはまらないもの" },

  // ② 写真としての出来。基準の点から上下させる幅
  quality: {
    swing: 15,
    points: [
      { title: "主役がはっきりしているか", detail: "何の写真か一目で分かること" },
      { title: "明るさ",                   detail: "暗すぎ・白飛び・逆光で見えなくなっていないこと" },
      { title: "構図",                     detail: "水平・垂直が取れていて、余計なものが写り込んでいないこと" },
    ],
  },

  // ③ これが写っていたら、何が写っていても29点以下
  gate: {
    title: "載せてはいけないものが写っていないか",
    items: [
      "人の顔がはっきり写っている",
      "表札・車のナンバー・図面などの個人情報",
      "散らかった様子",
      "安全上まずい状態",
    ],
  },

  bands: [
    { from: 85, to: 100, label: "そのまま載せられる。人に見てもらう価値がある" },
    { from: 70, to: 84,  label: "少し切り取れば載せられる" },
    { from: 50, to: 69,  label: "記録としては十分だが、載せるには弱い" },
    { from: 30, to: 49,  label: "載せるには向かない" },
    { from: 0,  to: 29,  label: "手ぶれ・真っ暗など写真として成立していない／載せてはいけないものが写っている" },
  ],
  notes: [
    "点数はまず「何が写っているか」で決まります。腕のいい全景より、ふつうの手元のほうが高く出ます。",
    "一言コメントの頭に、どの写真と見たかを書かせています。見立てが違っていたら教えてください。",
    "載せてはいけないものが写っている場合は、必ずそれを書かせています。",
    "採点するのはAIです。載せるかどうかは最後は人が決めてください。",
  ],
};

function buildPrompt(): string {
  const subs = CRITERIA.subjects
    .map((s) => `- ${s.title}（${s.reason}）… ${s.base}点あたり`).join("\n");
  const qual = CRITERIA.quality.points.map((p, i) => `${i + 1}. ${p.title}。${p.detail}`).join("\n");
  const bands = CRITERIA.bands.map((b) => `- ${b.from}〜${b.to} … ${b.label}`).join("\n");
  return `これは工務店（新築・リフォームの木工事）の職人が現場で撮った写真です。
この会社のInstagramに載せる写真としてどのくらい向いているかを、100点満点で採点してください。

【手順1】何が写っているかを見て、基準の点を置く。ここがいちばん効きます。
${subs}
- ${CRITERIA.subjectOther.label} … ${CRITERIA.subjectOther.base}点あたり
※ 当てはまるものが複数あれば、いちばん高いものを取る。
※ 腕のいい全景より、ふつうに撮れた手元のほうを高くすること。

【手順2】写真としての出来で、手順1の点を最大±${CRITERIA.quality.swing}点まで動かす。
${qual}

【手順3】次のものが写っていたら、何が写っていても29点以下にする。
${CRITERIA.gate.items.map((i) => "- " + i).join("\n")}

点数の目安:
${bands}

comment は日本語30字以内。頭に「どの写真と見たか」を短く書き、そのあとに
よければ何がよいか、惜しければ何を直せばよいかを書く。
例：「木組みのアップ。水平が少し傾いている」
「良い写真です」のような当たり障りのない言い方はしない。
手順3のものが写っている場合は、必ずそれを書く。`;
}

const PROMPT = buildPrompt();

const TOOL = {
  name: "save_score",
  description: "写真の採点を保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      score: { type: "integer", description: "0〜100の点数" },
      comment: { type: "string", description: "その点数にした理由。日本語30字以内" },
    },
    required: ["score", "comment"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // 呼び出し元が、ログイン済みの社員であることを確認する
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

    // 画面の「採点基準」からの問い合わせ。AIには聞かず、基準をそのまま返す
    if (body?.criteria === true) return json({ criteria: CRITERIA });

    const ids: number[] = Array.isArray(body?.photoIds)
      ? body.photoIds.map((n: unknown) => Number(n)).filter(Number.isFinite).slice(0, MAX_AT_ONCE)
      : [];
    if (!ids.length) return json({ error: "採点する写真が指定されていません" }, 400);

    const { data: rows, error: rowErr } = await admin.from("nippo_photos")
      .select("id, url").in("id", ids);
    if (rowErr) return json({ error: "写真を読み出せませんでした：" + rowErr.message }, 500);
    if (!rows?.length) return json({ error: "指定された写真が見つかりません" }, 404);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 500);
    const client = new Anthropic({ apiKey: key });

    const results: { id: number; score?: number; comment?: string; error?: string }[] = [];

    for (const row of rows) {
      try {
        const res = await fetch(row.url);
        if (!res.ok) throw new Error("写真を読み出せませんでした（" + res.status + "）");
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!bytes.length) throw new Error("写真の中身が空です");
        if (bytes.length > 5 * 1024 * 1024) throw new Error("写真が大きすぎます");

        const message = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          tools: [TOOL],
          tool_choice: { type: "tool", name: "save_score" },
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType(res, bytes), data: base64(bytes) } },
              { type: "text", text: PROMPT },
            ],
          }],
        });

        const use: any = message.content.find((c: any) => c.type === "tool_use");
        if (!use) throw new Error("採点できませんでした");
        const score = Math.max(0, Math.min(100, Math.round(Number(use.input?.score))));
        if (!Number.isFinite(score)) throw new Error("点数を読み取れませんでした");
        const comment = String(use.input?.comment || "").trim().replace(/\s+/g, " ").slice(0, 120);

        const { error: upErr } = await admin.from("nippo_photos")
          .update({ ig_score: score, ig_comment: comment, ig_scored_at: new Date().toISOString() })
          .eq("id", row.id);
        if (upErr) throw new Error("点数の保存に失敗しました：" + upErr.message);

        results.push({ id: row.id, score, comment });
      } catch (e) {
        results.push({ id: row.id, error: String((e as any)?.message || e).slice(0, 200) });
      }
    }

    return json({ results });
  } catch (err) {
    const raw = String((err as any)?.message || err);
    let msg = raw;
    if (/authentication_error|API key is invalid|401/.test(raw)) {
      msg = "ANTHROPIC_API_KEY が無効です。Supabase の Edge Functions の設定でキーを入れ直してください";
    } else if (/rate_limit|429/.test(raw)) {
      msg = "採点の利用が混み合っています。少し待ってからもう一度お試しください";
    } else if (/credit balance|billing/.test(raw)) {
      msg = "Anthropic の残高が不足しています。請求設定をご確認ください";
    }
    return json({ error: msg, detail: raw.slice(0, 300) }, 500);
  }
});

// 種類は応答のヘッダーから。分からなければ中身の先頭で見分ける
function mediaType(res: Response, bytes: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (ct === "image/png" || ct === "image/gif" || ct === "image/webp" || ct === "image/jpeg") return ct;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/jpeg";
}

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
