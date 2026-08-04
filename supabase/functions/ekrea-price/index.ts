// エクレアパーツ（ekrea Parts）オンラインショップから、品目マスタに登録してある
// 品番の単価を取ってくるEdge Function。
//
//   ・対象は「品目マスタに品番が入っている品目」だけ。勝手に商品を増やしたりはしない
//   ・取ってきた値は master_items.web_price に入れるだけ。原価（cost）は画面で選んで反映する
//   ・毎月1日9時（JST）にpg_cronから呼ばれ（migration-genba32.sql参照）、
//     原価と違う品目があれば管理者へ通知する
//   ・画面の「価格を確認」ボタンからも呼べる（この場合は通知しない）
//
// 価格はログイン不要で、商品ページのHTMLにそのまま入っている。
//   品番 30-8582 → /aec/user/shohin_list?k=30-8582 で商品ページ（SPM09919）を特定
//   → /aec/user/shohin_detail?item_cd=SPM09919 の中に品番ごとの単価が並んでいる
// 1ページに複数の品番が載っているので、1回取得したページは使い回して回数を減らす。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

const BASE = "https://www.ekrea.net";
const SUPPLIER_MATCH = "エクレア";     // この文字を含む発注先の品目が対象
const MAX_PAGES = 60;                  // 1回に取りにいく商品ページ数の上限
const WAIT_MS = 400;                   // 相手のサーバーに負担をかけないための間隔

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toNum = (s: string | undefined) => {
  const n = Number(String(s || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Row = { code: string; name: string; exTax: number | null; inTax: number | null };

async function getHtml(path: string) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": "teyose-price-check (kiyokawa)", "Accept-Language": "ja" },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return await res.text();
}

// 商品ページのHTMLから、品番ごとの単価を取り出す
function parseItemRows(html: string): Row[] {
  const rows: Row[] = [];
  for (const chunk of html.split("js-option-item-row").slice(1)) {
    const code = chunk.match(/js-input-itemCd"\s*value="([^"]*)"/)?.[1]?.trim();
    if (!code) continue;
    const name = chunk.match(/col-itemName[\s\S]{0,500}?<p><span>([^<]*)<\/span><\/p>/)?.[1]?.trim() || "";
    const inTax = toNum(chunk.match(/js-item-price-in-tax[^>]*>([\s\S]{0,150}?)<\/p>/)?.[1]);
    const exTax = toNum(chunk.match(/js-item-price"[^>]*>([\s\S]{0,150}?)<\/p>/)?.[1]);
    rows.push({ code, name, exTax, inTax });
  }
  return rows;
}

// 品番から商品ページの商品コード（SPM…）を探す。
// 見つからないときフッターの「おすすめ商品」を拾ってしまわないよう、
// 「検索結果がありませんでした」を先に見て、リンクも検索結果の並び（js-send-item）から取る。
async function findPageCode(makerCode: string) {
  const html = await getHtml(`/aec/user/shohin_list?k=${encodeURIComponent(makerCode)}`);
  if (html.includes("検索結果がありませんでした")) return null;
  return html.match(/js-send-item"[^>]*href="[^"]*item_cd=([A-Za-z0-9]+)"/)?.[1] || null;
}

Deno.serve(async (req) => {
  // ブラウザから呼ぶときの事前確認（CORS）
  if (req.method === "OPTIONS") return json({}, 200);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const byCron = req.headers.get("x-remind-secret") === OT_REMIND_SECRET;

    // 画面から呼ぶときは、ログインしている社内の人だけ
    if (!byCron) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "unauthorized" }, 401);
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (prof?.role !== "staff" && prof?.role !== "carpenter") return json({ error: "forbidden" }, 403);
    }

    // ── 対象の品目（エクレアパーツの発注先で、品番が入っているものだけ） ──
    const { data: suppliers } = await admin.from("suppliers").select("id, name");
    const supplierIds = (suppliers || []).filter((s: any) => String(s.name || "").includes(SUPPLIER_MATCH))
      .map((s: any) => s.id);
    if (!supplierIds.length) return json({ checked: 0, note: "エクレアパーツの発注先が登録されていません" });

    const { data: items, error: itemErr } = await admin.from("master_items")
      .select("id, name, cost, maker_code, web_page_code")
      .in("supplier_id", supplierIds)
      .neq("maker_code", "");
    // 品番の列が無い＝マイグレーション未実行。画面で案内できるようそのまま返す
    if (itemErr) return json({ error: itemErr.message }, 500);
    const targets = (items || []).filter((m: any) => m.maker_code);
    if (!targets.length) return json({ checked: 0, note: "品番が入っている品目がありません" });

    // ── 商品ページを取りにいく（同じページに載っている品番はまとめて拾う） ──
    const found = new Map<string, Row>();     // 品番 → 単価
    const pageOf = new Map<string, string>(); // 品番 → 商品コード
    const seenPages = new Set<string>();
    const errors: string[] = [];
    let pages = 0;

    // 1ページに何十もの品番が載っているので、検索で見つからなかった品番も
    // 別の品番のページに載っていることがある。最後にまとめて結果を見る。
    for (const m of targets) {
      const code = String(m.maker_code).trim();
      if (found.has(code)) continue;                 // 別の品番のページで既に拾えた
      if (pages >= MAX_PAGES) { errors.push("1回に取得できる件数の上限に達しました。時間をおいてもう一度実行してください"); break; }
      try {
        // 商品ページは「前回の記録 → サイト内検索」の順に探す
        let pageCode: string | null = m.web_page_code || null;
        if (!pageCode) {
          pageCode = await findPageCode(code);
          await sleep(WAIT_MS);
        }
        if (!pageCode || seenPages.has(pageCode)) continue;
        seenPages.add(pageCode);

        const html = await getHtml(`/aec/user/shohin_detail?item_cd=${encodeURIComponent(pageCode)}`);
        pages++;
        await sleep(WAIT_MS);
        for (const r of parseItemRows(html)) {
          if (!found.has(r.code)) { found.set(r.code, r); pageOf.set(r.code, pageCode); }
        }
      } catch (e) {
        errors.push(`${code}：${String((e as any)?.message || e)}`);
      }
    }
    // 最後まで見つからなかった品番だけを知らせる
    for (const m of targets) {
      const code = String(m.maker_code).trim();
      if (!found.has(code)) errors.push(`${code}：ホームページで見つかりません（品番違い・取扱終了かもしれません）`);
    }

    // ── 取れた分を web_price に書く（原価には触らない） ──
    const now = new Date().toISOString();
    const results: any[] = [];
    for (const m of targets) {
      const r = found.get(String(m.maker_code).trim());
      if (!r || r.exTax == null) continue;
      await admin.from("master_items").update({
        web_price: r.exTax,
        web_price_at: now,
        web_page_code: pageOf.get(String(m.maker_code).trim()) || m.web_page_code || "",
      }).eq("id", m.id);
      results.push({ id: m.id, name: m.name, makerCode: m.maker_code, cost: Number(m.cost), webPrice: r.exTax, webName: r.name });
    }

    const changed = results.filter((r) => r.webPrice !== r.cost);

    // ── 毎月の自動チェックでは、変わっていたら管理者に知らせる ──
    if (byCron && changed.length) {
      const { data: profiles } = await admin.from("profiles").select("id, role");
      const staffIds = (profiles || []).filter((p: any) => p.role === "staff").map((p: any) => p.id);
      const { data: subs } = staffIds.length
        ? await admin.from("push_subscriptions").select("*").in("user_id", staffIds)
        : { data: [] as any[] };
      const head = changed.slice(0, 3)
        .map((c) => `${c.name}（¥${c.cost.toLocaleString()}→¥${c.webPrice.toLocaleString()}）`).join("／");
      const body = `エクレアパーツの単価が${changed.length}件変わっています。${head}` +
        (changed.length > 3 ? ` ほか${changed.length - 3}件` : "") + "。品目マスタで確認してください。";
      await Promise.all((subs || []).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: "エクレアパーツの価格が変わりました", body, tab: "order/master" }),
          );
        } catch (e: any) {
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }));
    }

    return json({ checked: targets.length, got: results.length, changed: changed.length, pages, results, errors });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-remind-secret",
    },
  });
}
