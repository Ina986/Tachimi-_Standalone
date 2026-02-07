/**
 * json-register.js - JSON新規登録機能
 * 選択範囲をJSONファイルとして新規作成・既存に追加
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { JSON_FOLDER_PATH, LABELS_BY_GENRE } from './constants.js';
import { isFeatureUnlocked } from './feature-unlock.js';
import { jsonSelectModal } from './json-modal.js';
import { showAlert } from '../ui/alerts.js';

/**
 * JSON登録モーダルを表示
 */
export function showJsonRegisterModal() {
    // アンロックチェック（ボタンは非表示だが念のためガード）
    if (!isFeatureUnlocked()) {
        return;
    }

    // 現在の選択範囲を取得して表示
    const left = parseInt($('cropLeftFull').value) || 0;
    const top = parseInt($('cropTopFull').value) || 0;
    const right = parseInt($('cropRightFull').value) || 0;
    const bottom = parseInt($('cropBottomFull').value) || 0;

    // 範囲が設定されているか確認
    if (left === 0 && top === 0 && right === 0 && bottom === 0) {
        showAlert('選択範囲が設定されていません。\n先に範囲を設定してください。', 'warning');
        return;
    }

    const width = right - left;
    const height = bottom - top;

    // プレビュー表示を更新
    $('registerLeft').textContent = left;
    $('registerTop').textContent = top;
    $('registerRight').textContent = right;
    $('registerBottom').textContent = bottom;
    $('registerSize').textContent = `${width} × ${height}`;
    $('registerDocSize').textContent = `${appState.previewImageSize.width} × ${appState.previewImageSize.height}`;

    // デフォルトラベル名を設定
    const defaultLabel = `基本範囲_${appState.previewImageSize.width}x${appState.previewImageSize.height}`;
    $('registerRangeLabelNew').value = defaultLabel;
    $('registerRangeLabelExisting').value = defaultLabel;

    // フォームをリセット
    $('registerGenre').value = '';
    $('registerLabel').innerHTML = '<option value="">ジャンルを選択してください</option>';
    $('registerLabel').disabled = true;
    $('registerTitle').value = '';
    $('registerExistingFile').value = '';
    $('registerExistingInfo').style.display = 'none';
    $('btnAddToExisting').disabled = true;
    appState.registerModalSelectedFile = null;
    appState.registerModalExistingData = null;

    // タブを新規作成に戻す
    document.querySelectorAll('.register-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.register-tab[data-tab="new"]').classList.add('active');
    $('registerPanelNew').style.display = 'block';
    $('registerPanelExisting').style.display = 'none';

    // モーダル表示
    $('jsonRegisterModal').style.display = 'flex';
}

/**
 * JSON登録モーダルを非表示
 */
export function hideJsonRegisterModal() {
    $('jsonRegisterModal').style.display = 'none';
}

/**
 * 現在の選択範囲データを取得
 */
export function getCurrentSelectionData(labelName) {
    const left = parseInt($('cropLeftFull').value) || 0;
    const top = parseInt($('cropTopFull').value) || 0;
    const right = parseInt($('cropRightFull').value) || 0;
    const bottom = parseInt($('cropBottomFull').value) || 0;

    return {
        label: labelName,
        units: "px",
        bounds: { left, top, right, bottom },
        size: {
            width: right - left,
            height: bottom - top
        },
        documentSize: {
            width: appState.previewImageSize.width,
            height: appState.previewImageSize.height
        },
        savedAt: new Date().toISOString()
    };
}

/**
 * 新規JSONファイルとして保存
 */
