/**
 * preview.js - プレビュー管理
 * 見開きPDF・単ページPDF・JPEG のプレビュー表示、
 * クロップ範囲ステータス、画像プレビュー読み込み、ページナビゲーション
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { COLOR_MAP } from './constants.js';
import { getWorkInfoPreviewText } from './json-parsing.js';
import { setStatus } from './file-handling.js';
import { showAlert } from '../ui/alerts.js';

// ============================================================
// プレビュー更新
// ============================================================

/**
 * 単ページPDFプレビューを更新
 */
export function updateSinglePreview() {
    const showNombre = $('singleAddNombre')?.checked ?? true;
    const startNum = parseInt($('singleNombreStart')?.value) || 1;
    const tachikiriType = $('tachikiriSelect')?.value || 'none';
    const fillColorName = $('fillColor')?.value || 'white';
    const fillColor = COLOR_MAP[fillColorName] || '#FFFFFF';
    const strokeColorName = $('strokeColor')?.value || 'black';
    const strokeColor = COLOR_MAP[strokeColorName] || '#000000';

    // タチキリ処理の種類判定
    const hasFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);
    const hasStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);

    // ページ番号
    const pageNum = $('singlePageNum');
    if (pageNum) {
        pageNum.classList.toggle('hidden', !showNombre);
        pageNum.textContent = startNum;
    }

    // タチキリ塗りエリア
    const boxEl = $('singlePreviewBox');
    const fillEl = $('singlePreviewFill');
    const pageEl = $('singlePreviewPage');

    // ボックスの背景（塗りがある時のみ表示）
    if (boxEl) {
        boxEl.style.background = hasFill ? 'var(--bg2)' : 'transparent';
        boxEl.style.padding = hasFill ? '8px' : '0';
    }

    if (fillEl && pageEl) {
        if (hasFill) {
            // 塗りあり: 塗り色を表示
            fillEl.style.background = fillColor;
            fillEl.style.border = 'none';
            fillEl.style.padding = '4px';
        } else {
            // 塗りなし: fill要素は透明に
            fillEl.style.background = 'transparent';
            fillEl.style.border = 'none';
            fillEl.style.padding = '0';
        }
        // ページに線を追加（線付きの場合）- 内側に表示
        pageEl.style.boxShadow = hasStroke ? `inset 0 0 0 2px ${strokeColor}` : 'none';
    }
}

/**
 * 見開きPDFプレビューを更新
 */
