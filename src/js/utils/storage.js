/**
 * タチミ - LocalStorageユーティリティ
 * 設定の永続化
 */

const STORAGE_KEY = 'tachimi_settings';
const STORAGE_VERSION = 2; // バージョン管理用

/**
 * 設定を保存
 * @param {Object} settings - 保存する設定
 */
export function saveSettings(settings) {
    try {
        const data = {
            version: STORAGE_VERSION,
            timestamp: Date.now(),
            settings
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error('設定の保存に失敗:', e);
        return false;
    }
}

/**
 * 設定を読み込み
 * @returns {Object|null} 設定またはnull
 */
export function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const data = JSON.parse(raw);

        // バージョン1からの移行
        if (!data.version) {
            return migrateFromV1(data);
        }

        return data.settings;
    } catch (e) {
        console.error('設定の読み込みに失敗:', e);
        return null;
    }
}

/**
 * 設定をクリア
 */
export function clearSettings() {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * バージョン1からの移行
 * @param {Object} oldData - 旧形式のデータ
 * @returns {Object} 新形式の設定
 */
function migrateFromV1(oldData) {
    // 旧形式のキーを新形式にマッピング
    const settings = {
        output: {
            spreadPdf: oldData.spreadPdf ?? true,
            singlePdf: oldData.singlePdf ?? false,
            jpeg: oldData.jpeg ?? false
        },
        tachikiri: {
            type: oldData.tachikiriType || 'fill_white',
            crop: {
                left: oldData.cropLeft || 0,
                top: oldData.cropTop || 0,
                right: oldData.cropRight || 0,
                bottom: oldData.cropBottom || 0
            },
            strokeColor: oldData.strokeColor || 'black',
            fillColor: oldData.fillColor || 'white',
            fillOpacity: oldData.fillOpacity ?? 50
        },
        resize: {
            mode: oldData.resizeMode || 'fixed',
            percent: oldData.resizePercent ?? 50
        },
        spreadPdf: {
            gutterEnabled: oldData.gutterEnabled ?? true,
            gutter: oldData.gutter ?? 0,
            paddingEnabled: oldData.paddingEnabled ?? true,
            padding: oldData.padding ?? 50,
            addWhitePage: oldData.addWhitePage ?? false,
            addNombre: oldData.addNombre ?? true,
            nombreStart: oldData.nombreStart ?? 1,
            nombreSize: oldData.nombreSize || 'medium'
        },
        singlePdf: {
            addNombre: oldData.singleAddNombre ?? true,
            nombreStart: oldData.singleNombreStart ?? 1,
            nombreSize: oldData.singleNombreSize || 'medium',
            addPadding: oldData.singleAddPadding ?? true,
            padding: oldData.singlePadding ?? 50
        },
        jpeg: {
            addNombre: oldData.jpegAddNombre ?? true,
            nombreStart: oldData.jpegNombreStart ?? 1,
            nombreSize: oldData.jpegNombreSize || 'medium'
        }
    };

    // 新形式で保存し直す
    saveSettings(settings);

    return settings;
}

/**
 * 特定のキーを保存
 * @param {string} key - キー名
 * @param {*} value - 値
 */
export function setItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.error(`setItem(${key})に失敗:`, e);
        return false;
    }
}

/**
 * 特定のキーを読み込み
 * @param {string} key - キー名
 * @param {*} defaultValue - デフォルト値
 * @returns {*}
 */
export function getItem(key, defaultValue = null) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw);
    } catch (e) {
        console.error(`getItem(${key})に失敗:`, e);
        return defaultValue;
    }
}

/**
 * 特定のキーを削除
 * @param {string} key - キー名
 */
export function removeItem(key) {
    localStorage.removeItem(key);
}

// デフォルトエクスポート
export default {
    saveSettings,
    loadSettings,
    clearSettings,
    setItem,
    getItem,
    removeItem
};
