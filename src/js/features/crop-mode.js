/**
 * crop-mode.js - クロップモード（画像選択モード）
 * フルスクリーンプレビュー、ドラッグ選択、ズーム/パン、
 * 塗り・ストロークプレビュー、ステップインジケーター等
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { COLOR_MAP, JSON_REGISTER_ASPECT_RATIO } from '../features/constants.js';
import { saveToHistory, clearHistory, onRestore, undo, redo } from '../features/undo-redo.js';
import { renderGuides, updateGuideList, drawRulers, setupRulerDragEvents, applyGuidesToCrop, selectGuide, deselectGuide, moveSelectedGuide, toggleGuideLock } from '../features/guides.js';
import { isFeatureUnlocked, updateJsonRegisterButtonVisibility, updateCropInputsDisabledState } from '../features/feature-unlock.js';
import { updateCropPageNav, loadPreviewImageByIndex, updateCropModeImage } from '../features/preview.js';

// ── ヘルパー（モジュールローカル） ───────────────────

/**
 * ステータスバーにテキストを設定（window.setStatus経由）
 */
function setStatus(text) {
    if (typeof window.setStatus === 'function') window.setStatus(text);
}

/**
 * object-fit: contain で表示されている画像の実際の表示サイズとオフセットを計算
 * @returns {{ displayWidth: number, displayHeight: number, offsetX: number, offsetY: number }}
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
 * 有効な範囲選択があるか確認
 */
function hasValidCropSelection() {
    const left = parseInt($('cropLeftFull')?.value) || 0;
    const top = parseInt($('cropTopFull')?.value) || 0;
    const right = parseInt($('cropRightFull')?.value) || 0;
    const bottom = parseInt($('cropBottomFull')?.value) || 0;

    // いずれかの値が0より大きければ有効とみなす
    return left > 0 || top > 0 || right > 0 || bottom > 0;
}

// ── Undo/Redo コールバック登録 ───────────────────────

onRestore(() => {
    updateSelectionVisual();
    updateFillStrokePreview();
    renderGuides();
    updateGuideList();
    updateApplyButtonState();
});

// ── メインAPI ───────────────────────────────────────

/**
 * 画像選択モードを開く
 */
export function openCropMode(imageData) {
    const overlay = $('cropModeOverlay');
    const previewImg = $('cropPreviewImgFull');
    const container = $('cropPreviewContainerFull');
    const selection = $('cropSelectionFull');

    // 現在の値を保存（キャンセル時に戻す）
    appState.savedCropValues = {
        left: parseInt($('cropLeft').value) || 0,
        top: parseInt($('cropTop').value) || 0,
        right: parseInt($('cropRight').value) || 0,
        bottom: parseInt($('cropBottom').value) || 0
    };

    // 画像サイズを設定
    appState.previewImageSize.width = imageData.width;
    appState.previewImageSize.height = imageData.height;

    // 画像読み込みエラー時のハンドラ
    previewImg.onerror = (e) => {
        console.error('画像の読み込みに失敗:', e, imageData.base64);
        setStatus('画像の読み込みに失敗しました');
        $('btnLoadPreview').disabled = false;
    };

    // 画像を設定
    previewImg.src = imageData.base64;

    // 画像読み込み完了を待つ
    previewImg.onload = () => {
        // ドキュメントサイズ表示
        $('cropModeDocSize').textContent = `画像サイズ: ${appState.previewImageSize.width} × ${appState.previewImageSize.height} px`;
        $('docSizeInfo').textContent = `(${appState.previewImageSize.width} × ${appState.previewImageSize.height})`;

        // 現在の値をオーバーレイ側に反映
        $('cropLeftFull').value = appState.savedCropValues.left;
        $('cropTopFull').value = appState.savedCropValues.top;
        $('cropRightFull').value = appState.savedCropValues.right;
        $('cropBottomFull').value = appState.savedCropValues.bottom;

        // 色設定を同期
        syncColorSettingsToOverlay();

        // 選択範囲をリセット
        selection.style.display = 'none';

        // 塗り・ストロークプレビューをリセット
        clearFillStrokePreview();

        // ガイドをリセット
        appState.guides = [];
        appState.guideMode = null;
        appState.rulerDragging = null;
        appState.guidesLocked = false;
        renderGuides();
        updateGuideList();

        // PSDファイルの場合、埋め込みガイドを読み込む
        if (imageData.filePath && imageData.filePath.toLowerCase().endsWith('.psd') && appState.invoke) {
            appState.invoke('get_psd_guides', { filePath: imageData.filePath })
                .then(guides => {
                    if (guides && guides.length > 0) {
                        guides.forEach(g => {
                            appState.guides.push({
                                type: g.guide_type,
                                position: Math.round(g.position)
                            });
                        });
                        renderGuides();
                        updateGuideList();
                        if (typeof window.updateCropModeHint === 'function') window.updateCropModeHint();
                        if (typeof window.updateGuideButtonHighlight === 'function') window.updateGuideButtonHighlight();
                        setStatus(`PSDから ${guides.length} 本のガイドを読み込みました`);
                    }
                })
                .catch(err => {
                    console.warn('PSDガイド読み込みエラー:', err);
                });
        }

        // Undo/Redo履歴をクリア
        clearHistory();

        // ズームとパン状態をリセット
        appState.currentZoom = 1.0;
        appState.baseContainerSize = { width: 0, height: 0 };  // 基準サイズもリセット
        appState.lastMousePos = { x: 0, y: 0 };
        appState.isSpacePressed = false;
        appState.isPanning = false;
        const zoomWrapper = $('zoomWrapper');
        if (zoomWrapper) {
            zoomWrapper.classList.remove('zoomed');
            zoomWrapper.style.width = '100%';
            zoomWrapper.style.height = '100%';
            zoomWrapper.style.minWidth = '';
            zoomWrapper.style.minHeight = '';
        }
        container.style.overflow = 'hidden';

        // 定規を描画
        drawRulers();

        // ドラッグイベントを設定
        setupCropDragEventsFull(container);

        // オーバーレイを表示
        overlay.style.display = 'flex';
        appState.cropModeOpen = true;

        // JSON新規登録ボタンの表示状態を更新（アンロック状態に応じて）
        updateJsonRegisterButtonVisibility();

        // 数値入力欄の有効/無効を更新（アンロック時は比率固定のため無効化）
        updateCropInputsDisabledState();

        // ページナビゲーションを更新
        updateCropPageNav();

        // UI改修: ステップインジケーター初期化
        appState.cropModeStep = 'select';
        updateCropModeStep('select');

        // UI改修: ヒントを初期化
        updateCropModeHint();

        // UI改修: 適用ボタンの状態を更新
        updateApplyButtonState();

        // UI改修: ガイドボタンのハイライトを更新
        updateGuideButtonHighlight();

        // UI改修: 初回表示時は定規にパルスアニメーション
        if (appState.isFirstCropModeOpen) {
            const rulerH = $('rulerHorizontal');
            const rulerV = $('rulerVertical');
            if (rulerH && rulerV) {
                rulerH.classList.add('pulse');
                rulerV.classList.add('pulse');
                setTimeout(() => {
                    rulerH.classList.remove('pulse');
                    rulerV.classList.remove('pulse');
                }, 1000);
            }
            appState.isFirstCropModeOpen = false;
        }

        // JSON読み込み済みの場合、ラベル選択を表示
        updateCropModeLabelSelect();

        setStatus('ドラッグで範囲を選択してください');
    };
}

