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
       + "「何が写っているか（55点）」と「写真としての出来（45点）」を足して100点満点にします。"
       + "人が写っていることは減点ではありません。むしろ、職人が作業している姿は高く評価します。",

  // ① 何が写っているか。ここがいちばん効く
  subjects: [
    { stars: 5, base: 55, title: "職人が作業している姿", reason: "人が働く姿がいちばん伝わる。顔が写っていてもよい" },
    { stars: 5, base: 53, title: "大工＋手元＋木",       reason: "きよかわらしさが最も出る" },
    { stars: 5, base: 53, title: "上棟中の大工",         reason: "動きと迫力がある" },
    { stars: 5, base: 53, title: "若手に教えている瞬間", reason: "技術継承という会社の物語になる" },
    { stars: 5, base: 50, title: "加工中の手・道具",     reason: "手の仕事が伝わる" },
    { stars: 5, base: 50, title: "完成後に隠れる仕事",   reason: "一般のお客さまが見る機会がない" },
    { stars: 4, base: 42, title: "木組み・納まりのアップ", reason: "技術力が伝わる" },
    { stars: 4, base: 42, title: "整理された現場",       reason: "仕事への姿勢が伝わる" },
    { stars: 3, base: 32, title: "材料・木材",           reason: "素材の話につなげやすい" },
    { stars: 3, base: 32, title: "建築途中の空間",       reason: "設計の説明に使える" },
    { stars: 2, base: 22, title: "現場全景",             reason: "記録感が強くなりやすい" },
  ],
  subjectMax: 55,
  subjectOther: { base: 15, label: "上のどれにも当てはまらないもの" },

  // ② 写真としての出来。基準の点から上下させる幅
  quality: {
    total: 45,
    points: [
      { key: "lead",   max: 15, title: "主役がはっきりしているか", detail: "何の写真か一目で分かること" },
      { key: "people", max: 10, title: "人の動きや表情が伝わるか", detail: "働いている様子が伝わるほどよい。人が写っていること自体は減点しない" },
      { key: "light",  max: 10, title: "明るさ",                   detail: "暗すぎ・白飛び・逆光で見えなくなっていないこと" },
      { key: "frame",  max: 10, title: "構図・周りの片付き",       detail: "水平・垂直が取れていること。作業中の道具や材料は構わないが、関係のない物が目立つと下げる" },
    ],
  },

  // ③ これが写っていたら、何が写っていても29点以下
  // 片付いていない・散らかっているのは、作業中なら当たり前なので29点以下にはしない。
  // 「構図」の減点として扱う（Codexの指摘）
  gate: {
    title: "載せてはいけないものが写っていないか",
    items: [
      "表札・車のナンバー・図面の文字など、場所や個人が特定できるもの",
      "安全上まずい状態（保護具なし・不安定な足場など）",
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
    "点数は「何が写っているか（55点）」＋「写真としての出来（45点）」の足し算です。1点単位で付きます。",
    "腕のいい全景より、ふつうの手元のほうが高く出ます。",
    "人が写っていることは減点しません。職人が作業している姿はいちばん高く評価します（顔が写っていても構いません）。",
    "顔が写った写真を実際に載せるときは、念のためご本人に一言お願いします。",
    "一言コメントの頭に、どの写真と見たかを書かせています。見立てが違っていたら教えてください。",
    "載せてはいけないものが写っている場合は、必ずそれを書かせています。",
    "採点するのはAIです。載せるかどうかは最後は人が決めてください。",
  ],
};

