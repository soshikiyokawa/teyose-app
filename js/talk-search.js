// ════ チャットの検索 ════
//
// 手元にあるのは、スレッドごとの直近だけ（js/data/db.js の CHAT_FIRST_LOAD）。
// 手元だけを探すと古いやりとりが出てこないので、データベースに探しに行く。
// 見えてよいものだけが返る（データベースの決まりで絞られる）うえ、
// こちらでも「自分の一覧に出ているチャットか」を確かめてから出す。
//
// 通信できないとき・探し方が通らないときは、手元にあるぶんだけを探す。

const TALK_SEARCH_MAX = 100;        // 出す件数の上限（新しい順）
let talkSearch = { q:'', thread:null, only:false, hits:[], seq:0, timer:null, state:'idle', local:false, more:false };

function talkSearchWords(q){
  return String(q||'').trim().split(/[\s　]+/).filter(Boolean).slice(0,5);
}

// 「%」「_」は「何でも当たる字」なので、そのままの字として探すように打ち消す。
// 全体を二重引用符でくるむのは、「,」「(」などが探し方の区切りと取り違えられないようにするため
function talkSearchPattern(word){
  const like = word.replace(/[\\%_]/g, c=>'\\'+c);
  return '"%' + like.replace(/[\\"]/g, c=>'\\'+c) + '%"';
}

// そのチャットのぶんだけに絞る（最後はこちらでも確かめるので、ここは大まかでよい）
function talkSearchScope(qb, name){
  if(isClientThread(name))  return qb.eq('client_project_id', clientThreadIds[name]);
  if(isGroupThread(name))   return qb.eq('group_id', groupThreadIds[name]);
  if(isDirectThread(name)){ const o = directThreadIds[name]; return qb.or(`direct_a.eq.${o},direct_b.eq.${o}`); }
  if(isProjectThread(name)) return qb.eq('project_id', projectThreadIds[name]);
  if(name===INTERNAL_THREAD) return qb.eq('is_internal', true);
  const sid = supplierIdByName(name);
  return sid ? qb.eq('supplier_id', sid) : qb;
}

const TALK_SEARCH_COLS = 'id,type,text,file_name,sender_name,created_at,client_project_id,group_id,'
  + 'direct_a,direct_b,project_id,is_internal,supplier_id,order_no:order_data->>no';

async function dbSearchChat(words, threadName){
  let qb = sb.from('chat_messages').select(TALK_SEARCH_COLS);
  // 言葉を空白で区切ったときは、ぜんぶ入っているものだけ
  words.forEach(w=>{
    const p = talkSearchPattern(w);
    qb = qb.or(`text.ilike.${p},file_name.ilike.${p},order_data->>no.ilike.${p}`);
  });
  if(threadName) qb = talkSearchScope(qb, threadName);
  // 1件多く頼んで、「まだある」かどうかを知る
  const { data, error } = await qb.order('created_at', {ascending:false}).limit(TALK_SEARCH_MAX*3+1);
  if(error) throw error;
  return data || [];
}

// 探した言葉が当たる文（本文・ファイル名・発注書の番号）
function talkSearchTextOf(type, text, fileName, orderNo){
  if(type==='order') return '発注書 '+(orderNo||'')+(text?' '+text:'');
  if(type==='quote') return '見積依頼 '+(orderNo||'')+(text?' '+text:'');
  if(type==='file')  return (fileName||'')+(text&&text!==fileName?' '+text:'');
  return text||'';
}

function talkSearchRowToHit(r){
  return { id:r.id, thread:chatThreadNameOfRow(r), ts:new Date(r.created_at).getTime(),
    sender:r.sender_name||'', type:r.type,
    body:talkSearchTextOf(r.type, r.text, r.file_name, r.order_no) };
}

// 手元にあるぶんだけを探す（通信できないときの代わり）
function talkSearchLocal(words, threadName){
  const names = threadName ? [threadName] : visibleThreadNames();
  const low = words.map(w=>w.toLowerCase());
  const out = [];
  names.forEach(name=>{
    (talkThreads[name]||[]).forEach(m=>{
      if(typeof m.id !== 'number') return;
      const body = talkSearchTextOf(m.type, m.text, m.fileName, m.orderData?.no);
      const hay = body.toLowerCase();
      if(low.every(w=>hay.includes(w))) out.push({id:m.id, thread:name, ts:m.ts, sender:m.senderName||'', type:m.type, body});
    });
  });
  return out.sort((a,b)=>b.ts-a.ts);
}

// ── 画面 ──

function openTalkSearch(){
  const box = document.getElementById('talk-search');
  if(!box) return;
  const from = activeTalkPanelSupplier || null;
  // 開いているチャットから呼んだときは、まずそのチャットの中を探す
  if(from !== talkSearch.thread){ talkSearch.thread = from; talkSearch.only = !!from; }
  else if(!from) talkSearch.only = false;
  box.classList.add('open');
  const inp = document.getElementById('talk-search-q');
  inp.value = talkSearch.q;
  renderTalkSearchScope();
  if(talkSearch.q) runTalkSearch(); else renderTalkSearchResults();
  setTimeout(()=>inp.focus(), 60);
}

function closeTalkSearch(){
  clearTimeout(talkSearch.timer);
  document.getElementById('talk-search')?.classList.remove('open');
  document.getElementById('talk-search-q')?.blur();
}

function talkSearchSetOnly(only){
  talkSearch.only = !!only;
  renderTalkSearchScope();
  runTalkSearch();
}

function renderTalkSearchScope(){
  const el = document.getElementById('talk-search-scope');
  if(!el) return;
  if(!talkSearch.thread){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML =
    `<button type="button" class="tsr-chip${talkSearch.only?' on':''}" onclick="talkSearchSetOnly(true)">このチャットの中</button>`
   +`<button type="button" class="tsr-chip${talkSearch.only?'':' on'}" onclick="talkSearchSetOnly(false)">すべてのチャット</button>`;
}

// 打つたびに探しに行くと通信が増えるので、手が止まってから探す
function talkSearchInput(){
  talkSearch.q = document.getElementById('talk-search-q').value;
  clearTimeout(talkSearch.timer);
  talkSearch.timer = setTimeout(runTalkSearch, 350);
}

async function runTalkSearch(){
  clearTimeout(talkSearch.timer);
  const words = talkSearchWords(talkSearch.q);
  const seq = ++talkSearch.seq;
  if(!words.length){ talkSearch.hits = []; talkSearch.state = 'idle'; renderTalkSearchResults(); return; }
  const scope = (talkSearch.only && talkSearch.thread) ? talkSearch.thread : null;
  talkSearch.state = 'busy';
  renderTalkSearchResults();

  let hits, local = false, more = false;
  try{
    const rows = await dbSearchChat(words, scope);
    const seen = new Set(visibleThreadNames());
    hits = rows.map(talkSearchRowToHit)
      .filter(h=>h.thread && seen.has(h.thread) && (!scope || h.thread===scope));
    more = rows.length > TALK_SEARCH_MAX*3 || hits.length > TALK_SEARCH_MAX;
  }catch(e){
    console.warn('チャットの検索に失敗したので、手元のぶんだけ探します', e);
    hits = talkSearchLocal(words, scope);
    local = true;
    more = hits.length > TALK_SEARCH_MAX;
  }
  if(seq !== talkSearch.seq) return;      // 待っている間に、次の言葉で探し直している
  talkSearch.hits = hits.slice(0, TALK_SEARCH_MAX);
  talkSearch.local = local;
  talkSearch.more = more;
  talkSearch.state = 'done';
  renderTalkSearchResults();
}

// 当たったところの前後を抜き出して、当たった言葉に色を付ける
function talkSearchSnippet(body, words){
  const text = String(body||'').replace(/\s+/g,' ');
  const low = text.toLowerCase();
  let at = -1;
  words.forEach(w=>{ const i = low.indexOf(w.toLowerCase()); if(i>=0 && (at<0 || i<at)) at = i; });
  const from = Math.max(0, (at<0?0:at) - 18);
  const cut = (from>0?'…':'') + text.slice(from, from+90) + (text.length>from+90?'…':'');
  // 先に記号を打ち消してから色を付ける（本文に書かれたタグを効かせない）
  const marks = [];
  const lowCut = cut.toLowerCase();
  words.forEach(w=>{
    const lw = w.toLowerCase();
    for(let i=lowCut.indexOf(lw); i>=0; i=lowCut.indexOf(lw, i+lw.length)) marks.push([i, i+lw.length]);
  });
  marks.sort((a,b)=>a[0]-b[0]);
  let out = '', pos = 0;
  marks.forEach(([a,b])=>{
    if(a < pos) return;
    out += esc(cut.slice(pos,a)) + '<mark>' + esc(cut.slice(a,b)) + '</mark>';
    pos = b;
  });
  return out + esc(cut.slice(pos));
}

function talkSearchWhen(ts){
  const d = new Date(ts), now = new Date();
  const hm = d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  const md = (d.getMonth()+1)+'/'+d.getDate();
  return (d.getFullYear()===now.getFullYear() ? md : d.getFullYear()+'/'+md)+' '+hm;
}

function renderTalkSearchResults(){
  const el = document.getElementById('talk-search-results');
  if(!el) return;
  const words = talkSearchWords(talkSearch.q);
  if(!words.length){
    el.innerHTML = '<div class="empty" style="padding:28px 16px">探したい言葉を入れてください。<br>'
      + '<span style="font-size:12px">空白で区切ると、ぜんぶ入っているものだけを探します</span></div>';
    return;
  }
  if(talkSearch.state==='busy'){ el.innerHTML = '<div class="empty" style="padding:28px 16px">探しています…</div>'; return; }
  const hits = talkSearch.hits;
  if(!hits.length){
    el.innerHTML = '<div class="empty" style="padding:28px 16px">見つかりませんでした'
      + (talkSearch.local ? '<br><span style="font-size:12px">通信できなかったので、手元にあるぶんだけを探しました</span>' : '') + '</div>';
    return;
  }
  const all = !(talkSearch.only && talkSearch.thread);
  const head = `<div class="tsr-count">${hits.length}件${talkSearch.more?'（新しい順に'+TALK_SEARCH_MAX+'件まで。言葉を足すと絞れます）':''}`
    + (talkSearch.local ? '<br>通信できなかったので、手元にあるぶんだけを探しました' : '') + '</div>';
  el.innerHTML = head + hits.map((h,i)=>
    `<div class="tsr-row" onclick="openTalkSearchHit(${i})">
      <div class="tsr-top"><span class="tsr-who">${esc(h.sender||'—')}</span><span class="tsr-when">${talkSearchWhen(h.ts)}</span></div>
      <div class="tsr-body">${talkSearchSnippet(h.body, words)}</div>
      ${all?`<div class="tsr-thread">${esc(threadLabel(h.thread))}</div>`:''}
    </div>`).join('');
}

// ── 見つけたところへ飛ぶ ──
//
// 古いやりとりは手元に無いことがある。そのときは、そこに届くまで前を読み足す。
async function openTalkSearchHit(i){
  const h = talkSearch.hits[i];
  if(!h) return;
  closeTalkSearch();
  chatBookmarkFilter = false;
  openTalkPanelThread(h.thread, {noFocus:true});
  chatUnreadMark = null;            // 未読の位置ではなく、見つけたところへ送る
  _chatStick = false;

  const has = ()=>(talkThreads[h.thread]||[]).some(m=>m.id===h.id);
  let guard = 0;
  while(!has() && chatOlder[h.thread] && guard++ < 60){
    const list = talkThreads[h.thread]||[];
    const oldest = list.find(m=>typeof m.id === 'number');
    if(!oldest) break;
    if(guard===1) showToast('前のやりとりを読んでいます…');
    let rows;
    try{ rows = await dbOlderChatRows(oldest.id); }catch(_){ break; }
    if(rows.length < CHAT_MORE_LOAD) chatOlder[h.thread] = false;
    const have = new Set((talkThreads[h.thread]||[]).map(m=>m.id));
    const add = rows.map(chatRowToMsg).filter(m=>!have.has(m.id));
    if(!add.length) break;
    talkThreads[h.thread] = add.concat(talkThreads[h.thread]||[]).sort((a,b)=>a.ts-b.ts);
  }
  if(activeTalkPanelSupplier !== h.thread) return;   // 待っている間に、ほかへ移った
  resetChatRenderSignature();
  renderTalkPanelMessages();
  if(!has()){ showToast('そのメッセージは見つかりませんでした（消された可能性があります）'); return; }
  talkShowMessage(h.id);
}

// その吹き出しを画面の上のほうに出して、しばらく色を付ける
function talkShowMessage(id){
  const el = document.getElementById('talk-panel-messages');
  const place = ()=>{
    const node = el?.querySelector(`.talk-bubble[data-mid="${id}"]`);
    if(!node || activeTalkPanelSupplier==null) return null;
    _chatStick = false;
    chatSetScrollTop(el, Math.max(0, chatAnchorTop(el, node) - Math.round(el.clientHeight*0.25)));
    return node;
  };
  const node = place();
  if(!node) return;
  updateChatNewMark(el.scrollHeight - el.scrollTop - el.clientHeight > CHAT_BOTTOM_SLACK);
  node.classList.add('talk-hit');
  setTimeout(()=>node.classList.remove('talk-hit'), 2600);
  // 上にある写真があとから入ると、そのぶん下へずれる。指で動かしていなければ合わせ直す
  const top0 = el.scrollTop;
  let last = top0;
  [250, 700, 1400].forEach(ms=>setTimeout(()=>{
    if(Math.abs(el.scrollTop - last) > 2) return;      // 指で動かした
    if(place()) last = el.scrollTop;
  }, ms));
}
