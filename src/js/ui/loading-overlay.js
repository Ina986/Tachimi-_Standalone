/**
 * loading-overlay.js - 画像ロード中オーバーレイ
 * カウントダウン形式のローディング表示
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';

/**
 * ファイルサイズと拡張子から推定読み込み時間を取得（秒）
 */
export async function getEstimatedLoadTime(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();

    let fileSizeMB = 10;
    try {
        if (appState.statFile) {
            const stat = await appState.statFile(filePath);
            fileSizeMB = stat.size / (1024 * 1024);
        }
    } catch (e) {
        console.warn('ファイルサイズ取得失敗:', e);
    }

    let secondsPerMB;
    switch (ext) {
        case 'psd':
            secondsPerMB = 0.6;
            break;
        case 'psb':
            secondsPerMB = 0.5;
            break;
        case 'tif':
        case 'tiff':
            secondsPerMB = 0.32;
            break;
        case 'png':
            secondsPerMB = 0.2;
            break;
        default:
            secondsPerMB = 0.08;
    }

    const estimatedSeconds = Math.max(1, Math.min(120, Math.ceil(fileSizeMB * secondsPerMB)));
    console.log(`推定読み込み時間: ${filePath} (${fileSizeMB.toFixed(1)}MB, ${ext}) → ${estimatedSeconds}秒`);
    return estimatedSeconds;
}

/**
 * ローディングオーバーレイを表示
 */
export async function showLoadingOverlay(filePath) {
    const overlay = $('imageLoadingOverlay');
    const remainingEl = $('loadingRemaining');
    const prefixEl = $('loadingTimePrefix');
    const suffixEl = $('loadingTimeSuffix');
    const hintEl = $('loadingHint');

    overlay.style.display = 'flex';
    prefixEl.textContent = '';
    remainingEl.textContent = '計算中';
    suffixEl.textContent = '';
    hintEl.textContent = 'ファイル情報を取得中...';

    appState.loadingRemainingTime = await getEstimatedLoadTime(filePath);

    prefixEl.textContent = '残り約';
    remainingEl.textContent = appState.loadingRemainingTime;
    suffixEl.textContent = '秒';

    const ext = filePath.split('.').pop().toLowerCase();
    if (ext === 'psd' || ext === 'psb') {
        hintEl.textContent = 'PSD/PSBファイルの読み込みには時間がかかる場合があります';
    } else if (ext === 'tif' || ext === 'tiff') {
        hintEl.textContent = 'TIFFファイルを処理中です';
    } else {
        hintEl.textContent = '画像を処理中です';
    }

    appState.loadingTimerInterval = setInterval(() => {
        appState.loadingRemainingTime--;

        if (appState.loadingRemainingTime > 0) {
            remainingEl.textContent = appState.loadingRemainingTime;
        } else if (appState.loadingRemainingTime === 0) {
            remainingEl.textContent = '0';
        } else {
            prefixEl.textContent = '';
            remainingEl.textContent = 'あともうちょっと';
            suffixEl.textContent = '';
            hintEl.textContent = '大きなファイルの処理中です...';
        }
    }, 1000);
}

/**
 * ローディングオーバーレイを非表示
 */
export function hideLoadingOverlay() {
    const overlay = $('imageLoadingOverlay');
    overlay.style.display = 'none';

    if (appState.loadingTimerInterval) {
        clearInterval(appState.loadingTimerInterval);
        appState.loadingTimerInterval = null;
    }
}
