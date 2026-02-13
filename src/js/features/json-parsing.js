/**
 * json-parsing.js - JSONデータ解析
 * JSON設定ファイルのパース、範囲選択適用、クロップ範囲反映
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';

/**
 * 作品情報プレビューテキストを取得
 */
export function getWorkInfoPreviewText() {
    let label, title, subtitle, version, authorType, author, artist, original;

    if (appState.workInfoSource === 'manual' && appState.manualWorkInfo) {
        const wi = appState.manualWorkInfo;
        label = wi.label || '';
        title = wi.title || '';
        subtitle = wi.subtitle || '';
        version = wi.version || '';
        authorType = wi.authorType || 'single';
        author = wi.authorType === 'pair' ? '' : (wi.author1 || '');
        artist = wi.authorType === 'pair' ? (wi.author1 || '') : '';
        original = wi.author2 || '';
    } else if (appState.jsonData) {
        const preset = appState.jsonData.presetData || appState.jsonData;
        const workInfo = preset.workInfo || {};
        label = workInfo.label || '';
        title = workInfo.title || '';
        subtitle = workInfo.subtitle || '';
        version = workInfo.volume || '';
        authorType = workInfo.authorType || 'single';
        author = workInfo.author || '';
        artist = workInfo.artist || '';
        original = workInfo.original || '';
    } else {
        return '作品情報未設定';
    }

    let lines = [];

    // レーベル
    if (label) {
        lines.push(`<div class="work-info-label">${escapeHtml(label)}</div>`);
    }
    // タイトル
    if (title) {
        lines.push(`<div class="work-info-title">${escapeHtml(title)}</div>`);
    }
    // サブタイトル
    if (subtitle) {
        lines.push(`<div class="work-info-subtitle">${escapeHtml(subtitle)}</div>`);
    }
    // 巻数
    if (version) {
        lines.push(`<div class="work-info-version">${escapeHtml(version)}</div>`);
    }
    // 著者
    if (authorType === 'pair' && artist && original) {
        // 作画/原作分離
        lines.push(`<div class="work-info-author">作画: ${escapeHtml(artist)}</div>`);
        lines.push(`<div class="work-info-author">原作: ${escapeHtml(original)}</div>`);
    } else if (author) {
        lines.push(`<div class="work-info-author">著: ${escapeHtml(author)}</div>`);
    }

    if (lines.length === 0) {
        return '作品情報未設定';
    }

    return lines.join('');
}

/**
 * HTMLエスケープ
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * JSONデータを解析
 */
