/**
 * output-panels.js - 出力形式パネル管理
 * 見開きPDF・単ページPDF・JPEG の設定UI + タチキリカード
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { COLOR_MAP } from './constants.js';

/**
 * 出力形式カードの初期化（複数選択対応）
 */
export function setupPresetCards() {
    const cards = document.querySelectorAll('.output-type-card');

    // カードクリックイベント（トグル選択）
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;

            // 選択状態をトグル
            card.classList.toggle('selected');

            // 状態を更新
            if (type === 'spread-pdf') {
                appState.selectedOutputs.spreadPdf = card.classList.contains('selected');
            } else if (type === 'single-pdf') {
                appState.selectedOutputs.singlePdf = card.classList.contains('selected');
            } else if (type === 'jpeg') {
                appState.selectedOutputs.jpeg = card.classList.contains('selected');
            }

            // パネル表示を更新
            updateOutputPanels();

            // 実行ボタンの状態を更新
            if (typeof window.updateExecuteBtn === 'function') window.updateExecuteBtn();
        });
    });

    // 見開きPDF設定のイベント
    setupSpreadPdfEvents();

    // 単ページPDF設定のイベント
    setupSinglePdfEvents();

    // JPEG設定のイベント
    setupJpegEvents();

    // 初期状態のパネル表示
    updateOutputPanels();

    // 初期状態のプレビュー更新
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
    if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
}

/**
 * 出力形式パネルの表示/非表示を更新
 */
export function updateOutputPanels() {
    const spreadPanel = $('spreadPdfPanel');
    const singlePanel = $('singlePdfPanel');
    const jpegPanel = $('jpegPanel');

    if (spreadPanel) {
        spreadPanel.style.display = appState.selectedOutputs.spreadPdf ? 'block' : 'none';
    }
    if (singlePanel) {
        singlePanel.style.display = appState.selectedOutputs.singlePdf ? 'block' : 'none';
    }
    if (jpegPanel) {
        jpegPanel.style.display = appState.selectedOutputs.jpeg ? 'block' : 'none';
    }

    // JPEGパネル内のノンブル設定表示を更新
    updateJpegNombreSectionVisibility();

    // プレビューを更新
    if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
}

/**
 * 見開きPDF設定のイベント初期化
 */
