/**
 * settings.js - 設定の保存/読み込み/リセット
 * localStorageによる永続化 + 自動保存
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { SETTINGS_STORAGE_KEY } from './constants.js';

/**
 * 現在のUI設定をlocalStorageに保存
 */
export function saveSettings() {
    try {
        const settings = {
            // 出力形式の選択状態
            spreadPdfSelected: appState.selectedOutputs.spreadPdf,
            singlePdfSelected: appState.selectedOutputs.singlePdf,
            jpegSelected: appState.selectedOutputs.jpeg,

            // タチキリ処理
            tachikiriType: $('tachikiriSelect')?.value || 'fill_white',
            fillColor: $('fillColor')?.value || 'white',
            strokeColor: $('strokeColor')?.value || 'black',

            // 見開きPDF設定
            spreadGutterEnabled: $('spreadGutterEnabled')?.checked ?? true,
            spreadGutterValue: parseInt($('spreadGutterSlider')?.value) || 70,
            spreadPaddingEnabled: $('spreadPaddingEnabled')?.checked ?? true,
            spreadPaddingValue: parseInt($('spreadPaddingSlider')?.value) || 150,
            spreadWhitePage: $('spreadWhitePage')?.checked ?? false,
            spreadWorkInfo: $('spreadWorkInfo')?.checked ?? false,
            spreadAddNombre: $('spreadAddNombre')?.checked ?? true,
            spreadNombreStart: parseInt($('spreadNombreStart')?.value) || 1,
            spreadNombreSize: $('spreadNombreSize')?.value || 'small',

            // 単ページPDF設定
            singleAddNombre: $('singleAddNombre')?.checked ?? true,
            singleNombreStart: parseInt($('singleNombreStart')?.value) || 1,
            singleNombreSize: $('singleNombreSize')?.value || 'small',

            // JPEG設定
            jpegAddNombre: $('jpegAddNombre')?.checked ?? false,
            jpegNombreStart: parseInt($('jpegNombreStart')?.value) || 1,
            jpegNombreSize: $('jpegNombreSize')?.value || 'small',
            jpegQuality: parseInt($('jpegQuality')?.value) || 92,

            // 保存日時
            savedAt: new Date().toISOString()
        };

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        console.log('設定を保存しました');
    } catch (e) {
        console.warn('設定の保存に失敗:', e);
    }
}

/**
 * localStorageから設定を読み込んでUIに適用
 */
