/**
 * guides.js - ガイド線管理
 * 定規描画、ガイド追加/削除、ガイドからクロップ範囲自動設定
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { saveToHistory } from '../features/undo-redo.js';
import { isFeatureUnlocked } from './feature-unlock.js';

// ── ヘルパー ──────────────────────────────────────

/**
 * object-fit: contain で表示された画像の実際の表示領域を計算
 */
function getActualImageBounds(img) {
    const containerWidth = img.offsetWidth;
    const containerHeight = img.offsetHeight;
    const imageAspect = appState.previewImageSize.width / appState.previewImageSize.height;
    const containerAspect = containerWidth / containerHeight;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (imageAspect > containerAspect) {
        // 画像の方が横長 → 幅に合わせてスケール
        displayWidth = containerWidth;
        displayHeight = containerWidth / imageAspect;
        offsetX = 0;
        offsetY = (containerHeight - displayHeight) / 2;
    } else {
        // コンテナの方が横長 → 高さに合わせてスケール
        displayHeight = containerHeight;
        displayWidth = containerHeight * imageAspect;
        offsetX = (containerWidth - displayWidth) / 2;
        offsetY = 0;
    }

    return { displayWidth, displayHeight, offsetX, offsetY };
}

/**
 * 有効なクロップ選択範囲があるかチェック
 */
function hasValidCropSelection() {
    const left = parseInt($('cropLeftFull')?.value) || 0;
    const top = parseInt($('cropTopFull')?.value) || 0;
    const right = parseInt($('cropRightFull')?.value) || 0;
    const bottom = parseInt($('cropBottomFull')?.value) || 0;

    // いずれかの値が0より大きければ有効とみなす
    return left > 0 || top > 0 || right > 0 || bottom > 0;
}

// ── 定規ホバーヒント ──────────────────────────────

/**
 * 定規ホバー時にヒントを表示
 */
function onRulerHover(type) {
    const hint = $('cropModeHint');
    if (!hint) return;

    if (type === 'h') {
        hint.textContent = '↓ 定規からドラッグでガイド追加';
    } else if (type === 'v') {
        hint.textContent = '→ 定規からドラッグでガイド追加';
    }
    // ホバー時は通常の青いスタイルのまま（highlightは追加しない）
    hint.classList.remove('highlight');
}

/**
 * 定規ホバー終了時にヒントを元に戻す
 */
function onRulerLeave() {
    if (typeof window.updateCropModeHint === 'function') window.updateCropModeHint();
}

// ── 定規描画 ──────────────────────────────────────

/**
 * 定規を描画
 */
