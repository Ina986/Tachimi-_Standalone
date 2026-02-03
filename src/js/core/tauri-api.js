/**
 * タチミ - Tauri API ラッパーモジュール
 * Tauri v2 APIの統一的なインターフェース
 */

// API関数の参照を保持
let _invoke = null;
let _convertFileSrc = null;
let _listen = null;
let _openDialog = null;
let _openPath = null;
let _readTextFile = null;
let _statFile = null;
let _messageDialog = null;
let _desktopDir = null;

// 初期化状態
let _initialized = false;
const _initCallbacks = [];

/**
 * Tauri APIを初期化
 * @returns {boolean} 初期化成功の場合true
 */
function initTauriAPIs() {
    if (_initialized) return true;

    console.log('Tauri APIs:', Object.keys(window.__TAURI__ || {}));

    if (!window.__TAURI__) {
        console.error('Tauri API not found!');
        return false;
    }

    // コアAPI
    if (window.__TAURI__.core) {
        _invoke = window.__TAURI__.core.invoke;
        _convertFileSrc = window.__TAURI__.core.convertFileSrc;
    }

    // イベントAPI
    if (window.__TAURI__.event) {
        _listen = window.__TAURI__.event.listen;
    }

    // ダイアログプラグイン
    if (window.__TAURI__.dialog) {
        _openDialog = window.__TAURI__.dialog.open;
        _messageDialog = window.__TAURI__.dialog.message;
        console.log('Dialog API loaded');
    } else {
        console.warn('Dialog API not found');
    }

    // シェルプラグイン
    if (window.__TAURI__.shell) {
        _openPath = window.__TAURI__.shell.open;
    }

    // FSプラグイン
    if (window.__TAURI__.fs) {
        _readTextFile = window.__TAURI__.fs.readTextFile;
        _statFile = window.__TAURI__.fs.stat;
    }

    // Pathプラグイン
    if (window.__TAURI__.path) {
        _desktopDir = window.__TAURI__.path.desktopDir;
    }

    _initialized = true;

    // 待機中のコールバックを実行
    _initCallbacks.forEach(cb => cb());
    _initCallbacks.length = 0;

    return true;
}

/**
 * 初期化完了を待機
 * @returns {Promise<void>}
 */
function waitForInit() {
    return new Promise((resolve) => {
        if (_initialized) {
            resolve();
        } else {
            _initCallbacks.push(resolve);
        }
    });
}

/**
 * Rustコマンドを呼び出す
 * @param {string} command - コマンド名
 * @param {Object} args - 引数
 * @returns {Promise<*>}
 */
async function invoke(command, args = {}) {
    if (!_invoke) {
        await waitForInit();
        if (!_invoke) throw new Error('invoke API not available');
    }
    return _invoke(command, args);
}

/**
 * ローカルファイルパスをアセットURLに変換
 * @param {string} filePath - ファイルパス
 * @returns {string} アセットURL
 */
function convertFileSrc(filePath) {
    if (!_convertFileSrc) {
        console.warn('convertFileSrc not available');
        return filePath;
    }
    return _convertFileSrc(filePath);
}

/**
 * イベントをリッスン
 * @param {string} event - イベント名
 * @param {Function} handler - ハンドラ
 * @returns {Promise<Function>} 解除関数
 */
async function listen(event, handler) {
    if (!_listen) {
        await waitForInit();
        if (!_listen) throw new Error('listen API not available');
    }
    return _listen(event, handler);
}

/**
 * ファイル/フォルダ選択ダイアログを開く
 * @param {Object} options - ダイアログオプション
 * @returns {Promise<string|string[]|null>}
 */
async function openDialog(options = {}) {
    if (!_openDialog) {
        await waitForInit();
        if (!_openDialog) throw new Error('dialog API not available');
    }
    return _openDialog(options);
}

/**
 * メッセージダイアログを表示
 * @param {string} message - メッセージ
 * @param {Object} options - オプション
 * @returns {Promise<void>}
 */
async function showMessage(message, options = {}) {
    if (!_messageDialog) {
        // フォールバック: ブラウザのalert
        alert(message);
        return;
    }
    return _messageDialog(message, options);
}