export async function saveAsNewJson() {
    const genre = $('registerGenre').value;
    const label = $('registerLabel').value;
    const title = $('registerTitle').value.trim();
    const rangeLabelInput = $('registerRangeLabelNew').value.trim();

    // バリデーション
    if (!genre) {
        showAlert('ジャンルを選択してください。', 'warning');
        return;
    }
    if (!label) {
        showAlert('レーベルを選択してください。', 'warning');
        return;
    }
    if (!title) {
        showAlert('作品タイトルを入力してください。', 'warning');
        return;
    }

    // ラベル名を構築（画像サイズを自動付加）
    const rangeLabel = rangeLabelInput || '基本範囲';
    const fullRangeLabel = `${rangeLabel}_${appState.previewImageSize.width}x${appState.previewImageSize.height}`;

    // ファイル名に使えない文字を置換
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeTitle}.json`;
    const filePath = `${JSON_FOLDER_PATH}/${label}/${fileName}`;

    try {
        // ファイルが既に存在するか確認
        const exists = await appState.invoke('file_exists', { path: filePath });

        if (exists) {
            // 既存ファイルに追加するか確認
            const confirmAdd = confirm(
                `「${fileName}」は既に存在します。\n` +
                `既存のファイルに範囲を追加しますか？\n\n` +
                `「OK」→ 既存に追加\n` +
                `「キャンセル」→ 中止`
            );

            if (!confirmAdd) {
                return;
            }

            // 既存ファイルを読み込んで追加
            const content = await appState.invoke('read_json_file', { path: filePath });
            const existingData = JSON.parse(content);

            // 選択範囲データを作成
            const selectionData = getCurrentSelectionData(fullRangeLabel);

            // 重複チェック
            if (checkDuplicateLabel(existingData, fullRangeLabel)) {
                showDuplicateLabelModal(fullRangeLabel, async (action, newLabel) => {
                    if (action === 'cancel') return;

                    const finalLabel = action === 'addDate'
                        ? generateDateTimeLabel(newLabel || fullRangeLabel)
                        : (newLabel || fullRangeLabel);

                    selectionData.label = finalLabel;
                    addSelectionRangeToData(existingData, selectionData, action === 'overwrite' ? fullRangeLabel : null);

                    await saveJsonAndNotify(filePath, existingData, finalLabel, label, title);
                });
                return;
            }

            addSelectionRangeToData(existingData, selectionData, null);
            await saveJsonAndNotify(filePath, existingData, fullRangeLabel, label, title);

        } else {
            // 新規作成
            const selectionData = getCurrentSelectionData(fullRangeLabel);

            const newJsonData = {
                presetData: {
                    workInfo: { genre, label, title },
                    selectionRanges: [selectionData],
                    createdAt: new Date().toISOString()
                }
            };

            await saveJsonAndNotify(filePath, newJsonData, fullRangeLabel, label, title);
        }
    } catch (e) {
        console.error('JSON保存エラー:', e);
        showAlert(`保存エラー: ${e}`, 'error');
    }
}

/**
 * JSONを保存して通知
 */
export async function saveJsonAndNotify(filePath, data, rangeLabel, label, title) {
    const content = JSON.stringify(data, null, 4);
    await appState.invoke('save_json_file', { path: filePath, content });

    hideJsonRegisterModal();
    showAlert(
        `選択範囲を保存しました！\n\n` +
        `レーベル: ${label}\n` +
        `タイトル: ${title}\n` +
        `ラベル: ${rangeLabel}`,
        'success'
    );
    if (typeof window.setStatus === 'function') window.setStatus(`JSON保存完了: ${title}`);
}

/**
 * 既存JSONファイルを選択（登録用）
 */
export async function selectExistingJsonForRegister() {
    console.log('selectExistingJsonForRegister called');
    console.log('jsonSelectModal:', jsonSelectModal);

    if (!jsonSelectModal) {
        console.error('jsonSelectModal is not initialized');
        showAlert('エラー: ファイル選択モーダルが初期化されていません', 'error');
        return;
    }

    // 既存のjsonSelectModalを流用して選択
    // 選択後のコールバックを設定
    const originalOnSelect = jsonSelectModal.onFileSelected;

    jsonSelectModal.onFileSelected = async (filePath, data) => {
        console.log('File selected:', filePath);
        // 選択されたファイル情報を保存
        appState.registerModalSelectedFile = filePath;
        appState.registerModalExistingData = data;

        // UI更新
        const fileName = filePath.split('/').pop().split('\\').pop();
        $('registerExistingFile').value = fileName;

        // 既存の範囲数を表示
        let rangeCount = 0;
        if (data.presetData && data.presetData.selectionRanges) {
            rangeCount = data.presetData.selectionRanges.length;
        } else if (data.selectionRanges) {
            rangeCount = data.selectionRanges.length;
        }

        $('registerExistingInfo').textContent = `既存の範囲設定: ${rangeCount}件`;
        $('registerExistingInfo').style.display = 'block';
        $('btnAddToExisting').disabled = false;

        // コールバックを元に戻す
        jsonSelectModal.onFileSelected = originalOnSelect;
        jsonSelectModal.hide();
    };

    jsonSelectModal.show();
}

/**
 * 既存JSONに範囲を追加
 */
export async function addToExistingJson() {
    if (!appState.registerModalSelectedFile || !appState.registerModalExistingData) {
        showAlert('JSONファイルを選択してください。', 'warning');
        return;
    }

    const rangeLabelInput = $('registerRangeLabelExisting').value.trim();
    const rangeLabel = rangeLabelInput || '基本範囲';
    const fullRangeLabel = `${rangeLabel}_${appState.previewImageSize.width}x${appState.previewImageSize.height}`;

    const selectionData = getCurrentSelectionData(fullRangeLabel);

    // 重複チェック
    if (checkDuplicateLabel(appState.registerModalExistingData, fullRangeLabel)) {
        showDuplicateLabelModal(fullRangeLabel, async (action, newLabel) => {
            if (action === 'cancel') return;

            const finalLabel = action === 'addDate'
                ? generateDateTimeLabel(newLabel || fullRangeLabel)
                : (newLabel || fullRangeLabel);

            selectionData.label = finalLabel;
            addSelectionRangeToData(appState.registerModalExistingData, selectionData, action === 'overwrite' ? fullRangeLabel : null);

            const content = JSON.stringify(appState.registerModalExistingData, null, 4);
            await appState.invoke('save_json_file', { path: appState.registerModalSelectedFile, content });

            hideJsonRegisterModal();
            const fileName = appState.registerModalSelectedFile.split('/').pop().split('\\').pop();
            showAlert(
                `選択範囲を追加しました！\n\n` +
                `ファイル: ${fileName}\n` +
                `ラベル: ${finalLabel}`,
                'success'
            );
            if (typeof window.setStatus === 'function') window.setStatus(`JSON更新完了: ${fileName}`);
        });
        return;
    }

    try {
        addSelectionRangeToData(appState.registerModalExistingData, selectionData, null);

        const content = JSON.stringify(appState.registerModalExistingData, null, 4);
        await appState.invoke('save_json_file', { path: appState.registerModalSelectedFile, content });

        hideJsonRegisterModal();
        const fileName = appState.registerModalSelectedFile.split('/').pop().split('\\').pop();
        showAlert(
            `選択範囲を追加しました！\n\n` +
            `ファイル: ${fileName}\n` +
            `ラベル: ${fullRangeLabel}`,
            'success'
        );
        if (typeof window.setStatus === 'function') window.setStatus(`JSON更新完了: ${fileName}`);
    } catch (e) {
        console.error('JSON更新エラー:', e);
        showAlert(`更新エラー: ${e}`, 'error');
    }
}

/**
 * 選択範囲データをJSONオブジェクトに追加
 */
export function addSelectionRangeToData(data, selectionData, overwriteLabel) {
    // presetDataがなければ作成
    if (!data.presetData) {
        data.presetData = {};
    }
    // selectionRangesがなければ作成
    if (!data.presetData.selectionRanges) {
        data.presetData.selectionRanges = [];
    }

    // 上書きの場合、同名ラベルを削除
    if (overwriteLabel) {
        data.presetData.selectionRanges = data.presetData.selectionRanges.filter(
            range => range.label !== overwriteLabel
        );
    }

    // 新しい選択範囲を追加
    data.presetData.selectionRanges.push(selectionData);

    return data;
}

/**
 * 重複ラベルをチェック
 */
export function checkDuplicateLabel(data, labelName) {
    const ranges = data.presetData?.selectionRanges || data.selectionRanges || [];
    return ranges.some(range => range.label === labelName);
}

/**
 * 日時を追加したラベル名を生成
 */
export function generateDateTimeLabel(labelName) {
    const now = new Date();
    const dateStr = `_${now.getFullYear()}` +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return labelName + dateStr;
}

/**
 * 重複ラベル確認モーダルを表示
 */
export function showDuplicateLabelModal(labelName, callback) {
    appState.duplicateLabelCallback = callback;
    appState.duplicateLabelOriginal = labelName;
    $('duplicateLabelName').textContent = labelName;
    $('duplicateLabelModal').style.display = 'flex';
}

/**
 * 重複ラベル確認モーダルを非表示
 */
export function hideDuplicateLabelModal() {
    $('duplicateLabelModal').style.display = 'none';
}

/**
 * 重複ラベルの処理を解決
 */
export function resolveDuplicateLabel(action) {
    hideDuplicateLabelModal();

    if (!appState.duplicateLabelCallback) return;

    if (action === 'cancel') {
        appState.duplicateLabelCallback('cancel', null);
    } else if (action === 'overwrite') {
        appState.duplicateLabelCallback('overwrite', appState.duplicateLabelOriginal);
    } else if (action === 'addDate') {
        appState.duplicateLabelCallback('addDate', appState.duplicateLabelOriginal);
    } else if (action === 'rename') {
        const newLabel = prompt('新しいラベル名を入力してください:', appState.duplicateLabelOriginal);
        if (newLabel && newLabel !== appState.duplicateLabelOriginal) {
            appState.duplicateLabelCallback('rename', newLabel);
        } else {
            appState.duplicateLabelCallback('cancel', null);
        }
    }

    appState.duplicateLabelCallback = null;
    appState.duplicateLabelOriginal = '';
}

/**
 * イベントリスナーのセットアップ
 */
export function setupJsonRegisterEvents() {
    $('btnRegisterJson').onclick = () => showJsonRegisterModal();
    $('btnJsonRegisterClose').onclick = () => hideJsonRegisterModal();
    $('jsonRegisterModal').querySelector('.json-register-backdrop').onclick = () => hideJsonRegisterModal();

    // タブ切替
    document.querySelectorAll('.register-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.register-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            $('registerPanelNew').style.display = tabName === 'new' ? 'block' : 'none';
            $('registerPanelExisting').style.display = tabName === 'existing' ? 'block' : 'none';
        };
    });

    // ジャンル選択変更時にレーベルを更新
    $('registerGenre').onchange = () => {
        const genre = $('registerGenre').value;
        const labelSelect = $('registerLabel');
        labelSelect.innerHTML = '';

        if (genre && LABELS_BY_GENRE[genre]) {
            labelSelect.disabled = false;
            LABELS_BY_GENRE[genre].forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                labelSelect.appendChild(option);
            });
        } else {
            labelSelect.disabled = true;
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'ジャンルを選択してください';
            labelSelect.appendChild(option);
        }
    };

    // 新規作成保存ボタン
    $('btnSaveNewJson').onclick = () => saveAsNewJson();

    // 既存JSONファイル選択
    $('btnSelectExistingJson').onclick = () => selectExistingJsonForRegister();
    $('registerExistingFile').onclick = () => selectExistingJsonForRegister();

    // 既存に追加ボタン
    $('btnAddToExisting').onclick = () => addToExistingJson();

    // 重複ラベルモーダル
    $('btnDuplicateOverwrite').onclick = () => resolveDuplicateLabel('overwrite');
    $('btnDuplicateRename').onclick = () => resolveDuplicateLabel('rename');
    $('btnDuplicateAddDate').onclick = () => resolveDuplicateLabel('addDate');
    $('btnDuplicateCancel').onclick = () => resolveDuplicateLabel('cancel');
}
