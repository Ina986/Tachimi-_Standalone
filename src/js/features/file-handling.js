/**
 * file-handling.js - ファイル・フォルダ選択管理
 * D&D、フォルダ選択、出力先選択、ファイル情報表示
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';

/**
 * デフォルト出力フォルダを初期化
 */
export async function initDefaultOutputFolder() {
    if (!appState.invoke) {
        console.warn('invoke not available yet, retrying...');
        setTimeout(initDefaultOutputFolder, 100);
        return;
    }
    try {
        const defaultFolder = await appState.invoke('get_default_output_folder');
        if (defaultFolder && !appState.outputFolder) {
            appState.outputFolder = defaultFolder;
            updateOutputInfo();
            console.log('デフォルト出力フォルダを設定:', appState.outputFolder);
        }
    } catch (e) {
        console.error('デフォルト出力フォルダの取得に失敗:', e);
    }
}

/**
 * ファイル選択をリセットする
 */
export async function resetFileSelection() {
    appState.inputFolder = null;
    appState.targetFiles = [];
    appState.jsonData = null;
    appState.selectionRanges = [];
    appState.selectedRange = null;

    // UI更新
    $('fileInfo').textContent = '未選択';
    $('outputName').value = '出力';
    $('jsonInfo').textContent = '';
    $('jsonInfo').className = 'json-status';
    $('labelSelectArea').style.display = 'none';
    $('cropRangeStatus').textContent = '⚠ 未設定';
    $('cropRangeStatus').className = 'crop-range-status warning';

    // タチキリ範囲をリセット
    $('cropLeft').value = 0;
    $('cropTop').value = 0;
    $('cropRight').value = 0;
    $('cropBottom').value = 0;
    $('docSizeInfo').textContent = '';

    // ドロップエリアをリセット
    const dropArea = $('dropZone');
    const emptyState = $('dropAreaEmpty');
    const loadedState = $('dropAreaLoaded');
    if (dropArea) dropArea.classList.remove('has-files');
    if (emptyState) emptyState.style.display = 'flex';
    if (loadedState) loadedState.style.display = 'none';

    // 出力フォルダをデフォルトに戻す
    await initDefaultOutputFolder();

    updateExecuteBtn();
}

/**
 * ドラッグ＆ドロップ処理（Tauri v2 パスベース）
 */
export async function handleDroppedPaths(paths) {
    if (!paths || paths.length === 0) return;

    // 既存のファイル選択をリセット
    resetFileSelection();

    const supportedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'psd', 'tif', 'tiff'];
    const firstPath = paths[0];

    // フォルダかファイルかを判定（拡張子の有無で判断）
    const hasExtension = supportedExts.some(ext => firstPath.toLowerCase().endsWith('.' + ext));

    if (!hasExtension && paths.length === 1) {
        // フォルダがドロップされた場合
        try {
            setStatus('フォルダを読み込み中...');
            const files = await appState.invoke('get_image_files', { folderPath: firstPath });

            if (files.length === 0) {
                setStatus('フォルダ内に対応する画像ファイルがありません');
                return;
            }

            appState.inputFolder = firstPath;
            appState.targetFiles = files;

            updateFileInfo();
            updateExecuteBtn();
            setStatus(`${appState.targetFiles.length} ファイルを読み込みました`);
        } catch (e) {
            setStatus('フォルダの読み込みに失敗しました: ' + e);
        }
    } else {
        // ファイルがドロップされた場合
        const validPaths = paths.filter(p => {
            const ext = p.split('.').pop()?.toLowerCase();
            return supportedExts.includes(ext);
        });

        if (validPaths.length === 0) {
            setStatus('対応していないファイル形式です');
            return;
        }

        // 最初のファイルからフォルダパスを取得
        const fullPath = validPaths[0];
        const lastSep = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'));
        appState.inputFolder = fullPath.substring(0, lastSep);

        // ファイル名のみを配列に格納
        appState.targetFiles = validPaths.map(p => {
            const sep = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
            return p.substring(sep + 1);
        });
        appState.targetFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        updateFileInfo();
        updateExecuteBtn();
        setStatus(`${appState.targetFiles.length} ファイルを読み込みました`);
    }
}

/**
 * 入力フォルダ名から出力ファイル名を自動設定
 */
export function updateOutputNameFromFolder() {
    if (!appState.inputFolder) return;

    // フォルダパスから最後のフォルダ名を取得
    const parts = appState.inputFolder.split(/[\\\/]/);
    const folderName = parts[parts.length - 1];

    if (folderName) {
        const outputNameInput = $('outputName');
        if (outputNameInput) {
            outputNameInput.value = folderName;
        }
    }
}

/**
 * ファイル情報表示を更新
 */
