// 発注済みの単価を、発注先があとから直すためのEdge Function。
//
// 発注先にデータベースを直接いじらせると、品目や数量まで変えられてしまうので、
// ここを通してのみ単価を書き換える。やることは4つ。
//   ① 呼び出したのが、その発注先のログイン済みの人かを確認する
//   ② 発注の単価を差し替え、小計・消費税・合計を計算し直す
//   ③ 変更の履歴（いくらから いくらへ）を発注に残す
//   ④ 原価管理の金額（cost_entries）も同じ品目のぶんだけ直す
//   ⑤ 発注書PDFを新しい単価で作り直し、チャットの発注書にも反映する
//
// きよかわの社員も同じ発注の単価を直せる（発注先に代わって入れる場合）。
// 通知とチャットへの記録は、呼び出した画面の側で行う。

import { createClient } from "npm:@supabase/supabase-js@2";
import { saveOrderPdf } from "../_shared/order-pdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// 送料の行。発注のあとに足せる唯一の品目
const SHIPPING_NAME = "送料";
const isShippingItem = (it: any) => it?.isShipping === true || String(it?.name || "") === SHIPPING_NAME;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── ① 呼び出し元を確かめる ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles")
      .select("role, display_name, supplier_id").eq("id", userData.user.id).single();
    if (!profile) return json({ error: "利用者の情報が見つかりません" }, 403);

    const { orderNo, prices, note, shipping } = await req.json();
    if (!orderNo) return json({ error: "発注番号がありません" }, 400);
    const wantShipping = typeof shipping === "number" && Number.isFinite(shipping);
    if ((!Array.isArray(prices) || !prices.length) && !wantShipping) {
      return json({ error: "変更する単価がありません" }, 400);
    }
    if (wantShipping && (shipping < 0 || shipping > 9_999_999)) {
      return json({ error: "送料の金額が正しくありません" }, 400);
    }

    const { data: order, error: ordErr } = await admin.from("orders")
      .select("*").eq("no", orderNo).single();
    if (ordErr || !order) return json({ error: "その発注が見つかりません" }, 404);

    // 発注先は自社宛の発注だけ。社員はどれでも直せる
    const isStaff = profile.role === "staff" || profile.role === "carpenter";
    if (!isStaff) {
      if (profile.role !== "supplier" || profile.supplier_id !== order.supplier_id) {
        return json({ error: "この発注の単価は変更できません" }, 403);
      }
    }

    // ── ② 単価を差し替える ──
    // 品目は番号（index）で指定する。名前が同じ品目が複数あっても取り違えないため
    const items: any[] = Array.isArray(order.items) ? JSON.parse(JSON.stringify(order.items)) : [];
    const changes: any[] = [];
    for (const p of (Array.isArray(prices) ? prices : [])) {
      const i = Number(p.index);
      if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
      const after = Math.round(num(p.price));
      if (after < 0) return json({ error: "単価に負の数は入れられません" }, 400);
      const before = Math.round(num(items[i].cost ?? items[i].price));
      if (before === after) continue;
      // 最初に直したときの単価を残しておく（何度直しても当初の発注単価が分かる）
      if (items[i].origPrice === undefined || items[i].origPrice === null) items[i].origPrice = before;
      items[i].cost = after;
      items[i].price = after;
      changes.push({ name: String(items[i].name || ""), qty: num(items[i].qty), before, after });
    }
    // ── ②' 送料を足す・直す・消す ──
    // 発注のあとで送料が分かることが多いので、発注先が自分で入れられるようにしてある。
    // 品目を自由に増やせると発注の中身を変えられてしまうため、足せるのは送料の1行だけ。
    let shippingChange: any = null;
    if (wantShipping) {
      const at = items.findIndex(isShippingItem);
      const before = at >= 0 ? Math.round(num(items[at].cost ?? items[at].price)) : 0;
      const after = Math.round(shipping);
      if (before !== after) {
        if (after === 0 && at >= 0) {
          items.splice(at, 1);                    // 0円にしたら行ごと消す
        } else if (at >= 0) {
          items[at].cost = after;
          items[at].price = after;
          if (items[at].origPrice === undefined || items[at].origPrice === null) items[at].origPrice = before;
        } else if (after > 0) {
          items.push({ name: SHIPPING_NAME, qty: 1, unit: "式", cost: after, price: after, isShipping: true });
        }
        shippingChange = { name: SHIPPING_NAME, qty: 1, before, after, added: at < 0, removed: after === 0 };
        changes.push({ name: SHIPPING_NAME, qty: 1, before, after });
      }
    }

    if (!changes.length) return json({ error: "単価が変わっていません" }, 400);

    const subtotal = items.reduce((s, it) => s + num(it.cost) * num(it.qty), 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;

    const edit = {
      at: new Date().toISOString(),
      byName: String(profile.display_name || ""),
      byRole: profile.role,
      note: String(note || "").slice(0, 200),
      changes,
      subtotal: { before: num(order.subtotal), after: subtotal },
      total: { before: num(order.total), after: total },
    };
    const history = Array.isArray(order.price_edits) ? order.price_edits : [];

    const { error: upErr } = await admin.from("orders")
      .update({ items, subtotal, tax, total, price_edits: [...history, edit] })
      .eq("no", orderNo);
    if (upErr) return json({ error: "発注の更新に失敗しました：" + upErr.message }, 500);

    // ── ④ 原価管理の金額も直す ──
    // 発注のときに「品目名・数量」で1行ずつ作っているので、それで突き合わせる
    const { data: costRows } = await admin.from("cost_entries")
      .select("id, name, qty, amount").eq("order_no", orderNo).eq("supplier_id", order.supplier_id);
    const used = new Set<number>();
    const costUpdated: any[] = [];
    for (const it of items) {
      const want = Math.round(num(it.cost) * num(it.qty));
      const row = (costRows || []).find((r: any) =>
        !used.has(r.id) && String(r.name) === String(it.name || "") && num(r.qty) === num(it.qty));
      if (!row) continue;
      used.add(row.id);
      if (Math.round(num(row.amount)) === want) continue;
      const { error } = await admin.from("cost_entries").update({ amount: want }).eq("id", row.id);
      if (!error) costUpdated.push({ name: row.name, before: num(row.amount), after: want });
    }

    // 送料は発注のあとで足した行なので、原価の行も無ければ作り、消したなら消す
    if (shippingChange) {
      const shipRow = (costRows || []).find((r: any) => String(r.name) === SHIPPING_NAME);
      if (shippingChange.removed) {
        if (shipRow) await admin.from("cost_entries").delete().eq("id", shipRow.id);
      } else if (!shipRow) {
        await admin.from("cost_entries").insert({
          date: order.date, project: order.project, name: SHIPPING_NAME, qty: 1, unit: "式",
          amount: shippingChange.after, supplier_id: order.supplier_id, order_no: orderNo,
          cost_type: order.cost_type, status: order.status === "received" ? "received" : "pending",
        });
      }
    }

    // ── ⑤ 発注書PDFを新しい単価で作り直す ──
    // 失敗しても単価の変更そのものは成立させる（フォントの取得に失敗することがあるため）。
    // PDFは発注番号ごとに同じ場所へ上書きするので、古いリンクを開いても新しい中身が出る。
    let pdfUrl = "";
    let pdfError = "";
    try {
      const { data: sup } = await admin.from("suppliers")
        .select("name").eq("id", order.supplier_id).single();
      pdfUrl = await saveOrderPdf(admin, {
        no: order.no,
        date: order.date,
        dueDate: order.due_date || "",
        dueAsap: !!order.due_asap,
        costType: order.cost_type || "",
        project: order.project || "",
        suppliers: sup?.name || "",
        items, subtotal, tax, total,
        priceEdits: [...history, edit],
      });
      await updateChatOrderCard(admin, orderNo, { items, subtotal, tax, total, pdfUrl });
    } catch (e) {
      pdfError = String((e as any)?.message || e);
      console.warn("発注書PDFの作り直しに失敗しました", pdfError);
      // PDFが作れなくても、チャットの発注書の中身だけは新しい単価に直しておく
      try { await updateChatOrderCard(admin, orderNo, { items, subtotal, tax, total }); } catch (_) {}
    }

    return json({
      ok: true,
      orderNo,
      changes,
      subtotal, tax, total,
      costUpdated: costUpdated.length,
      // 原価の行が見つからなかった品目があれば知らせる（発注後に原価を消した場合など）
      costMissing: items.length - used.size,
      shipping: shippingChange,
      pdfUrl, pdfError,
      edit,
    });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

// チャットに流れている発注書の吹き出しも、新しい単価に差し替える。
// 吹き出しは発注時の内容をそのまま持っているので、ここを直さないと
// 「PDFを表示」が古いPDFのままになる。
async function updateChatOrderCard(admin: any, orderNo: string, patch: Record<string, unknown>) {
  const { data: rows } = await admin.from("chat_messages")
    .select("id, order_data").eq("type", "order").eq("order_data->>no", orderNo);
  for (const row of rows || []) {
    await admin.from("chat_messages")
      .update({ order_data: { ...(row.order_data || {}), ...patch } })
      .eq("id", row.id);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
