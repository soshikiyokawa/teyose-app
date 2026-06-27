// ════ 自動保存（ブラウザのlocalStorageに保存し、再読み込みしてもデータを保持） ════
const STORAGE_KEY = 'teyose-app-data-v1';

function saveAppState(){
  const data = {
    suppliers, supplierIdSeq,
    master, masterIdSeq,
    estimates, estSeq,
    orders, orderSeq,
    costEntries,
    talkThreads
  };
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }catch(e){
    console.warn('保存に失敗しました', e);
  }
}

function loadAppState(){
  let raw;
  try{
    raw = localStorage.getItem(STORAGE_KEY);
  }catch(e){
    console.warn('読み込みに失敗しました', e);
    return false;
  }
  if(!raw) return false;
  try{
    const data = JSON.parse(raw);
    if(data.suppliers) suppliers = data.suppliers;
    if(data.supplierIdSeq) supplierIdSeq = data.supplierIdSeq;
    if(data.master) master = data.master;
    if(data.masterIdSeq) masterIdSeq = data.masterIdSeq;
    if(data.estimates) estimates = data.estimates;
    if(data.estSeq) estSeq = data.estSeq;
    if(data.orders) orders = data.orders;
    if(data.orderSeq) orderSeq = data.orderSeq;
    if(data.costEntries) costEntries = data.costEntries;
    if(data.talkThreads) talkThreads = data.talkThreads;
    return true;
  }catch(e){
    console.warn('保存データの読み込みに失敗しました', e);
    return false;
  }
}

let _autosaveTimer = null;
function scheduleAutosave(){
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(saveAppState, 400);
}
