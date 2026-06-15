/**
 * update-system.js - アップデート機能（脱git / G:共有ドライブ方式）
 * 実行時は共有フォルダ(更新置き場\Tachimi\)だけを見る。minisign 署名検証で偽更新を拒否。
 * plugin-updater の check()/downloadAndInstall() は使わない（Rust の check_local_update / apply_local_update）。
 */

import { $ } from '../utils/dom.js';
import { invoke } from '../core/tauri-api.js';

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
        const update = await invoke('check_local_update');

        if (update) {
            resultEl.className = 'update-result available';
            resultEl.innerHTML = `
                <div><strong>新しいバージョンがあります: v${update.version}</strong></div>
                <button id="btnInstallUpdate" class="btn-install-update">
                    今すぐ更新
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
    } catch (error) {
        console.error('Update check failed:', error);
        resultEl.className = 'update-result error';
        resultEl.textContent = `確認に失敗しました: ${error}`;
        resultEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.classList.remove('checking');
    }
}

/**
 * 起動時の自動アップデートチェック（G:/参照アドレスの読込が間に合わないことがあるためリトライ）
 */
export async function checkForUpdateOnStartup() {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        try {
            const update = await invoke('check_local_update');
            if (update) {
                console.log(`Update available: v${update.version}`);
                window._pendingUpdate = update;
                const shouldUpdate = await showUpdateConfirmDialog(update.version);
                if (shouldUpdate) {
                    await performAutoUpdate();
                }
                return;
            }
        } catch (error) {
            console.warn('起動時更新チェック失敗(再試行):', error);
        }
    }
    console.log('App is up to date (or 更新置き場 未接続)');
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
 * 自動アップデートを実行（サイレント更新 → アプリは自動終了・再起動）
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
            <p>更新を適用しています。<br>自動で再起動します。</p>
        </div>
    `;
    document.body.appendChild(overlay);

    try {
        // apply_local_update が再検証→サイレント更新(/S /R /UPDATE)を起動しアプリ終了。
        await invoke('apply_local_update', { setupPath: window._pendingUpdate.setup_path });
        // 通常はここに到達しない（app.exit）
    } catch (error) {
        console.error('Auto update failed:', error);
        overlay.querySelector('h3').textContent = 'アップデート失敗';
        overlay.querySelector('p').textContent = `${error}`;
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
 * アップデートをインストール（手動）
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
            installBtn.textContent = '更新中...';
        }

        await invoke('apply_local_update', { setupPath: window._pendingUpdate.setup_path });
        // 通常はここに到達しない（app.exit）
    } catch (error) {
        console.error('Update install failed:', error);
        resultEl.className = 'update-result error';
        resultEl.textContent = `更新に失敗しました: ${error}`;
        if (installBtn) {
            installBtn.disabled = false;
            installBtn.textContent = '今すぐ更新';
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
                versionInfoEl.textContent = `Tachimi Standalone ${versionText}`;
            }
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
