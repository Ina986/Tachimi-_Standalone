/**
 * execution.js - 処理実行・進捗管理
 * 画像処理 → PDF生成 → 結果表示
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { processingOverlay } from '../ui/overlay.js';
import { showAlert } from '../ui/alerts.js';
import { formatTime } from '../utils/formatters.js';

/**
 * 設定を収集
 */
export function collectSettings() {
    const tachikiri = $('tachikiriSelect').value;
    const resize = $('resizeSelect').value;

    // クロップ範囲
    let cropBounds = null;
    if (tachikiri !== 'none') {
        const left = parseInt($('cropLeft').value) || 0;
        const top = parseInt($('cropTop').value) || 0;
        const right = parseInt($('cropRight').value) || 0;
        const bottom = parseInt($('cropBottom').value) || 0;

        if (right > left && bottom > top) {
            cropBounds = { left, top, right, bottom };
        }
    }

    // 基準ドキュメントサイズ（選択範囲から、またはプレビュー画像サイズ）
    let referenceDocSize = null;
    if (appState.selectedRange && appState.selectedRange.documentSize) {
        referenceDocSize = appState.selectedRange.documentSize;
    } else if (appState.previewImageSize.width > 0 && appState.previewImageSize.height > 0) {
        referenceDocSize = { width: appState.previewImageSize.width, height: appState.previewImageSize.height };
    }

    // 作品情報（JSONから取得）- JSX形式に合わせた構造
    let workInfo = null;
    if (appState.jsonData) {
        const preset = appState.jsonData.presetData || appState.jsonData;
        const wi = preset.workInfo || {};
        // authorTypeの変換: "single"=0, "pair"=1, それ以外=2
        let authorType = 0;
        if (wi.authorType === 'pair') authorType = 1;
        else if (wi.authorType === 'none') authorType = 2;

        workInfo = {
            label: wi.label || '',
            author_type: authorType,
            author1: wi.artist || wi.author || '',  // 作画 or 著者
            author2: wi.original || '',              // 原作
            title: wi.title || '',
            subtitle: wi.subtitle || '',
            version: wi.volume || ''
        };
    }

    // 出力設定を新UIから取得
    let outputSettings = {
        saveJpeg: false,
        savePdfSingle: false,
        savePdfSpread: false,
        spreadGutter: 70,
        spreadPadding: 150,
        addWhitePage: true,
        printWorkInfo: false
    };

    // 見開きPDFが選択されている場合
    if (appState.selectedOutputs.spreadPdf) {
        outputSettings.savePdfSpread = true;
        const gutterEnabled = $('spreadGutterEnabled')?.checked ?? true;
        const paddingEnabled = $('spreadPaddingEnabled')?.checked ?? true;
        outputSettings.spreadGutter = gutterEnabled ? (parseInt($('spreadGutterSlider')?.value) || 70) : 0;
        outputSettings.spreadPadding = paddingEnabled ? (parseInt($('spreadPaddingSlider')?.value) || 150) : 0;
        outputSettings.addWhitePage = $('spreadWhitePage')?.checked || false;
        outputSettings.printWorkInfo = $('spreadWorkInfo')?.checked || false;
    }

    // 単ページPDFが選択されている場合
    if (appState.selectedOutputs.singlePdf) {
        outputSettings.savePdfSingle = true;
    }

    // JPEGが選択されている場合
    if (appState.selectedOutputs.jpeg) {
        outputSettings.saveJpeg = true;
    }

    // ノンブル設定: PDFが選択されている場合はPDFの設定、そうでなければJPEGの設定を使用
    const hasPdf = appState.selectedOutputs.spreadPdf || appState.selectedOutputs.singlePdf;
    let addNombre, nombreStartNumber, nombreSize;
    let addNombreToImage = true;

    if (hasPdf) {
        addNombre = $('spreadAddNombre')?.checked ?? $('singleAddNombre')?.checked ?? true;
        nombreStartNumber = parseInt($('spreadNombreStart')?.value || $('singleNombreStart')?.value) || 1;
        nombreSize = $('spreadNombreSize')?.value || $('singleNombreSize')?.value || 'medium';

        // PDF出力時に余白がある場合、ノンブルはPDF余白に追加するため画像処理では追加しない
        const hasPdfPadding = (appState.selectedOutputs.spreadPdf && outputSettings.spreadPadding > 0) ||
                              (appState.selectedOutputs.singlePdf && addNombre);
        if (hasPdfPadding && addNombre) {
            addNombreToImage = false;
        }
    } else {
        // JPEG単独の場合
        addNombre = $('jpegAddNombre')?.checked ?? true;
        nombreStartNumber = parseInt($('jpegNombreStart')?.value) || 1;
        nombreSize = $('jpegNombreSize')?.value || 'medium';
    }

    return {
        targetFiles: appState.targetFiles,
        outputFolder: appState.outputFolder,
        tachikiriType: tachikiri,
        cropBounds,
        referenceDocSize,
        strokeColor: $('strokeColor').value,
        fillColor: $('fillColor').value,
        fillOpacity: parseInt($('fillOpacity').value) || 50,
        resizeMode: resize,
        resizePercent: parseInt($('resizePercent').value) || 50,
        addNombre,
        addNombreToImage,
        nombreStartNumber,
        nombreSize,
        saveJpeg: outputSettings.saveJpeg,
        savePdfSingle: outputSettings.savePdfSingle,
        savePdfSpread: outputSettings.savePdfSpread,
        spreadGutter: outputSettings.spreadGutter,
        spreadPadding: outputSettings.spreadPadding,
        addWhitePage: outputSettings.addWhitePage,
        printWorkInfo: outputSettings.printWorkInfo,
        workInfo,
        outputName: $('outputName').value || '出力'
    };
}

