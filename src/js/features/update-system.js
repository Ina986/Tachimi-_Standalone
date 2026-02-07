/**
 * update-system.js - アップデート機能
 * GitHub Releases + tauri-plugin-updater による自動更新
 */

import { $ } from '../utils/dom.js';

/**
 * アップデートを確認（手動）
 */
export async function checkForUpdate() {
    const btn = $('btnCheckUpdate');
    const resultEl = $('updateResult');

    btn.disabled = true;
    btn.classList.add('checking');
    resultEl.style.display = 'none';

    try {
        if (window.__TAURI__?.updater) {
            const { check } = window.__TAURI__.updater;
            const update = await check();

            if (update) {
                resultEl.className = 'update-result available';
                resultEl.innerHTML = `
                    <div><strong>新しいバージョンがあります: v${update.version}</strong></div>
                    <div style="margin-top: 6px; font-size: 11px; color: var(--text3);">${update.body || ''}</div>
                    <button id="btnInstallUpdate" class="btn-install-update">
                        ダウンロードしてインストール
                    </button>
                `;
                resultEl.style.display = 'block';

                window._pendingUpdate = update;
                $('btnInstallUpdate').onclick = () => installUpdate();
            } else {
                resultEl.className = 'update-result no-update';
                resultEl.textContent = '最新バージョンです';
                resultEl.style.display = 'block';
            }
        } else {
            resultEl.className = 'update-result error';
            resultEl.textContent = 'アップデート機能は利用できません（開発モード）';
            resultEl.style.display = 'block';
        }
    } catch (error) {
        console.error('Update check failed:', error);
        resultEl.className = 'update-result error';
        resultEl.textContent = `確認に失敗しました: ${error.message || error}`;
        resultEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.classList.remove('checking');
    }
}

/**
 * 起動時の自動アップデートチェック
 */
export async function checkForUpdateOnStartup() {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        if (!window.__TAURI__?.updater) {
            console.log('Updater not available (dev mode)');
            return;
        }

        const { check } = window.__TAURI__.updater;
        const update = await check();

        if (update) {
            console.log(`Update available: v${update.version}`);
            window._pendingUpdate = update;

            const shouldUpdate = await showUpdateConfirmDialog(update.version);
            if (shouldUpdate) {
                await performAutoUpdate();
            }
        } else {
            console.log('App is up to date');
        }
    } catch (error) {
        console.error('Startup update check failed:', error);
    }
}

/**
 * 更新確認ダイアログを表示
 */
export async function showUpdateConfirmDialog(version) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'update-dialog-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-dialog-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </div>
                <h3>新しいバージョンがあります</h3>
                <p>v${version} が利用可能です。<br>今すぐアップデートしますか？</p>
                <div class="update-dialog-buttons">
                    <button class="btn-update-later">後で</button>
                    <button class="btn-update-now">アップデート</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('visible'));

        overlay.querySelector('.btn-update-later').onclick = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            resolve(false);
        };

        overlay.querySelector('.btn-update-now').onclick = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            resolve(true);
        };
    });
}

/**
 * 自動アップデートを実行
 */
export async function performAutoUpdate() {
    if (!window._pendingUpdate) return;

    const overlay = document.createElement('div');
    overlay.className = 'update-dialog-overlay visible';
    overlay.innerHTML = `
        <div class="update-dialog">
            <div class="update-dialog-icon updating">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                </svg>
            </div>
            <h3>アップデート中...</h3>
            <p>ダウンロードしています。<br>しばらくお待ちください。</p>
        </div>
    `;
    document.body.appendChild(overlay);

    try {
        await window._pendingUpdate.downloadAndInstall();

        overlay.querySelector('h3').textContent = 'インストール完了';
        overlay.querySelector('p').textContent = 'アプリを再起動します...';
        overlay.querySelector('.update-dialog-icon').classList.remove('updating');

        if (window.__TAURI__?.process) {
            const { relaunch } = window.__TAURI__.process;
            setTimeout(async () => {
                await relaunch();
            }, 1500);
        }
    } catch (error) {
        console.error('Auto update failed:', error);
        overlay.querySelector('h3').textContent = 'アップデート失敗';
        overlay.querySelector('p').textContent = error.message || 'エラーが発生しました';
        overlay.querySelector('.update-dialog-icon').classList.remove('updating');

        const btnClose = document.createElement('button');
        btnClose.className = 'btn-update-now';
        btnClose.textContent = '閉じる';
        btnClose.onclick = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('.update-dialog').appendChild(btnClose);
    }
}

/**
 * アップデートをインストール
 */
export async function installUpdate() {
    const resultEl = $('updateResult');
    const installBtn = $('btnInstallUpdate');

    if (!window._pendingUpdate) {
        resultEl.textContent = 'アップデート情報がありません';
        return;
    }

    try {
        if (installBtn) {
            installBtn.disabled = true;
            installBtn.textContent = 'ダウンロード中...';
        }

        await window._pendingUpdate.downloadAndInstall();

        resultEl.innerHTML = `
            <div><strong>インストール完了</strong></div>
            <div style="margin-top: 6px;">アプリを再起動してください</div>
        `;

        if (window.__TAURI__?.process) {
            const { relaunch } = window.__TAURI__.process;
            setTimeout(async () => {
                await relaunch();
            }, 1500);
        }
    } catch (error) {
        console.error('Update install failed:', error);
        resultEl.className = 'update-result error';
        resultEl.textContent = `インストールに失敗しました: ${error.message || error}`;
        if (installBtn) {
            installBtn.disabled = false;
            installBtn.textContent = 'ダウンロードしてインストール';
        }
    }
}

/**
 * Tauriからバージョンを取得して表示を更新
 */
export async function updateVersionDisplay() {
    try {
        if (window.__TAURI__?.app?.getVersion) {
            const version = await window.__TAURI__.app.getVersion();
            const versionText = `v${version}`;

            const currentVersionEl = $('currentVersion');
            if (currentVersionEl) {
                currentVersionEl.textContent = versionText;
            }

            const versionInfoEl = document.querySelector('.version-info');
            if (versionInfoEl) {
                versionInfoEl.textContent = `タチミ Standalone ${versionText}`;
            }

            console.log('バージョン表示を更新:', versionText);
        }
    } catch (e) {
        console.warn('バージョン取得に失敗:', e);
    }
}

/**
 * イベントリスナーのセットアップ
 */
export function setupUpdateEvents() {
    $('btnCheckUpdate').onclick = () => checkForUpdate();
}
