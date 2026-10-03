// ════ 指で左右に払って、となりのタブへ移る ════
//
// スマホで、人員配置 ⇄ 日報、案件情報 ⇄ 見積情報 のように
// 画面を左右に払うだけで、となりのタブへ移れるようにする。
//
// 気をつけていること
//   ・横に動かせるもの（工程表・人員配置・幅の広い表）の上では、タブを変えない。
//     そのまま中身を横に送れるようにするため。
//     ただし、指を置いた時点ですでに端まで来ていれば、タブを変えてよいものとする
//   ・縦に払ったとき（ふつうのスクロール）では動かさない
//   ・入力欄や、何かを開いている間（モーダル）は動かさない
//   ・指で触ったときだけ。マウスでは動かない

const SWIPE_MIN_X   = 60;   // この幅より大きく払ったらタブを移る（px）
const SWIPE_MAX_Y   = 50;   // 縦にこれ以上動いていたら、縦スクロールと見なす（px）
const SWIPE_RATIO   = 1.5;  // 横の動きが縦の何倍あれば「横に払った」と見るか
const SWIPE_MAX_MS  = 800;  // これより長く触っていたら、払ったとは見なさない

let _swipe = null;

// いま開いているページの、押せるタブのボタン（隠れているものは飛ばす）
function swipeTabButtons(){
  const page = document.querySelector('.page.active');
  if(!page) return [];
  return [...page.querySelectorAll('.sub-tab-bar .sub-tab-btn')]
    .filter(b => b.offsetParent !== null);   // 役割によって隠れているものを除く
}

// 指を置いたところから上へたどって、横に動かせるものを探す
function swipeScrollerAt(el){
  const page = document.querySelector('.page.active');
  for(let n = el; n && n !== document.body; n = n.parentElement){
    if(n.nodeType !== 1) continue;
    const ov = getComputedStyle(n).overflowX;
    if((ov === 'auto' || ov === 'scroll') && n.scrollWidth > n.clientWidth + 2) return n;
    if(n === page) break;
  }
  return null;
}

function swipeIgnore(el){
  if(document.querySelector('.modal-overlay.open')) return true;     // 何か開いている
  if(document.querySelector('#est-list-overlay.open')) return true;
  return !!el.closest('input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"]');
}

function onSwipeStart(e){
  _swipe = null;
  if(e.touches.length !== 1) return;                 // 2本指は拡大縮小なので触らない
  const t = e.touches[0];
  const el = e.target;
  if(swipeIgnore(el)) return;
  if(!swipeTabButtons().length) return;

  // 横に動かせるものの上なら、その端にいるときだけタブを移してよい
  const sc = swipeScrollerAt(el);
  const atLeft  = !sc || sc.scrollLeft <= 1;
  const atRight = !sc || sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 1;

  _swipe = { x: t.clientX, y: t.clientY, t: Date.now(), atLeft, atRight, ok: true };
}

function onSwipeMove(e){
  if(!_swipe || e.touches.length !== 1) { _swipe = null; return; }
  const t = e.touches[0];
  // 縦に大きく動いたら、ふつうのスクロールと見なして以後は無視する
  if(Math.abs(t.clientY - _swipe.y) > SWIPE_MAX_Y) _swipe.ok = false;
}

function onSwipeEnd(e){
  const s = _swipe;
  _swipe = null;
  if(!s || !s.ok) return;
  if(Date.now() - s.t > SWIPE_MAX_MS) return;
  const t = e.changedTouches && e.changedTouches[0];
  if(!t) return;

  const dx = t.clientX - s.x, dy = t.clientY - s.y;
  if(Math.abs(dx) < SWIPE_MIN_X) return;
  if(Math.abs(dy) > SWIPE_MAX_Y) return;
  if(Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

  const next = dx < 0;                 // 左へ払ったら、右どなりのタブへ
  if(next && !s.atRight) return;       // まだ横に送れる途中なので、タブは変えない
  if(!next && !s.atLeft) return;

  swipeGoTab(next ? 1 : -1);
}

// となりのタブへ移る。端まで来ていたら、それ以上は動かさない
function swipeGoTab(dir){
  const btns = swipeTabButtons();
  const i = btns.findIndex(b => b.classList.contains('active'));
  if(i < 0) return;
  const j = i + dir;
  if(j < 0 || j >= btns.length) return;
  btns[j].click();
  // 移った先のタブが隠れていたら、見えるところまで送る
  btns[j].scrollIntoView({ block:'nearest', inline:'center' });
}

document.addEventListener('touchstart', onSwipeStart, { passive:true });
document.addEventListener('touchmove',  onSwipeMove,  { passive:true });
document.addEventListener('touchend',   onSwipeEnd,   { passive:true });
