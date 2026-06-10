/**
 * output-panels.js - 出力形式パネル管理
 * 見開きPDF・単ページPDF・JPEG の設定UI + タチキリカード
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { COLOR_MAP } from './constants.js';
import { showWorkInfoChoiceDialog, showManualWorkInfoModal } from './work-info.js';
import { jsonSelectModal } from './json-modal.js';
import { saveSettings } from './settings.js';

/**
 * range スライダーと数値手入力欄を双方向バインドする
 * - スライダー操作 → 手入力欄へ反映
 * - 手入力欄の入力 → スライダーへ反映（min/max でクランプ）
 * @param {string} sliderId  range要素のID
 * @param {string} inputId   number入力欄のID
 * @param {Function} onChange 値が変わったときに呼ぶコールバック（プレビュー更新等）
 */
export function bindSliderValuePair(sliderId, inputId, onChange) {
    const slider = $(sliderId);
    const input = $(inputId);
    if (!slider) return;

    const clamp = (v) => {
        const min = parseInt(slider.min) || 0;
        const max = slider.max !== '' ? parseInt(slider.max) : Infinity;
        if (isNaN(v)) v = min;
        return Math.min(max, Math.max(min, v));
    };

    // スライダー → 手入力欄
    slider.addEventListener('input', () => {
        if (input) input.value = slider.value;
        if (onChange) onChange();
    });

    // 手入力欄 → スライダー
    if (input) {
        const apply = () => {
            const v = clamp(parseInt(input.value, 10));
            input.value = v;
            slider.value = v;
            if (onChange) onChange();
        };
        input.addEventListener('input', apply);
        input.addEventListener('change', apply);
    }
}

/**
 * 全プレビューの作品情報・白紙表示を更新
 */
function refreshWorkInfoPreviews() {
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
}

/**
 * 「作品情報」チェックボックスの共通セットアップ（見開き・単ページ共用）
 * チェック時に JSON / 手動入力の選択ダイアログを出し、作品情報を appState に保存する。
 * 作品情報データ自体は出力形式をまたいで共有される（appState.workInfoSource）。
 * @param {HTMLInputElement|null} checkbox
 */
function setupWorkInfoCheckbox(checkbox) {
    if (!checkbox) return;
    checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
            const choice = await showWorkInfoChoiceDialog();

            if (choice === 'json') {
                // 一旦OFFにしてJSON選択後にON
                checkbox.checked = false;
                const prevCallback = jsonSelectModal.onFileSelected;
                jsonSelectModal.onFileSelected = (filePath, data) => {
                    jsonSelectModal.onFileSelected = prevCallback;
                    jsonSelectModal.hide();
                    appState.jsonData = data;
                    appState.workInfoSource = 'json';
                    checkbox.checked = true;
                    refreshWorkInfoPreviews();
                };
                jsonSelectModal.show();
            } else if (choice === 'manual') {
                const manualData = await showManualWorkInfoModal();
                if (manualData) {
                    appState.manualWorkInfo = manualData;
                    appState.workInfoSource = 'manual';
                } else {
                    checkbox.checked = false;
                }
            } else {
                checkbox.checked = false;
            }
        } else {
            // 見開き・単ページ両方の作品情報がOFFになったときだけソースをクリア
            const spreadWi = $('spreadWorkInfo');
            const singleWi = $('singleWorkInfo');
            const otherChecked = (checkbox === spreadWi ? singleWi : spreadWi)?.checked;
            if (!otherChecked) appState.workInfoSource = null;
        }
        refreshWorkInfoPreviews();
    });
}

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

    // PDF分割トグルボタンのイベント
    const btnMerged = $('btnPdfMerged');
    const btnSplit = $('btnPdfSplit');
    if (btnMerged && btnSplit) {
        btnMerged.addEventListener('click', () => {
            appState.splitPdfBySubfolder = false;
            btnMerged.classList.add('active');
            btnSplit.classList.remove('active');
            saveSettings();
        });
        btnSplit.addEventListener('click', () => {
            appState.splitPdfBySubfolder = true;
            btnSplit.classList.add('active');
            btnMerged.classList.remove('active');
            saveSettings();
        });
    }

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

    // PDF分割トグルの表示/非表示
    const splitRow = $('splitPdfRow');
    if (splitRow) {
        const hasPdf = appState.selectedOutputs.spreadPdf || appState.selectedOutputs.singlePdf;
        splitRow.style.display = (appState.subfolderMode && hasPdf) ? 'inline-flex' : 'none';
        if (!appState.subfolderMode || !hasPdf) {
            appState.splitPdfBySubfolder = false;
            const btnMerged = $('btnPdfMerged');
            const btnSplit = $('btnPdfSplit');
            if (btnMerged) btnMerged.classList.add('active');
            if (btnSplit) btnSplit.classList.remove('active');
        }
    }

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

    // ノドスライダー（スライダー⇔手入力欄を双方向バインド）
    bindSliderValuePair('spreadGutterSlider', 'spreadGutterValue', () => {
        if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    });

    // 余白スライダー（スライダー⇔手入力欄を双方向バインド）
    bindSliderValuePair('spreadPaddingSlider', 'spreadPaddingValue', () => {
        if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    });

    // 先頭白紙追加チェック
    const whitePage = $('spreadWhitePage');
    if (whitePage) {
        whitePage.addEventListener('change', () => {
            if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        });
    }

    // 作品情報印字チェック
    setupWorkInfoCheckbox($('spreadWorkInfo'));

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

    // ファイル名の番号を使うチェック
    const fromFile = $('spreadNombreFromFilename');
    if (fromFile) {
        fromFile.addEventListener('change', () => syncNombreSettings('spread'));
    }

    // 初期状態でノンブルヒントを設定
    updateSpreadNombreHint();
}

