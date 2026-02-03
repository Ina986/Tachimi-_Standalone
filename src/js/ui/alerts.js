/**
 * タチミ - アラート/確認ダイアログモジュール
 */

import { $, focusElement } from '../utils/dom.js';

/**
 * カスタムアラートを表示
 * @param {string} message - 表示メッセージ
 * @param {string} kind - 'warning' | 'error' | 'info'
 * @returns {Promise<void>} OKボタンが押されたら解決
 */
export function showAlert(message, kind = 'warning') {
    return new Promise((resolve) => {
        const modal = $('alertModal');
        const icon = $('alertModalIcon');
        const msg = $('alertModalMessage');
        const okBtn = $('alertModalOk');

        if (!modal || !icon || !msg || !okBtn) {
            // フォールバック: ブラウザのalert
            alert(message);
            resolve();
            return;
        }

        // アイコン設定
        icon.className = 'alert-modal-icon ' + kind;
        const icons = {
            warning: '\u26A0', // ⚠
            error: '\u2715',   // ✕
            info: '\u2139',    // ℹ
            success: '\u2713'  // ✓
        };
        icon.textContent = icons[kind] || icons.warning;

        // メッセージ設定
        msg.textContent = message;

        // モーダル表示
        modal.style.display = 'flex';

        // OKボタンにフォーカス
        focusElement(okBtn, 50);

        // イベントハンドラ
        const close = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', close);
            document.removeEventListener('keydown', keyHandler);
            resolve();
        };

        const keyHandler = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };

        okBtn.addEventListener('click', close);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * 確認ダイアログを表示
 * @param {string} message - 表示メッセージ
 * @param {Object} options - オプション
 * @param {string} options.confirmText - 確認ボタンのテキスト
 * @param {string} options.cancelText - キャンセルボタンのテキスト
 * @param {string} options.kind - 'warning' | 'error' | 'info'
 * @returns {Promise<boolean>} 確認されたらtrue、キャンセルされたらfalse
 */
export function showConfirm(message, options = {}) {
    const {
        confirmText = 'OK',
        cancelText = 'キャンセル',
        kind = 'warning'
    } = options;

    return new Promise((resolve) => {
        const modal = $('confirmModal');
        const icon = $('confirmModalIcon');
        const msg = $('confirmModalMessage');
        const okBtn = $('confirmModalOk');
        const cancelBtn = $('confirmModalCancel');

        if (!modal || !okBtn || !cancelBtn) {
            // フォールバック: ブラウザのconfirm
            resolve(confirm(message));
            return;
        }

        // アイコン設定
        if (icon) {
            icon.className = 'confirm-modal-icon ' + kind;
            const icons = {
                warning: '\u26A0',
                error: '\u2715',
                info: '\u2139'
            };
            icon.textContent = icons[kind] || icons.warning;
        }

        // メッセージ設定
        if (msg) msg.textContent = message;

        // ボタンテキスト設定
        okBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        // モーダル表示
        modal.style.display = 'flex';

        // キャンセルボタンにフォーカス
        focusElement(cancelBtn, 50);

        // イベントハンドラ
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', keyHandler);
        };

        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            }
        };

        okBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * ステータスメッセージを表示
 * @param {string} message - メッセージ
 * @param {string} type - 'info' | 'success' | 'warning' | 'error'
 */
export function setStatus(message, type = 'info') {
    const statusEl = $('status');
    if (statusEl) {
        statusEl.textContent = message;

        // タイプに応じたクラスを設定
        statusEl.className = 'status-inline';
        if (type !== 'info') {
            statusEl.classList.add(`status-${type}`);
        }
    }
}

// デフォルトエクスポート
export default {
    showAlert,
    showConfirm,
    setStatus
};