function setupSpreadPdfEvents() {
    // ノド有効/無効トグル
    const gutterEnabled = $('spreadGutterEnabled');
    const gutterSliderArea = $('spreadGutterSliderArea');
    if (gutterEnabled && gutterSliderArea) {
        gutterEnabled.addEventListener('change', () => {
            gutterSliderArea.classList.toggle('disabled', !gutterEnabled.checked);
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // 余白有効/無効トグル
    const paddingEnabled = $('spreadPaddingEnabled');
    const paddingSliderArea = $('spreadPaddingSliderArea');
    if (paddingEnabled && paddingSliderArea) {
        paddingEnabled.addEventListener('change', () => {
            paddingSliderArea.classList.toggle('disabled', !paddingEnabled.checked);
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
            // ノンブルヒントを更新
            updateSpreadNombreHint();
        });
    }

    // ノドスライダー
    const gutterSlider = $('spreadGutterSlider');
    if (gutterSlider) {
        gutterSlider.addEventListener('input', () => {
            $('spreadGutterValue').textContent = gutterSlider.value;
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // 余白スライダー
    const paddingSlider = $('spreadPaddingSlider');
    if (paddingSlider) {
        paddingSlider.addEventListener('input', () => {
            $('spreadPaddingValue').textContent = paddingSlider.value;
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // 先頭白紙追加チェック
    const whitePage = $('spreadWhitePage');
    if (whitePage) {
        whitePage.addEventListener('change', () => {
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // 作品情報印字チェック
    const workInfo = $('spreadWorkInfo');
    if (workInfo) {
        workInfo.addEventListener('change', () => {
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // ノンブル追加チェック
    const addNombre = $('spreadAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('spreadNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
            // 他のパネルのノンブル設定も同期
            syncNombreSettings('spread');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('spreadNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
            if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('spread');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('spreadNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('spread');
        });
    }

    // 初期状態でノンブルヒントを設定
    updateSpreadNombreHint();
}

/**
 * 単ページPDF設定のイベント初期化
 */
function setupSinglePdfEvents() {
    // ノンブル追加チェック
    const addNombre = $('singleAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('singleNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
            // 他のパネルのノンブル設定も同期
            syncNombreSettings('single');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('singleNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
            if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('single');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('singleNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('single');
        });
    }
}

/**
 * JPEG設定のイベント初期化
 */
function setupJpegEvents() {
    // ノンブル追加チェックボックス
    const addNombre = $('jpegAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('jpegNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('jpeg');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('jpegNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
            syncNombreSettings('jpeg');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('jpegNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('jpeg');
        });
    }
}

/**
 * タチキリカードの初期化
 */
export function setupTachikiriCards() {
    const cards = document.querySelectorAll('.tachikiri-card-sm');
    const select = $('tachikiriSelect');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            // 選択状態を更新
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            // 隠しセレクトの値を更新
            const value = card.dataset.value;
            select.value = value;

            // 既存の設定更新処理を呼び出し
            updateTachikiriSettings();
        });
    });
}

/**
 * タチキリ設定の更新（色設定の表示/非表示 + プレビュー更新）
 */
export function updateTachikiriSettings() {
    const tachikiriType = $('tachikiriSelect')?.value || 'none';

    // 範囲指定パネルの表示/非表示
    const cropSettings = $('cropSettings');
    if (cropSettings) {
        cropSettings.style.display = tachikiriType !== 'none' ? 'block' : 'none';
    }

    updateColorSettingsVisibility(tachikiriType);

    // 範囲選択ステータスを更新
    if (tachikiriType !== 'none') {
        if (typeof window.updateCropRangeStatus === 'function') window.updateCropRangeStatus();
    }

    // 画像選択モードが開いている場合、オーバーレイの色設定も更新
    if (appState.cropModeOpen) {
        if (typeof window.syncColorSettingsToOverlay === 'function') window.syncColorSettingsToOverlay();
        if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();
    }

    // JPEGオプションの無効化状態を更新
    updateJpegOptionsAvailability();

    // 全プレビューにタチキリ設定を反映
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
    if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
}

/**
 * タチキリタイプに応じて色設定の表示/非表示を切り替え
 */
export function updateColorSettingsVisibility(tachikiriType) {
    const needsStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);
    const needsFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);

    $('colorSettings').style.display = (needsStroke || needsFill) ? 'flex' : 'none';
    $('strokeColorRow').style.display = needsStroke ? 'flex' : 'none';
    $('fillColorRow').style.display = needsFill ? 'flex' : 'none';
    $('fillOpacityRow').style.display = needsFill ? 'flex' : 'none';
}

/**
 * 見開きPDFのノンブルヒントを更新
 */
export function updateSpreadNombreHint() {
    const hint = $('spreadNombreHint');
    if (!hint) return;

    const paddingEnabled = $('spreadPaddingEnabled')?.checked ?? true;
    if (paddingEnabled) {
        hint.textContent = '※ 余白有効時はPDF余白に追加';
    } else {
        hint.textContent = '※ 余白無効時は画像に追加（タチキリ領域内）';
    }
}

/**
 * ノンブル設定を他のパネルと同期
 */
export function syncNombreSettings(source) {
    const spreadCheck = $('spreadAddNombre');
    const singleCheck = $('singleAddNombre');
    const jpegCheck = $('jpegAddNombre');

    let isChecked = false;
    let startValue = '1';
    let sizeValue = 'medium';

    // ソースから値を取得
    if (source === 'spread' && spreadCheck) {
        isChecked = spreadCheck.checked;
        startValue = $('spreadNombreStart')?.value || '1';
        sizeValue = $('spreadNombreSize')?.value || 'medium';
    } else if (source === 'single' && singleCheck) {
        isChecked = singleCheck.checked;
        startValue = $('singleNombreStart')?.value || '1';
        sizeValue = $('singleNombreSize')?.value || 'medium';
    } else if (source === 'jpeg' && jpegCheck) {
        isChecked = jpegCheck.checked;
        startValue = $('jpegNombreStart')?.value || '1';
        sizeValue = $('jpegNombreSize')?.value || 'medium';
    }

    // 他のパネルに同期
    if (source !== 'spread' && spreadCheck) {
        spreadCheck.checked = isChecked;
        if ($('spreadNombreStart')) $('spreadNombreStart').value = startValue;
        if ($('spreadNombreSize')) $('spreadNombreSize').value = sizeValue;
        if ($('spreadNombreSettings')) {
            $('spreadNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'single' && singleCheck) {
        singleCheck.checked = isChecked;
        if ($('singleNombreStart')) $('singleNombreStart').value = startValue;
        if ($('singleNombreSize')) $('singleNombreSize').value = sizeValue;
        if ($('singleNombreSettings')) {
            $('singleNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'jpeg' && jpegCheck) {
        jpegCheck.checked = isChecked;
        if ($('jpegNombreStart')) $('jpegNombreStart').value = startValue;
        if ($('jpegNombreSize')) $('jpegNombreSize').value = sizeValue;
        if ($('jpegNombreSettings')) {
            $('jpegNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }

    // 各プレビューを更新
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
    if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
}

/**
 * JPEGパネル内のノンブル設定セクションの表示/非表示を更新
 */
export function updateJpegNombreSectionVisibility() {
    const jpegNombreSection = $('jpegNombreSection');
    const jpegPdfSyncNote = $('jpegPdfSyncNote');

    if (!jpegNombreSection || !jpegPdfSyncNote) return;

    const hasPdf = appState.selectedOutputs.spreadPdf || appState.selectedOutputs.singlePdf;

    if (hasPdf) {
        // PDFが選択されている場合、ノンブル設定は非表示にし、同期メッセージを表示
        jpegNombreSection.style.display = 'none';
        jpegPdfSyncNote.style.display = 'block';
    } else {
        // JPEG単独の場合、独自のノンブル設定を表示
        jpegNombreSection.style.display = 'flex';
        jpegPdfSyncNote.style.display = 'none';
    }
}

/**
 * 互換性のため残す（旧関数名）
 */
export function updateJpegOptionsAvailability() {
    updateJpegNombreSectionVisibility();
}

/**
 * イベントリスナーのセットアップ
 */
export function setupOutputPanelEvents() {
    // タチキリ設定表示切替（ドロップダウン）
    $('tachikiriSelect').onchange = updateTachikiriSettings;

    // 色選択変更時のプレビュー更新
    $('strokeColor').onchange = () => {
        $('strokeColorPreview').style.background = COLOR_MAP[$('strokeColor').value];
        if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
        if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
    };
    $('fillColor').onchange = () => {
        $('fillColorPreview').style.background = COLOR_MAP[$('fillColor').value];
        if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
        if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();
    };

    // 不透明度スライダー変更時の表示更新
    $('fillOpacity').oninput = () => {
        $('fillOpacityValue').textContent = $('fillOpacity').value + '%';
    };

    // リサイズ設定表示切替（ドロップダウン）
    $('resizeSelect').onchange = () => {
        $('percentSettings').style.display =
            $('resizeSelect').value === 'percent' ? 'flex' : 'none';
    };

    // カード初期化
    setupPresetCards();
    setupTachikiriCards();
}