/**
 * 単ページPDF設定のイベント初期化
 */
function setupSinglePdfEvents() {
    // 余白有効/無効トグル
    const paddingEnabled = $('singlePaddingEnabled');
    const paddingSliderArea = $('singlePaddingSliderArea');
    if (paddingEnabled && paddingSliderArea) {
        paddingEnabled.addEventListener('change', () => {
            paddingSliderArea.classList.toggle('disabled', !paddingEnabled.checked);
            if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
        });
    }

    // 余白スライダー（スライダー⇔手入力欄を双方向バインド）
    bindSliderValuePair('singlePaddingSlider', 'singlePaddingValue', () => {
        if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
    });

    // 先頭白紙チェック
    const whitePage = $('singleWhitePage');
    if (whitePage) {
        whitePage.addEventListener('change', () => {
            if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
        });
    }

    // 作品情報チェック（見開きと共通処理）
    setupWorkInfoCheckbox($('singleWorkInfo'));

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

    // ファイル名の番号を使うチェック
    const fromFile = $('singleNombreFromFilename');
    if (fromFile) {
        fromFile.addEventListener('change', () => syncNombreSettings('single'));
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

    // ファイル名の番号を使うチェック
    const fromFile = $('jpegNombreFromFilename');
    if (fromFile) {
        fromFile.addEventListener('change', () => syncNombreSettings('jpeg'));
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
    let fromFile = false;

    // ソースから値を取得
    if (source === 'spread' && spreadCheck) {
        isChecked = spreadCheck.checked;
        startValue = $('spreadNombreStart')?.value || '1';
        sizeValue = $('spreadNombreSize')?.value || 'medium';
        fromFile = $('spreadNombreFromFilename')?.checked || false;
    } else if (source === 'single' && singleCheck) {
        isChecked = singleCheck.checked;
        startValue = $('singleNombreStart')?.value || '1';
        sizeValue = $('singleNombreSize')?.value || 'medium';
        fromFile = $('singleNombreFromFilename')?.checked || false;
    } else if (source === 'jpeg' && jpegCheck) {
        isChecked = jpegCheck.checked;
        startValue = $('jpegNombreStart')?.value || '1';
        sizeValue = $('jpegNombreSize')?.value || 'medium';
        fromFile = $('jpegNombreFromFilename')?.checked || false;
    }

    // 他のパネルに同期
    if (source !== 'spread' && spreadCheck) {
        spreadCheck.checked = isChecked;
        if ($('spreadNombreStart')) $('spreadNombreStart').value = startValue;
        if ($('spreadNombreSize')) $('spreadNombreSize').value = sizeValue;
        if ($('spreadNombreFromFilename')) $('spreadNombreFromFilename').checked = fromFile;
        if ($('spreadNombreSettings')) {
            $('spreadNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'single' && singleCheck) {
        singleCheck.checked = isChecked;
        if ($('singleNombreStart')) $('singleNombreStart').value = startValue;
        if ($('singleNombreSize')) $('singleNombreSize').value = sizeValue;
        if ($('singleNombreFromFilename')) $('singleNombreFromFilename').checked = fromFile;
        if ($('singleNombreSettings')) {
            $('singleNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'jpeg' && jpegCheck) {
        jpegCheck.checked = isChecked;
        if ($('jpegNombreStart')) $('jpegNombreStart').value = startValue;
        if ($('jpegNombreSize')) $('jpegNombreSize').value = sizeValue;
        if ($('jpegNombreFromFilename')) $('jpegNombreFromFilename').checked = fromFile;
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
        const mode = $('resizeSelect').value;
        $('percentSettings').style.display = mode === 'percent' ? 'flex' : 'none';
        const customEl = $('customSizeSettings');
        if (customEl) customEl.style.display = mode === 'custom' ? 'flex' : 'none';
    };

    // カード初期化
    setupPresetCards();
    setupTachikiriCards();
}