export function updateSpreadPreview() {
    const gutterEnabled = $('spreadGutterEnabled')?.checked ?? true;
    const paddingEnabled = $('spreadPaddingEnabled')?.checked ?? true;
    const gutter = gutterEnabled ? (parseInt($('spreadGutterSlider')?.value) || 0) : 0;
    const padding = paddingEnabled ? (parseInt($('spreadPaddingSlider')?.value) || 0) : 0;
    const showWhitePage = $('spreadWhitePage')?.checked || false;
    const showWorkInfo = $('spreadWorkInfo')?.checked || false;
    const showNombre = $('spreadAddNombre')?.checked ?? true;
    const tachikiriType = $('tachikiriSelect')?.value || 'none';
    // 色名をHEXに変換
    const fillColorName = $('fillColor')?.value || 'white';
    const fillColor = COLOR_MAP[fillColorName] || '#FFFFFF';

    // タチキリ処理の種類判定
    const hasFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);
    const hasStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);
    const isCropOnly = tachikiriType === 'crop';  // 切り抜きのみ

    // スケーリング計算
    const maxGutter = 150;
    const maxPadding = 300;
    const gutterScale = gutter / maxGutter;
    const paddingScale = padding / maxPadding;

    // プレビュー用のピクセル値（実際の設定に近い見た目に）
    // 余白（外側の白い部分）: 0〜22px（実際の0〜300pxに対応）
    const previewMargin = padding === 0 ? 0 : Math.round(4 + paddingScale * 18);
    // 塗りエリア: 塗り＋線がある場合は8px、塗りのみは6px、線のみ・その他は0
    const previewFillPadding = (hasFill && hasStroke) ? 8 : hasFill ? 6 : 0;
    // ノド: 実際の比率に近い表現（0〜24px）
    const previewGutter = gutter === 0 ? 0 : Math.round(4 + gutterScale * 20);

    // 余白エリアの更新（外側の白い部分）
    const marginEl = $('spreadPreviewMargin');
    const boxEl = $('spreadPreviewBox');
    if (marginEl) {
        marginEl.style.padding = previewMargin + 'px';
        // 余白0のときは斜線背景を非表示
        marginEl.style.background = padding === 0 ? 'transparent' : '';
    }
    if (boxEl) {
        // 余白0のときは黒い台紙・枠線・影も非表示
        boxEl.style.background = padding === 0 ? 'transparent' : '';
        boxEl.style.border = padding === 0 ? 'none' : '';
        boxEl.style.boxShadow = padding === 0 ? 'none' : '';
    }

    // 塗りエリアの更新
    const fillEl = $('spreadPreviewFill');
    const strokeColorName = $('strokeColor')?.value || 'black';
    const strokeColor = COLOR_MAP[strokeColorName] || '#000000';
    if (fillEl) {
        fillEl.style.padding = previewFillPadding + 'px';
        fillEl.style.border = 'none';  // borderは各ページ要素で設定
        if (hasFill) {
            // 塗りがある場合は指定色
            fillEl.style.background = fillColor;
        } else if (hasStroke || isCropOnly) {
            // 切り抜きのみの場合は透明（ページが直接表示）
            fillEl.style.background = 'transparent';
        } else {
            // タチキリなしの場合も透明
            fillEl.style.background = 'transparent';
        }
    }

    // ノド幅の更新（0のときは非表示）
    const gutterEl = $('spreadPreviewGutter');
    if (gutterEl) {
        gutterEl.style.width = previewGutter + 'px';
        gutterEl.style.display = gutter === 0 ? 'none' : 'block';
        gutterEl.style.background = 'transparent';
    }

    // ページサイズの計算（縦長の漫画ページ用）
    const boxWidth = 180;
    const boxHeight = 140;
    const totalPadding = previewMargin + previewFillPadding;
    const contentWidth = boxWidth - totalPadding * 2;
    const contentHeight = boxHeight - totalPadding * 2;

    // 白紙オーバーレイの表示/非表示（右ページ上に表示）
    const whitePageOverlay = $('spreadWhitePageOverlay');
    if (whitePageOverlay) {
        whitePageOverlay.classList.toggle('visible', showWhitePage);
    }

    // 作品情報の表示/非表示
    const workInfoEl = $('spreadPreviewWorkInfo');
    if (workInfoEl) {
        workInfoEl.classList.toggle('visible', showWorkInfo && showWhitePage);
        if (showWorkInfo) {
            // JSONから作品情報を取得して表示
            const workInfoText = getWorkInfoPreviewText();
            workInfoEl.innerHTML = workInfoText;
        }
    }

    // 「白紙」テキストの表示/非表示（作品情報印字がONなら非表示）
    const whitePageTextEl = $('spreadWhitePageText');
    if (whitePageTextEl) {
        whitePageTextEl.style.display = showWorkInfo ? 'none' : 'block';
    }

    // ページ番号の表示/非表示（ノンブル設定に連動）
    const pageLeftNum = $('spreadPageLeftNum');
    const pageRightNum = $('spreadPageRightNum');
    const startNum = parseInt($('spreadNombreStart')?.value) || 1;

    if (pageLeftNum) {
        pageLeftNum.classList.toggle('hidden', !showNombre);
        // 白紙追加時は左ページが開始番号、通常は開始番号+1
        pageLeftNum.textContent = showWhitePage ? startNum : startNum + 1;
    }
    if (pageRightNum) {
        pageRightNum.classList.toggle('hidden', !showNombre || showWhitePage);
        // 通常時は右ページが開始番号
        pageRightNum.textContent = showWhitePage ? '' : startNum;
    }

    // ページサイズの調整
    const pageLeft = $('spreadPreviewPageLeft');
    const pageRight = $('spreadPreviewPageRight');
    const pageWidth = Math.max(20, (contentWidth - previewGutter) / 2);

    // 線の種類判定
    const isStrokeOnly = tachikiriType === 'stroke_only';
    const isCropAndStroke = tachikiriType === 'crop_and_stroke';

    if (pageLeft) {
        pageLeft.style.width = pageWidth + 'px';
        pageLeft.style.height = Math.max(40, contentHeight) + 'px';
        // 線の設定（各ページに個別に表示）
        if (isStrokeOnly) {
            // 線のみ: 内側に点線（断ち切り範囲を示す）
            pageLeft.style.border = 'none';
            pageLeft.style.outline = `2px dashed ${strokeColor}`;
            pageLeft.style.outlineOffset = '-6px';
        } else if (isCropAndStroke) {
            // 切+線: 外枠に点線（切り抜いた画像の境界）
            pageLeft.style.border = `2px dashed ${strokeColor}`;
            pageLeft.style.outline = 'none';
        } else if (hasStroke && hasFill) {
            // 塗り+線: 外枠に実線
            pageLeft.style.border = `2px solid ${strokeColor}`;
            pageLeft.style.outline = 'none';
        } else {
            pageLeft.style.border = 'none';
            pageLeft.style.outline = 'none';
        }
    }
    if (pageRight) {
        pageRight.style.width = pageWidth + 'px';
        pageRight.style.height = Math.max(40, contentHeight) + 'px';
        // 線の設定（各ページに個別に表示）
        if (isStrokeOnly) {
            // 線のみ: 内側に点線（断ち切り範囲を示す）
            pageRight.style.border = 'none';
            pageRight.style.outline = `2px dashed ${strokeColor}`;
            pageRight.style.outlineOffset = '-6px';
        } else if (isCropAndStroke) {
            // 切+線: 外枠に点線（切り抜いた画像の境界）
            pageRight.style.border = `2px dashed ${strokeColor}`;
            pageRight.style.outline = 'none';
        } else if (hasStroke && hasFill) {
            // 塗り+線: 外枠に実線
            pageRight.style.border = `2px solid ${strokeColor}`;
            pageRight.style.outline = 'none';
        } else {
            pageRight.style.border = 'none';
            pageRight.style.outline = 'none';
        }
    }
}