/**
 * 進捗を更新
 */
export function updateProgress(data) {
    // シンプルな進捗計算（完了したファイル数のみ）
    const percent = Math.round((data.current / data.total) * 100);
    $('progressBar').style.width = `${percent}%`;
    const fileName = data.filename || data.fileName || '';
    const phase = data.phase || '処理中';
    const inProgress = data.in_progress || 0;
    $('progressText').textContent = `${phase}: ${data.current}/${data.total} ${fileName}`;

    // デバッグ用ログ
    console.log('[Progress]', phase, `${data.current}/${data.total}`, fileName);

    // フェーズ自動判定（先に実行）
    if (phase) {
        if (phase.includes('PDF') || phase.includes('見開き')) {
            processingOverlay.setPhase('pdf');
        } else if (phase.includes('読み込み中') || phase.includes('変換完了') || phase.includes('画像')) {
            processingOverlay.setPhase('process');
        }
    }

    // リッチ進捗オーバーレイを更新（表示用テキストを改善）
    let displayFilename = fileName;
    if (phase) {
        if (phase.includes('ファイル保存中')) {
            displayFilename = 'PDFファイルを保存中...';
        } else if (phase.includes('読み込み中')) {
            const match = phase.match(/\((\d+)\s*処理中\)/);
            const count = match ? match[1] : '';
            displayFilename = count ? `${fileName} (${count}ファイル並列処理中)` : `${fileName} を読み込み中...`;
        } else if (phase.includes('変換完了')) {
            displayFilename = `${fileName} 完了`;
        } else if (phase.includes('画像読み込み中')) {
            displayFilename = `${fileName} を読み込み中...`;
        } else if (phase.includes('ページ追加中')) {
            displayFilename = `${fileName} をPDFに追加中...`;
        } else if (fileName) {
            displayFilename = `${fileName}`;
        }
    }

    processingOverlay.updateDisplay(data.current, data.total, displayFilename, inProgress);
}

/**
 * 処理を実行
 */
