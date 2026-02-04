/**
 * タチミ - 状態管理モジュール
 * シンプルなリアクティブストア
 */

class StateStore {
    constructor(initialState = {}) {
        this._state = this._deepClone(initialState);
        this._listeners = new Map();
        this._globalListeners = [];
    }

    /**
     * パスで指定された値を取得
     * @param {string} path - ドット区切りのパス (例: 'files.inputFolder')
     * @returns {*} 値
     */
    get(path) {
        if (!path) return this._state;
        return path.split('.').reduce((obj, key) => obj?.[key], this._state);
    }

    /**
     * パスで指定された値を設定
     * @param {string} path - ドット区切りのパス
     * @param {*} value - 設定する値
     */
    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let target = this._state;

        for (const key of keys) {
            if (target[key] === undefined) {
                target[key] = {};
            }
            target = target[key];
        }

        const oldValue = target[lastKey];
        target[lastKey] = value;

        // リスナーに通知
        this._notifyListeners(path, value, oldValue);
    }

    /**
     * 複数の値を一度に更新
     * @param {Object} updates - { path: value } の形式
     */
    batchUpdate(updates) {
        const changes = [];
        for (const [path, value] of Object.entries(updates)) {
            const oldValue = this.get(path);
            this.set(path, value);
            changes.push({ path, value, oldValue });
        }
        return changes;
    }

    /**
     * パスの変更を監視
     * @param {string} path - 監視するパス
     * @param {Function} callback - コールバック (value, oldValue, path) => void
     * @returns {Function} 解除関数
     */
    subscribe(path, callback) {
        if (!this._listeners.has(path)) {
            this._listeners.set(path, new Set());
        }
        this._listeners.get(path).add(callback);

        return () => {
            this._listeners.get(path)?.delete(callback);
        };
    }

    /**
     * すべての変更を監視
     * @param {Function} callback - コールバック (path, value, oldValue) => void
     * @returns {Function} 解除関数
     */
    subscribeAll(callback) {
        this._globalListeners.push(callback);
        return () => {
            const idx = this._globalListeners.indexOf(callback);
            if (idx > -1) this._globalListeners.splice(idx, 1);
        };
    }

    /**
     * 現在の状態のスナップショットを取得
     * @returns {Object} 状態のディープコピー
     */
    getSnapshot() {
        return this._deepClone(this._state);
    }

    /**
     * 状態全体を復元
     * @param {Object} snapshot - 復元する状態
     */
    restoreSnapshot(snapshot) {
        this._state = this._deepClone(snapshot);
        // 全リスナーに通知
        for (const callback of this._globalListeners) {
            callback('*', this._state, null);
        }
    }

    /**
     * リスナーに通知
     */
    _notifyListeners(path, value, oldValue) {
        // 完全一致のリスナー
        const listeners = this._listeners.get(path);
        if (listeners) {
            for (const callback of listeners) {
                callback(value, oldValue, path);
            }
        }

        // 親パスのリスナー（ワイルドカード的な動作）
        const parts = path.split('.');
        for (let i = parts.length - 1; i > 0; i--) {
            const parentPath = parts.slice(0, i).join('.');
            const parentListeners = this._listeners.get(parentPath + '.*');
            if (parentListeners) {
                for (const callback of parentListeners) {
                    callback(value, oldValue, path);
                }
            }
        }

        // グローバルリスナー
        for (const callback of this._globalListeners) {
            callback(path, value, oldValue);
        }
    }

    /**
     * ディープクローン
     */
    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));
        const clone = {};
        for (const key in obj) {
            clone[key] = this._deepClone(obj[key]);
        }
        return clone;
    }
}

// 初期状態の定義
const initialState = {
    // ファイル関連
    files: {
        inputFolder: null,
        targetFiles: [],
        outputFolder: null,
        outputName: '出力'
    },

    // 処理状態
    processing: {
        isProcessing: false,
        progress: {
            current: 0,
            total: 0,
            phase: 'idle',
            filename: ''
        }
    },

    // クロップモード
    cropMode: {
        isOpen: false,
        currentPageIndex: 0,
        zoom: 1.0,
        guides: [],
        savedValues: { left: 0, top: 0, right: 0, bottom: 0 },
        previewImageSize: { width: 0, height: 0 },
        previewScale: 1
    },

    // 出力形式の選択
    output: {
        spreadPdf: true,
        singlePdf: false,
        jpeg: false
    },

    // タチキリ設定
    tachikiri: {
        type: 'fill_white', // 'none', 'crop', 'fill_white', 'fill_black', 'stroke_black', 'stroke_white'
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        strokeColor: 'black',
        fillColor: 'white',
        fillOpacity: 50
    },

    // リサイズ設定
    resize: {
        mode: 'fixed',
        percent: 50,
        width: 0,
        height: 0
    },

    // 見開きPDF設定
    spreadPdf: {
        gutterEnabled: true,
        gutter: 0,
        paddingEnabled: true,
        padding: 50,
        addWhitePage: false,
        printWorkInfo: false,
        addNombre: true,
        nombreStart: 1,
        nombreSize: 'medium',
        nombrePosition: 'outside'
    },

    // 単ページPDF設定
    singlePdf: {
        addNombre: true,
        nombreStart: 1,
        nombreSize: 'medium',
        nombrePosition: 'outside',
        addPadding: true,
        padding: 50
    },

    // JPEG設定
    jpeg: {
        addNombre: true,
        nombreStart: 1,
        nombreSize: 'medium',
        nombrePosition: 'outside'
    },

    // JSON/範囲選択
    json: {
        data: null,
        ranges: [],
        selectedRangeIndex: null
    },

    // Undo/Redo
    history: {
        undoStack: [],
        redoStack: [],
        maxHistory: 50
    }
};

// シングルトンインスタンス
const store = new StateStore(initialState);

// エクスポート
export { StateStore, store, initialState };
export default store;
