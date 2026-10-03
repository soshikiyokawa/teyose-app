// ════ 指で左右に払って、となりのタブへ移る ════
//
// スマホで、人員配置 ⇄ 日報、案件情報 ⇄ 見積情報 のように
// 画面を左右に払うだけで、となりのタブへ移れるようにする。
//
// 指に付いてくるように動かす。
//   ・払っている間、中身が指と一緒に横へずれる（どちらへ動くか手元で分かる）
//   ・指を離すと、短い時間で滑らかに収まる
//   ・いちばん端のタブでは、少しだけ動いて戻る（それ以上は無いことが手で分かる）
//
// 気をつけていること
//   ・横に動かせるもの（工程表・人員配置・幅の広い表）の上では、タブを変えない。
//     そのまま中身を横に送れるようにするため。
//     ただし、指を置いた時点ですでに端まで来ていれば、タブを変えてよいものとする
//   ・縦に払ったとき（ふつうのスクロール）では動かさない
//   ・入力欄や、何かを開いている間（モーダル）は動かさない
//   ・指で触ったときだけ。マウスでは動かない
//   ・終わったら必ず transform を消す（残すと中身の貼り付き表示がおかしくなるため）

const SWIPE_MIN_X   = 60;   // この幅より大きく払ったらタブを移る（px）
const SWIPE_MAX_Y   = 50;   // 縦にこれ以上動いていたら、縦スクロールと見なす（px）
const SWIPE_RATIO   = 1.5;  // 横の動きが縦の何倍あれば「横に払った」と見るか
const SWIPE_MAX_MS  = 800;  // これより長く触っていたら、払ったとは見なさない
const SWIPE_START_X = 12;   // この幅を越えたら、指に付いて動かし始める（px）
const SWIPE_DRAG    = 0.45; // 指の動きに対して、どれだけ付いてくるか
const SWIPE_WALL    = 0.12; // となりが無いときの、ひっかかる程度

let _swipe = null;

// いま開いているページの、押せるタブのボタン（隠れているものは飛ばす）
function swipeTabButtons(){
  const page = document.querySelector('.page.active');
  if(!page) return [];
  return [...page.querySelectorAll('.sub-tab-bar .sub-tab-btn')]
    .filter(b => b.offsetParent !== null);   // 役割によって隠れているものを除く
}
// いま出ている中身（動かす対象）
function swipePane(){
  const page = document.querySelector('.page.active');
  return page ? page.querySelector('.sub-page.active') : null;
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

// 中身の横のずれを決める。終わったら必ず消す
function swipeShift(pane, px){
  if(!pane) return;
  if(px === null){
    pane.classList.remove('swipe-drag');
    pane.style.transform = '';
    return;
  }
  pane.classList.add('swipe-drag');          // 動かしている間は、なめらかに追従させない
  pane.style.transform = 'translate3d(' + px + 'px,0,0)';
}
// 指を離したあと、短い時間で収める。
// 始まりの位置をいったん確定させてから0へ戻すと、動きとして見える。
// （次の描画を待つ requestAnimationFrame は、画面が裏にあると呼ばれず
//   ずれたまま残ってしまうので使わない）
function swipeSettle(pane, from){
  if(!pane) return;
  pane.classList.remove('swipe-drag');
  if(from){
    pane.style.transition = 'none';
    pane.style.transform = 'translate3d(' + from + 'px,0,0)';
    void pane.offsetWidth;                 // ここで一度確定させる
    pane.style.transition = '';
  }
  pane.style.transform = 'translate3d(0,0,0)';
  clearTimeout(pane._swipeT);
  pane._swipeT = setTimeout(()=>{
    pane.style.transform = '';
    pane.style.transition = '';
  }, 260);
}

function onSwipeStart(e){
  _swipe = null;
  if(e.touches.length !== 1) return;                 // 2本指は拡大縮小なので触らない
  const t = e.touches[0];
  const el = e.target;
  if(swipeIgnore(el)) return;
  const btns = swipeTabButtons();
  if(!btns.length) return;

  // 横に動かせるものの上なら、その端にいるときだけタブを移してよい
  const sc = swipeScrollerAt(el);
  const atLeft  = !sc || sc.scrollLeft <= 1;
  const atRight = !sc || sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 1;
  const i = btns.findIndex(b => b.classList.contains('active'));

  _swipe = { x:t.clientX, y:t.clientY, t:Date.now(), atLeft, atRight, ok:true,
             pane: swipePane(), drag:false,
             hasPrev: i > 0, hasNext: i >= 0 && i < btns.length - 1 };
}

function onSwipeMove(e){
  const s = _swipe;
  if(!s || e.touches.length !== 1){ if(s) swipeShift(s.pane, null); _swipe = null; return; }
  const t = e.touches[0];
  const dx = t.clientX - s.x, dy = t.clientY - s.y;

  // 縦に大きく動いたら、ふつうのスクロールと見なして以後は無視する
  if(Math.abs(dy) > SWIPE_MAX_Y){
    if(s.drag){ swipeShift(s.pane, null); s.drag = false; }
    s.ok = false;
    return;
  }
  if(!s.ok) return;
  if(Math.abs(dx) < SWIPE_START_X || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

  // タブを変えられない向きなら、少しだけ動かして「ここが端」と分かるようにする
  const toNext = dx < 0;
  const canGo = toNext ? (s.hasNext && s.atRight) : (s.hasPrev && s.atLeft);
  s.drag = true;
  swipeShift(s.pane, dx * (canGo ? SWIPE_DRAG : SWIPE_WALL));
}

function onSwipeEnd(e){
  const s = _swipe;
  _swipe = null;
  if(!s) return;
  const t = e.changedTouches && e.changedTouches[0];
  const dx = t ? t.clientX - s.x : 0;
  const dy = t ? t.clientY - s.y : 0;

  const go = s.ok && t
    && Date.now() - s.t <= SWIPE_MAX_MS
    && Math.abs(dx) >= SWIPE_MIN_X
    && Math.abs(dy) <= SWIPE_MAX_Y
    && Math.abs(dx) >= Math.abs(dy) * SWIPE_RATIO
    && (dx < 0 ? s.atRight : s.atLeft);

  if(!go){
    // 戻す。動かしていたぶんから0へ滑らせる
    if(s.drag) swipeSettle(s.pane, dx * SWIPE_WALL);
    else swipeShift(s.pane, null);
    return;
  }
  swipeShift(s.pane, null);      // 元のタブの中身は、ずらしたまま消さずに戻しておく
  swipeGoTab(dx < 0 ? 1 : -1);
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

  // 新しい中身を、払った向きから滑り込ませる
  const pane = swipePane();
  if(pane) swipeSettle(pane, dir > 0 ? 60 : -60);
}

document.addEventListener('touchstart', onSwipeStart, { passive:true });
document.addEventListener('touchmove',  onSwipeMove,  { passive:true });
document.addEventListener('touchend',   onSwipeEnd,   { passive:true });
document.addEventListener('touchcancel', ()=>{ if(_swipe) swipeShift(_swipe.pane, null); _swipe = null; }, { passive:true });