export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!saved) {
            console.log('保存された設定がありません（初回起動）');
            return;
        }

        const settings = JSON.parse(saved);
        console.log('設定を読み込み:', settings.savedAt);

        // 出力形式の選択状態を復元
        if (settings.spreadPdfSelected !== undefined) {
            appState.selectedOutputs.spreadPdf = settings.spreadPdfSelected;
        }
        if (settings.singlePdfSelected !== undefined) {
            appState.selectedOutputs.singlePdf = settings.singlePdfSelected;
        }
        if (settings.jpegSelected !== undefined) {
            appState.selectedOutputs.jpeg = settings.jpegSelected;
        }
        // 出力形式カードの選択状態を更新
        document.querySelectorAll('.output-type-card').forEach(card => {
            const type = card.dataset.type;
            if (type === 'spread-pdf') {
                card.classList.toggle('selected', appState.selectedOutputs.spreadPdf);
            } else if (type === 'single-pdf') {
                card.classList.toggle('selected', appState.selectedOutputs.singlePdf);
            } else if (type === 'jpeg') {
                card.classList.toggle('selected', appState.selectedOutputs.jpeg);
            }
        });
        // パネル表示を更新
        if (typeof window.updateOutputPanels === 'function') window.updateOutputPanels();

        // タチキリ処理
        if (settings.tachikiriType) {
            const select = $('tachikiriSelect');
            if (select) select.value = settings.tachikiriType;
            // カードの選択状態も更新
            document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
                card.classList.toggle('selected', card.dataset.value === settings.tachikiriType);
            });
        }
        if (settings.fillColor) {
            const el = $('fillColor');
            if (el) el.value = settings.fillColor;
        }
        if (settings.strokeColor) {
            const el = $('strokeColor');
            if (el) el.value = settings.strokeColor;
        }

        // 見開きPDF設定
        const spreadGutterEnabled = $('spreadGutterEnabled');
        if (spreadGutterEnabled && settings.spreadGutterEnabled !== undefined) {
            spreadGutterEnabled.checked = settings.spreadGutterEnabled;
            $('spreadGutterSliderArea')?.classList.toggle('disabled', !settings.spreadGutterEnabled);
        }
        if (settings.spreadGutterValue !== undefined) {
            const slider = $('spreadGutterSlider');
            if (slider) {
                slider.value = settings.spreadGutterValue;
                const valueEl = $('spreadGutterValue');
                if (valueEl) valueEl.textContent = settings.spreadGutterValue;
            }
        }
        const spreadPaddingEnabled = $('spreadPaddingEnabled');
        if (spreadPaddingEnabled && settings.spreadPaddingEnabled !== undefined) {
            spreadPaddingEnabled.checked = settings.spreadPaddingEnabled;
            $('spreadPaddingSliderArea')?.classList.toggle('disabled', !settings.spreadPaddingEnabled);
        }
        if (settings.spreadPaddingValue !== undefined) {
            const slider = $('spreadPaddingSlider');
            if (slider) {
                slider.value = settings.spreadPaddingValue;
                const valueEl = $('spreadPaddingValue');
                if (valueEl) valueEl.textContent = settings.spreadPaddingValue;
            }
        }
        if (settings.spreadWhitePage !== undefined) {
            const el = $('spreadWhitePage');
            if (el) el.checked = settings.spreadWhitePage;
        }
        if (settings.spreadWorkInfo !== undefined) {
            const el = $('spreadWorkInfo');
            if (el) el.checked = settings.spreadWorkInfo;
        }
        if (settings.spreadAddNombre !== undefined) {
            const el = $('spreadAddNombre');
            if (el) {
                el.checked = settings.spreadAddNombre;
                const settingsPanel = $('spreadNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.spreadAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.spreadNombreStart !== undefined) {
            const el = $('spreadNombreStart');
            if (el) el.value = settings.spreadNombreStart;
        }
        if (settings.spreadNombreSize) {
            const el = $('spreadNombreSize');
            if (el) el.value = settings.spreadNombreSize;
        }

        // 単ページPDF設定
        if (settings.singleAddNombre !== undefined) {
            const el = $('singleAddNombre');
            if (el) {
                el.checked = settings.singleAddNombre;
                const settingsPanel = $('singleNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.singleAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.singleNombreStart !== undefined) {
            const el = $('singleNombreStart');
            if (el) el.value = settings.singleNombreStart;
        }
        if (settings.singleNombreSize) {
            const el = $('singleNombreSize');
            if (el) el.value = settings.singleNombreSize;
        }

        // JPEG設定
        if (settings.jpegAddNombre !== undefined) {
            const el = $('jpegAddNombre');
            if (el) {
                el.checked = settings.jpegAddNombre;
                const settingsPanel = $('jpegNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.jpegAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.jpegNombreStart !== undefined) {
            const el = $('jpegNombreStart');
            if (el) el.value = settings.jpegNombreStart;
        }
        if (settings.jpegNombreSize) {
            const el = $('jpegNombreSize');
            if (el) el.value = settings.jpegNombreSize;
        }
        if (settings.jpegQuality !== undefined) {
            const slider = $('jpegQuality');
            if (slider) {
                slider.value = settings.jpegQuality;
                const valueEl = $('jpegQualityValue');
                if (valueEl) valueEl.textContent = settings.jpegQuality;
            }
        }

        // プレビューを更新
        if (typeof window.updateTachikiriSettings === 'function') window.updateTachikiriSettings();
        if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
        if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
        if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();

        console.log('設定の適用完了');
    } catch (e) {
        console.warn('設定の読み込みに失敗:', e);
    }
}

/**
 * 設定変更時に自動保存するイベントリスナーを設定
 */
export function setupSettingsAutoSave() {
    // 監視対象の要素IDリスト
    const watchIds = [
        // タチキリ
        'tachikiriSelect', 'fillColor', 'strokeColor',
        // 見開きPDF
        'spreadGutterEnabled', 'spreadGutterSlider', 'spreadPaddingEnabled', 'spreadPaddingSlider',
        'spreadWhitePage', 'spreadWorkInfo', 'spreadAddNombre', 'spreadNombreStart', 'spreadNombreSize',
        // 単ページPDF
        'singleAddNombre', 'singleNombreStart', 'singleNombreSize',
        // JPEG
        'jpegAddNombre', 'jpegNombreStart', 'jpegNombreSize', 'jpegQuality'
    ];

    watchIds.forEach(id => {
        const el = $(id);
        if (el) {
            // inputとchangeの両方でキャッチ
            el.addEventListener('input', saveSettings);
            el.addEventListener('change', saveSettings);
        }
    });

    // タチキリカードのクリックも監視
    document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
        card.addEventListener('click', saveSettings);
    });

    // 出力形式カードのクリックも監視
    document.querySelectorAll('.output-type-card').forEach(card => {
        card.addEventListener('click', saveSettings);
    });

    console.log('設定の自動保存を有効化');

    // リセットボタン
    const resetBtn = $('btnResetSettings');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }
}

/**
 * 設定リセットの確認ダイアログを表示
 */
export function resetSettings() {
    showConfirmModal('設定を初期状態に戻しますか？', doResetSettings);
}

/**
 * カスタム確認ダイアログを表示
 */
export function showConfirmModal(message, onConfirm) {
    const modal = $('confirmModal');
    const messageEl = $('confirmModalMessage');
    const okBtn = $('confirmModalOk');
    const cancelBtn = $('confirmModalCancel');
    const backdrop = modal.querySelector('.confirm-modal-backdrop');

    if (!modal) return;

    messageEl.textContent = message;
    modal.style.display = 'flex';

    // イベントリスナーをクリーンアップ用に保持
    const handleOk = () => {
        modal.style.display = 'none';
        cleanup();
        if (onConfirm) onConfirm();
    };

    const handleCancel = () => {
        modal.style.display = 'none';
        cleanup();
    };

    const cleanup = () => {
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    backdrop.addEventListener('click', handleCancel);
}

/**
 * 設定を実際にリセットする
 */
export function doResetSettings() {
    // localStorageから設定を削除
    localStorage.removeItem(SETTINGS_STORAGE_KEY);

    // 出力形式の選択状態をデフォルトに戻す
    appState.selectedOutputs.spreadPdf = true;
    appState.selectedOutputs.singlePdf = false;
    appState.selectedOutputs.jpeg = false;
    // カードの選択状態を更新
    document.querySelectorAll('.output-type-card').forEach(card => {
        const type = card.dataset.type;
        if (type === 'spread-pdf') {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    // パネル表示を更新
    if (typeof window.updateOutputPanels === 'function') window.updateOutputPanels();

    // デフォルト値を適用
    const defaults = {
        // タチキリ
        tachikiriType: 'fill_white',
        fillColor: 'black',
        strokeColor: 'black',
        // 見開きPDF
        spreadGutterEnabled: true,
        spreadGutterValue: 70,
        spreadPaddingEnabled: true,
        spreadPaddingValue: 150,
        spreadWhitePage: true,
        spreadWorkInfo: false,
        spreadAddNombre: true,
        spreadNombreStart: 1,
        spreadNombreSize: 'small',
        // 単ページPDF
        singleAddNombre: true,
        singleNombreStart: 1,
        singleNombreSize: 'small',
        // JPEG
        jpegAddNombre: false,
        jpegNombreStart: 1,
        jpegNombreSize: 'small',
        jpegQuality: 92
    };

    // タチキリ
    const tachikiriSelect = $('tachikiriSelect');
    if (tachikiriSelect) tachikiriSelect.value = defaults.tachikiriType;
    document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
        card.classList.toggle('selected', card.dataset.value === defaults.tachikiriType);
    });
    if ($('fillColor')) $('fillColor').value = defaults.fillColor;
    if ($('strokeColor')) $('strokeColor').value = defaults.strokeColor;

    // 見開きPDF
    const spreadGutterEnabled = $('spreadGutterEnabled');
    if (spreadGutterEnabled) {
        spreadGutterEnabled.checked = defaults.spreadGutterEnabled;
        $('spreadGutterSliderArea')?.classList.toggle('disabled', !defaults.spreadGutterEnabled);
    }
    const spreadGutterSlider = $('spreadGutterSlider');
    if (spreadGutterSlider) {
        spreadGutterSlider.value = defaults.spreadGutterValue;
        if ($('spreadGutterValue')) $('spreadGutterValue').textContent = defaults.spreadGutterValue;
    }
    const spreadPaddingEnabled = $('spreadPaddingEnabled');
    if (spreadPaddingEnabled) {
        spreadPaddingEnabled.checked = defaults.spreadPaddingEnabled;
        $('spreadPaddingSliderArea')?.classList.toggle('disabled', !defaults.spreadPaddingEnabled);
    }
    const spreadPaddingSlider = $('spreadPaddingSlider');
    if (spreadPaddingSlider) {
        spreadPaddingSlider.value = defaults.spreadPaddingValue;
        if ($('spreadPaddingValue')) $('spreadPaddingValue').textContent = defaults.spreadPaddingValue;
    }
    if ($('spreadWhitePage')) $('spreadWhitePage').checked = defaults.spreadWhitePage;
    if ($('spreadWorkInfo')) $('spreadWorkInfo').checked = defaults.spreadWorkInfo;
    const spreadAddNombre = $('spreadAddNombre');
    if (spreadAddNombre) {
        spreadAddNombre.checked = defaults.spreadAddNombre;
        const settingsEl = $('spreadNombreSettings');
        if (settingsEl) settingsEl.style.display = defaults.spreadAddNombre ? 'flex' : 'none';
    }
    if ($('spreadNombreStart')) $('spreadNombreStart').value = defaults.spreadNombreStart;
    if ($('spreadNombreSize')) $('spreadNombreSize').value = defaults.spreadNombreSize;

    // 単ページPDF
    const singleAddNombre = $('singleAddNombre');
    if (singleAddNombre) {
        singleAddNombre.checked = defaults.singleAddNombre;
        const settingsEl = $('singleNombreSettings');
        if (settingsEl) settingsEl.style.display = defaults.singleAddNombre ? 'flex' : 'none';
    }
    if ($('singleNombreStart')) $('singleNombreStart').value = defaults.singleNombreStart;
    if ($('singleNombreSize')) $('singleNombreSize').value = defaults.singleNombreSize;

    // JPEG
    const jpegAddNombre = $('jpegAddNombre');
    if (jpegAddNombre) {
        jpegAddNombre.checked = defaults.jpegAddNombre;
        const settingsEl = $('jpegNombreSettings');
        if (settingsEl) settingsEl.style.display = defaults.jpegAddNombre ? 'flex' : 'none';
    }
    if ($('jpegNombreStart')) $('jpegNombreStart').value = defaults.jpegNombreStart;
    if ($('jpegNombreSize')) $('jpegNombreSize').value = defaults.jpegNombreSize;
    const jpegQualitySlider = $('jpegQuality');
    if (jpegQualitySlider) {
        jpegQualitySlider.value = defaults.jpegQuality;
        if ($('jpegQualityValue')) $('jpegQualityValue').textContent = defaults.jpegQuality;
    }

    // プレビューを更新
    if (typeof window.updateTachikiriSettings === 'function') window.updateTachikiriSettings();
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
    if (typeof window.updateSinglePreview === 'function') window.updateSinglePreview();
    if (typeof window.updateJpegPreview === 'function') window.updateJpegPreview();

    if (typeof window.setStatus === 'function') window.setStatus('設定を初期状態に戻しました');
    console.log('設定をリセットしました');
}
