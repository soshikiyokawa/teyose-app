// 発注書PDFをサーバー側（Supabase Edge Function）で生成するための関数。
//
// これまではブラウザ内でhtml2canvasを使って画面をそのまま画像化してPDFにしていたが、
// 利用者の一部の端末（セキュリティソフトや組織のネットワーク設定など）でCanvas読み取りが
// ブロックされ、内容が空白のPDFになってしまう問題があった。
// サーバー側で直接PDFを組み立てることで、ブラウザ側の制限を一切受けないようにする。

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COMPANY = {
  name: "株式会社きよかわ",
  zip: "〒731-0221",
  address: "広島県広島市安佐北区可部2-13-31-1",
  tel: "082-815-6080",
  url: "kiyokawanoie.com",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // ① 呼び出し元が、ログイン済みの社内（staff）ユーザーであることを確認する
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "認証が必要です" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (!profile || profile.role !== "staff") {
      return json({ error: "権限がありません" }, 403);
    }

    // ② 発注データを受け取り、PDFを組み立てる
    const order = await req.json();
    const pdfBytes = await buildOrderPdf(order);

    // ③ Supabase Storageに保存し、公開URLを返す
    const yyyymm = String(order.no).slice(0, 6);
    const path = `${yyyymm}/${order.no}.pdf`;
    const { error: upErr } = await admin.storage
      .from("order-pdfs")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: pub } = admin.storage.from("order-pdfs").getPublicUrl(path);
    return json({ url: pub.publicUrl + "?t=" + Date.now() });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const fmt = (n: number) => Math.round(n || 0).toLocaleString("ja-JP");

async function buildOrderPdf(o: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // フォントファイルが大きく、デプロイ時にFunctionへ同梱されないことがあるため、
  // Supabase Storage（publicバケット）に置いたフォントをHTTPで取得して埋め込む。
  const FONTS_BASE = `${SUPABASE_URL}/storage/v1/object/public/assets/fonts`;
  const regularBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Regular.ttf`)).arrayBuffer());
  const boldBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Bold.ttf`)).arrayBuffer());
  const font = await pdfDoc.embedFont(regularBytes, { subset: true });
  const fontBold = await pdfDoc.embedFont(boldBytes, { subset: true });

  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 (pt)
  const marginX = 42;
  const rightX = PAGE_W - marginX;
  const tableW = rightX - marginX;

  const black = rgb(0.165, 0.118, 0.055);
  const gray = rgb(0.53, 0.53, 0.53);
  const green = rgb(0.36, 0.48, 0.24);
  const lightBg = rgb(0.969, 0.953, 0.922);
  const lineColor = rgb(0.91, 0.88, 0.81);
  const darkBrown = rgb(0.165, 0.118, 0.055);
  const gold = rgb(0.831, 0.663, 0.416);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = 800;

  const drawRight = (text: string, yy: number, size = 9, f = font, color = gray) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: rightX - w, y: yy, size, font: f, color });
  };
  const newPageIfNeeded = (need: number) => {
    if (y - need < 50) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = 800;
    }
  };

  page.drawText("発 注 書", { x: marginX, y, size: 20, font: fontBold, color: black });
  page.drawText("Purchase Order", { x: marginX, y: y - 16, size: 9, font, color: gray });
  drawRight(COMPANY.name, y - 2, 11, fontBold, black);
  drawRight(`${COMPANY.zip} ${COMPANY.address}`, y - 14, 8, font, gray);
  drawRight(`TEL：${COMPANY.tel}`, y - 24, 8, font, gray);
  drawRight(COMPANY.url, y - 34, 8, font, green);

  y -= 60;
  const boxH = 70;
  page.drawRectangle({ x: marginX, y: y - boxH, width: tableW, height: boxH, color: lightBg });
  let iy = y - 16;
  page.drawText(`発注先：${o.suppliers || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  page.drawText(`発注番号：${o.no || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  page.drawText(`発注日：${o.date || ""}`, { x: marginX + 260, y: iy, size: 10, font, color: black });
  iy -= 16;
  page.drawText(`物件名：${o.project || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  page.drawText(`納品希望日：${o.dueDate || "未指定"}`, { x: marginX + 260, y: iy, size: 10, font, color: black });

  y -= boxH + 16;
  const colX = [marginX, marginX + 260, marginX + 320, marginX + 380, marginX + 440];
  page.drawRectangle({ x: marginX, y: y - 20, width: tableW, height: 20, color: darkBrown });
  let headerY = y - 14;
  page.drawText("品目名", { x: colX[0] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("単位", { x: colX[1] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("数量", { x: colX[2] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("単価", { x: colX[3] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("金額", { x: colX[4] + 8, y: headerY, size: 9, font, color: gold });
  y -= 20;

  for (const it of o.items || []) {
    newPageIfNeeded(24);
    page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
    const rowY = y - 14;
    page.drawText(String(it.name || ""), { x: colX[0] + 8, y: rowY, size: 9, font, color: black });
    page.drawText(String(it.unit || ""), { x: colX[1] + 8, y: rowY, size: 9, font, color: black });
    page.drawText(String(it.qty || 0), { x: colX[2] + 8, y: rowY, size: 9, font, color: black });
    page.drawText("¥" + fmt(it.price || 0), { x: colX[3] + 8, y: rowY, size: 9, font, color: black });
    page.drawText("¥" + fmt((it.price || 0) * (it.qty || 0)), { x: colX[4] + 8, y: rowY, size: 9, font, color: black });
    y -= 20;
  }
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });

  newPageIfNeeded(90);
  y -= 24;
  drawRight(`小計：¥${fmt(o.subtotal)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 18;
  drawRight(`消費税（10%）：¥${fmt(o.tax)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 22;
  drawRight(`合計：¥${fmt(o.total)}`, y, 16, fontBold, rgb(0.29, 0.19, 0.06));

  y -= 24;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
  y -= 14;
  page.drawText(`納品場所：${o.project || ""} 現場　／　ご納品の際は現場担当者へご連絡ください。`, {
    x: marginX,
    y,
    size: 8,
    font,
    color: gray,
  });

  return await pdfDoc.save();
}
