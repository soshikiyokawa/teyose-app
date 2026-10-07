// ════ 請求書を、確かめる画面の中に出す ════
//
// AIが読んだ数字が合っているかを確かめるとき、請求書そのものを横に（スマホでは上に）出す。
// 中で上下左右に送れて、拡大もできる。
//
//   ・PDF  … pdf.js で1ページずつ絵にして並べる。
//            ブラウザ任せ（iframe）にすると、iPhoneでは1ページ目しか出ず、
//            Androidではそもそも表示されないため
//   ・画像 … そのまま出す
//
// pdf.js は大きい（1.5MB）ので、この画面を初めて開いたときにだけ読み込む。
// よそのCDNではなく自前（vendor/pdfjs）に置いてある。

const INV_VIEW_ZOOMS = [1, 1.5, 2, 3];
const INV_VIEW_MAX_PAGES = 30;
// root … 請求書を出す場所（.invamt-viewcol）。金額の確認と、明細の割り当ての2か所で使う
let invView = { token:0, pdf:null, url:'', kind:'', zoom:1, root:null };

// 部品の置き場。pdf.js は相対の場所を「いま開いているページ」から数えるので、
// ずれないように、はじめから完全な場所にして渡す
function invPdfJsDir(){ return new URL('vendor/pdfjs/', document.baseURI).href; }

