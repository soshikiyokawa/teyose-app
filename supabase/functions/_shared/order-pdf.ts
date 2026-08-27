// 発注書PDFの組み立てと保存。
//
// 発注確定のとき（generate-order-pdf）と、あとから単価を直したとき（update-order-price）の
// 両方から使う。同じ発注番号なら同じ場所に上書きするので、単価を直すとPDFも直る。
//
// もともとはブラウザ内でhtml2canvasを使って画面を画像化していたが、
// 一部の端末（セキュリティソフトや組織のネットワーク設定など）でCanvas読み取りが
// ブロックされ、内容が空白のPDFになってしまう問題があった。
// サーバー側で直接PDFを組み立てることで、ブラウザ側の制限を一切受けないようにしている。

import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

export const COMPANY = {
  name: "株式会社きよかわ",
  zip: "〒731-0221",
  address: "広島県広島市安佐北区可部2-13-31-1",
  tel: "082-815-6080",
  url: "kiyokawanoie.com",
};

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const nowPrice = (it: any) => Math.round(Number(it?.cost ?? it?.price) || 0);
const origPrice = (it: any) =>
  it?.origPrice === undefined || it?.origPrice === null
    ? nowPrice(it)
    : Math.round(Number(it.origPrice) || 0);

// PDFを組み立ててStorageに保存し、表示用のURLを返す。
// 同じ発注番号なら同じ場所を上書きするため、古いURLを開いても新しい中身が出る。
// URLの末尾に時刻を付けているのは、端末やCDNに残った古いPDFを掴まないようにするため。
export async function saveOrderPdf(admin: any, order: any): Promise<string> {
  const pdfBytes = await buildOrderPdf(order);
  const path = `${String(order.no).slice(0, 6)}/${order.no}.pdf`;
  const { error } = await admin.storage
    .from("order-pdfs")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  const { data: pub } = admin.storage.from("order-pdfs").getPublicUrl(path);
  return pub.publicUrl + "?t=" + Date.now();
}

export async function buildOrderPdf(o: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // フォントファイルが大きく、デプロイ時にFunctionへ同梱されないことがあるため、
  // Supabase Storage（publicバケット）に置いたフォントをHTTPで取得して埋め込む。
  const FONTS_BASE = `${SUPABASE_URL}/storage/v1/object/public/assets/fonts`;
  const regularBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Regular.ttf`)).arrayBuffer());
  const boldBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Bold.ttf`)).arrayBuffer());
  // subset:trueにすると日本語のような文字数の多いフォントで文字が欠ける不具合があるため、
  // サブセット化せずフォント全体をそのまま埋め込む
  const font = await pdfDoc.embedFont(regularBytes, { subset: false });
  const fontBold = await pdfDoc.embedFont(boldBytes, { subset: false });

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

  // 単価を直した発注は、いつ直したものかが分かるようにしておく
  const edits: any[] = Array.isArray(o.priceEdits) ? o.priceEdits : (Array.isArray(o.price_edits) ? o.price_edits : []);
  const lastEdit = edits.length ? edits[edits.length - 1] : null;
  const editedOn = lastEdit ? String(lastEdit.at || "").slice(0, 10) : "";

  page.drawText("発 注 書", { x: marginX, y, size: 20, font: fontBold, color: black });
  page.drawText("Purchase Order", { x: marginX, y: y - 16, size: 9, font, color: gray });
  if (lastEdit) {
    page.drawText(`単価変更あり（${editedOn} 改定・${edits.length}回目）`, {
      x: marginX + 92, y: y + 4, size: 9, font: fontBold, color: green,
    });
  }
  drawRight(COMPANY.name, y - 2, 11, fontBold, black);
  drawRight(`${COMPANY.zip} ${COMPANY.address}`, y - 14, 8, font, gray);
  drawRight(`TEL：${COMPANY.tel}`, y - 24, 8, font, gray);
  drawRight(COMPANY.url, y - 34, 8, font, green);

  y -= 60;
  const boxH = 86;
  page.drawRectangle({ x: marginX, y: y - boxH, width: tableW, height: boxH, color: lightBg });
  let iy = y - 16;
  page.drawText(`発注先：${o.suppliers || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  page.drawText(`発注番号：${o.no || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  page.drawText(`発注日：${o.date || ""}`, { x: marginX + 260, y: iy, size: 10, font, color: black });
  iy -= 16;
  page.drawText(`費目区分：${o.costType || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  page.drawText(`物件名：${o.project || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  page.drawText(`納品希望日：${o.dueDate || "未指定"}`, { x: marginX + 260, y: iy, size: 10, font, color: black });

  y -= boxH + 16;
  const colX = [marginX, marginX + 260, marginX + 320, marginX + 380, marginX + 440];
  page.drawRectangle({ x: marginX, y: y - 20, width: tableW, height: 20, color: darkBrown });
  const headerY = y - 14;
  page.drawText("品目名", { x: colX[0] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("単位", { x: colX[1] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("数量", { x: colX[2] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("単価", { x: colX[3] + 8, y: headerY, size: 9, font, color: gold });
  page.drawText("金額", { x: colX[4] + 8, y: headerY, size: 9, font, color: gold });
  y -= 20;

  for (const it of o.items || []) {
    const price = nowPrice(it);
    const orig = origPrice(it);
    const qty = Number(it.qty) || 0;
    const changed = orig !== price;
    newPageIfNeeded(changed ? 34 : 24);
    page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
    const rowY = y - 14;
    page.drawText(String(it.name || ""), { x: colX[0] + 8, y: rowY, size: 9, font, color: black });
    page.drawText(String(it.unit || ""), { x: colX[1] + 8, y: rowY, size: 9, font, color: black });
    page.drawText(String(qty), { x: colX[2] + 8, y: rowY, size: 9, font, color: black });
    page.drawText("¥" + fmt(price), { x: colX[3] + 8, y: rowY, size: 9, font, color: black });
    page.drawText("¥" + fmt(price * qty), { x: colX[4] + 8, y: rowY, size: 9, font, color: black });
    y -= 20;
    // 直した品目は、当初いくらだったかを小さく添える
    if (changed) {
      page.drawText(`（当初 ¥${fmt(orig)} → ¥${fmt(price)}）`, {
        x: colX[0] + 8, y: y - 2, size: 7.5, font, color: gray,
      });
      y -= 12;
    }
  }
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });

  newPageIfNeeded(110);
  y -= 24;
  drawRight(`小計：¥${fmt(o.subtotal)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 18;
  drawRight(`消費税（10%）：¥${fmt(o.tax)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 22;
  drawRight(`合計：¥${fmt(o.total)}`, y, 16, fontBold, rgb(0.29, 0.19, 0.06));

  if (lastEdit) {
    const first = edits[0];
    y -= 16;
    drawRight(`（当初の合計：¥${fmt(first?.total?.before)}）`, y, 8.5, font, gray);
  }

  y -= 24;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
  y -= 14;
  page.drawText(`納品場所：${o.project || ""} 現場　／　ご納品の際は現場担当者へご連絡ください。`, {
    x: marginX, y, size: 8, font, color: gray,
  });
  if (lastEdit) {
    y -= 12;
    const by = String(lastEdit.byName || "");
    page.drawText(`この発注書は ${editedOn} に単価変更のため作り直したものです${by ? `（変更：${by}）` : ""}。`, {
      x: marginX, y, size: 8, font, color: gray,
    });
  }

  return await pdfDoc.save();
}