/**
 * クロップ範囲のステータスを更新
 */
export function updateCropRangeStatus() {
    const statusEl = $('cropRangeStatus');
    if (!statusEl) return;

    const left = parseInt($('cropLeft')?.value) || 0;
    const top = parseInt($('cropTop')?.value) || 0;
    const right = parseInt($('cropRight')?.value) || 0;
    const bottom = parseInt($('cropBottom')?.value) || 0;

    // すべて0なら未設定
    const isSet = (left > 0 || top > 0 || right > 0 || bottom > 0);

    if (isSet) {
        statusEl.className = 'crop-range-status success';
        statusEl.textContent = '\u2713 設定済';
    } else {
        statusEl.className = 'crop-range-status warning';
        statusEl.textContent = '\u26A0 未設定';
    }
}

/**
 * JPEGプレビューを更新
 */
export function updateJpegPreview() {
    const nombreEl = $('jpegPreviewNombre');
    const boxEl = $('jpegPreviewBox');
    const fillEl = $('jpegPreviewFill');
    const pageEl = $('jpegPreviewPage');

    // タチキリ設定
    const tachikiriType = $('tachikiriSelect')?.value || 'none';
    const fillColorName = $('fillColor')?.value || 'white';
    const fillColor = COLOR_MAP[fillColorName] || '#FFFFFF';
    const strokeColorName = $('strokeColor')?.value || 'black';
    const strokeColor = COLOR_MAP[strokeColorName] || '#000000';

    // タチキリ処理の種類判定
    const hasFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);
    const hasStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);

    // ボックスの背景（塗りがある時のみ表示）
    if (boxEl) {
        boxEl.style.background = hasFill ? 'var(--bg2)' : 'transparent';
        boxEl.style.padding = hasFill ? '8px' : '0';
    }

    // タチキリ塗りエリア
    if (fillEl && pageEl) {
        if (hasFill) {
            // 塗りあり: 塗り色を表示
            fillEl.style.background = fillColor;
            fillEl.style.border = 'none';
            fillEl.style.padding = '4px';
        } else {
            // 塗りなし: fill要素は透明に
            fillEl.style.background = 'transparent';
            fillEl.style.border = 'none';
            fillEl.style.padding = '0';
        }
        // ページに線を追加（線付きの場合）- 内側に表示
        pageEl.style.boxShadow = hasStroke ? `inset 0 0 0 2px ${strokeColor}` : 'none';
    }

    // ノンブル設定
    if (!nombreEl) return;

    // PDFが選択されている場合はPDFの設定を使用、そうでなければJPEGの設定を使用
    const hasPdf = appState.selectedOutputs.spreadPdf || appState.selectedOutputs.singlePdf;
    let showNombre, startNum;

    if (hasPdf) {
        // PDFの設定を参照
        showNombre = $('spreadAddNombre')?.checked ?? $('singleAddNombre')?.checked ?? true;
        startNum = parseInt($('spreadNombreStart')?.value || $('singleNombreStart')?.value) || 1;
    } else {
        // JPEG独自の設定を参照
        showNombre = $('jpegAddNombre')?.checked ?? true;
        startNum = parseInt($('jpegNombreStart')?.value) || 1;
    }

    // ノンブル表示/非表示
    nombreEl.style.display = showNombre ? 'block' : 'none';
    nombreEl.textContent = startNum;
}

