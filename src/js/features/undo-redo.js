/**
 * undo-redo.js - Undo/Redo履歴管理
 * クロップモードの操作履歴（最大50）
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { MAX_HISTORY } from './constants.js';

// restoreState後のUI更新コールバック
let _onRestoreCallbacks = [];

/**
 * restoreState時に呼ばれるUI更新コールバックを登録
 * crop-mode.jsなどが登録する
 */
export function onRestore(callback) {
    _onRestoreCallbacks.push(callback);
}

/**
 * 現在の状態をスナップショットとして取得
 */
export function getCurrentState() {
    return {
        guides: JSON.parse(JSON.stringify(appState.guides)),
        cropValues: {
            left: parseInt($('cropLeftFull')?.value) || 0,
            top: parseInt($('cropTopFull')?.value) || 0,
            right: parseInt($('cropRightFull')?.value) || 0,
            bottom: parseInt($('cropBottomFull')?.value) || 0
        }
    };
}

/**
 * 状態を復元
 */
export function restoreState(state) {
    appState.guides = JSON.parse(JSON.stringify(state.guides));
    if ($('cropLeftFull')) $('cropLeftFull').value = state.cropValues.left;
    if ($('cropTopFull')) $('cropTopFull').value = state.cropValues.top;
    if ($('cropRightFull')) $('cropRightFull').value = state.cropValues.right;
    if ($('cropBottomFull')) $('cropBottomFull').value = state.cropValues.bottom;

    // 登録されたUI更新コールバックを実行
    _onRestoreCallbacks.forEach(cb => {
        try { cb(); } catch (e) { console.error('onRestore callback error:', e); }
    });
}

/**
 * 操作前に現在の状態を履歴に保存
 */
export function saveToHistory() {
    const state = getCurrentState();
    appState.undoHistory.push(state);

    if (appState.undoHistory.length > MAX_HISTORY) {
        appState.undoHistory.shift();
    }

    // 新しい操作が行われたらRedoをクリア
    appState.redoHistory = [];
}

/**
 * Undo実行
 */
export function undo() {
    if (appState.undoHistory.length === 0) {
        if (typeof window.setStatus === 'function') window.setStatus('これ以上戻れません');
        return;
    }

    appState.redoHistory.push(getCurrentState());
    const prevState = appState.undoHistory.pop();
    restoreState(prevState);

    if (typeof window.setStatus === 'function') window.setStatus('操作を元に戻しました (Ctrl+Y でやり直し)');
}

/**
 * Redo実行
 */
export function redo() {
    if (appState.redoHistory.length === 0) {
        if (typeof window.setStatus === 'function') window.setStatus('やり直す操作がありません');
        return;
    }

    appState.undoHistory.push(getCurrentState());
    const nextState = appState.redoHistory.pop();
    restoreState(nextState);

    if (typeof window.setStatus === 'function') window.setStatus('操作をやり直しました');
}

/**
 * 履歴をクリア
 */
export function clearHistory() {
    appState.undoHistory = [];
    appState.redoHistory = [];
}
