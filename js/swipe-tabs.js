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

const SWIPE_MIN_X   = 45;   // この幅より大きく払ったらタブを移る（px）
const SWIPE_MAX_Y   = 50;   // 縦にこれ以上動いていたら、縦スクロールと見なす（px）
const SWIPE_RATIO   = 1.2;  // 横の動きが縦の何倍あれば「横に払った」と見るか
const SWIPE_MAX_MS  = 1200; // これより長く触っていたら、払ったとは見なさない
const SWIPE_START_X = 6;    // この幅を越えたら、指に付いて動かし始める（px）
const SWIPE_DRAG    = 0.9;  // 指の動きに対して、どれだけ付いてくるか（1に近いほど手に吸い付く）
const SWIPE_WALL    = 0.14; // となりが無いときの、ひっかかる程度
// さっと払ったときは、短くてもタブを移す（速さ px/ミリ秒、最低これだけは動かす）
const SWIPE_FLICK_V = 0.4;
const SWIPE_FLICK_X = 22;

let _swipe = null;

// いま開いている画面で、払ったときに何が起きるか。
//   btns … 並んでいるタブ。となりへ移る
//   back … チャットを開いているとき。右へ払うと一覧へ戻る
//   pane … 指に付いて動かす中身
function swipeCtx(){
  const page = document.querySelector('.page.active');
  if(!page) return null;

  // チャットはタブの作りが違う（.talk-tab）。
  // スレッドを開いている間は、右へ払うと一覧へ戻る
  if(page.id === 'page-talk'){
    const detail = document.getElementById('talk-panel-detail');
    const list   = document.getElementById('talk-panel-list');
    if(detail && getComputedStyle(detail).display !== 'none'){
      return { pane: detail, btns: [], back: true };
    }
    return { pane: list, btns: [...document.querySelectorAll('#talk-list-tabs .talk-tab')]
                               .filter(b => b.offsetParent !== null) };
  }

  return { pane: page.querySelector('.sub-page.active'),
           btns: [...page.querySelectorAll('.sub-tab-bar .sub-tab-btn')]
                   .filter(b => b.offsetParent !== null) };   // 役割によって隠れているものを除く
}

// いま開いているページの、押せるタブのボタン（隠れているものは飛ばす）
function swipeTabButtons(){ return swipeCtx()?.btns || []; }
// いま出ている中身（動かす対象）
function swipePane(){ return swipeCtx()?.pane || null; }

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

// 中身の横のずれを決める。終わったら必ず消す。
// 指を動かすたびに書き込むと、1回の描き替えに何度も書くことになって重くなるので、
// 次に描くときにまとめて1回だけ反映する
let _swipeRaf = 0, _swipePx = 0, _swipePane = null;
function swipeFlush(){
  _swipeRaf = 0;
  if(_swipePane) _swipePane.style.transform = 'translate3d(' + _swipePx + 'px,0,0)';
}
function swipeShift(pane, px){
  if(!pane) return;
  if(px === null){
    if(_swipeRaf){ cancelAnimationFrame(_swipeRaf); _swipeRaf = 0; }
    _swipePane = null;
    pane.classList.remove('swipe-drag');
    pane.style.transform = '';
    return;
  }
  pane.classList.add('swipe-drag');          // 動かしている間は、なめらかに追従させない
  _swipePane = pane; _swipePx = px;
  if(!_swipeRaf) _swipeRaf = requestAnimationFrame(swipeFlush);
}
// 指を離したあと、短い時間で収める。
// 始まりの位置をいったん確定させてから0へ戻すと、動きとして見える。
// （次の描画を待つ requestAnimationFrame は、画面が裏にあると呼ばれず
//   ずれたまま残ってしまうので使わない）
function swipeSettle(pane, from){
  if(!pane) return;
  if(_swipeRaf){ cancelAnimationFrame(_swipeRaf); _swipeRaf = 0; }
  _swipePane = null;
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
  }, 200);
}

function onSwipeStart(e){
  _swipe = null;
  if(e.touches.length !== 1) return;                 // 2本指は拡大縮小なので触らない
  const t = e.touches[0];
  const el = e.target;
  if(swipeIgnore(el)) return;
  const ctx = swipeCtx();
  if(!ctx) return;
  if(!ctx.back && !ctx.btns.length) return;

  // 横に動かせるものの上なら、その端にいるときだけタブを移してよい
  const sc = swipeScrollerAt(el);
  const atLeft  = !sc || sc.scrollLeft <= 1;
  const atRight = !sc || sc.scrollLeft >= sc.scrollWidth - sc.clientWidth - 1;
  const i = ctx.btns.findIndex(b => b.classList.contains('active'));

  _swipe = { x:t.clientX, y:t.clientY, t:Date.now(), atLeft, atRight, ok:true,
             pane: ctx.pane, drag:false, back: !!ctx.back,
             // チャットを開いている間は、右へ払う（＝一覧へ戻る）だけができる
             hasPrev: ctx.back ? true  : i > 0,
             hasNext: ctx.back ? false : (i >= 0 && i < ctx.btns.length - 1) };
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

  // さっと払ったときは、短くても移す（速さで見る）
  const ms = Math.max(1, Date.now() - s.t);
  const far = Math.abs(dx) >= SWIPE_MIN_X
           || (Math.abs(dx) / ms >= SWIPE_FLICK_V && Math.abs(dx) >= SWIPE_FLICK_X);
  // 行き先があるか。チャットを開いている間は、右へ払ったとき（＝一覧へ戻る）だけ
  const hasWay = s.back ? (dx > 0) : (dx < 0 ? s.hasNext : s.hasPrev);
  const go = s.ok && t
    && Date.now() - s.t <= SWIPE_MAX_MS
    && far
    && hasWay
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
  if(s.back){ swipeGoBack(); return; }
  swipeGoTab(dx < 0 ? 1 : -1);
}

// チャットのスレッドから、一覧へ戻る
function swipeGoBack(){
  if(typeof closeTalkPanelThread !== 'function') return;
  closeTalkPanelThread();
  const list = document.getElementById('talk-panel-list');
  if(list) swipeSettle(list, -44);          // 一覧が左から滑り込む
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
  if(pane) swipeSettle(pane, dir > 0 ? 44 : -44);
}

document.addEventListener('touchstart', onSwipeStart, { passive:true });
document.addEventListener('touchmove',  onSwipeMove,  { passive:true });
document.addEventListener('touchend',   onSwipeEnd,   { passive:true });
document.addEventListener('touchcancel', ()=>{ if(_swipe) swipeShift(_swipe.pane, null); _swipe = null; }, { passive:true });