export async function execute() {
    if (appState.isProcessing) return;

    // タチキリ処理が有効で範囲選択がされていない場合は警告
    const tachikiriType = $('tachikiriSelect')?.value || 'none';
    if (tachikiriType !== 'none') {
        const left = parseInt($('cropLeft')?.value) || 0;
        const top = parseInt($('cropTop')?.value) || 0;
        const right = parseInt($('cropRight')?.value) || 0;
        const bottom = parseInt($('cropBottom')?.value) || 0;

        if (left === 0 && top === 0 && right === 0 && bottom === 0) {
            await showAlert('タチキリ範囲が未設定です。\n設定画面から範囲を指定してください。', 'warning');
            return;
        }
    }

    appState.isProcessing = true;
    $('btnExecute').disabled = true;
    $('progressArea').style.display = 'block';
    if (typeof window.setStatus === 'function') window.setStatus('処理中...');

    // リッチ進捗オーバーレイを表示
    processingOverlay.show(appState.targetFiles.length);

    try {
        const settings = collectSettings();
        let message = '';
        let processedImages = false;
        let tempFolderUsed = false;
        let actualOutputFolder = appState.outputFolder;
        let jpegOutputFolder = null;  // Rust側が返す実際のJPEG出力パス

        // PDF出力が有効かチェック
        const savePdf = settings.savePdfSingle || settings.savePdfSpread;

        // タチキリ処理が必要かどうか判定
        const needsTachikiri = settings.tachikiriType && settings.tachikiriType !== 'none';

        // ノンブル機能が有効かどうか判定
        const needsNombre = settings.addNombre === true;

        // PDF出力のために画像処理が必要だが、JPEG保存が無効な場合
        const needsTempProcessing = savePdf && (needsTachikiri || needsNombre) && !settings.saveJpeg;

        if (needsTempProcessing) {
            if (typeof window.setStatus === 'function') window.setStatus('PDF用の一時フォルダを準備中...');
            actualOutputFolder = appState.outputFolder + '\\_temp_pdf_source';
            tempFolderUsed = true;
        }

        // 画像処理が必要な場合
        if (settings.saveJpeg || needsTempProcessing) {
            processingOverlay.setPhase('process');
            if (typeof window.setStatus === 'function') window.setStatus('画像処理を開始しています...');

            const processOptions = {
                crop_left: settings.cropBounds?.left || 0,
                crop_top: settings.cropBounds?.top || 0,
                crop_right: settings.cropBounds?.right || 0,
                crop_bottom: settings.cropBounds?.bottom || 0,
                tachikiri_type: settings.tachikiriType || 'none',
                stroke_color: settings.strokeColor || 'black',
                fill_color: settings.fillColor || 'black',
                fill_opacity: settings.fillOpacity || 50,
                reference_width: settings.referenceDocSize?.width || 0,
                reference_height: settings.referenceDocSize?.height || 0,
                add_nombre: settings.addNombreToImage && settings.addNombre,
                nombre_start_number: settings.nombreStartNumber || 1,
                nombre_size: settings.nombreSize || 'medium',
                resize_mode: settings.resizeMode || 'none',
                resize_percent: settings.resizePercent || 50
            };

            const result = await appState.invoke('process_images', {
                inputFolder: appState.inputFolder,
                outputFolder: actualOutputFolder,
                files: appState.targetFiles,
                options: processOptions
            });

            // Rust側が返す実際のJPEG出力パス（連番フォルダ: jpg, jpg(1), jpg(2)...）
            jpegOutputFolder = result.output_folder;

            if (!tempFolderUsed) {
                message += `画像処理完了: ${result.processed}/${result.total} ファイル\n`;
            }

            // キャンセルされた場合は処理を中断
            const wasCancelled = processingOverlay.cancelled ||
                (result.errors.length > 0 && result.errors[0].startsWith('処理がキャンセルされました'));
            if (wasCancelled) {
                if (tempFolderUsed) {
                    try { await appState.invoke('delete_folder', { path: actualOutputFolder }); } catch(e) {}
                }
                const cancelMsg = result.errors[0] || '処理がキャンセルされました';
                $('modalMessage').textContent = cancelMsg;
                $('modal').style.display = 'flex';
                if (typeof window.setStatus === 'function') window.setStatus('キャンセルされました');
                return;
            }

            if (result.errors.length > 0) {
                message += `エラー (${result.errors.length}件):\n`;
                result.errors.slice(0, 5).forEach(e => {
                    message += `・${e}\n`;
                });
                if (result.errors.length > 5) {
                    message += `...他 ${result.errors.length - 5} 件\n`;
                }
            }
            processedImages = true;
        }

        // PDF用のファイルリストとソースフォルダを決定
        let pdfSourceFolder = appState.inputFolder;
        let pdfFiles = appState.targetFiles;

        if (processedImages) {
            if (tempFolderUsed) {
                pdfSourceFolder = actualOutputFolder;
            } else {
                // Rust側が返す実際のJPEG出力パスを使用（連番フォルダ対応: jpg, jpg(1), jpg(2)...）
                pdfSourceFolder = jpegOutputFolder || (actualOutputFolder + '\\jpg');
            }
            pdfFiles = appState.targetFiles.map(f => {
                const baseName = f.replace(/\.[^/.]+$/, '');
                return baseName + '.jpg';
            });
        }

        // 単ページPDF出力
        if (settings.savePdfSingle) {
            processingOverlay.setPhase('pdf');
            if (typeof window.setStatus === 'function') window.setStatus('単ページPDFを生成中...');

            const singleAddNombre = $('singleAddNombre')?.checked ?? false;
            const singleNombreSize = $('singleNombreSize')?.value || 'medium';
            const singlePadding = singleAddNombre ? 50 : 0;

            const singlePdfOptions = {
                preset: 'b4_single',
                width_mm: 257.0,
                height_mm: 364.0,
                gutter: 0,
                padding: singlePadding,
                is_spread: false,
                add_nombre: singleAddNombre,
                nombre_size: singleNombreSize
            };

            const singlePdfPath = appState.outputFolder + '\\' + (settings.outputName || '出力') + '_単ページ.pdf';

            await appState.invoke('generate_pdf', {
                inputFolder: pdfSourceFolder,
                outputPath: singlePdfPath,
                files: pdfFiles,
                options: singlePdfOptions
            });

            message += `単ページPDF生成完了\n`;
        }

        // 見開きPDF出力
        if (settings.savePdfSpread) {
            processingOverlay.setPhase('pdf');
            if (typeof window.setStatus === 'function') window.setStatus('見開きPDFを生成中...');

            const spreadAddNombre = $('spreadAddNombre')?.checked ?? false;
            const spreadNombreSize = $('spreadNombreSize')?.value || 'medium';
            console.log('見開きPDF設定:', {
                spreadAddNombre,
                spreadNombreSize,
                padding: settings.spreadPadding,
                paddingEnabled: $('spreadPaddingEnabled')?.checked
            });

            const spreadPdfOptions = {
                preset: 'b4_spread',
                width_mm: 257.0,
                height_mm: 364.0,
                gutter: settings.spreadGutter ?? 70,
                padding: settings.spreadPadding ?? 150,
                is_spread: true,
                add_white_page: settings.addWhitePage || false,
                print_work_info: settings.printWorkInfo || false,
                work_info: settings.workInfo || null,
                add_nombre: spreadAddNombre,
                nombre_size: spreadNombreSize
            };

            const spreadPdfPath = appState.outputFolder + '\\' + (settings.outputName || '出力') + '_見開き.pdf';

            await appState.invoke('generate_pdf', {
                inputFolder: pdfSourceFolder,
                outputPath: spreadPdfPath,
                files: pdfFiles,
                options: spreadPdfOptions
            });

            message += `見開きPDF生成完了\n`;
        }

        // 一時フォルダを使用した場合は削除
        if (tempFolderUsed) {
            if (typeof window.setStatus === 'function') window.setStatus('一時ファイルを削除中...');
            try {
                await appState.invoke('delete_folder', { path: actualOutputFolder });
            } catch (cleanupError) {
                console.warn('一時フォルダの削除に失敗:', cleanupError);
            }
        }

        // 処理時間を計算
        const elapsedMs = Date.now() - processingOverlay.startTime;
        const elapsedTime = formatTime(elapsedMs);
        message += `\n処理時間: ${elapsedTime}`;
        message += `\n出力先: ${appState.outputFolder}`;

        // 完了フェーズを表示
        processingOverlay.setPhase('complete');
        await new Promise(r => setTimeout(r, 900));

        $('modalMessage').textContent = message;
        $('modal').style.display = 'flex';
        if (typeof window.setStatus === 'function') window.setStatus('処理完了');

    } catch (e) {
        if (typeof window.setStatus === 'function') window.setStatus(`エラー: ${e}`);
        $('modalMessage').textContent = `エラーが発生しました:\n${e}`;
        $('modal').style.display = 'flex';
    } finally {
        appState.isProcessing = false;
        $('progressArea').style.display = 'none';
        processingOverlay.hide();
        if (typeof window.updateExecuteBtn === 'function') window.updateExecuteBtn();
    }
}

