/**
 * タチミ - メインエントリポイント
 * renderer.jsの機能を全てESモジュールに分割し、ここで統合する
 */

// === コアモジュール ===
import { store } from './core/state.js';
import { eventBus, Events } from './core/events.js';
import * as tauriApi from './core/tauri-api.js';
import appState from './core/app-state.js';

// === ユーティリティ ===
import { $ } from './utils/dom.js';
import * as storage from './utils/storage.js';
import * as formatters from './utils/formatters.js';

// === UIコンポーネント ===
import { processingOverlay } from './ui/overlay.js';
import { showAlert, showConfirm } from './ui/alerts.js';

// === フィーチャーモジュール ===
import {
    setupFileHandlingEvents, initDefaultOutputFolder, setStatus,
    updateExecuteBtn, updateOutputInfo, updateFileInfo
} from './features/file-handling.js';

import { setupJsonParsingEvents } from './features/json-parsing.js';
import { setupJsonModalEvents } from './features/json-modal.js';
import { setupJsonRegisterEvents } from './features/json-register.js';

import {
    setupPresetCards, setupTachikiriCards, setupOutputPanelEvents,
    updateOutputPanels, updateTachikiriSettings, updateColorSettingsVisibility,
    updateSpreadNombreHint, syncNombreSettings,
    updateJpegNombreSectionVisibility, updateJpegOptionsAvailability
} from './features/output-panels.js';

import {
    setupPreviewEvents, updateSpreadPreview, updateSinglePreview,
    updateJpegPreview, updateCropRangeStatus,
    loadPreviewImageByIndex, loadPreviewImage,
    updateCropPageNav, updateCropModeImage
} from './features/preview.js';

import {
    drawRulers, renderGuides, updateGuideList,
    addGuide, removeGuide, applyGuidesToCrop,
    selectGuide, deselectGuide, moveSelectedGuide,
    toggleGuideLock
} from './features/guides.js';

import {
    setupCropModeEvents, openCropMode, closeCropMode,
    updateSelectionVisual, updateFillStrokePreview,
    updateApplyButtonState, updateCropModeHint,
    updateGuideButtonHighlight, updateCropModeLabelSelect,
    clearFillStrokePreview, applySelectionRangeInCropMode,
    syncColorSettingsToOverlay
} from './features/crop-mode.js';

import { setupExecutionEvents } from './features/execution.js';

import { setupWorkInfoEvents } from './features/work-info.js';

import { loadSettings, setupSettingsAutoSave } from './features/settings.js';

import { setupUpdateEvents, updateVersionDisplay, checkForUpdateOnStartup } from './features/update-system.js';

import { setupUnlockEvents } from './features/feature-unlock.js';

import { onRestore } from './features/undo-redo.js';

// ========================================
// Tauri API初期化
// ========================================

/**
 * Tauri APIをappStateオブジェクトに設定
 */
function initTauriAPIs() {
    console.log('Tauri APIs:', Object.keys(window.__TAURI__ || {}));

    if (window.__TAURI__) {
        if (window.__TAURI__.core) {
            appState.invoke = window.__TAURI__.core.invoke;
            appState.convertFileSrc = window.__TAURI__.core.convertFileSrc;
        }
        if (window.__TAURI__.event) {
            appState.listen = window.__TAURI__.event.listen;
        }
        if (window.__TAURI__.dialog) {
            appState.openDialog = window.__TAURI__.dialog.open;
            appState.messageDialog = window.__TAURI__.dialog.message;
        }
        if (window.__TAURI__.shell) {
            appState.openPath = window.__TAURI__.shell.open;
        }
        if (window.__TAURI__.fs) {
            appState.readTextFile = window.__TAURI__.fs.readTextFile;
            appState.statFile = window.__TAURI__.fs.stat;
        }
        if (window.__TAURI__.path) {
            appState.desktopDir = window.__TAURI__.path.desktopDir;
        }
        console.log('Tauri APIs initialized on appState');
    } else {
        console.error('Tauri API not found!');
    }
}

// ========================================
// window.*公開（クロスモジュール通信用）
// ========================================

/**
 * 全モジュールの関数をwindow.*に公開
 * モジュール間のwindow.xxx()呼び出しを解決する
 */
