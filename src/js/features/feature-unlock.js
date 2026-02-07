/**
 * feature-unlock.js - 機能アンロック管理
 * パスワードによる機能制限の解除/再ロック
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { UNLOCK_STORAGE_KEY, UNLOCK_PASSWORD } from './constants.js';

/**
 * アンロック状態を取得
 */
export function isFeatureUnlocked() {
    try {
        const data = localStorage.getItem(UNLOCK_STORAGE_KEY);
        if (!data) return false;
        const parsed = JSON.parse(data);
        return parsed.unlocked === true;
    } catch {
        return false;
    }
}

/**
 * アンロック状態を保存
 */
export function setFeatureUnlocked(unlocked) {
    try {
        localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify({
            unlocked: unlocked,
            timestamp: new Date().toISOString()
        }));
        updateLockIcon();
        updateUnlockModalUI();
        updateJsonRegisterButtonVisibility();
        updateCropInputsDisabledState();
        // クロップモードが開いている場合はガイドボタンの表示も更新
        if (appState.cropModeOpen && typeof window._updateGuideList === 'function') {
            window._updateGuideList();
        }
    } catch (e) {
        console.warn('アンロック状態の保存に失敗:', e);
    }
}

/**
 * パスワード検証
 */
export function verifyUnlockPassword(inputPassword) {
    return inputPassword === UNLOCK_PASSWORD;
}

/**
 * アンロック試行
 */
export function attemptUnlock() {
    const input = $('unlockPassword');
    const errorEl = $('unlockError');

    if (verifyUnlockPassword(input.value)) {
        setFeatureUnlocked(true);
        input.value = '';
        errorEl.style.display = 'none';
    } else {
        errorEl.style.display = 'block';
        input.value = '';
        input.focus();
    }
}

/**
 * 再ロック
 */
export function lockFeature() {
    setFeatureUnlocked(false);
}

/**
 * ヘッダーの鍵アイコン状態を更新
 */
export function updateLockIcon() {
    const lockEl = $('btnFeatureLock');
    if (!lockEl) return;

    const closedIcon = lockEl.querySelector('.lock-closed');
    const openIcon = lockEl.querySelector('.lock-open');
    const unlocked = isFeatureUnlocked();

    if (closedIcon) closedIcon.style.display = unlocked ? 'none' : 'block';
    if (openIcon) openIcon.style.display = unlocked ? 'block' : 'none';
}

/**
 * 設定モーダル内のUI状態を更新
 */
export function updateUnlockModalUI() {
    const unlocked = isFeatureUnlocked();
    const statusEl = $('unlockStatus');
    const statusText = statusEl?.querySelector('.unlock-status-text');
    const inputArea = $('unlockInputArea');
    const unlockedArea = $('unlockedArea');

    if (statusEl) {
        statusEl.classList.toggle('locked', !unlocked);
        statusEl.classList.toggle('unlocked', unlocked);
    }
    if (statusText) {
        statusText.textContent = unlocked
            ? 'JSON新規登録: アンロック済み'
            : 'JSON新規登録: ロック中';
    }
    if (inputArea) {
        inputArea.style.display = unlocked ? 'none' : 'block';
    }
    if (unlockedArea) {
        unlockedArea.style.display = unlocked ? 'block' : 'none';
    }
}

/**
 * JSON新規登録ボタンの表示/非表示を更新
 */
export function updateJsonRegisterButtonVisibility() {
    const btn = $('btnRegisterJson');
    if (btn) {
        btn.style.display = isFeatureUnlocked() ? '' : 'none';
    }
}

/**
 * クロップモードの数値入力欄の有効/無効を更新
 */
export function updateCropInputsDisabledState() {
    const unlocked = isFeatureUnlocked();
    const inputs = ['cropLeftFull', 'cropTopFull', 'cropRightFull', 'cropBottomFull'];

    inputs.forEach(id => {
        const input = $(id);
        if (input) {
            input.disabled = unlocked;
            input.style.opacity = unlocked ? '0.5' : '1';
            input.title = unlocked ? '比率固定モード（640:909）' : '';
        }
    });
}

/**
 * 機能アンロックモーダルを表示
 */
export function showFeatureUnlockModal() {
    updateUnlockModalUI();
    $('featureUnlockModal').style.display = 'flex';
}

/**
 * 機能アンロックモーダルを非表示
 */
export function hideFeatureUnlockModal() {
    $('featureUnlockModal').style.display = 'none';
    $('unlockPassword').value = '';
    $('unlockError').style.display = 'none';
}

/**
 * イベントリスナーのセットアップ
 */
export function setupUnlockEvents() {
    $('btnFeatureLock').onclick = () => showFeatureUnlockModal();
    $('btnFeatureUnlockClose').onclick = () => hideFeatureUnlockModal();
    $('featureUnlockModal').querySelector('.feature-unlock-backdrop').onclick = () => hideFeatureUnlockModal();
    $('btnUnlock').onclick = () => attemptUnlock();
    $('unlockPassword').onkeydown = (e) => {
        if (e.key === 'Enter') attemptUnlock();
    };
    $('btnLockAgain').onclick = () => lockFeature();
}