export function drawRulers() {
    const img = $('cropPreviewImgFull');
    if (!img || !img.offsetWidth) return;

    const hCanvas = $('rulerHCanvas');
    const vCanvas = $('rulerVCanvas');
    if (!hCanvas || !vCanvas) return;

    const imgWidth = img.offsetWidth;
    const imgHeight = img.offsetHeight;
    const rulerSize = 20;

    // キャンバスサイズを設定
    hCanvas.width = imgWidth;
    hCanvas.height = rulerSize;
    vCanvas.width = rulerSize;
    vCanvas.height = imgHeight;

    const scaleX = appState.previewImageSize.width / imgWidth;
    const scaleY = appState.previewImageSize.height / imgHeight;

    // 定規の色設定（Photoshop風）
    const bgColor = '#535353';
    const bgColorLight = '#606060';
    const bgColorDark = '#404040';
    const tickColor = '#1a1a1a';
    const textColor = '#1a1a1a';
    const highlightColor = '#6a6a6a';
    const shadowColor = '#3a3a3a';

    // ========== 水平定規 ==========
    const hCtx = hCanvas.getContext('2d');

    // グラデーション背景
    const hGrad = hCtx.createLinearGradient(0, 0, 0, rulerSize);
    hGrad.addColorStop(0, highlightColor);
    hGrad.addColorStop(0.1, bgColorLight);
    hGrad.addColorStop(0.9, bgColor);
    hGrad.addColorStop(1, shadowColor);
    hCtx.fillStyle = hGrad;
    hCtx.fillRect(0, 0, imgWidth, rulerSize);

    // 目盛りを描画
    hCtx.fillStyle = tickColor;
    hCtx.strokeStyle = tickColor;
    hCtx.font = 'bold 9px Arial, sans-serif';
    hCtx.textBaseline = 'top';

    // 適切な目盛り間隔を計算
    const pixelsPerUnit = 1 / scaleX;
    let majorStep, minorStep;
    if (pixelsPerUnit > 2) {
        majorStep = 100; minorStep = 10;
    } else if (pixelsPerUnit > 0.5) {
        majorStep = 500; minorStep = 50;
    } else {
        majorStep = 1000; minorStep = 100;
    }

    // 小目盛り
    const minorStepPx = minorStep / scaleX;
    for (let px = 0; px < imgWidth; px += minorStepPx) {
        const realPx = Math.round(px * scaleX);
        const isMajor = realPx % majorStep === 0;
        const isMedium = realPx % (majorStep / 2) === 0;

        if (isMajor) {
            // 大目盛り + 数字
            hCtx.fillRect(Math.floor(px), 2, 1, rulerSize - 3);
            hCtx.fillText(realPx.toString(), Math.floor(px) + 3, 3);
        } else if (isMedium) {
            // 中目盛り
            hCtx.fillRect(Math.floor(px), rulerSize - 10, 1, 9);
        } else {
            // 小目盛り
            hCtx.fillRect(Math.floor(px), rulerSize - 6, 1, 5);
        }
    }

    // 下端のライン
    hCtx.fillStyle = shadowColor;
    hCtx.fillRect(0, rulerSize - 1, imgWidth, 1);

    // ========== 垂直定規 ==========
    const vCtx = vCanvas.getContext('2d');

    // グラデーション背景
    const vGrad = vCtx.createLinearGradient(0, 0, rulerSize, 0);
    vGrad.addColorStop(0, highlightColor);
    vGrad.addColorStop(0.1, bgColorLight);
    vGrad.addColorStop(0.9, bgColor);
    vGrad.addColorStop(1, shadowColor);
    vCtx.fillStyle = vGrad;
    vCtx.fillRect(0, 0, rulerSize, imgHeight);

    // 目盛りを描画
    vCtx.fillStyle = tickColor;
    vCtx.strokeStyle = tickColor;
    vCtx.font = 'bold 9px Arial, sans-serif';
    vCtx.textBaseline = 'middle';

    // 適切な目盛り間隔を計算
    const pixelsPerUnitV = 1 / scaleY;
    let majorStepV, minorStepV;
    if (pixelsPerUnitV > 2) {
        majorStepV = 100; minorStepV = 10;
    } else if (pixelsPerUnitV > 0.5) {
        majorStepV = 500; minorStepV = 50;
    } else {
        majorStepV = 1000; minorStepV = 100;
    }

    const minorStepPxV = minorStepV / scaleY;
    for (let py = 0; py < imgHeight; py += minorStepPxV) {
        const realPy = Math.round(py * scaleY);
        const isMajor = realPy % majorStepV === 0;
        const isMedium = realPy % (majorStepV / 2) === 0;

        if (isMajor) {
            // 大目盛り + 数字（縦書き）
            vCtx.fillRect(2, Math.floor(py), rulerSize - 3, 1);
            // 数字を縦に描画
            vCtx.save();
            vCtx.translate(10, Math.floor(py) + 3);
            vCtx.rotate(-Math.PI / 2);
            vCtx.textBaseline = 'middle';
            vCtx.fillText(realPy.toString(), 0, 0);
            vCtx.restore();
        } else if (isMedium) {
            // 中目盛り
            vCtx.fillRect(rulerSize - 10, Math.floor(py), 9, 1);
        } else {
            // 小目盛り
            vCtx.fillRect(rulerSize - 6, Math.floor(py), 5, 1);
        }
    }

    // 右端のライン
    vCtx.fillStyle = shadowColor;
    vCtx.fillRect(rulerSize - 1, 0, 1, imgHeight);
}

// ── 定規ドラッグイベント ──────────────────────────

/**
 * 定規からのドラッグイベントを設定
 */