/**
 * イベントリスナーのセットアップ
 */
export function setupExecutionEvents() {
    // 実行ボタン
    $('btnExecute').onclick = execute;

    // 結果モーダル
    $('btnOpenFolder').onclick = async () => {
        if (appState.outputFolder && appState.invoke) {
            try {
                await appState.invoke('open_folder', { path: appState.outputFolder });
            } catch (e) {
                console.error('フォルダを開けませんでした:', e);
                try {
                    if (appState.openPath) {
                        await appState.openPath(appState.outputFolder);
                    }
                } catch (e2) {
                    console.error('shell.openも失敗:', e2);
                }
            }
        }
        $('modal').style.display = 'none';
    };
    $('btnCloseModal').onclick = () => {
        $('modal').style.display = 'none';
    };

    // 進捗更新（Tauri イベント）
    if (appState.listen) {
        appState.listen('progress', (event) => {
            updateProgress(event.payload);
        });
    }

    // 処理キャンセルボタン
    $('cancelProcessingBtn').onclick = async () => {
        if (!appState.isProcessing) return;
        try {
            await appState.invoke('cancel_processing');
            processingOverlay.cancelled = true;
            const btn = $('cancelProcessingBtn');
            if (btn) btn.style.display = 'none';
        } catch (e) {
            console.error('キャンセル失敗:', e);
        }
    };
}