// ============================================================
// 画像プレビュー読み込み・ページナビゲーション
// ============================================================

/**
 * ページインデックスを指定してプレビュー画像を読み込む
 */
export async function loadPreviewImageByIndex(pageIndex, keepOpen = false) {
    if (appState.targetFiles.length === 0) return;
    if (pageIndex < 0 || pageIndex >= appState.targetFiles.length) return;

    const fullPath = appState.inputFolder + '\\' + appState.targetFiles[pageIndex];
    await loadPreviewImage(fullPath, keepOpen);

    // ページ情報を更新
    updateCropPageNav();
}

/**
 * クロップモードのページナビゲーションを更新
 */
export function updateCropPageNav() {
    const pageInfo = $('cropPageInfo');
    const btnPrev = $('btnPrevPage');
    const btnNext = $('btnNextPage');

    if (pageInfo) {
        pageInfo.textContent = `${appState.currentPreviewPageIndex + 1} / ${appState.targetFiles.length}`;
    }
    if (btnPrev) {
        btnPrev.disabled = appState.currentPreviewPageIndex <= 0;
    }
    if (btnNext) {
        btnNext.disabled = appState.currentPreviewPageIndex >= appState.targetFiles.length - 1;
    }
}

/**
 * プレビュー画像を読み込む（画像選択モードを開く）
 * 高速化版：ファイルシステム経由転送 + 非同期処理
 * @param {string} filePath - ファイルパス
 * @param {boolean} keepOpen - trueの場合、既存のモードを維持して画像のみ差し替え
 */
export async function loadPreviewImage(filePath, keepOpen = false) {
    console.log('[loadPreviewImage] 開始 - filePath:', filePath, 'keepOpen:', keepOpen);
    setStatus(`デバッグ: loadPreviewImage開始 invoke=${!!appState.invoke}`);

    // invoke が未初期化の場合はエラー
    if (!appState.invoke) {
        console.error('[loadPreviewImage] invoke関数が未初期化です');
        setStatus('エラー: Tauri APIが初期化されていません');
        return;
    }

    try {
        $('btnLoadPreview').disabled = true;

        // 高速化版：ファイルシステム経由で画像を取得
        // maxSize: 1200でトンボが見える解像度を維持しつつ処理時間を短縮
        console.log('[loadPreviewImage] invoke呼び出し前');
        const previewInfo = await appState.invoke('get_image_preview_as_file', {
            filePath: filePath,
            maxSize: 1200
        });
        console.log('[loadPreviewImage] invoke完了 - previewInfo:', previewInfo);

        $('btnLoadPreview').disabled = false;

        if (!previewInfo) {
            setStatus('画像の読み込みに失敗しました');
            return;
        }

        // asset://プロトコルでファイルを直接表示（Base64不要）
        const assetUrl = appState.convertFileSrc(previewInfo.file_path);
        console.log('[loadPreviewImage] assetUrl:', assetUrl);

        const imageData = {
            width: previewInfo.width,
            height: previewInfo.height,
            base64: assetUrl  // 互換性のためbase64キーを使用（実際はURL）
        };

        if (keepOpen) {
            // 既に開いている場合は画像のみ差し替え
            updateCropModeImage(imageData);
        } else {
            // 画像選択モードを開く
            if (typeof window.openCropMode === 'function') window.openCropMode(imageData);
        }

    } catch (e) {
        console.error('[loadPreviewImage] エラー:', e);
        $('btnLoadPreview').disabled = false;
        setStatus('画像の読み込みエラー: ' + e);
    }
}