export function updateFileInfo() {
    const dropArea = $('dropZone');
    const emptyState = $('dropAreaEmpty');
    const loadedState = $('dropAreaLoaded');

    if (appState.targetFiles.length === 0) {
        $('fileInfo').textContent = '未選択';
        if (dropArea) dropArea.classList.remove('has-files');
        if (emptyState) emptyState.style.display = 'flex';
        if (loadedState) loadedState.style.display = 'none';
    } else if (appState.targetFiles.length === 1) {
        const name = appState.targetFiles[0].split(/[\\\/]/).pop();
        $('fileInfo').textContent = name;
        if (dropArea) dropArea.classList.add('has-files');
        if (emptyState) emptyState.style.display = 'none';
        if (loadedState) loadedState.style.display = 'flex';
        // フォルダ名から出力ファイル名を設定
        updateOutputNameFromFolder();
    } else {
        $('fileInfo').textContent = `${appState.targetFiles.length} ファイル選択済み`;
        if (dropArea) dropArea.classList.add('has-files');
        if (emptyState) emptyState.style.display = 'none';
        if (loadedState) loadedState.style.display = 'flex';
        // フォルダ名から出力ファイル名を設定
        updateOutputNameFromFolder();
    }

    updateExecuteBtn();
}

/**
 * 出力先情報表示を更新
 */
export function updateOutputInfo() {
    const outputInfoEl = $('outputInfo');
    const outputPathDisplay = $('outputPathDisplay');

    if (appState.outputFolder) {
        // パスを省略表示（最後の2つのフォルダ名を表示）
        const parts = appState.outputFolder.split(/[\\\/]/);
        let displayPath;
        if (parts.length <= 2) {
            displayPath = appState.outputFolder;
        } else {
            displayPath = '…/' + parts.slice(-2).join('/');
        }
        outputInfoEl.textContent = displayPath;
        if (outputPathDisplay) {
            outputPathDisplay.title = appState.outputFolder;
        }
    } else {
        outputInfoEl.textContent = '未選択';
        if (outputPathDisplay) {
            outputPathDisplay.title = '';
        }
    }
    updateExecuteBtn();
}

/**
 * 実行ボタンの有効/無効を更新
 */
export function updateExecuteBtn() {
    const hasFiles = appState.targetFiles.length > 0;
    const hasOutput = appState.outputFolder !== null;

    // 出力形式が1つ以上選択されているか判定
    let hasFormat = false;

    // 見開きPDF、単ページPDF、またはJPEGが選択されていれば出力あり
    if (appState.selectedOutputs.spreadPdf || appState.selectedOutputs.singlePdf || appState.selectedOutputs.jpeg) {
        hasFormat = true;
    }

    $('btnExecute').disabled = !hasFiles || !hasOutput || !hasFormat || appState.isProcessing;
}

/**
 * ステータスバー更新
 */
export function setStatus(text) {
    const el = $('status');
    if (el) el.textContent = text;
}

/**
 * イベントリスナーのセットアップ
 */
export function setupFileHandlingEvents() {
    const dropZone = $('dropZone');

    // Tauriのドラッグ＆ドロップイベントをリッスン
    if (appState.listen) {
        // ドラッグ進入時
        appState.listen('tauri://drag-enter', (event) => {
            console.log('[DragDrop] drag-enter', event.payload);
            if (dropZone) dropZone.classList.add('drag-over');
        });

        // ドラッグホバー時
        appState.listen('tauri://drag-over', (event) => {
            if (dropZone) dropZone.classList.add('drag-over');
        });

        // ドラッグ離脱時
        appState.listen('tauri://drag-leave', (event) => {
            console.log('[DragDrop] drag-leave');
            if (dropZone) dropZone.classList.remove('drag-over');
        });

        // ドロップ時
        appState.listen('tauri://drag-drop', async (event) => {
            console.log('[DragDrop] drag-drop', event.payload);
            if (dropZone) dropZone.classList.remove('drag-over');
            const paths = event.payload?.paths;
            if (paths && paths.length > 0) {
                await handleDroppedPaths(paths);
            }
        });
    }

    // ウィンドウ全体のデフォルト動作を防止
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // ドロップエリアをクリックでフォルダ選択
    if (dropZone) {
        dropZone.onclick = async () => {
            const folder = await appState.openDialog({ directory: true });
            if (folder) {
                try {
                    const files = await appState.invoke('get_image_files', { folderPath: folder });
                    if (files.length === 0) {
                        setStatus('フォルダ内に対応する画像ファイルがありません');
                        return;
                    }
                    appState.inputFolder = folder;
                    appState.targetFiles = files;
                    updateFileInfo();
                    setStatus(`${appState.targetFiles.length} ファイルを読み込みました`);
                } catch (e) {
                    setStatus('エラー: ' + e);
                }
            }
        };
    }

    // 出力フォルダ選択
    $('btnSelectOutput').onclick = async () => {
        const folder = await appState.openDialog({ directory: true });
        if (folder) {
            appState.outputFolder = folder;
            updateOutputInfo();
            setStatus('出力先を設定しました');
        }
    };

    // 出力フォルダをデフォルトに戻す
    $('btnResetOutput').onclick = async () => {
        await initDefaultOutputFolder();
        setStatus('出力先をデフォルトに戻しました');
    };

    // クリアボタン
    $('btnClearFiles').onclick = () => {
        resetFileSelection();
        setStatus('ファイル選択をクリアしました');
    };
}