export function parseJsonData(data, fileName) {
    appState.selectionRanges = [];
    appState.selectedRange = null;

    // presetData.selectionRanges を探す
    let ranges = null;
    if (data.presetData && data.presetData.selectionRanges) {
        ranges = data.presetData.selectionRanges;
    } else if (data.selectionRanges) {
        ranges = data.selectionRanges;
    }

    if (ranges && ranges.length > 0) {
        appState.selectionRanges = ranges;

        // ラベル選択UIを更新
        const select = $('labelSelect');
        select.innerHTML = '';

        ranges.forEach((range, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = range.label || `範囲 ${index + 1}`;
            select.appendChild(option);
        });

        // 複数ある場合は選択UIを表示
        $('labelSelectArea').style.display = ranges.length > 1 ? 'flex' : 'none';

        // 最初の範囲を適用
        applySelectionRange(ranges[0]);

        // クロップモード内のラベル選択も更新
        if (appState.cropModeOpen) {
            if (typeof window.updateCropModeLabelSelect === 'function') {
                window.updateCropModeLabelSelect();
            }
        }

        $('jsonInfo').textContent = fileName;
        $('jsonInfo').className = 'json-status success';
        if (typeof window.setStatus === 'function') window.setStatus(`JSON読み込み完了 (${ranges.length}件の範囲設定)`);

    } else if (data.presetData && data.presetData.guides) {
        // 旧形式: guides から読み込み
        const guides = data.presetData.guides;
        if (guides.vertical && guides.horizontal) {
            const bounds = {
                left: Math.min(...guides.vertical),
                right: Math.max(...guides.vertical),
                top: Math.min(...guides.horizontal),
                bottom: Math.max(...guides.horizontal)
            };
            applyCropBounds(bounds);
            $('labelSelectArea').style.display = 'none';
            $('jsonInfo').textContent = fileName + ' (guides)';
            $('jsonInfo').className = 'json-status success';
            if (typeof window.setStatus === 'function') window.setStatus('JSON読み込み完了 (ガイド形式)');

            // CropUIモードが開いている場合、CropUI入力欄も更新
            if (appState.cropModeOpen) {
                $('cropLeftFull').value = Math.round(bounds.left);
                $('cropTopFull').value = Math.round(bounds.top);
                $('cropRightFull').value = Math.round(bounds.right);
                $('cropBottomFull').value = Math.round(bounds.bottom);
                if (typeof window.updateSelectionVisual === 'function') window.updateSelectionVisual();
                if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();
            }
        }
    } else if (data.vertical && data.horizontal) {
        // シンプル形式
        const bounds = {
            left: Math.min(...data.vertical),
            right: Math.max(...data.vertical),
            top: Math.min(...data.horizontal),
            bottom: Math.max(...data.horizontal)
        };
        applyCropBounds(bounds);
        $('labelSelectArea').style.display = 'none';
        $('jsonInfo').textContent = fileName;
        $('jsonInfo').className = 'json-status success';
        if (typeof window.setStatus === 'function') window.setStatus('JSON読み込み完了');

        // CropUIモードが開いている場合、CropUI入力欄も更新
        if (appState.cropModeOpen) {
            $('cropLeftFull').value = Math.round(bounds.left);
            $('cropTopFull').value = Math.round(bounds.top);
            $('cropRightFull').value = Math.round(bounds.right);
            $('cropBottomFull').value = Math.round(bounds.bottom);
            if (typeof window.updateSelectionVisual === 'function') window.updateSelectionVisual();
            if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();
        }
    } else {
        $('jsonInfo').textContent = '範囲設定が見つかりません';
        $('jsonInfo').className = 'json-status error';
    }

    // 作品情報プレビューを更新
    if (typeof window.updateSpreadPreview === 'function') window.updateSpreadPreview();
}

/**
 * 範囲選択を適用
 */
export function applySelectionRange(range) {
    appState.selectedRange = range;

    if (range.bounds) {
        applyCropBounds(range.bounds);
    }

    // ドキュメントサイズ情報を表示
    if (range.documentSize) {
        $('docSizeInfo').textContent = `基準: ${range.documentSize.width} × ${range.documentSize.height} px`;
    } else {
        $('docSizeInfo').textContent = '';
    }
}

/**
 * クロップ範囲を入力欄に反映
 */
export function applyCropBounds(bounds) {
    // メイン画面側の入力欄を更新
    $('cropLeft').value = Math.round(bounds.left);
    $('cropTop').value = Math.round(bounds.top);
    $('cropRight').value = Math.round(bounds.right);
    $('cropBottom').value = Math.round(bounds.bottom);
    if (typeof window.updateCropRangeStatus === 'function') window.updateCropRangeStatus();

    // クロップモードが開いている場合はクロップモード側の入力欄も同期
    if (appState.cropModeOpen) {
        $('cropLeftFull').value = Math.round(bounds.left);
        $('cropTopFull').value = Math.round(bounds.top);
        $('cropRightFull').value = Math.round(bounds.right);
        $('cropBottomFull').value = Math.round(bounds.bottom);
        if (typeof window.updateSelectionVisual === 'function') window.updateSelectionVisual();
        if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();
        if (typeof window.updateApplyButtonState === 'function') window.updateApplyButtonState();
    }
}

/**
 * ラベル選択変更イベントのセットアップ
 */
export function setupJsonParsingEvents() {
    // ラベル選択変更
    $('labelSelect').onchange = () => {
        const index = parseInt($('labelSelect').value);
        if (appState.selectionRanges[index]) {
            applySelectionRange(appState.selectionRanges[index]);
        }
    };
}