export function setupRulerDragEvents() {
    const rulerH = $('rulerHorizontal');
    const rulerV = $('rulerVertical');
    const container = $('cropPreviewContainerFull');
    const guidePreview = $('guidePreview');

    if (!rulerH || !rulerV) return;

    // UI改修: 定規ホバー時のヒント表示
    rulerH.onmouseenter = () => onRulerHover('h');
    rulerH.onmouseleave = () => onRulerLeave();
    rulerV.onmouseenter = () => onRulerHover('v');
    rulerV.onmouseleave = () => onRulerLeave();

    // 水平定規からドラッグ開始（水平ガイドを作成）
    rulerH.onmousedown = (e) => {
        if (e.button !== 0) return;
        appState.rulerDragging = { type: 'h' };
        guidePreview.className = 'guide-preview horizontal';
        // 前回のスタイルをリセット
        guidePreview.style.width = '';
        guidePreview.style.height = '';
        guidePreview.style.left = '';
        guidePreview.style.top = '0px';
        guidePreview.style.display = 'block';
        e.preventDefault();
    };

    // 垂直定規からドラッグ開始（垂直ガイドを作成）
    rulerV.onmousedown = (e) => {
        if (e.button !== 0) return;
        appState.rulerDragging = { type: 'v' };
        guidePreview.className = 'guide-preview vertical';
        // 前回のスタイルをリセット
        guidePreview.style.width = '';
        guidePreview.style.height = '';
        guidePreview.style.top = '';
        guidePreview.style.left = '0px';
        guidePreview.style.display = 'block';
        e.preventDefault();
    };

    // マウス移動（ドラッグ中のプレビュー更新）
    document.addEventListener('mousemove', (e) => {
        if (!appState.rulerDragging || !appState.cropModeOpen) return;

        const img = $('cropPreviewImgFull');
        const container = $('cropPreviewContainerFull');
        if (!img || !container) return;

        const imgRect = img.getBoundingClientRect();
        // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
        const bounds = getActualImageBounds(img);

        if (appState.rulerDragging.type === 'h') {
            // 画像の実際の表示領域内でのY座標
            const y = e.clientY - imgRect.top - bounds.offsetY;
            if (y >= 0 && y <= bounds.displayHeight) {
                guidePreview.style.top = (y + bounds.offsetY) + 'px';
                // コンテナ全体に表示
                guidePreview.style.left = '0';
                guidePreview.style.width = '100%';
                guidePreview.style.display = 'block';
            } else {
                guidePreview.style.display = 'none';
            }
        } else {
            // 画像の実際の表示領域内でのX座標
            const x = e.clientX - imgRect.left - bounds.offsetX;
            if (x >= 0 && x <= bounds.displayWidth) {
                guidePreview.style.left = (x + bounds.offsetX) + 'px';
                // コンテナ全体に表示
                guidePreview.style.top = '0';
                guidePreview.style.height = '100%';
                guidePreview.style.display = 'block';
            } else {
                guidePreview.style.display = 'none';
            }
        }
    });

    // マウスアップ（ガイドを確定）
    document.addEventListener('mouseup', (e) => {
        if (!appState.rulerDragging || !appState.cropModeOpen) return;

        const img = $('cropPreviewImgFull');
        if (!img) {
            appState.rulerDragging = null;
            guidePreview.style.display = 'none';
            return;
        }

        const imgRect = img.getBoundingClientRect();
        // 実際の表示サイズを取得（object-fit: contain対応）
        const bounds = getActualImageBounds(img);
        const scaleX = appState.previewImageSize.width / bounds.displayWidth;
        const scaleY = appState.previewImageSize.height / bounds.displayHeight;

        if (appState.rulerDragging.type === 'h') {
            // 画像の実際の表示領域内でのY座標
            const y = e.clientY - imgRect.top - bounds.offsetY;
            if (y >= 0 && y <= bounds.displayHeight) {
                const realY = Math.round(y * scaleY);
                addGuide('h', realY);
            }
        } else {
            // 画像の実際の表示領域内でのX座標
            const x = e.clientX - imgRect.left - bounds.offsetX;
            if (x >= 0 && x <= bounds.displayWidth) {
                const realX = Math.round(x * scaleX);
                addGuide('v', realX);
            }
        }

        appState.rulerDragging = null;
        guidePreview.style.display = 'none';
    });
}

// ── ガイド描画 ────────────────────────────────────

/**
 * ガイド線を描画
 */
export function renderGuides() {
    const container = $('guideLinesContainer');
    const img = $('cropPreviewImgFull');
    const previewContainer = $('cropPreviewContainerFull');
    if (!container || !img || !previewContainer) return;

    container.innerHTML = '';

    // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
    const bounds = getActualImageBounds(img);
    const scaleX = bounds.displayWidth / appState.previewImageSize.width;
    const scaleY = bounds.displayHeight / appState.previewImageSize.height;

    appState.guides.forEach((guide, index) => {
        const line = document.createElement('div');
        line.className = `guide-line ${guide.type === 'h' ? 'horizontal' : 'vertical'}`;

        if (guide.type === 'h') {
            line.style.top = (guide.position * scaleY + bounds.offsetY) + 'px';
            // 水平ガイドはコンテナ全体に表示
            line.style.left = '0';
            line.style.width = '100%';
        } else {
            line.style.left = (guide.position * scaleX + bounds.offsetX) + 'px';
            // 垂直ガイドはコンテナ全体に表示
            line.style.top = '0';
            line.style.height = '100%';
        }

        line.onclick = (e) => {
            e.stopPropagation();
            removeGuide(index);
        };

        container.appendChild(line);
    });
}