let _invPdfJs = null;
function invLoadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve();
  if(!_invPdfJs){
    _invPdfJs = new Promise((res, rej)=>{
      const s = document.createElement('script');
      s.src = invPdfJsDir() + 'pdf.min.js';
      s.onload = ()=>{
        try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = invPdfJsDir() + 'pdf.worker.min.js'; }catch(_){}
        res();
      };
      s.onerror = ()=>{ _invPdfJs = null; rej(new Error('表示の部品を読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }
  return _invPdfJs;
}

function invViewIsPdf(v){
  return /pdf/i.test(v.fileMime||'') || /\.pdf$/i.test(v.fileName||'') || /\.pdf$/i.test(v.filePath||'');
}
function invViewBox(){ return invView.root ? invView.root.querySelector('.invv-box') : null; }
function invViewMsg(html){
  const box = invViewBox();
  if(box) box.innerHTML = `<div class="invv-msg">${html}</div>`;
}

// 請求書を出す。root は出す場所（省くと、金額を確かめる画面）
async function invViewOpen(v, root){
  invViewClose();                        // 前に出していた場所を片付けてから、場所を替える
  invView.root = root || document.querySelector('#invamt-modal .invamt-viewcol');
  const box = invViewBox();
  if(!box) return;
  invView.root.classList.remove('invv-collapsed');
  const token = ++invView.token;
  invView.zoom = 1;
  invViewSyncZoom();
  invViewMsg('請求書を読み込んでいます…');

  let url;
  try{ url = await dbInvoiceUrl(v.filePath); }
  catch(_){ if(token===invView.token) invViewMsg('請求書を開けませんでした'); return; }
  if(token !== invView.token) return;          // 待っている間に閉じた・別のを開いた
  invView.url = url;
  invView.kind = invViewIsPdf(v) ? 'pdf' : 'image';

  if(invView.kind === 'image'){ invViewDraw(); return; }

  try{
    await invLoadPdfJs();
    if(token !== invView.token) return;
    const pdf = await window.pdfjsLib.getDocument({
      url: new URL(url, document.baseURI).href,
      // 日本語の字が入っていないPDFでも字が出るように、字の対応表と基本の字形を渡す
      cMapUrl: invPdfJsDir() + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: invPdfJsDir() + 'standard_fonts/'
    }).promise;
    if(token !== invView.token){ try{ pdf.destroy(); }catch(_){} return; }
    invView.pdf = pdf;
    await invViewDraw();
  }catch(e){
    if(token !== invView.token) return;
    console.warn('請求書を表示できませんでした', e?.message||e);
    invViewMsg(`この画面には表示できませんでした。<br>
      <button type="button" class="btn sm" style="margin-top:8px" onclick="invViewOpenTab()">別の画面で開く</button>`);
  }
}

// いまの拡大率で描く（拡大を変えたときも、ここを通る）
async function invViewDraw(){
  const box = invViewBox();
  if(!box || !invView.url) return;
  const token = invView.token;
  const zoom = invView.zoom;
  const keepX = box.scrollWidth  ? box.scrollLeft / box.scrollWidth  : 0;
  const keepY = box.scrollHeight ? box.scrollTop  / box.scrollHeight : 0;
  const baseW = Math.max(120, box.clientWidth - 16);      // 左右の余白ぶん
  const cssW  = Math.round(baseW * zoom);

  if(invView.kind === 'image'){
    box.innerHTML = `<img class="invv-page" src="${invView.url}" alt="請求書" style="width:${cssW}px">`;
    return;
  }
  const pdf = invView.pdf;
  if(!pdf) return;

  const n = Math.min(pdf.numPages, INV_VIEW_MAX_PAGES);
  const frag = document.createDocumentFragment();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for(let i=1; i<=n; i++){
    const page = await pdf.getPage(i);
    if(token !== invView.token || zoom !== invView.zoom) return;   // 途中で閉じた・拡大を変えた
    const base = page.getViewport({ scale:1 });
    // 絵の細かさ。大きくしすぎるとスマホで落ちるので、幅4000pxで頭打ちにする
    const scale = Math.min(cssW * dpr, 4000) / base.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.className = 'invv-page';
    canvas.width  = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = cssW + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if(token !== invView.token || zoom !== invView.zoom) return;
    frag.appendChild(canvas);
    if(n > 1){
      const no = document.createElement('div');
      no.className = 'invv-no';
      no.textContent = `${i} / ${pdf.numPages}`;
      frag.appendChild(no);
    }
  }
  if(pdf.numPages > n){
    const more = document.createElement('div');
    more.className = 'invv-msg';
    more.innerHTML = `${n}ページ目までを出しています。続きは
      <button type="button" class="btn xs" onclick="invViewOpenTab()">別の画面で開く</button>`;
    frag.appendChild(more);
  }
  box.innerHTML = '';
  box.appendChild(frag);
  // 拡大しても、見ていたあたりがそのまま見えるようにする
  box.scrollLeft = keepX * box.scrollWidth;
  box.scrollTop  = keepY * box.scrollHeight;
}

// 拡大・縮小（dir：+1 で大きく、-1 で小さく）
function invViewZoom(dir){
  const i = INV_VIEW_ZOOMS.indexOf(invView.zoom);
  const j = Math.max(0, Math.min(INV_VIEW_ZOOMS.length-1, (i<0?0:i) + dir));
  if(INV_VIEW_ZOOMS[j] === invView.zoom) return;
  invView.zoom = INV_VIEW_ZOOMS[j];
  invViewSyncZoom();
  invViewDraw();
}
function invViewSyncZoom(){
  const r = invView.root; if(!r) return;
  const lbl = r.querySelector('.invv-zoom');
  if(lbl) lbl.textContent = Math.round(invView.zoom*100) + '%';
  const i = INV_VIEW_ZOOMS.indexOf(invView.zoom);
  const out = r.querySelector('.invv-out'), inn = r.querySelector('.invv-in');
  if(out) out.disabled = i <= 0;
  if(inn) inn.disabled = i >= INV_VIEW_ZOOMS.length-1;
}

// スマホで入力欄を広く使いたいとき、請求書をたたむ（もう一度押すと出る）
function invViewToggle(){
  const r = invView.root; if(!r) return;
  const hide = r.classList.toggle('invv-collapsed');
  const b = r.querySelector('.invv-fold');
  if(b) b.textContent = hide ? '出す' : 'たたむ';
  if(!hide) invViewDraw();               // たたんでいる間に幅が変わっていても、出したときに合わせる
}

function invViewOpenTab(){
  if(invView.url) window.open(invView.url, '_blank');
}

// 片付ける（閉じたあとも大きな絵を抱えたままにしない）
function invViewClose(){
  invView.token++;
  if(invView.pdf){ try{ invView.pdf.destroy(); }catch(_){} }
  invView.pdf = null; invView.url = ''; invView.kind = '';
  const box = invViewBox();
  if(box) box.innerHTML = '';
}
