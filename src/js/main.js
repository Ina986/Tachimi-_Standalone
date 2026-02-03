/**
 * タチミ - メインエントリポイント
 * ES Modulesを使用した新しいアーキテクチャ
 */

// === コアモジュール ===
import { store, initialState } from './core/state.js';
import { eventBus, Events } from './core/events.js';
import * as tauriApi from './core/tauri-api.js';

// === ユーティリティ ===
import * as dom from './utils/dom.js';
import * as storage from './utils/storage.js';
import * as formatters from './utils/formatters.js';

// === UIコンポーネント ===
import { processingOverlay } from './ui/overlay.js';
import { showAlert, showConfirm, setStatus } from './ui/alerts.js';

// DOM要素取得のショートカット
const $ = dom.$;

// ========================================
// グローバル互換性レイヤー
// 既存のrenderer.jsからの段階的移行のため
// ========================================

// Tauri APIをグローバルに公開（既存コードとの互換性）
window.tauriApi = tauriApi;

// ユーティリティをグローバルに公開
window.dom = dom;
window.storage = storage;
window.formatters = formatters;

// ストアをグローバルに公開
window.store = store;
window.eventBus = eventBus;
window.Events = Events;

// UIコンポーネントをグローバルに公開
window.processingOverlay = processingOverlay;
window.showAlert = showAlert;
window.showConfirm = showConfirm;
window.setStatus = setStatus;

// DOM $関数をグローバルに（既存コードとの互換性）
window.$ = $;

// ========================================
// アプリケーション初期化
// ========================================

/**
 * 設定を読み込んでストアに反映
 */
function loadSavedSettings() {
    const saved = storage.loadSettings();
    if (!saved) return;

    // 保存された設定をストアに反映
    if (saved.output) {
        store.set('output.spreadPdf', saved.output.spreadPdf ?? true);
        store.set('output.singlePdf', saved.output.singlePdf ?? false);
        store.set('output.jpeg', saved.output.jpeg ?? false);
    }

    if (saved.tachikiri) {
        store.set('tachikiri.type', saved.tachikiri.type || 'fill_white');
        if (saved.tachikiri.crop) {
            store.set('tachikiri.crop', saved.tachikiri.crop);
        }
        store.set('tachikiri.strokeColor', saved.tachikiri.strokeColor || 'black');
        store.set('tachikiri.fillColor', saved.tachikiri.fillColor || 'white');
        store.set('tachikiri.fillOpacity', saved.tachikiri.fillOpacity ?? 50);
    }

    if (saved.resize) {
        store.set('resize.mode', saved.resize.mode || 'fixed');
        store.set('resize.percent', saved.resize.percent ?? 50);
    }

    if (saved.spreadPdf) {
        Object.entries(saved.spreadPdf).forEach(([key, value]) => {
            store.set(`spreadPdf.${key}`, value);
        });
    }

    if (saved.singlePdf) {
        Object.entries(saved.singlePdf).forEach(([key, value]) => {
            store.set(`singlePdf.${key}`, value);
        });
    }

    if (saved.jpeg) {
        Object.entries(saved.jpeg).forEach(([key, value]) => {
            store.set(`jpeg.${key}`, value);
        });
    }

    eventBus.emit(Events.SETTINGS_LOADED, saved);
    console.log('設定を読み込みました');
}

/**
 * 設定の自動保存をセットアップ
 */
function setupSettingsAutoSave() {
    // ストアの変更を監視して自動保存
    let saveTimeout = null;

    store.subscribeAll((path) => {
        // 設定関連のパスのみ保存
        const settingsPaths = ['output', 'tachikiri', 'resize', 'spreadPdf', 'singlePdf', 'jpeg'];
        const shouldSave = settingsPaths.some(p => path.startsWith(p));

        if (shouldSave) {
            // デバウンス処理
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                const settings = {
                    output: store.get('output'),
                    tachikiri: store.get('tachikiri'),
                    resize: store.get('resize'),
                    spreadPdf: store.get('spreadPdf'),
                    singlePdf: store.get('singlePdf'),
                    jpeg: store.get('jpeg')
                };
                storage.saveSettings(settings);
                eventBus.emit(Events.SETTINGS_SAVED, settings);
            }, 500);
        }
    });
}

/**
 * デフォルト出力フォルダを初期化
 */
async function initDefaultOutputFolder() {
    try {
        await tauriApi.waitForInit();
        const defaultFolder = await tauriApi.getDefaultOutputFolder();
        if (defaultFolder && !store.get('files.outputFolder')) {
            store.set('files.outputFolder', defaultFolder);
            console.log('デフォルト出力フォルダを設定:', defaultFolder);
        }
    } catch (e) {
        console.error('デフォルト出力フォルダの取得に失敗:', e);
    }
}

/**
 * Tauriイベントリスナーをセットアップ
 */
async function setupTauriEventListeners() {
    try {
        await tauriApi.waitForInit();

        // 処理進捗イベント
        await tauriApi.listen('processing_progress', (event) => {
            const { completed, in_progress, total, current_file, phase } = event.payload;
            eventBus.emit(Events.PROCESSING_PROGRESS, {
                completed,
                inProgress: in_progress,
                total,
                currentFile: current_file,
                phase
            });
        });

        // ドラッグ＆ドロップイベント
        await tauriApi.listen('tauri://drag-enter', () => {
            eventBus.emit('drag:enter');
        });

        await tauriApi.listen('tauri://drag-leave', () => {
            eventBus.emit('drag:leave');
        });

        await tauriApi.listen('tauri://drag-drop', (event) => {
            eventBus.emit('drag:drop', event.payload);
        });

        console.log('Tauriイベントリスナーをセットアップしました');
    } catch (e) {
        console.error('Tauriイベントリスナーのセットアップに失敗:', e);
    }
}

/**
 * メイン初期化関数
 */
async function init() {
    console.log('タチミ初期化開始...');

    // Tauri APIの初期化を待機
    await tauriApi.waitForInit();

    // 設定読み込み
    loadSavedSettings();

    // 自動保存セットアップ
    setupSettingsAutoSave();

    // デフォルト出力フォルダ
    await initDefaultOutputFolder();

    // Tauriイベントリスナー
    await setupTauriEventListeners();

    // 初期化完了
    eventBus.emit('app:ready');
    console.log('タチミ初期化完了');
}

// DOMContentLoadedで初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// エクスポート（他のモジュールから利用可能）
export {
    store,
    eventBus,
    Events,
    tauriApi,
    dom,
    storage,
    formatters,
    processingOverlay,
    showAlert,
    showConfirm,
    setStatus,
    $
};
