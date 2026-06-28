// ════ グローバル状態（アプリ起動中に変化するデータ） ════
// データの実体はSupabase（js/data/db.js）から取得し、ここへ反映する

// 認証・権限
let currentUserRole = null;       // 'staff' | 'supplier'
let currentUserSupplierId = null; // supplierロールの場合、自社のsupplier id
let currentUserDisplayName = '';

// やり取り
let talkPanelOpen = false;
let activeTalkPanelSupplier = null;
let talkThreads = {};

// 受発注
let cart=[], orders=[], orderSeq=1, costEntries=[], currentOrder=null;

// 見積
let estimates=[],estSeq=1,editingEstId=null;
let selectedProjectName=null; // 左サイドバーで選択中の案件（物件名）。一覧の絞り込みに使う
let sections=[],secSeq=1,itemSeq=1;
let estimatePresets=[]; // 工事品目マスタ（工種ごとの明細・単位・原価の選択候補）
let estimateCategories=[]; // 工種マスタ
let estimateDefaults={}; // 工事区分（新築／リフォーム等）ごとのデフォルト明細 {type: sections[]}

// 見積：明細入力画面のドラッグ並び替え用の一時状態
let dragSrcSecId=null;
let dragSrcItemSecId=null, dragSrcItemId=null;

// 見積の工事区分（新築・リフォーム等）。マスタ画面の工事区分タブ・見積入力の選択肢もこれを使う。追加・削除可能
let estimateTypes=[];
let estTypeIdSeq=1;

// 工種・工事品目マスタ画面の一時状態
let editingEstCatId=null;
let editingEstPresetId=null;
let activeEstPresetCat=null;
let activeMasterWorkType='新築'; // 工種・工事品目マスタで今表示中の工事区分
let dragSrcEstCatId=null, estCatDirty=false;
let dragSrcEstPresetId=null, estPresetDirty=false;

// 発注先マスタ
let suppliers = [];
let supplierIdSeq = 1, editingSupplierId=null;

// 品目マスタ
let master = [];
let masterIdSeq = 1, editingMasterId=null;

// 発注作成フロー（発注先選択 → 品目選択）の一時状態
let selectedSupplier=null, activeCat='全て', pendingItem=null;

// 品目マスタ画面（ドラッグ並び替え）の一時状態
let dragSrcId = null;
let activeMasterSupplier = null;
let masterDirty = false; // 並び替え後に保存ボタンを光らせるフラグ

// 発注先マスタ画面（ドラッグ並び替え）の一時状態
let dragSrcSupplierId = null;
let supplierDirty = false;