/**
 * 画像選択モードを閉じる
 */
export function closeCropMode(apply) {
    const overlay = $('cropModeOverlay');

    if (apply) {
        // ステップを「適用」に進める
        updateCropModeStep('apply');

        // チェックマークアニメーションを表示
        showApplySuccessAnimation(() => {
            // アニメーション完了後に実際の処理を実行
            finalizeCropMode(overlay, true);
        });
    } else {
        // キャンセル: 保存した値に戻す
        $('cropLeft').value = appState.savedCropValues.left;
        $('cropTop').value = appState.savedCropValues.top;
        $('cropRight').value = appState.savedCropValues.right;
        $('cropBottom').value = appState.savedCropValues.bottom;

        setStatus('範囲選択をキャンセルしました');

        // 範囲選択ステータスを更新
        if (typeof window.updateCropRangeStatus === 'function') window.updateCropRangeStatus();

        // プレビューをクリア
        clearFillStrokePreview();

        overlay.style.display = 'none';
        appState.cropModeOpen = false;

        // ガイド選択状態をリセット
        appState.selectedGuideIndex = null;
        appState.guideDragging = null;

        // UI改修: ステップをリセット
        appState.cropModeStep = 'select';
    }
}

/**
 * 適用成功アニメーションを表示
 */
export function showApplySuccessAnimation(callback) {
    const container = $('cropPreviewContainerFull');
    if (!container) {
        callback();
        return;
    }

    // 既存のアニメーションを削除
    const existing = container.querySelector('.apply-success-overlay');
    if (existing) existing.remove();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'apply-success-overlay';
    overlay.innerHTML = `
        <div class="apply-success-icon">
            <div class="apply-success-burst"></div>
            <svg viewBox="0 0 48 48" fill="none">
                <circle class="apply-success-ring" cx="24" cy="24" r="22"/>
                <path class="apply-success-check-path" d="M14 24l7 7 13-13"/>
            </svg>
        </div>
    `;

    container.appendChild(overlay);

    // アニメーション完了後にコールバック
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.remove();
            callback();
        }, 200);
    }, 600);
}

/**
 * クロップモードの終了処理
 */
export function finalizeCropMode(overlay, apply) {
    if (apply) {
        // オーバーレイの値をメインの入力欄にコピー
        $('cropLeft').value = $('cropLeftFull').value;
        $('cropTop').value = $('cropTopFull').value;
        $('cropRight').value = $('cropRightFull').value;
        $('cropBottom').value = $('cropBottomFull').value;

        // 色設定も同期
        $('strokeColor').value = $('strokeColorFull').value;
        $('strokeColorPreview').style.background = COLOR_MAP[$('strokeColorFull').value];
        $('fillColor').value = $('fillColorFull').value;
        $('fillColorPreview').style.background = COLOR_MAP[$('fillColorFull').value];
        $('fillOpacity').value = $('fillOpacityFull').value;
        $('fillOpacityValue').textContent = $('fillOpacityFull').value + '%';

        setStatus('範囲を適用しました');
    }

    // 範囲選択ステータスを更新
    if (typeof window.updateCropRangeStatus === 'function') window.updateCropRangeStatus();

    // プレビューをクリア
    clearFillStrokePreview();

    overlay.style.display = 'none';
    appState.cropModeOpen = false;

    // UI改修: ステップをリセット
    appState.cropModeStep = 'select';
}

// ── ステップインジケーター ────────────────────────────

/**
 * ステップインジケーターを更新
 * @param {string} step - 'select' | 'confirm' | 'apply'
 */
export function updateCropModeStep(step) {
    appState.cropModeStep = step;
    const steps = ['select', 'confirm', 'apply'];
    const currentIndex = steps.indexOf(step);

    steps.forEach((s, index) => {
        const stepEl = document.querySelector(`.crop-step[data-step="${s}"]`);
        const lineEl = stepEl?.nextElementSibling;

        if (stepEl) {
            stepEl.classList.remove('active', 'completed');

            if (index < currentIndex) {
                stepEl.classList.add('completed');
            } else if (index === currentIndex) {
                stepEl.classList.add('active');
            }
        }

        // ライン要素の更新
        if (lineEl && lineEl.classList.contains('crop-step-line')) {
            lineEl.classList.remove('completed');
            if (index < currentIndex) {
                lineEl.classList.add('completed');
            }
        }
    });
}

// ── ヒント ─────────────────────────────────────────

/**
 * クロップモードのヒントを状態に応じて更新
 */
export function updateCropModeHint() {
    const hint = $('cropModeHint');
    if (!hint) return;

    const hasSelection = hasValidCropSelection();
    const guideCount = appState.guides.length;

    let message = '';
    let highlight = false;

    if (hasSelection) {
        message = '\u2713 範囲OK！「適用」を押して完了';
        highlight = true;
        // 範囲が設定されたらステップを「確認」に進める
        if (appState.cropModeStep === 'select') {
            updateCropModeStep('confirm');
        }
    } else if (guideCount === 0) {
        message = '下のボタンで操作方法を確認できます';
    } else if (guideCount < 4) {
        const remaining = 4 - guideCount;
        message = `あと${remaining}本ガイドを引いてください（計4本必要）`;
    } else if (guideCount >= 4) {
        if (isFeatureUnlocked()) {
            // 機能解除時はドラッグで範囲を決定（ロック状態で案内を切替）
            if (appState.guidesLocked) {
                message = '\u2713 ガイドロック中 \u2014 ドラッグで範囲を選択してください';
            } else {
                message = 'L キーでガイドをロックすると、ドラッグで範囲を引けます';
            }
        } else {
            message = '\u2713「ガイドから範囲を設定」をクリック';
        }
        highlight = true;
    }

    hint.textContent = message;
    hint.classList.toggle('highlight', highlight);
}

/**
 * ヒントを一時的に変更（アニメーション用）
 */
export function showTemporaryHint(message, duration = 2000) {
    const hint = $('cropModeHint');
    if (!hint) return;

    hint.textContent = message;
    hint.classList.remove('highlight');

    // 指定時間後に通常のヒントに戻す
    setTimeout(() => {
        updateCropModeHint();
    }, duration);
}

// ── 適用ボタン・ガイドボタン ────────────────────────

/**
 * 適用ボタンの状態を更新
 */
export function updateApplyButtonState() {
    const btn = $('btnApplyCrop');
    if (!btn) return;

    const hasSelection = hasValidCropSelection();

    if (hasSelection) {
        btn.classList.remove('disabled');
        btn.classList.add('ready');
        btn.title = '範囲を適用してメインに戻る';
    } else {
        btn.classList.add('disabled');
        btn.classList.remove('ready');
        btn.title = '範囲を選択してください';
    }
}

/**
 * ガイドボタンのハイライトを更新
 */