/**
 * クロップモードの画像を差し替える（設定は維持）
 */
export function updateCropModeImage(imageData) {
    const previewImg = $('cropPreviewImgFull');

    // 画像サイズを更新
    appState.previewImageSize.width = imageData.width;
    appState.previewImageSize.height = imageData.height;

    // 画像読み込みエラー時のハンドラ
    previewImg.onerror = (e) => {
        console.error('画像の読み込みに失敗:', e, imageData.base64);
        setStatus('画像の読み込みに失敗しました');
    };

    // 画像を設定
    previewImg.src = imageData.base64;

    // 画像読み込み完了を待つ
    previewImg.onload = () => {
        // ドキュメントサイズ表示を更新
        $('cropModeDocSize').textContent = `画像サイズ: ${appState.previewImageSize.width} \u00D7 ${appState.previewImageSize.height} px`;
        $('docSizeInfo').textContent = `(${appState.previewImageSize.width} \u00D7 ${appState.previewImageSize.height})`;

        // 定規を再描画
        if (typeof window.drawRulers === 'function') window.drawRulers();

        // ガイドを再描画（既存のガイドを維持）
        if (typeof window.renderGuides === 'function') window.renderGuides();

        // 選択範囲のプレビューを更新
        if (typeof window.updateFillStrokePreview === 'function') window.updateFillStrokePreview();

        // ページナビゲーションを更新
        updateCropPageNav();

        setStatus(`ページ ${appState.currentPreviewPageIndex + 1} を表示中`);
    };
}

// ============================================================
// イベントセットアップ
// ============================================================

/**
 * プレビュー関連のイベントリスナーをセットアップ
 */
export function setupPreviewEvents() {
    // メイン画面のクロップ入力欄変更時のステータス更新
    ['cropLeft', 'cropTop', 'cropRight', 'cropBottom'].forEach(id => {
        const el = $(id);
        if (el) el.oninput = updateCropRangeStatus;
    });

    // 画像プレビューで範囲選択
    const btnLoadPreview = $('btnLoadPreview');
    console.log('[setupPreviewEvents] btnLoadPreview要素:', btnLoadPreview);
    if (btnLoadPreview) {
        btnLoadPreview.onclick = async () => {
            console.log('[btnLoadPreview] クリック - targetFiles:', appState.targetFiles.length, 'inputFolder:', appState.inputFolder);
            setStatus(`デバッグ: クリック検知 files=${appState.targetFiles.length}`);
            if (appState.targetFiles.length === 0) {
                await showAlert('ファイルを選択してください', 'warning');
                return;
            }
            // 最初のページから開始
            appState.currentPreviewPageIndex = 0;
            try {
                setStatus('デバッグ: loadPreviewImageByIndex開始');
                await loadPreviewImageByIndex(appState.currentPreviewPageIndex);
            } catch (e) {
                console.error('[btnLoadPreview] エラー:', e);
                setStatus('エラー: ' + e.message);
            }
        };
    }

    // クロップモードのページナビゲーション
    const btnPrev = $('btnPrevPage');
    if (btnPrev) {
        btnPrev.onclick = async () => {
            if (appState.currentPreviewPageIndex > 0) {
                appState.currentPreviewPageIndex--;
                await loadPreviewImageByIndex(appState.currentPreviewPageIndex, true);
            }
        };
    }

    const btnNext = $('btnNextPage');
    if (btnNext) {
        btnNext.onclick = async () => {
            if (appState.currentPreviewPageIndex < appState.targetFiles.length - 1) {
                appState.currentPreviewPageIndex++;
                await loadPreviewImageByIndex(appState.currentPreviewPageIndex, true);
            }
        };
    }
}
