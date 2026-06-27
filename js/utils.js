const fmt = n => Math.round(n).toLocaleString('ja-JP');
const COMPANY = {name:'株式会社きよかわ',zip:'〒731-0221',address:'広島県広島市安佐北区可部2-13-31-1',tel:'082-815-6080',url:'kiyokawanoie.com'};

function showToast(msg, duration=2000){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), duration);
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function tsLabel(ts){
  const d=new Date(ts);const now=new Date();const diff=now-d;
  if(diff<60000) return 'たった今';
  if(diff<3600000) return Math.floor(diff/60000)+'分前';
  if(diff<86400000) return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  return (d.getMonth()+1)+'/'+d.getDate();
}
function dateLabel(ts){const d=new Date(ts);return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';}

// 品目名から「品名」と「寸法」を分離
// 寸法は数字×数字パターン or 末尾の数字列を検出
function splitNameSpec(name){
  // 数字×数字×数字 or 数字×数字 のパターンより前を品名とする
  const m = name.match(/^(.*?)\s+([\d.]+(?:[×xX][\d.]+)+(?:\s*\(.*\))?)$/);
  if(m) return {n: m[1].trim(), s: m[2].trim()};
  // 末尾に単独の数字（長さなど）があるパターン
  const m2 = name.match(/^(.*?)\s+(\d{3,}(?:\s*\(.*\))?)$/);
  if(m2) return {n: m2[1].trim(), s: m2[2].trim()};
  return {n: name, s: ''};
}

// HTML断片から実際のPDFファイル（Blob）を生成する（チャットへの添付用）
async function htmlToPdfBlob(title, body){
  const wrap=document.createElement('div');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;width:800px;background:#fff';
  wrap.innerHTML=`<div style="font-family:'Helvetica Neue','Hiragino Sans',sans-serif;color:#111;padding:32px">${body}</div>`;
  document.body.appendChild(wrap);
  try{
    const blob=await html2pdf().from(wrap).set({
      margin:10,
      filename:`${title}.pdf`,
      html2canvas:{scale:2},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
    }).outputPdf('blob');
    return blob;
  }finally{
    wrap.remove();
  }
}

// PDF印刷ユーティリティ（ポップアップブロック対応）
function printHtml(title, body){
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${title}</title><style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}body{font-family:'Helvetica Neue','Hiragino Sans',sans-serif;color:#111;padding:32px;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}@media print{@page{margin:15mm}button{display:none}}</style></head><body>${body}</body></html>`;
  const win=window.open('','_blank');
  if(win){
    win.document.write(html);win.document.close();
    setTimeout(()=>win.print(),500);
    return true;
  }
  // フォールバック：非表示iframeで印刷
  const old=document.getElementById('_print_frame');
  if(old) old.remove();
  const iframe=document.createElement('iframe');
  iframe.id='_print_frame';
  iframe.style.cssText='position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
  document.body.appendChild(iframe);
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(()=>{iframe.contentWindow.focus();iframe.contentWindow.print();},500);
  return false;
}