export function updateGuideButtonHighlight() {
    const btn = $('btnApplyGuides');
    if (!btn) return;

    const guideCount = appState.guides.length;

    // 既存のバッジを削除
    const existingBadge = btn.querySelector('.guide-count-badge');
    if (existingBadge) {
        existingBadge.remove();
    }

    if (guideCount >= 4) {
        btn.classList.add('highlight');
        // バッジを追加
        const badge = document.createElement('span');
        badge.className = 'guide-count-badge';
        badge.textContent = guideCount;
        btn.appendChild(badge);
    } else {
        btn.classList.remove('highlight');
        // 4本未満でもバッジは表示（進捗確認用）
        if (guideCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'guide-count-badge';
            badge.textContent = guideCount;
            btn.appendChild(badge);
        }
    }
}

// ── ヒントアニメーション ──────────────────────────────

/**
 * ドラッグヒントアニメーションを表示
 * 左上から右下に選択範囲を引くアニメーション
 */
export function showDragHintAnimation() {
    const container = $('cropPreviewContainerFull');
    if (!container) return;

    // 既存のヒントを削除
    const existing = container.querySelector('.drag-hint-overlay');
    if (existing) existing.remove();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'drag-hint-overlay';

    // カーソルアイコン
    const cursor = document.createElement('div');
    cursor.className = 'drag-hint-cursor';
    cursor.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 3l14 9-6 2-4 6-4-17z" fill="#fff" stroke="#1a8cff" stroke-width="1.5"/>
        </svg>
    `;
    cursor.style.cssText = 'left: 15%; top: 15%;';

    // ドラッグボックス（最初は0サイズ）
    const box = document.createElement('div');
    box.className = 'drag-hint-box';
    box.style.cssText = 'left: 15%; top: 15%; width: 0; height: 0; opacity: 0;';

    overlay.appendChild(box);
    overlay.appendChild(cursor);
    container.appendChild(overlay);

    // アニメーション開始
    const duration = 1500;
    const startTime = performance.now();
    const startX = 15, startY = 15;
    const endX = 70, endY = 65;

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // イージング（ease-out）
        const eased = 1 - Math.pow(1 - progress, 3);

        const currentX = startX + (endX - startX) * eased;
        const currentY = startY + (endY - startY) * eased;

        // カーソル位置更新
        cursor.style.left = currentX + '%';
        cursor.style.top = currentY + '%';

        // ボックスサイズ更新
        box.style.width = (currentX - startX) + '%';
        box.style.height = (currentY - startY) + '%';
        box.style.opacity = Math.min(progress * 2, 1);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // フェードアウト
            setTimeout(() => {
                overlay.style.transition = 'opacity 0.3s ease';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
            }, 200);
        }
    }

    requestAnimationFrame(animate);
}

/**
 * 定規ハイライトアニメーションを表示
 * 定規が光り、4本のガイド線が引かれるアニメーション
 */
export function showRulerHighlightAnimation() {
    const rulerH = $('rulerHorizontal');
    const rulerV = $('rulerVertical');
    const container = $('cropPreviewContainerFull');
    if (!rulerH || !rulerV || !container) return;

    // 既存のアニメーションを削除
    rulerH.classList.remove('highlight-anim');
    rulerV.classList.remove('highlight-anim');
    const existingOverlay = container.querySelector('.guide-hint-overlay');
    if (existingOverlay) existingOverlay.remove();

    // 次のフレームでアニメーションを追加（リフロー強制の代わり）
    requestAnimationFrame(() => {
        rulerH.classList.add('highlight-anim');
        rulerV.classList.add('highlight-anim');
    });

    // ガイド線オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'guide-hint-overlay';

    // 4本のガイド線を作成（水平2本、垂直2本）
    const guidePositions = [
        { type: 'horizontal', position: 20 },  // 上
        { type: 'horizontal', position: 80 },  // 下
        { type: 'vertical', position: 15 },    // 左
        { type: 'vertical', position: 85 },    // 右
    ];

    guidePositions.forEach((guide, index) => {
        const line = document.createElement('div');
        line.className = `guide-hint-line ${guide.type}`;

        if (guide.type === 'horizontal') {
            line.style.top = guide.position + '%';
            line.style.transform = 'scaleX(0)';
            line.style.transformOrigin = 'left';
        } else {
            line.style.left = guide.position + '%';
            line.style.transform = 'scaleY(0)';
            line.style.transformOrigin = 'top';
        }
        line.style.opacity = '0';

        overlay.appendChild(line);
    });

    container.appendChild(overlay);

    // ガイド線を順番に引くアニメーション
    const lines = overlay.querySelectorAll('.guide-hint-line');
    lines.forEach((line, index) => {
        const delay = 200 + index * 150;
        const isHorizontal = line.classList.contains('horizontal');

        setTimeout(() => {
            line.style.transition = 'transform 0.4s ease-out, opacity 0.2s ease';
            line.style.opacity = '1';
            line.style.transform = isHorizontal ? 'scaleX(1)' : 'scaleY(1)';
        }, delay);
    });

    // アニメーション終了後にクリーンアップ
    setTimeout(() => {
        // フェードアウト
        overlay.style.transition = 'opacity 0.4s ease';
        overlay.style.opacity = '0';

        setTimeout(() => {
            overlay.remove();
            rulerH.classList.remove('highlight-anim');
            rulerV.classList.remove('highlight-anim');
        }, 400);
    }, 1800);
}

// ── ラベル選択 ───────────────────────────────────────

/**
 * クロップモード内のラベル選択を更新
 */
export function updateCropModeLabelSelect() {
    console.log('updateCropModeLabelSelect called, selectionRanges:', appState.selectionRanges.length);
    const selectArea = $('cropModeLabelSelect');
    const select = $('labelSelectInCrop');
    if (!selectArea || !select) {
        console.log('updateCropModeLabelSelect: elements not found');
        return;
    }

    if (appState.selectionRanges.length > 0) {
        // ラベル選択を表示・更新
        select.innerHTML = '';
        appState.selectionRanges.forEach((range, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = range.label || `範囲 ${index + 1}`;
            select.appendChild(option);
        });
        selectArea.style.display = 'block';
        console.log('updateCropModeLabelSelect: select displayed');

        // 最初の範囲を自動適用
        if (appState.selectionRanges[0]) {
            applySelectionRangeInCropMode(appState.selectionRanges[0]);
        }
    } else {
        selectArea.style.display = 'none';
        console.log('updateCropModeLabelSelect: no ranges, hidden');
    }
}

/**
 * クロップモード内で範囲選択を適用（ビジュアル表示付き）
 */
export function applySelectionRangeInCropMode(range) {
    console.log('applySelectionRangeInCropMode called:', range);
    appState.selectedRange = range;

    if (range.bounds) {
        // オーバーレイ側の入力欄に値を設定
        $('cropLeftFull').value = Math.round(range.bounds.left);
        $('cropTopFull').value = Math.round(range.bounds.top);
        $('cropRightFull').value = Math.round(range.bounds.right);
        $('cropBottomFull').value = Math.round(range.bounds.bottom);

        console.log('applySelectionRangeInCropMode: values set', {
            left: $('cropLeftFull').value,
            top: $('cropTopFull').value,
            right: $('cropRightFull').value,
            bottom: $('cropBottomFull').value
        });

        // 選択範囲をビジュアルで表示
        updateSelectionVisual();

        // 塗り・ストロークプレビューを更新
        updateFillStrokePreview();

        // UI更新
        updateCropModeHint();
        updateApplyButtonState();
    } else {
        console.log('applySelectionRangeInCropMode: no bounds in range');
    }

    // ドキュメントサイズ情報を表示
    if (range.documentSize) {
        $('cropModeDocSize').textContent = `基準: ${range.documentSize.width} × ${range.documentSize.height} px`;
    }
}

// ── 選択範囲ビジュアル ────────────────────────────────

/**
 * 選択範囲をビジュアルで表示
 */
export function updateSelectionVisual() {
    const img = $('cropPreviewImgFull');
    const selection = $('cropSelectionFull');
    if (!img || !selection) {
        console.log('updateSelectionVisual: img or selection not found');
        return;
    }

    // 画像が読み込まれていない場合はスキップ
    if (!appState.previewImageSize.width || !appState.previewImageSize.height) {
        console.log('updateSelectionVisual: previewImageSize not set', appState.previewImageSize);
        return;
    }

    const bounds = getActualImageBounds(img);
    if (!bounds || !bounds.displayWidth || !bounds.displayHeight) {
        console.log('updateSelectionVisual: bounds invalid', bounds);
        return;
    }

    // 画像座標から表示座標へのスケール
    const scaleX = bounds.displayWidth / appState.previewImageSize.width;
    const scaleY = bounds.displayHeight / appState.previewImageSize.height;

    const left = parseInt($('cropLeftFull').value) || 0;
    const top = parseInt($('cropTopFull').value) || 0;
    const right = parseInt($('cropRightFull').value) || 0;
    const bottom = parseInt($('cropBottomFull').value) || 0;

    console.log('updateSelectionVisual: values', { left, top, right, bottom, scaleX, scaleY, bounds });

    // 選択範囲があるかどうか
    const hasSelection = !(left === 0 && top === 0 && right === 0 && bottom === 0);

    // フローティング削除ボタンの表示/非表示（選択範囲またはガイドがあれば表示）
    const floatingClearBtn = $('btnFloatingClearAll');
    if (floatingClearBtn) {
        floatingClearBtn.style.display = (hasSelection || appState.guides.length > 0) ? 'flex' : 'none';
    }

    // 値が全て0の場合は非表示
    if (!hasSelection) {
        selection.style.display = 'none';
        return;
    }

    // 表示座標に変換
    const displayLeft = left * scaleX + bounds.offsetX;
    const displayTop = top * scaleY + bounds.offsetY;
    const displayRight = right * scaleX + bounds.offsetX;
    const displayBottom = bottom * scaleY + bounds.offsetY;

    // 選択範囲を表示
    selection.style.left = displayLeft + 'px';
    selection.style.top = displayTop + 'px';
    selection.style.width = (displayRight - displayLeft) + 'px';
    selection.style.height = (displayBottom - displayTop) + 'px';
    selection.style.display = 'block';

    console.log('updateSelectionVisual: displayed', { displayLeft, displayTop, displayRight, displayBottom });
}

// ── ズーム ────────────────────────────────────────────

/**
 * プレビューをズーム（倍率を乗算）- マウス位置を中心にズーム
 * @param {number} factor - 乗算する倍率（1.25で拡大、0.8で縮小）
 */
export function zoomPreview(factor) {
    const container = $('cropPreviewContainerFull');
    const zoomWrapper = $('zoomWrapper');
    if (!container || !zoomWrapper) return;

    const oldZoom = appState.currentZoom;

    // 新しいズーム倍率を計算（0.5〜8倍の範囲で制限）
    const newZoom = Math.max(0.5, Math.min(8, appState.currentZoom * factor));
    if (newZoom === appState.currentZoom) return;

    // マウス位置をコンテンツ座標に変換（スクロール込み）
    const mouseContentX = container.scrollLeft + appState.lastMousePos.x;
    const mouseContentY = container.scrollTop + appState.lastMousePos.y;

    appState.currentZoom = newZoom;
    applyZoom();

    // マウス位置を中心にスクロール位置を調整
    const ratio = appState.currentZoom / oldZoom;
    const newScrollX = mouseContentX * ratio - appState.lastMousePos.x;
    const newScrollY = mouseContentY * ratio - appState.lastMousePos.y;
    container.scrollLeft = Math.max(0, newScrollX);
    container.scrollTop = Math.max(0, newScrollY);
}

/**
 * ズームをリセット（フィット表示に戻す）
 */
export function resetZoom() {
    appState.currentZoom = 1.0;
    applyZoom();

    // スクロールを原点に戻す
    const container = $('cropPreviewContainerFull');
    if (container) {
        container.scrollLeft = 0;
        container.scrollTop = 0;
    }
}

/**
 * 現在のズーム倍率を適用
 */
export function applyZoom() {
    const container = $('cropPreviewContainerFull');
    const zoomWrapper = $('zoomWrapper');
    const img = $('cropPreviewImgFull');
    if (!container || !zoomWrapper || !img) return;

    // 基準サイズが未設定なら現在のコンテナサイズを保存
    if (appState.baseContainerSize.width === 0) {
        appState.baseContainerSize.width = container.clientWidth;
        appState.baseContainerSize.height = container.clientHeight;
    }

    if (appState.currentZoom > 1) {
        // 画像のアスペクト比を維持しながらズーム
        const imageAspect = appState.previewImageSize.width / appState.previewImageSize.height;
        const containerAspect = appState.baseContainerSize.width / appState.baseContainerSize.height;

        let baseDisplayWidth, baseDisplayHeight;
        if (imageAspect > containerAspect) {
            // 横長画像: 幅に合わせる
            baseDisplayWidth = appState.baseContainerSize.width;
            baseDisplayHeight = appState.baseContainerSize.width / imageAspect;
        } else {
            // 縦長画像: 高さに合わせる
            baseDisplayHeight = appState.baseContainerSize.height;
            baseDisplayWidth = appState.baseContainerSize.height * imageAspect;
        }

        // ズーム適用後のサイズ
        const zoomedWidth = baseDisplayWidth * appState.currentZoom;
        const zoomedHeight = baseDisplayHeight * appState.currentZoom;

        zoomWrapper.classList.add('zoomed');
        zoomWrapper.style.width = `${zoomedWidth}px`;
        zoomWrapper.style.height = `${zoomedHeight}px`;
        zoomWrapper.style.minWidth = `${zoomedWidth}px`;
        zoomWrapper.style.minHeight = `${zoomedHeight}px`;
        container.style.overflow = 'auto';
    } else {
        // フィット表示
        zoomWrapper.classList.remove('zoomed');
        zoomWrapper.style.width = '100%';
        zoomWrapper.style.height = '100%';
        zoomWrapper.style.minWidth = '';
        zoomWrapper.style.minHeight = '';
        container.style.overflow = 'hidden';
    }

    // ガイドを再描画
    renderGuides();

    // 選択範囲を再描画
    updateSelectionDisplay();

    // 塗り/ストロークプレビューを再描画
    updateFillStrokePreview();

    // 定規も再描画
    drawRulers();

    // ズーム表示を更新
    const zoomPercent = Math.round(appState.currentZoom * 100);
    setStatus(`ズーム: ${zoomPercent}%（Ctrl+0でリセット）`);
}

// ── 選択範囲表示 ──────────────────────────────────────

/**
 * 入力欄の値から選択範囲の表示を更新
 */
export function updateSelectionDisplay() {
    const selection = $('cropSelectionFull');
    const img = $('cropPreviewImgFull');
    if (!selection || !img) return;

    const cropLeft = parseInt($('cropLeftFull').value) || 0;
    const cropTop = parseInt($('cropTopFull').value) || 0;
    const cropRight = parseInt($('cropRightFull').value) || 0;
    const cropBottom = parseInt($('cropBottomFull').value) || 0;

    // 値がすべて0なら非表示
    if (cropLeft === 0 && cropTop === 0 && cropRight === 0 && cropBottom === 0) {
        selection.style.display = 'none';
        return;
    }

    const bounds = getActualImageBounds(img);

    // 画像座標から表示座標へのスケール
    const scaleX = bounds.displayWidth / appState.previewImageSize.width;
    const scaleY = bounds.displayHeight / appState.previewImageSize.height;

    // 画像座標からプレビュー座標に変換（オフセットを加算）
    const displayLeft = cropLeft * scaleX + bounds.offsetX;
    const displayTop = cropTop * scaleY + bounds.offsetY;
    const displayRight = cropRight * scaleX + bounds.offsetX;
    const displayBottom = cropBottom * scaleY + bounds.offsetY;
    const displayWidth = displayRight - displayLeft;
    const displayHeight = displayBottom - displayTop;

    if (displayWidth > 0 && displayHeight > 0) {
        selection.style.left = displayLeft + 'px';
        selection.style.top = displayTop + 'px';
        selection.style.width = displayWidth + 'px';
        selection.style.height = displayHeight + 'px';
        selection.style.display = 'block';
    } else {
        selection.style.display = 'none';
    }
}

// ── 色設定の同期 ──────────────────────────────────────

/**
 * 色設定をオーバーレイに同期
 */
export function syncColorSettingsToOverlay() {
    // 色設定エリアは非表示（メイン画面で設定）
    $('cropModeColorSettings').style.display = 'none';

    // 値をコピー（プレビュー描画用）
    $('strokeColorFull').value = $('strokeColor').value;
    $('strokeColorPreviewFull').style.background = COLOR_MAP[$('strokeColor').value];
    $('fillColorFull').value = $('fillColor').value;
    $('fillColorPreviewFull').style.background = COLOR_MAP[$('fillColor').value];
    $('fillOpacityFull').value = $('fillOpacity').value;
    $('fillOpacityValueFull').textContent = $('fillOpacity').value + '%';
}

// ── ドラッグイベント ──────────────────────────────────

/**
 * フルスクリーン用の範囲選択ドラッグイベント
 */
export function setupCropDragEventsFull(container) {
    const selection = $('cropSelectionFull');
    const img = $('cropPreviewImgFull');

    container.onmousedown = (e) => {
        if (e.button !== 0) return;

        // コンテナクリック時にガイド選択を解除（ガイド線自体のクリックはstopPropagationされる）
        if (appState.selectedGuideIndex !== null) {
            deselectGuide();
        }

        // スペースキーが押されている場合はパン操作
        if (appState.isSpacePressed && appState.currentZoom > 1) {
            appState.isPanning = true;
            appState.panStart.x = e.clientX;
            appState.panStart.y = e.clientY;
            appState.panStart.scrollX = container.scrollLeft;
            appState.panStart.scrollY = container.scrollTop;
            container.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        const rect = img.getBoundingClientRect();
        const bounds = getActualImageBounds(img);

        // クリック位置を画像の実際の表示領域内の座標に変換
        let clickX = e.clientX - rect.left - bounds.offsetX;
        let clickY = e.clientY - rect.top - bounds.offsetY;

        // 画像範囲外ならクランプ
        clickX = Math.max(0, Math.min(clickX, bounds.displayWidth));
        clickY = Math.max(0, Math.min(clickY, bounds.displayHeight));

        // ガイドスナップ（8表示px以内で吸着）
        if (appState.guides.length > 0) {
            const snapPx = 8;
            const scaleX = bounds.displayWidth / appState.previewImageSize.width;
            const scaleY = bounds.displayHeight / appState.previewImageSize.height;
            for (const g of appState.guides) {
                if (g.type === 'v') {
                    const gx = g.position * scaleX;
                    if (Math.abs(clickX - gx) < snapPx) clickX = gx;
                } else {
                    const gy = g.position * scaleY;
                    if (Math.abs(clickY - gy) < snapPx) clickY = gy;
                }
            }
        }

        // Undo用に現在の状態を保存（ドラッグ開始時）
        saveToHistory();

        // ドラッグ開始時に塗りプレビューをクリア（背景画像を見えるように）
        clearFillStrokePreview();

        // 通常の範囲選択開始（オフセットを加味した位置で保存）
        appState.dragStart.x = clickX + bounds.offsetX;
        appState.dragStart.y = clickY + bounds.offsetY;
        appState.isDragging = true;

        selection.style.display = 'block';
        selection.style.left = appState.dragStart.x + 'px';
        selection.style.top = appState.dragStart.y + 'px';
        selection.style.width = '0px';
        selection.style.height = '0px';

        e.preventDefault();
    };

    container.onmousemove = (e) => {
        // マウス位置を常に追跡（ズーム用）
        const containerRect = container.getBoundingClientRect();
        appState.lastMousePos.x = e.clientX - containerRect.left;
        appState.lastMousePos.y = e.clientY - containerRect.top;

        // パン操作中
        if (appState.isPanning) {
            e.preventDefault();
            const dx = e.clientX - appState.panStart.x;
            const dy = e.clientY - appState.panStart.y;
            container.scrollLeft = appState.panStart.scrollX - dx;
            container.scrollTop = appState.panStart.scrollY - dy;
            return;
        }

        if (!appState.isDragging) return;

        const rect = img.getBoundingClientRect();
        const bounds = getActualImageBounds(img);

        // 現在位置を画像の実際の表示領域内の座標に変換
        let currentX = e.clientX - rect.left - bounds.offsetX;
        let currentY = e.clientY - rect.top - bounds.offsetY;

        // 画像範囲内にクランプ
        currentX = Math.max(0, Math.min(currentX, bounds.displayWidth));
        currentY = Math.max(0, Math.min(currentY, bounds.displayHeight));

        // ガイドスナップ（8表示px以内で吸着）
        if (appState.guides.length > 0) {
            const snapPx = 8;
            const scaleX = bounds.displayWidth / appState.previewImageSize.width;
            const scaleY = bounds.displayHeight / appState.previewImageSize.height;
            for (const g of appState.guides) {
                if (g.type === 'v') {
                    const gx = g.position * scaleX;
                    if (Math.abs(currentX - gx) < snapPx) currentX = gx;
                } else {
                    const gy = g.position * scaleY;
                    if (Math.abs(currentY - gy) < snapPx) currentY = gy;
                }
            }
        }

        // オフセットを加味した表示座標
        let displayCurrentX = currentX + bounds.offsetX;
        let displayCurrentY = currentY + bounds.offsetY;

        let width = Math.abs(displayCurrentX - appState.dragStart.x);
        let height = Math.abs(displayCurrentY - appState.dragStart.y);

        // 機能解除時は640:909の比率を維持（ポインター=右下角に完全固定）
        if (isFeatureUnlocked()) {
            // マウス位置を比率の対角線上に投影して、ポインターが常に右下角になるようにする
            const dx = displayCurrentX - appState.dragStart.x;
            const dy = displayCurrentY - appState.dragStart.y;

            // 右下方向のみ有効（左上方向は無視）
            if (dx > 0 && dy > 0) {
                // 比率640:909の対角線ベクトル
                const aspectW = 640;
                const aspectH = 909;
                const aspectLen = Math.sqrt(aspectW * aspectW + aspectH * aspectH);

                // マウスベクトルを対角線に投影
                const dot = (dx * aspectW + dy * aspectH) / aspectLen;
                const projectedLen = Math.max(0, dot);

                // 投影された長さから幅と高さを計算
                width = (projectedLen * aspectW) / aspectLen;
                height = (projectedLen * aspectH) / aspectLen;

                // 画像範囲内にクランプ
                const maxX = bounds.offsetX + bounds.displayWidth;
                const maxY = bounds.offsetY + bounds.displayHeight;
                const maxWidth = maxX - appState.dragStart.x;
                const maxHeight = maxY - appState.dragStart.y;

                // 幅と高さを制限（比率を維持しながら）
                if (width > maxWidth) {
                    width = maxWidth;
                    height = width / JSON_REGISTER_ASPECT_RATIO;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                    width = height * JSON_REGISTER_ASPECT_RATIO;
                }

                displayCurrentX = appState.dragStart.x + width;
                displayCurrentY = appState.dragStart.y + height;
                currentX = appState.dragStart.x - bounds.offsetX + width;
                currentY = appState.dragStart.y - bounds.offsetY + height;
            } else {
                // 左上方向は枠なし
                width = 0;
                height = 0;
            }

            // 開始点=左上、現在点=右下
            selection.style.left = appState.dragStart.x + 'px';
            selection.style.top = appState.dragStart.y + 'px';
            selection.style.width = width + 'px';
            selection.style.height = height + 'px';

            // 画像座標系で計算
            const imgLeft = appState.dragStart.x - bounds.offsetX;
            const imgTop = appState.dragStart.y - bounds.offsetY;
            const imgRight = imgLeft + width;
            const imgBottom = imgTop + height;

            updateCropInputsFromSelectionFull(imgLeft, imgTop, imgRight, imgBottom, img, bounds);
            return;
        }

        const left = Math.min(appState.dragStart.x, displayCurrentX);
        const top = Math.min(appState.dragStart.y, displayCurrentY);

        selection.style.left = left + 'px';
        selection.style.top = top + 'px';
        selection.style.width = width + 'px';
        selection.style.height = height + 'px';

        // リアルタイムで座標を更新（オーバーレイ側の入力欄）
        // 画像座標系（オフセット除去後）で計算
        const imgLeft = Math.min(appState.dragStart.x - bounds.offsetX, currentX);
        const imgTop = Math.min(appState.dragStart.y - bounds.offsetY, currentY);
        const imgRight = Math.max(appState.dragStart.x - bounds.offsetX, currentX);
        const imgBottom = Math.max(appState.dragStart.y - bounds.offsetY, currentY);

        updateCropInputsFromSelectionFull(imgLeft, imgTop, imgRight, imgBottom, img, bounds);
    };

    container.onmouseup = (e) => {
        // パン操作終了
        if (appState.isPanning) {
            e.preventDefault();
            appState.isPanning = false;
            container.style.cursor = appState.isSpacePressed ? 'grab' : 'crosshair';
            return;
        }

        if (appState.isDragging) {
            appState.isDragging = false;
            // 選択完了後にビジュアルとプレビューを更新
            updateSelectionVisual();
            updateFillStrokePreview();
        }
    };

    container.onmouseleave = () => {
        // パン操作終了
        if (appState.isPanning) {
            appState.isPanning = false;
            container.style.cursor = appState.isSpacePressed ? 'grab' : 'crosshair';
        }

        if (appState.isDragging) {
            appState.isDragging = false;
            // マウスがコンテナ外に出た場合も塗りプレビューを更新
            updateFillStrokePreview();
        }
    };
}

/**
 * 選択範囲からクロップ入力欄を更新（オーバーレイ用）
 * ドラッグ中は塗りプレビューを更新しない（背景画像が見えるように）
 * @param left, top, right, bottom - 画像の表示座標系での位置（オフセット除去済み）
 * @param img - 画像要素
 * @param bounds - getActualImageBounds()の結果
 */
export function updateCropInputsFromSelectionFull(left, top, right, bottom, img, bounds) {
    // 表示座標から実際の画像座標に変換
    // bounds.displayWidth/Height は実際に表示されている画像の大きさ
    const scaleX = appState.previewImageSize.width / bounds.displayWidth;
    const scaleY = appState.previewImageSize.height / bounds.displayHeight;

    const realLeft = Math.max(0, Math.round(left * scaleX));
    const realTop = Math.max(0, Math.round(top * scaleY));
    const realRight = Math.min(appState.previewImageSize.width, Math.round(right * scaleX));
    const realBottom = Math.min(appState.previewImageSize.height, Math.round(bottom * scaleY));

    $('cropLeftFull').value = realLeft;
    $('cropTopFull').value = realTop;
    $('cropRightFull').value = realRight;
    $('cropBottomFull').value = realBottom;

    // ドラッグ中は塗り/ストロークプレビューを更新しない
    // マウスを離した後にupdateFillStrokePreview()が呼ばれる

    // UI改修: ヒントと適用ボタンの状態を更新
    updateCropModeHint();
    updateApplyButtonState();
}

// ── 塗り・ストロークプレビュー ─────────────────────────

/**
 * 塗り・ストロークのリアルタイムプレビューを更新
 */
export function updateFillStrokePreview() {
    const img = $('cropPreviewImgFull');
    const container = $('cropPreviewContainerFull');
    if (!img || !container) return;

    const tachikiriType = $('tachikiriSelect').value;
    const needsStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);
    const needsFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);

    // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
    const bounds = getActualImageBounds(img);

    // 画像座標から表示座標へのスケール
    const scaleX = bounds.displayWidth / appState.previewImageSize.width;
    const scaleY = bounds.displayHeight / appState.previewImageSize.height;

    const cropLeft = parseInt($('cropLeftFull').value) || 0;
    const cropTop = parseInt($('cropTopFull').value) || 0;
    const cropRight = parseInt($('cropRightFull').value) || 0;
    const cropBottom = parseInt($('cropBottomFull').value) || 0;

    // 画像座標からプレビュー座標に変換（オフセットを加算）
    const previewLeft = cropLeft * scaleX + bounds.offsetX;
    const previewTop = cropTop * scaleY + bounds.offsetY;
    const previewRight = cropRight * scaleX + bounds.offsetX;
    const previewBottom = cropBottom * scaleY + bounds.offsetY;
    const previewWidth = previewRight - previewLeft;
    const previewHeight = previewBottom - previewTop;

    // 塗りプレビュー
    const fillPreview = $('fillPreview');
    if (needsFill && previewWidth > 0 && previewHeight > 0) {
        const fillColor = $('fillColorFull').value;
        const fillOpacity = parseInt($('fillOpacityFull').value) / 100;

        let r, g, b;
        if (fillColor === 'white') { r = 255; g = 255; b = 255; }
        else if (fillColor === 'black') { r = 0; g = 0; b = 0; }
        else if (fillColor === 'cyan') { r = 0; g = 255; b = 255; }
        else { r = 255; g = 255; b = 255; }

        fillPreview.style.left = previewLeft + 'px';
        fillPreview.style.top = previewTop + 'px';
        fillPreview.style.width = previewWidth + 'px';
        fillPreview.style.height = previewHeight + 'px';
        fillPreview.style.boxShadow = `0 0 0 9999px rgba(${r}, ${g}, ${b}, ${fillOpacity})`;
        fillPreview.style.display = 'block';
    } else {
        fillPreview.style.display = 'none';
    }

    // ストロークプレビュー
    const strokeTop = $('strokePreviewTop');
    const strokeBottom = $('strokePreviewBottom');
    const strokeLeft = $('strokePreviewLeft');
    const strokeRight = $('strokePreviewRight');

    if (needsStroke && previewWidth > 0 && previewHeight > 0) {
        const strokeColor = $('strokeColorFull').value;
        let bgColor;
        if (strokeColor === 'black') bgColor = '#000000';
        else if (strokeColor === 'white') bgColor = '#ffffff';
        else if (strokeColor === 'cyan') bgColor = '#00ffff';
        else bgColor = '#000000';

        // 上辺
        strokeTop.style.left = previewLeft + 'px';
        strokeTop.style.top = previewTop + 'px';
        strokeTop.style.width = previewWidth + 'px';
        strokeTop.style.background = bgColor;
        strokeTop.style.display = 'block';

        // 下辺
        strokeBottom.style.left = previewLeft + 'px';
        strokeBottom.style.top = (previewBottom - 2) + 'px';
        strokeBottom.style.width = previewWidth + 'px';
        strokeBottom.style.background = bgColor;
        strokeBottom.style.display = 'block';

        // 左辺
        strokeLeft.style.left = previewLeft + 'px';
        strokeLeft.style.top = previewTop + 'px';
        strokeLeft.style.height = previewHeight + 'px';
        strokeLeft.style.background = bgColor;
        strokeLeft.style.display = 'block';

        // 右辺
        strokeRight.style.left = (previewRight - 2) + 'px';
        strokeRight.style.top = previewTop + 'px';
        strokeRight.style.height = previewHeight + 'px';
        strokeRight.style.background = bgColor;
        strokeRight.style.display = 'block';
    } else {
        strokeTop.style.display = 'none';
        strokeBottom.style.display = 'none';
        strokeLeft.style.display = 'none';
        strokeRight.style.display = 'none';
    }
}

/**
 * プレビューをクリア
 */
export function clearFillStrokePreview() {
    $('fillPreview').style.display = 'none';
    $('strokePreviewTop').style.display = 'none';
    $('strokePreviewBottom').style.display = 'none';
    $('strokePreviewLeft').style.display = 'none';
    $('strokePreviewRight').style.display = 'none';
}

// ── イベントセットアップ ──────────────────────────────

/**
 * クロップモード関連のイベントリスナーを設定
 */
export function setupCropModeEvents() {
    // 適用/キャンセルボタン
    $('btnApplyCrop').onclick = () => closeCropMode(true);
    $('btnCancelCrop').onclick = () => closeCropMode(false);

    // オーバーレイ側の色選択変更（プレビューも更新）
    $('strokeColorFull').onchange = () => {
        $('strokeColorPreviewFull').style.background = COLOR_MAP[$('strokeColorFull').value];
        updateFillStrokePreview();
    };
    $('fillColorFull').onchange = () => {
        $('fillColorPreviewFull').style.background = COLOR_MAP[$('fillColorFull').value];
        updateFillStrokePreview();
    };
    $('fillOpacityFull').oninput = () => {
        $('fillOpacityValueFull').textContent = $('fillOpacityFull').value + '%';
        updateFillStrokePreview();
    };

    // 座標入力欄の変更時もプレビュー更新
    ['cropLeftFull', 'cropTopFull', 'cropRightFull', 'cropBottomFull'].forEach(id => {
        $(id).oninput = () => {
            updateSelectionVisual();
            updateFillStrokePreview();
            updateApplyButtonState();
        };
    });

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
        // ESCキー: ガイド選択中は選択解除、それ以外はクロップモードを閉じる
        if (e.key === 'Escape' && appState.cropModeOpen) {
            if (appState.selectedGuideIndex !== null) {
                deselectGuide();
            } else {
                closeCropMode(false);
            }
        }

        // 画像選択モード中のUndo/Redo
        if (appState.cropModeOpen) {
            // Ctrl+Z: Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            // Ctrl+Y または Ctrl+Shift+Z: Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
                e.preventDefault();
                redo();
            }

            // ズーム操作（Photoshop風）
            // Ctrl + (+/=): 拡大
            if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === ';')) {
                e.preventDefault();
                zoomPreview(1.25);
            }
            // Ctrl + (-): 縮小
            if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                zoomPreview(0.8);
            }
            // Ctrl + 0: 元のサイズ（フィット）
            if (e.ctrlKey && e.key === '0') {
                e.preventDefault();
                resetZoom();
            }

            // L キー: ガイドロックトグル（機能解除モード + ガイド4本以上）
            if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.altKey) {
                const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
                if (!inputFocused && appState.guides.length >= 4 && isFeatureUnlocked()) {
                    e.preventDefault();
                    toggleGuideLock();
                    showTemporaryHint(
                        appState.guidesLocked
                            ? 'ガイドをロックしました \u2014 ドラッグで選択範囲を引けます'
                            : 'ガイドのロックを解除しました',
                        2000
                    );
                }
            }

            // スペースキー: パンモード（押し続けている間もpreventDefault）
            if (e.key === ' ') {
                e.preventDefault();
                if (!appState.isSpacePressed) {
                    appState.isSpacePressed = true;
                    const container = $('cropPreviewContainerFull');
                    if (container && appState.currentZoom > 1) {
                        container.style.cursor = 'grab';
                    }
                }
            }

            // 矢印キー: ガイド選択中はガイド移動、それ以外は選択範囲移動
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                // ガイドが選択されている場合 → ガイドを移動
                if (appState.selectedGuideIndex !== null && appState.selectedGuideIndex < appState.guides.length) {
                    e.preventDefault();
                    // Shift: 10px、通常: 1px
                    const step = e.shiftKey ? 10 : 1;
                    let dx = 0, dy = 0;

                    switch (e.key) {
                        case 'ArrowUp':    dy = -step; break;
                        case 'ArrowDown':  dy = step; break;
                        case 'ArrowLeft':  dx = -step; break;
                        case 'ArrowRight': dx = step; break;
                    }

                    // 初回の矢印キー押下時にUndo履歴を保存（連続移動時は保存しない）
                    if (!appState._guideArrowKeyActive) {
                        saveToHistory();
                        appState._guideArrowKeyActive = true;
                    }

                    moveSelectedGuide(dx, dy);
                    return;
                }

                // ガイド未選択 → 選択範囲を移動
                const left = parseInt($('cropLeftFull').value) || 0;
                const top = parseInt($('cropTopFull').value) || 0;
                const right = parseInt($('cropRightFull').value) || 0;
                const bottom = parseInt($('cropBottomFull').value) || 0;

                // 選択範囲が存在する場合のみ
                if (left !== 0 || top !== 0 || right !== 0 || bottom !== 0) {
                    e.preventDefault();

                    const step = e.shiftKey ? 1 : 10;
                    let dx = 0, dy = 0;

                    switch (e.key) {
                        case 'ArrowUp':    dy = -step; break;
                        case 'ArrowDown':  dy = step; break;
                        case 'ArrowLeft':  dx = -step; break;
                        case 'ArrowRight': dx = step; break;
                    }

                    // 新しい座標を計算
                    let newLeft = left + dx;
                    let newTop = top + dy;
                    let newRight = right + dx;
                    let newBottom = bottom + dy;

                    // 画像範囲内にクランプ
                    if (newLeft < 0) {
                        const shift = -newLeft;
                        newLeft = 0;
                        newRight += shift;
                    }
                    if (newTop < 0) {
                        const shift = -newTop;
                        newTop = 0;
                        newBottom += shift;
                    }
                    if (newRight > appState.previewImageSize.width) {
                        const shift = newRight - appState.previewImageSize.width;
                        newRight = appState.previewImageSize.width;
                        newLeft -= shift;
                    }
                    if (newBottom > appState.previewImageSize.height) {
                        const shift = newBottom - appState.previewImageSize.height;
                        newBottom = appState.previewImageSize.height;
                        newTop -= shift;
                    }

                    // 最終クランプ（負の値にならないように）
                    newLeft = Math.max(0, newLeft);
                    newTop = Math.max(0, newTop);

                    // 値を更新
                    $('cropLeftFull').value = Math.round(newLeft);
                    $('cropTopFull').value = Math.round(newTop);
                    $('cropRightFull').value = Math.round(newRight);
                    $('cropBottomFull').value = Math.round(newBottom);

                    // ビジュアルを更新
                    updateSelectionVisual();
                    updateFillStrokePreview();
                    updateApplyButtonState();
                }
            }

            // Deleteキー: 選択中のガイドを削除
            if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedGuideIndex !== null) {
                // 入力欄にフォーカスがある場合は無視
                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
                e.preventDefault();
                const idx = appState.selectedGuideIndex;
                if (idx >= 0 && idx < appState.guides.length) {
                    if (typeof window.removeGuide === 'function') window.removeGuide(idx);
                }
            }
        }
    });

    // keyupイベント
    document.addEventListener('keyup', (e) => {
        if (appState.cropModeOpen) {
            // スペースキー: パンモード終了
            if (e.key === ' ') {
                e.preventDefault();
                appState.isSpacePressed = false;
                appState.isPanning = false;
                const container = $('cropPreviewContainerFull');
                if (container) {
                    container.style.cursor = 'crosshair';
                }
            }

            // 矢印キーを離したらガイド移動のUndo連続抑制フラグをリセット
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                appState._guideArrowKeyActive = false;
            }
        }
    });

    // ガイドロックボタン
    $('btnLockGuides').onclick = () => {
        if (appState.guides.length >= 4 && isFeatureUnlocked()) {
            toggleGuideLock();
            showTemporaryHint(
                appState.guidesLocked
                    ? 'ガイドをロックしました \u2014 ドラッグで選択範囲を引けます'
                    : 'ガイドのロックを解除しました',
                2000
            );
        }
    };

    // ガイド機能
    $('btnClearGuides').onclick = () => {
        if (appState.guides.length > 0) {
            saveToHistory();  // Undo用に現在の状態を保存
        }
        appState.guides = [];
        appState.selectedGuideIndex = null;
        appState.guidesLocked = false;
        renderGuides();
        updateGuideList();
        // UI改修: ヒントとガイドボタンを更新
        updateCropModeHint();
        updateGuideButtonHighlight();
    };
    $('btnApplyGuides').onclick = () => {
        applyGuidesToCrop();
    };

    // サイドパネルの「ガイドから範囲を設定」ボタン
    $('btnPanelApplyGuides').onclick = () => {
        applyGuidesToCrop();
    };

    // フローティング削除ボタン - すべてクリア（プレビュー右下）
    $('btnFloatingClearAll').onclick = () => {
        saveToHistory();
        // 選択範囲をクリア
        $('cropLeftFull').value = 0;
        $('cropTopFull').value = 0;
        $('cropRightFull').value = 0;
        $('cropBottomFull').value = 0;
        // ガイドをクリア
        appState.guides = [];
        appState.selectedGuideIndex = null;
        appState.guidesLocked = false;
        renderGuides();
        updateGuideList();
        updateSelectionVisual();
        updateFillStrokePreview();
        updateApplyButtonState();
        updateCropModeHint();
        updateGuideButtonHighlight();
    };

    // クロップモード内のJSON読み込み
    $('btnLoadJsonInCrop').onclick = () => {
        if (appState.jsonSelectModal) {
            appState.jsonSelectModal.show();
        }
        // JSON読み込み後はparseJsonData内でupdateCropModeLabelSelectが呼ばれる
    };

    // クロップモード内のラベル選択変更
    $('labelSelectInCrop').onchange = () => {
        const index = parseInt($('labelSelectInCrop').value);
        if (appState.selectionRanges[index]) {
            applySelectionRangeInCropMode(appState.selectionRanges[index]);
        }
    };

    // ドラッグボタン - ヒントアニメーション表示
    $('btnMethodDrag').onclick = () => {
        showDragHintAnimation();
        showTemporaryHint('画像上をドラッグして範囲を選択してください', 2000);
    };

    // ガイドボタン - 定規ハイライトアニメーション
    $('btnMethodGuide').onclick = () => {
        showRulerHighlightAnimation();
        showTemporaryHint('定規からドラッグしてガイドを4本引いてください', 2500);
    };

    // 範囲リセットボタン
    $('btnResetRange').onclick = () => {
        $('cropLeftFull').value = 0;
        $('cropTopFull').value = 0;
        $('cropRightFull').value = 0;
        $('cropBottomFull').value = 0;
        updateSelectionVisual();
        updateFillStrokePreview();
        updateApplyButtonState();
    };

    // 定規からのドラッグ
    setupRulerDragEvents();
}

// ── window公開（クロスモジュールアクセス） ─────────────

// guides.jsからcrop-mode関数にアクセスするため
window._updateGuideList = updateGuideList;
window.updateCropModeHint = updateCropModeHint;
window.updateGuideButtonHighlight = updateGuideButtonHighlight;
window.updateFillStrokePreview = updateFillStrokePreview;
window.updateApplyButtonState = updateApplyButtonState;
window.updateSelectionVisual = updateSelectionVisual;
window.updateCropModeLabelSelect = updateCropModeLabelSelect;
