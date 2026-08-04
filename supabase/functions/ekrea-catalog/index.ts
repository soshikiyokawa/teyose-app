// エクレアパーツのカタログ索引をつくるEdge Function。
//
// エクレアのサイトは商品名で検索してもヒットしない（品番でしか引けない）ので、
// カテゴリ一覧から商品ページを集め、ページごとに載っている
// 「品番・商品名・単価」を ekrea_catalog に貯める。
// これがあると、品目マスタの品目名から品番の候補を出せる。
//
//   1回の実行で読むページ数には上限があるので、少しずつ進める。
//   毎日3時（JST）にpg_cronから呼ばれ（migration-genba33.sql参照）、
//   全部読み終わったら、古くなったページから読み直す。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

const BASE = "https://www.ekrea.net";
const WAIT_MS = 350;          // 相手のサーバーへの間隔
const MAX_PAGES = 70;         // 1回に読む商品ページ数
const RELIST_DAYS = 7;        // 商品ページの一覧を作り直す間隔
const RECRAWL_DAYS = 30;      // 同じページを読み直す間隔

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toNum = (s: string | undefined) => {
  const n = Number(String(s || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function getHtml(path: string) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": "teyose-price-check (kiyokawa)", "Accept-Language": "ja" },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return await res.text();
}

// 商品ページから品番ごとの単価を取り出す（ekrea-price と同じ読み方）
function parseItemRows(html: string) {
  const rows: { code: string; name: string; price: number | null }[] = [];
  for (const chunk of html.split("js-option-item-row").slice(1)) {
    const code = chunk.match(/js-input-itemCd"\s*value="([^"]*)"/)?.[1]?.trim();
    if (!code) continue;
    const name = chunk.match(/col-itemName[\s\S]{0,500}?<p><span>([^<]*)<\/span><\/p>/)?.[1]?.trim() || "";
    const price = toNum(chunk.match(/js-item-price"[^>]*>([\s\S]{0,150}?)<\/p>/)?.[1]);
    rows.push({ code, name, price });
  }
  return rows;
}

const pageCodesIn = (html: string) =>
  [...new Set([...html.matchAll(/js-send-item"[^>]*href="[^"]*item_cd=([A-Za-z0-9]+)"/g)].map((m) => m[1]))];

// カテゴリ一覧をたどって商品ページの一覧を作る
async function listPages() {
  const top = await getHtml("/aec/user/");
  await sleep(WAIT_MS);
  const cats = [...new Set(
    [...top.matchAll(/shohin_list\?c1=([A-Za-z0-9]+)&(?:amp;)?c2=([A-Za-z0-9]+)/g)].map((m) => `${m[1]}|${m[2]}`),
  )];
  const codes = new Set<string>();
  for (const c of cats) {
    const [c1, c2] = c.split("|");
    const first = await getHtml(`/aec/user/shohin_list?c1=${c1}&c2=${c2}`);
    await sleep(WAIT_MS);
    pageCodesIn(first).forEach((x) => codes.add(x));
    // 30件ずつなので、残りはページ送りで読む
    const total = Number(first.match(/全<strong>(\d+)<\/strong>件/)?.[1] || 0);
    for (let p = 2; p <= Math.ceil(total / 30) && p <= 12; p++) {
      const h = await getHtml(`/aec/user/shohin_list?c1=${c1}&c2=${c2}&p=${p}`);
      await sleep(WAIT_MS);
      pageCodesIn(h).forEach((x) => codes.add(x));
    }
  }
  return [...codes];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const byCron = req.headers.get("x-remind-secret") === OT_REMIND_SECRET;
    if (!byCron) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "unauthorized" }, 401);
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (prof?.role !== "staff") return json({ error: "forbidden" }, 403);
    }

    const { data: pages, error: pageErr } = await admin.from("ekrea_pages")
      .select("page_code, listed_at, crawled_at").order("crawled_at", { ascending: true, nullsFirst: true });
    if (pageErr) return json({ error: pageErr.message }, 500);

    // ── 商品ページの一覧づくり（初回、または一定期間ごと） ──
    let listed = 0;
    const newestList = (pages || []).map((p: any) => p.listed_at).sort().pop();
    const listStale = !pages?.length ||
      (Date.now() - new Date(newestList || 0).getTime()) / 86400000 > RELIST_DAYS;
    if (listStale) {
      const codes = await listPages();
      listed = codes.length;
      for (let i = 0; i < codes.length; i += 200) {
        await admin.from("ekrea_pages")
          .upsert(codes.slice(i, i + 200).map((c) => ({ page_code: c, listed_at: new Date().toISOString() })),
            { onConflict: "page_code", ignoreDuplicates: false });
      }
    }

    // ── まだ読んでいない（または古い）ページを少しずつ読む ──
    const { data: todo } = await admin.from("ekrea_pages")
      .select("page_code, crawled_at")
      .or(`crawled_at.is.null,crawled_at.lt.${new Date(Date.now() - RECRAWL_DAYS * 86400000).toISOString()}`)
      .order("crawled_at", { ascending: true, nullsFirst: true })
      .limit(MAX_PAGES);

    let crawled = 0, items = 0;
    const errors: string[] = [];
    for (const p of todo || []) {
      try {
        const html = await getHtml(`/aec/user/shohin_detail?item_cd=${encodeURIComponent(p.page_code)}`);
        await sleep(WAIT_MS);
        const rows = parseItemRows(html);
        if (rows.length) {
          await admin.from("ekrea_catalog").upsert(
            rows.map((r) => ({
              maker_code: r.code, name: r.name, price: r.price,
              page_code: p.page_code, updated_at: new Date().toISOString(),
            })),
            { onConflict: "maker_code" },
          );
          items += rows.length;
        }
        await admin.from("ekrea_pages")
          .update({ crawled_at: new Date().toISOString(), rows: rows.length }).eq("page_code", p.page_code);
        crawled++;
      } catch (e) {
        errors.push(`${p.page_code}：${String((e as any)?.message || e)}`);
      }
    }

    const { count: total } = await admin.from("ekrea_pages").select("*", { count: "exact", head: true });
    const { count: done } = await admin.from("ekrea_pages")
      .select("*", { count: "exact", head: true }).not("crawled_at", "is", null);
    const { count: catalog } = await admin.from("ekrea_catalog").select("*", { count: "exact", head: true });

    return json({
      listed, crawled, items,
      pages: { total: total || 0, done: done || 0, remaining: (total || 0) - (done || 0) },
      catalog: catalog || 0,
      errors: errors.slice(0, 10),
    });
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
