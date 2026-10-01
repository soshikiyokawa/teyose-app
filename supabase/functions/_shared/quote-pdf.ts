// 見積依頼書PDFの組み立てと保存。
//
// 発注書（order-pdf.ts）とほとんど同じ体裁にしてある。違うのは次の3つ。
//   ・単価と金額の欄を書かない（それを教えてもらうための書類なので、空けておく）
//   ・「納品希望日」ではなく「見積回答希望日」を出す
//   ・下に「お見積りをお願いいたします」と、返信先を書く
//
// 文字の描き方・フォントの読み込みは order-pdf.ts のものを使い回す。

import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { COMPANY, drawRuns, wrapByWidth, textWidth, loadFont } from "./order-pdf.ts";

// PDFを組み立ててStorageに保存し、表示用のURLを返す
export async function saveQuotePdf(admin: any, q: any): Promise<string> {
  const bytes = await buildQuotePdf(q);
  const path = `quotes/${q.no}.pdf`;
  const { error } = await admin.storage
    .from("order-pdfs")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  const { data: pub } = admin.storage.from("order-pdfs").getPublicUrl(path);
  return pub.publicUrl + "?t=" + Date.now();
}

export async function buildQuotePdf(q: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(await loadFont(), { subset: false });

  const PAGE_W = 595.28, PAGE_H = 841.89;   // A4 たて
  const marginX = 42;
  const rightX = PAGE_W - marginX;
  const tableW = PAGE_W - marginX * 2;

  const black = rgb(0.09, 0.09, 0.09);
  const gray = rgb(0.45, 0.45, 0.45);
  const green = rgb(0.36, 0.48, 0.24);
  const lightBg = rgb(0.969, 0.953, 0.922);
  const lineColor = rgb(0.91, 0.88, 0.81);
  const darkBrown = rgb(0.165, 0.118, 0.055);
  const gold = rgb(0.831, 0.663, 0.416);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = 800;
  const drawRight = (text: string, yy: number, size = 9, bold = false, color = gray) => {
    drawRuns(page, text, { x: rightX - textWidth(font, text, size), y: yy, size, font, color, bold });
  };
  const newPageIfNeeded = (need: number) => {
    if (y - need < 60) { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = 800; }
  };

  // ── 見出し ──
  drawRuns(page, "見 積 依 頼 書", { x: marginX, y, size: 20, font, bold: true, color: black });
  drawRuns(page, "Request for Quotation", { x: marginX, y: y - 16, size: 9, font, color: gray });
  drawRight(COMPANY.name, y - 2, 11, true, black);
  drawRight(`${COMPANY.zip} ${COMPANY.address}`, y - 14, 8, false, gray);
  drawRight(`TEL：${COMPANY.tel}`, y - 24, 8, false, gray);
  drawRight(COMPANY.url, y - 34, 8, false, green);
  const staffName = String(q.createdByName || "").trim();
  if (staffName) drawRight(`担当者：${staffName}`, y - 47, 9, false, black);

  // ── 宛先と条件 ──
  y -= 60;
  const replyBy = String(q.replyBy || "").trim();
  const boxH = 86;
  page.drawRectangle({ x: marginX, y: y - boxH, width: tableW, height: boxH, color: lightBg });
  let iy = y - 16;
  drawRuns(page, `発注先：${q.supplierName || ""}　御中`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `依頼番号：${q.no || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  drawRuns(page, `依頼日：${q.date || ""}`, { x: marginX + 260, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `件名：${q.project || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `見積回答希望日：${replyBy || "ご都合のよい日"}`, {
    x: marginX + 10, y: iy, size: 10, font, bold: !!replyBy, color: replyBy ? black : gray,
  });

  // ── お願いの一文 ──
  y -= boxH + 20;
  drawRuns(page, "下記につきまして、お見積りをお願いいたします。", { x: marginX, y, size: 11, font, color: black });
  y -= 6;

  // ── 品目の表（単価・金額は空欄。先方に書いていただく） ──
  const colX = [marginX, marginX + 250, marginX + 300, marginX + 360, marginX + 435];
  const PAD = 8;
  const nameW = colX[1] - colX[0] - PAD * 2;
  const ROW_SIZE = 9;
  const LINE_H = 12;

  const drawHead = () => {
    page.drawRectangle({ x: marginX, y: y - 20, width: tableW, height: 20, color: darkBrown });
    const hy = y - 14;
    drawRuns(page, "品目・仕様", { x: colX[0] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "単位", { x: colX[1] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "数量", { x: colX[2] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "単価", { x: colX[3] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "金額", { x: colX[4] + PAD, y: hy, size: 9, font, color: gold });
    y -= 20;
  };
  y -= 14;
  drawHead();

  for (const it of q.items || []) {
    const lines: string[] = wrapByWidth(String(it.name || ""), font, ROW_SIZE, nameW);
    const spec = String(it.spec || "").trim();
    const specLines: string[] = spec ? wrapByWidth(spec, font, 8, nameW) : [];
    const rowH = Math.max(22, 8 + lines.length * LINE_H + specLines.length * 10);
    newPageIfNeeded(rowH + 30);
    if (y === 800) drawHead();
    page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
    const rowY = y - 14;
    lines.forEach((l, i) => drawRuns(page, l, { x: colX[0] + PAD, y: rowY - i * LINE_H, size: ROW_SIZE, font, color: black }));
    specLines.forEach((l, i) =>
      drawRuns(page, l, { x: colX[0] + PAD, y: rowY - lines.length * LINE_H - i * 10 + 2, size: 8, font, color: gray }));
    drawRuns(page, String(it.unit || ""), { x: colX[1] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    drawRuns(page, String(it.qty ?? ""), { x: colX[2] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    // 単価・金額は空欄のまま（記入していただく欄）
    y -= rowH;
  }
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
  // 記入欄だとわかるように、単価・金額の列に薄い区切りを引く
  drawRight("単価・金額の欄はご記入ください", y - 12, 8, false, gray);
  y -= 18;

  // ── 備考 ──
  const note = String(q.note || "").trim();
  if (note) {
    const noteLines = note.split("\n").flatMap((l: string) => wrapByWidth(l, font, 10, tableW - 24));
    const h = 20 + noteLines.length * 14;
    newPageIfNeeded(h + 40);
    y -= 20;
    page.drawRectangle({ x: marginX, y: y - h + 14, width: tableW, height: h, borderColor: lineColor, borderWidth: 0.8, color: lightBg });
    drawRuns(page, "備考", { x: marginX + 12, y, size: 8, font, color: gray });
    let ny = y - 14;
    for (const l of noteLines) { drawRuns(page, l, { x: marginX + 12, y: ny, size: 10, font, color: black }); ny -= 14; }
    y = y - h + 14;
  }

  // ── 返信のお願い ──
  newPageIfNeeded(70);
  y -= 26;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
  y -= 14;
  const foot = replyBy
    ? `お手数ですが、${replyBy} までにご回答をお願いいたします。`
    : "お手数ですが、ご回答をお願いいたします。";
  drawRuns(page, foot, { x: marginX, y, size: 9, font, color: black });
  y -= 13;
  drawRuns(page, "ご回答は、手寄のチャット・メール・FAXのいずれでも構いません。ご不明な点はお問い合わせください。", {
    x: marginX, y, size: 8, font, color: gray,
  });
  y -= 12;
  drawRuns(page, "※この書類は発注ではありません。お見積りのお願いです。", { x: marginX, y, size: 8, font, color: gray });

  return await pdfDoc.save();
}
