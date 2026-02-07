/**
 * app-state.js - 共有ミュータブル状態
 * renderer.jsのグローバル変数を1:1マッピングしたオブジェクト
 */

const appState = {
    // Tauri API references (initTauriAPIs()で設定)
    invoke: null,
    convertFileSrc: null,
    listen: null,
    openDialog: null,
    openPath: null,
    readTextFile: null,
    statFile: null,
    messageDialog: null,
    desktopDir: null,

    // ファイル・フォルダ状態
    inputFolder: null,
    targetFiles: [],
    outputFolder: null,
    jsonData: null,
    selectionRanges: [],
    selectedRange: null,
    isProcessing: false,

    // クロップモード状態
    previewImageSize: { width: 0, height: 0 },
    previewScale: 1,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    cropModeOpen: false,
    savedCropValues: { left: 0, top: 0, right: 0, bottom: 0 },
    guides: [],
    cropModeStep: 'select',
    isFirstCropModeOpen: true,
    guideMode: null,
    rulerDragging: null,
    currentPreviewPageIndex: 0,
    currentZoom: 1.0,
    lastMousePos: { x: 0, y: 0 },
    baseContainerSize: { width: 0, height: 0 },
    isSpacePressed: false,
    isPanning: false,
    panStart: { x: 0, y: 0, scrollX: 0, scrollY: 0 },

    // Undo/Redo履歴
    undoHistory: [],
    redoHistory: [],

    // 出力形式の選択状態
    selectedOutputs: {
        spreadPdf: true,
        singlePdf: false,
        jpeg: false
    },

    // JSON登録モーダル用状態
    registerModalSelectedFile: null,
    registerModalExistingData: null,
    jsonSelectModal: null,
    duplicateLabelCallback: null,
    duplicateLabelOriginal: '',

    // ローディングオーバーレイ用
    loadingTimerInterval: null,
    loadingRemainingTime: 0,
};

export { appState };
export default appState;
