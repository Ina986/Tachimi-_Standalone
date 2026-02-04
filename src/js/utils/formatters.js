/**
 * タチミ - フォーマッターユーティリティ
 */

/**
 * ミリ秒を「分:秒」形式にフォーマット
 * @param {number} ms - ミリ秒
 * @returns {string}
 */
export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * バイト数を人間が読みやすい形式にフォーマット
 * @param {number} bytes - バイト数
 * @param {number} decimals - 小数点以下の桁数
 * @returns {string}
 */
export function formatFileSize(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 数値をパーセンテージにフォーマット
 * @param {number} value - 値（0-1または0-100）
 * @param {boolean} isRatio - 0-1の比率かどうか
 * @param {number} decimals - 小数点以下の桁数
 * @returns {string}
 */
export function formatPercent(value, isRatio = false, decimals = 0) {
    const percent = isRatio ? value * 100 : value;
    return percent.toFixed(decimals) + '%';
}

/**
 * ファイルパスからファイル名を取得
 * @param {string} path - ファイルパス
 * @returns {string}
 */
export function getFileName(path) {
    if (!path) return '';
    // Windows と Unix 両方のパス区切りに対応
    return path.split(/[/\\]/).pop() || '';
}

/**
 * ファイルパスから拡張子を取得
 * @param {string} path - ファイルパス
 * @returns {string} 小文字の拡張子（ドットなし）
 */
export function getExtension(path) {
    const filename = getFileName(path);
    const lastDot = filename.lastIndexOf('.');
    if (lastDot < 0) return '';
    return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * ファイルパスから拡張子を除いたファイル名を取得
 * @param {string} path - ファイルパス
 * @returns {string}
 */
export function getBaseName(path) {
    const filename = getFileName(path);
    const lastDot = filename.lastIndexOf('.');
    if (lastDot < 0) return filename;
    return filename.slice(0, lastDot);
}

/**
 * ファイルパスからディレクトリパスを取得
 * @param {string} path - ファイルパス
 * @returns {string}
 */
export function getDirName(path) {
    if (!path) return '';
    const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (lastSep < 0) return '';
    return path.slice(0, lastSep);
}

/**
 * 数値を3桁区切りでフォーマット
 * @param {number} num - 数値
 * @returns {string}
 */
export function formatNumber(num) {
    return num.toLocaleString('ja-JP');
}

/**
 * ピクセル値をmm単位に変換（350dpi基準）
 * @param {number} px - ピクセル値
 * @param {number} dpi - DPI値
 * @returns {number}
 */
export function pxToMm(px, dpi = 350) {
    return (px / dpi) * 25.4;
}

/**
 * mm単位をピクセル値に変換（350dpi基準）
 * @param {number} mm - ミリメートル値
 * @param {number} dpi - DPI値
 * @returns {number}
 */
export function mmToPx(mm, dpi = 350) {
    return (mm / 25.4) * dpi;
}

/**
 * 文字列を最大長で切り詰める
 * @param {string} str - 文字列
 * @param {number} maxLength - 最大長
 * @param {string} suffix - 省略時の接尾辞
 * @returns {string}
 */
export function truncate(str, maxLength, suffix = '...') {
    if (!str || str.length <= maxLength) return str || '';
    return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * パスを短縮表示用にフォーマット
 * @param {string} path - ファイルパス
 * @param {number} maxLength - 最大表示長
 * @returns {string}
 */
export function formatPath(path, maxLength = 40) {
    if (!path || path.length <= maxLength) return path || '';

    const fileName = getFileName(path);
    if (fileName.length >= maxLength - 3) {
        return truncate(fileName, maxLength);
    }

    const remaining = maxLength - fileName.length - 3; // "..."の分
    const dirPath = getDirName(path);

    if (dirPath.length <= remaining) {
        return path;
    }

    // ディレクトリパスの先頭部分を省略
    return '...' + dirPath.slice(-remaining) + '/' + fileName;
}

// デフォルトエクスポート
export default {
    formatTime,
    formatFileSize,
    formatPercent,
    getFileName,
    getExtension,
    getBaseName,
    getDirName,
    formatNumber,
    pxToMm,
    mmToPx,
    truncate,
    formatPath
};