// ── ガイドリストUI ────────────────────────────────

/**
 * ガイドリストUIを更新
 */
export function updateGuideList() {
    const list = $('guideList');
    if (!list) return;

    list.innerHTML = '';

    appState.guides.forEach((guide, index) => {
        const item = document.createElement('div');
        item.className = 'guide-item';

        const info = document.createElement('span');
        info.className = 'guide-item-info';
        info.innerHTML = `<span class="guide-item-type">${guide.type === 'h' ? '─' : '│'}</span> ${Math.round(guide.position)} px`;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'guide-item-delete';
        deleteBtn.textContent = '\u00d7';
        deleteBtn.onclick = () => removeGuide(index);

        item.appendChild(info);
        item.appendChild(deleteBtn);
        list.appendChild(item);
    });

    // ガイドセクションの表示切り替え
    const guideSection = $('guideSectionPanel');
    const guideCountEl = $('guideCount');
    if (guideSection) {
        guideSection.style.display = appState.guides.length > 0 ? 'block' : 'none';
    }
    if (guideCountEl) {
        guideCountEl.textContent = appState.guides.length;
    }

    // ガイドボタンの表示切り替え（4本以上で表示、ただし機能解除時は非表示）
    const hasEnoughGuides = appState.guides.length >= 4;
    const unlocked = isFeatureUnlocked();

    // サイドパネルの「ガイドから範囲を設定」ボタン（機能解除時は非表示）
    const panelApplyBtn = $('btnPanelApplyGuides');
    if (panelApplyBtn) {
        panelApplyBtn.style.display = (hasEnoughGuides && !unlocked) ? 'flex' : 'none';
    }

    // ガイドリスト内の「適用」ボタン（機能解除時は非表示）
    const applyBtn = $('btnApplyGuides');
    if (applyBtn) {
        applyBtn.style.display = (hasEnoughGuides && !unlocked) ? 'block' : 'none';
    }

    // フローティング削除ボタンの表示を更新（選択範囲とガイドの両方を考慮）
    const floatingClearBtn = $('btnFloatingClearAll');
    if (floatingClearBtn) {
        const hasSelection = hasValidCropSelection();
        floatingClearBtn.style.display = (hasSelection || appState.guides.length > 0) ? 'flex' : 'none';
    }
}

// ── ガイド追加/削除 ───────────────────────────────

/**
 * ガイドを追加
 */
export function addGuide(type, position) {
    saveToHistory();  // Undo用に現在の状態を保存
    appState.guides.push({ type, position });
    renderGuides();
    updateGuideList();
    // UI改修: ヒントとガイドボタンを更新
    if (typeof window.updateCropModeHint === 'function') window.updateCropModeHint();
    if (typeof window.updateGuideButtonHighlight === 'function') window.updateGuideButtonHighlight();
}

/**
 * ガイドを削除
 */
export function removeGuide(index) {
    saveToHistory();  // Undo用に現在の状態を保存
    appState.guides.splice(index, 1);
    renderGuides();
    updateGuideList();
    // UI改修: ヒントとガイドボタンを更新
    if (typeof window.updateCropModeHint === 'function') window.updateCropModeHint();
    if (typeof window.updateGuideButtonHighlight === 'function') window.updateGuideButtonHighlight();
}

// ── ガイドからクロップ ────────────────────────────

/**
 * ガイドからクロップ範囲を自動設定
 */
export function applyGuidesToCrop() {
    saveToHistory();  // Undo用に現在の状態を保存

    const hGuides = appState.guides.filter(g => g.type === 'h').map(g => g.position).sort((a, b) => a - b);
    const vGuides = appState.guides.filter(g => g.type === 'v').map(g => g.position).sort((a, b) => a - b);

    if (vGuides.length >= 2) {
        $('cropLeftFull').value = Math.round(vGuides[0]);
        $('cropRightFull').value = Math.round(vGuides[vGuides.length - 1]);
    }
    if (hGuides.length >= 2) {
        $('cropTopFull').value = Math.round(hGuides[0]);
        $('cropBottomFull').value = Math.round(hGuides[hGuides.length - 1]);
    }

    // プレビューを更新
    if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();

    // UI改修: ヒントと適用ボタンの状態を更新
    if (typeof window.updateCropModeHint === 'function') window.updateCropModeHint();
    if (typeof window.updateApplyButtonState === 'function') window.updateApplyButtonState();
    if (typeof window.updateSelectionVisual === 'function') window.updateSelectionVisual();
}
