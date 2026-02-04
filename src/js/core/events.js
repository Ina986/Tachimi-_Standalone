/**
 * タチミ - イベントバスモジュール
 * モジュール間のイベント通信
 */

class EventBus {
    constructor() {
        this._listeners = new Map();
        this._onceListeners = new Map();
    }

    /**
     * イベントを購読
     * @param {string} event - イベント名
     * @param {Function} callback - コールバック
     * @returns {Function} 解除関数
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);

        return () => this.off(event, callback);
    }

    /**
     * イベントを一度だけ購読
     * @param {string} event - イベント名
     * @param {Function} callback - コールバック
     * @returns {Function} 解除関数
     */
    once(event, callback) {
        if (!this._onceListeners.has(event)) {
            this._onceListeners.set(event, new Set());
        }
        this._onceListeners.get(event).add(callback);

        return () => {
            this._onceListeners.get(event)?.delete(callback);
        };
    }

    /**
     * イベント購読を解除
     * @param {string} event - イベント名
     * @param {Function} callback - コールバック
     */
    off(event, callback) {
        this._listeners.get(event)?.delete(callback);
        this._onceListeners.get(event)?.delete(callback);
    }

    /**
     * イベントを発行
     * @param {string} event - イベント名
     * @param {*} data - イベントデータ
     */
    emit(event, data) {
        // 通常リスナー
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`Event handler error for "${event}":`, err);
                }
            }
        }

        // 一度きりのリスナー
        const onceListeners = this._onceListeners.get(event);
        if (onceListeners) {
            for (const callback of onceListeners) {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`Once event handler error for "${event}":`, err);
                }
            }
            this._onceListeners.delete(event);
        }

        // ワイルドカード '*' リスナー
        const wildcardListeners = this._listeners.get('*');
        if (wildcardListeners) {
            for (const callback of wildcardListeners) {
                try {
                    callback({ event, data });
                } catch (err) {
                    console.error('Wildcard event handler error:', err);
                }
            }
        }
    }

    /**
     * すべてのリスナーを削除
     * @param {string} event - イベント名（省略時は全イベント）
     */
    clear(event) {
        if (event) {
            this._listeners.delete(event);
            this._onceListeners.delete(event);
        } else {
            this._listeners.clear();
            this._onceListeners.clear();
        }
    }

    /**
     * 登録されているリスナー数を取得
     * @param {string} event - イベント名
     * @returns {number}
     */
    listenerCount(event) {
        const regular = this._listeners.get(event)?.size || 0;
        const once = this._onceListeners.get(event)?.size || 0;
        return regular + once;
    }
}

// イベント名の定数
const Events = {
    // ファイル関連
    FILES_SELECTED: 'files:selected',
    FILES_CLEARED: 'files:cleared',
    OUTPUT_FOLDER_CHANGED: 'output:folderChanged',

    // 処理関連
    PROCESSING_START: 'processing:start',
    PROCESSING_PROGRESS: 'processing:progress',
    PROCESSING_PHASE: 'processing:phase',
    PROCESSING_COMPLETE: 'processing:complete',
    PROCESSING_ERROR: 'processing:error',

    // クロップモード
    CROP_MODE_OPEN: 'cropMode:open',
    CROP_MODE_CLOSE: 'cropMode:close',
    CROP_VALUES_CHANGED: 'cropMode:valuesChanged',
    GUIDES_CHANGED: 'cropMode:guidesChanged',
    ZOOM_CHANGED: 'cropMode:zoomChanged',
    PAGE_CHANGED: 'cropMode:pageChanged',

    // 設定関連
    SETTINGS_CHANGED: 'settings:changed',
    SETTINGS_LOADED: 'settings:loaded',
    SETTINGS_SAVED: 'settings:saved',

    // 出力形式
    OUTPUT_TYPE_CHANGED: 'output:typeChanged',

    // タチキリ
    TACHIKIRI_TYPE_CHANGED: 'tachikiri:typeChanged',

    // プレビュー
    PREVIEW_UPDATED: 'preview:updated',
    PREVIEW_LOADING: 'preview:loading',

    // UI
    STATUS_MESSAGE: 'ui:statusMessage',
    ALERT_SHOW: 'ui:alertShow',

    // Undo/Redo
    HISTORY_PUSH: 'history:push',
    HISTORY_UNDO: 'history:undo',
    HISTORY_REDO: 'history:redo'
};

// シングルトンインスタンス
const eventBus = new EventBus();

// エクスポート
export { EventBus, eventBus, Events };
export default eventBus;