/**
 * パスを開く（エクスプローラー等）
 * @param {string} path - 開くパス
 * @returns {Promise<void>}
 */
async function openPath(path) {
    if (!_openPath) {
        console.warn('shell.open not available');
        return;
    }
    return _openPath(path);
}

/**
 * テキストファイルを読み込む
 * @param {string} path - ファイルパス
 * @returns {Promise<string>}
 */
async function readTextFile(path) {
    if (!_readTextFile) {
        throw new Error('fs.readTextFile not available');
    }
    return _readTextFile(path);
}

/**
 * ファイル情報を取得
 * @param {string} path - ファイルパス
 * @returns {Promise<Object>}
 */
async function statFile(path) {
    if (!_statFile) {
        throw new Error('fs.stat not available');
    }
    return _statFile(path);
}

/**
 * デスクトップディレクトリを取得
 * @returns {Promise<string>}
 */
async function getDesktopDir() {
    if (!_desktopDir) {
        throw new Error('path.desktopDir not available');
    }
    return _desktopDir();
}

// === タチミ固有のAPIラッパー ===

/**
 * 画像ファイル一覧を取得
 * @param {string} folderPath - フォルダパス
 * @returns {Promise<string[]>}
 */
async function getImageFiles(folderPath) {
    return invoke('get_image_files', { folderPath });
}

/**
 * 画像プレビューを取得（ファイルベース）
 * @param {string} filePath - ファイルパス
 * @param {number} maxWidth - 最大幅
 * @param {number} maxHeight - 最大高さ
 * @returns {Promise<{path: string, width: number, height: number}>}
 */
async function getImagePreviewAsFile(filePath, maxWidth = 800, maxHeight = 800) {
    return invoke('get_image_preview_as_file', { filePath, maxWidth, maxHeight });
}

/**
 * 画像処理を実行
 * @param {Object} options - 処理オプション
 * @returns {Promise<Object>}
 */
async function processImages(options) {
    return invoke('process_images', options);
}

/**
 * PDFを生成
 * @param {Object} options - PDF生成オプション
 * @returns {Promise<Object>}
 */
async function generatePdf(options) {
    return invoke('generate_pdf', options);
}

/**
 * デフォルト出力フォルダを取得
 * @returns {Promise<string>}
 */
async function getDefaultOutputFolder() {
    return invoke('get_default_output_folder');
}

/**
 * フォルダを開く
 * @param {string} path - フォルダパス
 * @returns {Promise<void>}
 */
async function openFolder(path) {
    return invoke('open_folder', { path });
}

/**
 * フォルダを削除
 * @param {string} path - フォルダパス
 * @returns {Promise<void>}
 */
async function deleteFolder(path) {
    return invoke('delete_folder', { path });
}

/**
 * PSDキャッシュをクリア
 * @returns {Promise<void>}
 */
async function clearPsdCache() {
    return invoke('clear_psd_cache');
}

// DOM読み込み後に初期化
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTauriAPIs);
    } else {
        initTauriAPIs();
    }
}

// エクスポート
export {
    // 初期化
    initTauriAPIs,
    waitForInit,

    // コアAPI
    invoke,
    convertFileSrc,
    listen,

    // ダイアログ
    openDialog,
    showMessage,

    // ファイルシステム
    readTextFile,
    statFile,
    getDesktopDir,
    openPath,

    // タチミ固有API
    getImageFiles,
    getImagePreviewAsFile,
    processImages,
    generatePdf,
    getDefaultOutputFolder,
    openFolder,
    deleteFolder,
    clearPsdCache
};

// デフォルトエクスポート
export default {
    initTauriAPIs,
    waitForInit,
    invoke,
    convertFileSrc,
    listen,
    openDialog,
    showMessage,
    readTextFile,
    statFile,
    getDesktopDir,
    openPath,
    getImageFiles,
    getImagePreviewAsFile,
    processImages,
    generatePdf,
    getDefaultOutputFolder,
    openFolder,
    deleteFolder,
    clearPsdCache
};