function buildPrompt(): string {
  const subs = CRITERIA.subjects.map((s) => `- ${s.title}（${s.reason}）… ${s.base}点`).join("\n");
  const qual = CRITERIA.quality.points
    .map((p) => `- ${p.key}（${p.title}）… 0〜${p.max}点。${p.detail}`).join("\n");
  // 合計点の目安（bands）は指示文に入れない。入れると、その帯の数字に寄ってしまう。
  // 画面の「採点基準」には出す（criteria で返している）
  return `これは工務店（新築・リフォームの木工事）の職人が現場で撮った写真です。
この会社のInstagramに載せる写真としてどのくらい向いているかを、項目ごとに点を付けてください。
合計点はこちらで足すので、あなたは項目ごとの点だけを出してください。

【1】subject … 何が写っているか。次から最も近いものを1つだけ選び、その名前をそのまま返す。
${subs}
- ${CRITERIA.subjectOther.label}（その他）… ${CRITERIA.subjectOther.base}点
※ 当てはまるものが複数あれば、いちばん点の高いものを選ぶ。
※ 人（職人・お客さま）が写っていることは減点しない。働いている姿はむしろ高く評価する。
　 顔がはっきり写っていても、それだけで下げないこと。

【2】写真としての出来。次の4つに、それぞれ点を付ける（合わせて${CRITERIA.quality.total}点）。
${qual}

【3】ng … 次のものが写っていたら、その内容を短く書く。無ければ空文字。
${CRITERIA.gate.items.map((i) => "- " + i).join("\n")}

点の付け方でとても大事なこと:
- 各項目は1点単位で付ける。5点刻み・きりのよい数字（5・10・15）に寄せない
- 「だいたい何割」で決めず、その写真で実際に見えたもので決める
  例）主役：主役が画面の3分の1以上を占め、背景が邪魔していない＝高い／
      何を見せたいか分からない＝低い
  例）明るさ：顔や手元の細部が見える＝高い／暗部がつぶれている・白く飛んでいる＝低い
- 4つの項目に同じ点を並べない。写真ごとに必ず差を付ける
- 満点や0点は、はっきりそう言える写真だけに使う

comment は日本語30字以内。頭に「どの写真と見たか」を短く書き、そのあとに
よければ何がよいか、惜しければ何を直せばよいかを書く。
例：「木組みのアップ。水平が少し傾いている」
「良い写真です」のような当たり障りのない言い方はしない。
ng があるときは、必ずその内容を書く。`;
}

const PROMPT = buildPrompt();

const TOOL = {
  name: "save_score",
  description: "写真の採点を、項目ごとに保存する",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: {
        type: "string",
        enum: [...CRITERIA.subjects.map((s) => s.title), CRITERIA.subjectOther.label],
        description: "何が写っているか。一覧から1つ選ぶ",
      },
      lead:    { type: "integer", description: "主役のはっきりさ 0〜15点" },
      people:  { type: "integer", description: "人の動きや表情 0〜10点" },
      light:   { type: "integer", description: "明るさ 0〜10点" },
      frame:   { type: "integer", description: "構図 0〜10点" },
      ng:      { type: "string", description: "載せてはいけないものが写っていればその内容。無ければ空文字" },
      comment: { type: "string", description: "その点数にした理由。日本語30字以内" },
    },
    required: ["subject", "lead", "people", "light", "frame", "ng", "comment"],
  },
};

// 項目ごとの点を足して合計を出す。丸い数字に寄らないよう、合計はこちらで計算する
const SUBJECT_POINTS: Record<string, number> = Object.fromEntries(
  CRITERIA.subjects.map((s) => [s.title, s.base]),
);
function totalFrom(input: any): { score: number; parts: Record<string, number>; subject: string } {
  const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const name = String(input?.subject || "").trim();
  const known = SUBJECT_POINTS[name] != null;
  const parts: Record<string, number> = { subject: known ? SUBJECT_POINTS[name] : CRITERIA.subjectOther.base };
  for (const p of CRITERIA.quality.points) parts[p.key] = clamp(input?.[p.key], p.max);
  let score = Math.max(0, Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)));
  // 写真としての出来が極端に低い＝ぶれ・真っ暗などで成立していない。
  // 被写体の点だけで55点になってしまうのを防ぐ（Codexの指摘）
  const qualityTotal = CRITERIA.quality.points.reduce((a, p) => a + parts[p.key], 0);
  if (qualityTotal <= 8) score = Math.min(score, 29);
  // 載せてはいけないものが写っていたら、何が写っていても29点以下
  if (String(input?.ng || "").trim()) score = Math.min(score, 29);
  return { score, parts, subject: known ? name : CRITERIA.subjectOther.label };
}

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
        // 採点は縮小版で足りる。元の大きさで読むと通信量が大きい（1枚1MB超のことがある）
        const small = String(row.url || "").includes("/storage/v1/object/public/")
          ? row.url.split("?")[0].replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + "?width=1024&quality=80"
          : row.url;
        const res = await fetch(small);
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
        const { score, parts, subject } = totalFrom(use.input);
        console.log("score-photo", JSON.stringify({ id: row.id, score, subject, parts }));
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
