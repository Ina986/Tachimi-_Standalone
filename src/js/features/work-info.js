/**
 * work-info.js - 作品情報入力管理
 * チェックボックスON時の選択ダイアログ + 手動入力フォーム
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';

/**
 * 選択ダイアログを表示
 * @returns {Promise<'json'|'manual'|null>} 選択結果
 */
export function showWorkInfoChoiceDialog() {
    return new Promise((resolve) => {
        const modal = $('workInfoChoiceModal');
        const backdrop = modal.querySelector('.confirm-modal-backdrop');
        const jsonBtn = $('workInfoChoiceJson');
        const manualBtn = $('workInfoChoiceManual');

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            jsonBtn.removeEventListener('click', handleJson);
            manualBtn.removeEventListener('click', handleManual);
            backdrop.removeEventListener('click', handleClose);
            document.removeEventListener('keydown', keyHandler);
        };

        const handleJson = () => { cleanup(); resolve('json'); };
        const handleManual = () => { cleanup(); resolve('manual'); };
        const handleClose = () => { cleanup(); resolve(null); };
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); handleClose(); }
        };

        jsonBtn.addEventListener('click', handleJson);
        manualBtn.addEventListener('click', handleManual);
        backdrop.addEventListener('click', handleClose);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * 手動入力フォームモーダルを表示
 * @returns {Promise<Object|null>} 入力された作品情報、キャンセル時null
 */
export function showManualWorkInfoModal() {
    return new Promise((resolve) => {
        const modal = $('manualWorkInfoModal');
        const backdrop = modal.querySelector('.confirm-modal-backdrop');
        const cancelBtn = $('btnManualWorkInfoCancel');
        const confirmBtn = $('btnManualWorkInfoConfirm');

        // 既存のmanualWorkInfoがあればフォームにプリフィル
        prefillForm(appState.manualWorkInfo);

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            backdrop.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', keyHandler);
        };

        const handleConfirm = () => {
            const data = collectFormData();
            cleanup();
            resolve(data);
        };

        const handleCancel = () => { cleanup(); resolve(null); };
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        backdrop.addEventListener('click', handleCancel);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * フォームデータを収集
 */
function collectFormData() {
    const authorTypeRadio = document.querySelector('input[name="manualAuthorType"]:checked');
    return {
        label: $('manualLabel').value.trim(),
        title: $('manualTitle').value.trim(),
        subtitle: $('manualSubtitle').value.trim(),
        version: $('manualVersion').value.trim(),
        authorType: authorTypeRadio ? authorTypeRadio.value : 'single',
        author1: $('manualAuthor1').value.trim(),
        author2: $('manualAuthor2').value.trim()
    };
}

/**
 * 既存データでフォームをプリフィル
 */
function prefillForm(data) {
    $('manualLabel').value = data?.label || '';
    $('manualTitle').value = data?.title || '';
    $('manualSubtitle').value = data?.subtitle || '';
    $('manualVersion').value = data?.version || '';
    $('manualAuthor1').value = data?.author1 || '';
    $('manualAuthor2').value = data?.author2 || '';

    const type = data?.authorType || 'single';
    const radio = document.querySelector(`input[name="manualAuthorType"][value="${type}"]`);
    if (radio) radio.checked = true;

    updateAuthorFieldsVisibility(type);
}

/**
 * 著者タイプに応じてフィールドの表示を切替
 */
function updateAuthorFieldsVisibility(authorType) {
    const author1Label = $('manualAuthor1Label');
    const author2Field = $('manualAuthor2Field');

    if (authorType === 'pair') {
        if (author1Label) author1Label.textContent = '作画';
        if (author2Field) author2Field.style.display = 'flex';
    } else {
        if (author1Label) author1Label.textContent = '著者';
        if (author2Field) author2Field.style.display = 'none';
    }
}

/**
 * イベントリスナーのセットアップ
 */
export function setupWorkInfoEvents() {
    document.querySelectorAll('input[name="manualAuthorType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateAuthorFieldsVisibility(e.target.value);
        });
    });
}