function exposeToWindow() {
    // 共有状態
    window.appState = appState;

    // UI
    window.processingOverlay = processingOverlay;
    window.showAlert = showAlert;
    window.showConfirm = showConfirm;
    window.setStatus = setStatus;
    window.$ = $;

    // 旧コアモジュール（後方互換）
    window.store = store;
    window.eventBus = eventBus;
    window.Events = Events;
    window.tauriApi = tauriApi;
    window.storage = storage;
    window.formatters = formatters;

    // file-handling
    window.updateExecuteBtn = updateExecuteBtn;
    window.updateOutputInfo = updateOutputInfo;
    window.updateFileInfo = updateFileInfo;

    // preview
    window.updateSpreadPreview = updateSpreadPreview;
    window.updateSinglePreview = updateSinglePreview;
    window.updateJpegPreview = updateJpegPreview;
    window.updateCropRangeStatus = updateCropRangeStatus;
    window.loadPreviewImage = loadPreviewImage;
    window.loadPreviewImageByIndex = loadPreviewImageByIndex;
    window.updateCropPageNav = updateCropPageNav;
    window.updateCropModeImage = updateCropModeImage;

    // output-panels
    window.updateOutputPanels = updateOutputPanels;
    window.updateTachikiriSettings = updateTachikiriSettings;
    window.updateColorSettingsVisibility = updateColorSettingsVisibility;
    window.syncNombreSettings = syncNombreSettings;
    window.updateSpreadNombreHint = updateSpreadNombreHint;
    window.updateJpegNombreSectionVisibility = updateJpegNombreSectionVisibility;
    window.updateJpegOptionsAvailability = updateJpegOptionsAvailability;

    // crop-mode
    window.openCropMode = openCropMode;
    window.closeCropMode = closeCropMode;
    window.updateSelectionVisual = updateSelectionVisual;
    window.updateFillStrokePreview = updateFillStrokePreview;
    window.updateApplyButtonState = updateApplyButtonState;
    window.updateCropModeHint = updateCropModeHint;
    window.updateGuideButtonHighlight = updateGuideButtonHighlight;
    window.updateCropModeLabelSelect = updateCropModeLabelSelect;
    window.clearFillStrokePreview = clearFillStrokePreview;
    window.applySelectionRangeInCropMode = applySelectionRangeInCropMode;
    window.syncColorSettingsToOverlay = syncColorSettingsToOverlay;

    // guides
    window.drawRulers = drawRulers;
    window.renderGuides = renderGuides;
    window.updateGuideList = updateGuideList;
    window._updateGuideList = updateGuideList;  // feature-unlock.jsから参照
    window.addGuide = addGuide;
    window.removeGuide = removeGuide;
    window.applyGuidesToCrop = applyGuidesToCrop;
    window.selectGuide = selectGuide;
    window.deselectGuide = deselectGuide;
    window.moveSelectedGuide = moveSelectedGuide;
    window.toggleGuideLock = toggleGuideLock;
}

// ========================================
// アプリケーション初期化
// ========================================

/**
 * メイン初期化関数
 */
async function init() {
    console.log('タチミ初期化開始...');

    // 1. Tauri API初期化
    initTauriAPIs();

    // 2. window.*に関数を公開（setupEvents前に必要）
    exposeToWindow();

    // 3. Undo/RedoのrestoreState後コールバック登録
    onRestore(() => {
        renderGuides();
        updateGuideList();
        updateSelectionVisual();
        updateFillStrokePreview();
        updateApplyButtonState();
        updateCropModeHint();
        updateGuideButtonHighlight();
    });

    // 4. 全モジュールのイベントセットアップ
    setupFileHandlingEvents();
    setupJsonParsingEvents();
    setupJsonModalEvents();
    setupJsonRegisterEvents();
    setupOutputPanelEvents();
    setupPreviewEvents();
    setupCropModeEvents();
    setupExecutionEvents();
    setupWorkInfoEvents();
    setupUpdateEvents();
    setupUnlockEvents();

    // 5. タチキリ設定・実行ボタンの初期化
    updateTachikiriSettings();
    updateExecuteBtn();

    // 6. 保存された設定を読み込み → UI復元
    loadSettings();
    setupSettingsAutoSave();

    // 7. デフォルト出力フォルダ
    await initDefaultOutputFolder();

    // 8. バージョン表示
    await updateVersionDisplay();

    // 9. 起動時のアップデート確認（バックグラウンド）
    checkForUpdateOnStartup();

    console.log('タチミ初期化完了');
}

// DOMContentLoadedで初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
