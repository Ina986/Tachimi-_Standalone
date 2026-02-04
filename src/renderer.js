/**
 * タチミ スタンドアロン版 - レンダラー (Tauri版)
 */

// Tauri API ラッパー（Tauri v2）
let invoke, convertFileSrc, listen, openDialog, openPath, readTextFile, statFile, messageDialog, desktopDir;

function initTauriAPIs() {
    console.log('Tauri APIs:', Object.keys(window.__TAURI__ || {}));

    if (window.__TAURI__) {
        // コアAPI
        if (window.__TAURI__.core) {
            invoke = window.__TAURI__.core.invoke;
            convertFileSrc = window.__TAURI__.core.convertFileSrc;
        }
        // イベントAPI
        if (window.__TAURI__.event) {
            listen = window.__TAURI__.event.listen;
        }
        // ダイアログプラグイン
        if (window.__TAURI__.dialog) {
            openDialog = window.__TAURI__.dialog.open;
            messageDialog = window.__TAURI__.dialog.message;
            console.log('Dialog API loaded');
        } else {
            console.warn('Dialog API not found');
        }
        // シェルプラグイン
        if (window.__TAURI__.shell) {
            openPath = window.__TAURI__.shell.open;
        }
        // FSプラグイン
        if (window.__TAURI__.fs) {
            readTextFile = window.__TAURI__.fs.readTextFile;
            statFile = window.__TAURI__.fs.stat;
        }
        // Pathプラグイン
        if (window.__TAURI__.path) {
            desktopDir = window.__TAURI__.path.desktopDir;
        }
    } else {
        console.error('Tauri API not found!');
    }
}

// DOM読み込み後に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTauriAPIs);
} else {
    initTauriAPIs();
}

// 入力フォルダパス（Tauriでは絶対パスが必要）
let inputFolder = null;

let targetFiles = [];
let outputFolder = null;
let jsonData = null;           // JSON全体
let selectionRanges = [];      // 範囲選択リスト
let selectedRange = null;      // 選択中の範囲
let isProcessing = false;

// 範囲選択プレビュー用
let previewImageSize = { width: 0, height: 0 };  // 実際の画像サイズ
let previewScale = 1;                             // プレビュー表示のスケール
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let cropModeOpen = false;                         // 画像選択モードが開いているか
let savedCropValues = { left: 0, top: 0, right: 0, bottom: 0 };  // キャンセル時に戻す値
let guides = [];                                   // ガイド線リスト { type: 'h'|'v', position: number (実座標) }
let cropModeStep = 'select';                       // クロップモードの現在のステップ ('select' | 'confirm' | 'apply')
let isFirstCropModeOpen = true;                    // クロップモード初回表示フラグ
let guideMode = null;                              // 'h' or 'v' or null
let rulerDragging = null;                          // 定規からのドラッグ中 { type: 'h'|'v' }
let currentPreviewPageIndex = 0;                   // クロップモードで表示中のページインデックス
let currentZoom = 1.0;                             // プレビューのズーム倍率
let lastMousePos = { x: 0, y: 0 };                 // 最後のマウス位置（コンテナ相対）
let baseContainerSize = { width: 0, height: 0 };   // ズーム計算用の基準コンテナサイズ
let isSpacePressed = false;                        // スペースキーが押されているか
let isPanning = false;                             // パン操作中か
let panStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };  // パン開始時の位置

// Undo/Redo履歴管理
let undoHistory = [];                              // 操作履歴スタック
let redoHistory = [];                              // やり直し履歴スタック
const MAX_HISTORY = 50;                            // 履歴の最大数

// JSON保存関連定数
const JSON_FOLDER_PATH = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/JSONフォルダ";

// ========================================
// 機能アンロック管理
// ========================================
const UNLOCK_STORAGE_KEY = 'tachimi_feature_unlock';
const UNLOCK_PASSWORD = 'Tachimi2026';

// JSON登録用の固定比率（幅:高さ = 640:909）
const JSON_REGISTER_ASPECT_RATIO = 640 / 909;

/**
 * アンロック状態を取得
 */
function isFeatureUnlocked() {
    try {
        const data = localStorage.getItem(UNLOCK_STORAGE_KEY);
        if (!data) return false;
        const parsed = JSON.parse(data);
        return parsed.unlocked === true;
    } catch {
        return false;
    }
}

/**
 * アンロック状態を保存
 */
function setFeatureUnlocked(unlocked) {
    try {
        localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify({
            unlocked: unlocked,
            timestamp: new Date().toISOString()
        }));
        updateLockIcon();
        updateUnlockModalUI();
        updateJsonRegisterButtonVisibility();
        updateCropInputsDisabledState();
        // クロップモードが開いている場合はガイドボタンの表示も更新
        if (cropModeOpen) {
            updateGuideList();
        }
    } catch (e) {
        console.warn('アンロック状態の保存に失敗:', e);
    }
}

/**
 * パスワード検証
 */
function verifyUnlockPassword(inputPassword) {
    return inputPassword === UNLOCK_PASSWORD;
}

/**
 * アンロック試行
 */
function attemptUnlock() {
    const input = $('unlockPassword');
    const errorEl = $('unlockError');

    if (verifyUnlockPassword(input.value)) {
        setFeatureUnlocked(true);
        input.value = '';
        errorEl.style.display = 'none';
    } else {
        errorEl.style.display = 'block';
        input.value = '';
        input.focus();
    }
}

/**
 * 再ロック
 */
function lockFeature() {
    setFeatureUnlocked(false);
}

/**
 * ヘッダーの鍵アイコン状態を更新
 */
function updateLockIcon() {
    const lockEl = $('btnFeatureLock');
    if (!lockEl) return;

    const closedIcon = lockEl.querySelector('.lock-closed');
    const openIcon = lockEl.querySelector('.lock-open');
    const unlocked = isFeatureUnlocked();

    if (closedIcon) closedIcon.style.display = unlocked ? 'none' : 'block';
    if (openIcon) openIcon.style.display = unlocked ? 'block' : 'none';
}

/**
 * 設定モーダル内のUI状態を更新
 */
function updateUnlockModalUI() {
    const unlocked = isFeatureUnlocked();
    const statusEl = $('unlockStatus');
    const statusText = statusEl?.querySelector('.unlock-status-text');
    const inputArea = $('unlockInputArea');
    const unlockedArea = $('unlockedArea');

    if (statusEl) {
        statusEl.classList.toggle('locked', !unlocked);
        statusEl.classList.toggle('unlocked', unlocked);
    }
    if (statusText) {
        statusText.textContent = unlocked
            ? 'JSON新規登録: アンロック済み'
            : 'JSON新規登録: ロック中';
    }
    if (inputArea) {
        inputArea.style.display = unlocked ? 'none' : 'block';
    }
    if (unlockedArea) {
        unlockedArea.style.display = unlocked ? 'block' : 'none';
    }
}

/**
 * JSON新規登録ボタンの表示/非表示を更新
 */
function updateJsonRegisterButtonVisibility() {
    const btn = $('btnRegisterJson');
    if (btn) {
        btn.style.display = isFeatureUnlocked() ? '' : 'none';
    }
}

/**
 * クロップモードの数値入力欄の有効/無効を更新
 * 機能解除時は比率固定のため数値入力を無効化
 */
function updateCropInputsDisabledState() {
    const unlocked = isFeatureUnlocked();
    const inputs = ['cropLeftFull', 'cropTopFull', 'cropRightFull', 'cropBottomFull'];

    inputs.forEach(id => {
        const input = $(id);
        if (input) {
            input.disabled = unlocked;
            input.style.opacity = unlocked ? '0.5' : '1';
            input.title = unlocked ? '比率固定モード（640:909）' : '';
        }
    });
}

/**
 * 機能アンロックモーダルを表示
 */
function showFeatureUnlockModal() {
    updateUnlockModalUI();
    $('featureUnlockModal').style.display = 'flex';
}

/**
 * 機能アンロックモーダルを非表示
 */
function hideFeatureUnlockModal() {
    $('featureUnlockModal').style.display = 'none';
    $('unlockPassword').value = '';
    $('unlockError').style.display = 'none';
}

// ========================================
// アップデート機能
// ========================================

/**
 * アップデートを確認（手動）
 */
async function checkForUpdate() {
    const btn = $('btnCheckUpdate');
    const resultEl = $('updateResult');

    // ボタンを無効化してローディング状態に
    btn.disabled = true;
    btn.classList.add('checking');
    resultEl.style.display = 'none';

    try {
        // Tauri updater API を使用
        if (window.__TAURI__?.updater) {
            const { check } = window.__TAURI__.updater;
            const update = await check();

            if (update) {
                // 更新あり
                resultEl.className = 'update-result available';
                resultEl.innerHTML = `
                    <div><strong>新しいバージョンがあります: v${update.version}</strong></div>
                    <div style="margin-top: 6px; font-size: 11px; color: var(--text3);">${update.body || ''}</div>
                    <button id="btnInstallUpdate" class="btn-install-update" onclick="installUpdate()">
                        ダウンロードしてインストール
                    </button>
                `;
                resultEl.style.display = 'block';

                // 更新オブジェクトを保存
                window._pendingUpdate = update;
            } else {
                // 更新なし
                resultEl.className = 'update-result no-update';
                resultEl.textContent = '最新バージョンです';
                resultEl.style.display = 'block';
            }
        } else {
            // Updater API が利用できない
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
async function checkForUpdateOnStartup() {
    // 少し遅延させてアプリの初期化を待つ
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

            // 確認ダイアログを表示
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
async function showUpdateConfirmDialog(version) {
    return new Promise((resolve) => {
        // カスタムダイアログを作成
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

        // アニメーション用
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
async function performAutoUpdate() {
    if (!window._pendingUpdate) return;

    // 進捗ダイアログを表示
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

        // 完了表示
        overlay.querySelector('h3').textContent = 'インストール完了';
        overlay.querySelector('p').textContent = 'アプリを再起動します...';
        overlay.querySelector('.update-dialog-icon').classList.remove('updating');

        // 再起動
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

        // 閉じるボタンを追加
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
async function installUpdate() {
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

        // ダウンロードとインストールを実行
        await window._pendingUpdate.downloadAndInstall();

        // 再起動が必要なことを通知
        resultEl.innerHTML = `
            <div><strong>インストール完了</strong></div>
            <div style="margin-top: 6px;">アプリを再起動してください</div>
        `;

        // Tauri の再起動 API を使用
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

const LABELS_BY_GENRE = {
    "一般女性": ["Ropopo!", "コイパレ", "キスカラ", "カルコミ", "ウーコミ!", "シェノン"],
    "TL": ["TLオトメチカ", "LOVE FLICK", "乙女チック", "ウーコミkiss!", "シェノン+", "@夜噺"],
    "BL": ["NuPu", "spicomi", "MooiComics", "BLオトメチカ", "BOYS FAN"],
    "一般男性": ["DEDEDE", "GG-COMICS", "コミックREBEL"],
    "メンズ": ["カゲキヤコミック", "もえスタビースト", "@夜噺＋"],
    "タテコミ": ["GIGATOON"]
};

// JSON登録モーダル用状態
let registerModalSelectedFile = null;  // 既存追加で選択されたJSONファイルパス
let registerModalExistingData = null;  // 既存JSONの読み込みデータ

// JSONファイル選択モーダル（グローバル参照用）
let jsonSelectModal = null;

// ========================================
// 処理中オーバーレイ制御
// ========================================
const processingOverlay = {
    // 状態管理
    currentPhase: 'prepare',
    phases: ['prepare', 'process', 'pdf', 'complete'],
    phaseLabels: {
        prepare: '準備中',
        process: '変換中',
        pdf: '製本中',
        complete: '完了'
    },

    // 時間管理
    startTime: 0,
    elapsedInterval: null,

    // スムーズアニメーション用
    currentPercent: 0,
    targetPercent: 0,
    animationFrame: null,
    totalFiles: 0,

    show(totalFiles) {
        const overlay = $('processingOverlay');
        if (!overlay) return;

        overlay.style.display = 'flex';
        overlay.classList.remove('complete');

        // 初期化
        this.startTime = Date.now();
        this.currentPercent = 0;
        this.targetPercent = 0;
        this.totalFiles = totalFiles;

        // UI初期化
        const percentEl = $('processingPercent');
        const currentEl = $('processingCurrent');
        const totalEl = $('processingTotal');
        const filenameEl = $('processingFilename');
        const elapsedEl = $('processingElapsed');
        const inkFill = $('processingBar');

        if (percentEl) percentEl.textContent = '0';
        if (currentEl) currentEl.textContent = '0';
        if (totalEl) totalEl.textContent = totalFiles;
        if (filenameEl) filenameEl.textContent = '';
        if (elapsedEl) elapsedEl.textContent = '0:00';
        if (inkFill) inkFill.style.width = '0%';

        this.setPhase('prepare');
        this.startAnimation();
        this.startElapsedTimer();
    },

    hide() {
        this.stopAnimation();
        this.stopElapsedTimer();
        const overlay = $('processingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    },

    setPhase(phase) {
        this.currentPhase = phase;
        const idx = this.phases.indexOf(phase);

        // フェーズラベルを更新
        const labelEl = $('processingPhaseLabel');
        if (labelEl) {
            labelEl.textContent = this.phaseLabels[phase] || phase;
        }

        // ステップの状態を更新（印刷工房スタイル）
        document.querySelectorAll('.process-steps .step').forEach((step, i) => {
            step.classList.remove('active', 'completed');
            if (i < idx) {
                step.classList.add('completed');
            } else if (i === idx) {
                step.classList.add('active');
            }
        });

        // 完了状態の場合
        if (phase === 'complete') {
            const overlay = $('processingOverlay');
            if (overlay) {
                overlay.classList.add('complete');
            }
            // 完了時は100%に
            this.targetPercent = 100;

            // 完了時間を表示（押印に）
            const elapsed = Date.now() - this.startTime;
            const completionTimeEl = $('completionTime');
            if (completionTimeEl) {
                completionTimeEl.textContent = this.formatTime(elapsed) + ' で完了';
            }
        }
    },

    // 経過時間をフォーマット
    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    },

    // 経過時間タイマー開始
    startElapsedTimer() {
        this.stopElapsedTimer();
        const elapsedEl = $('processingElapsed');
        if (!elapsedEl) return;

        this.elapsedInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            elapsedEl.textContent = this.formatTime(elapsed);
        }, 1000);
    },

    // 経過時間タイマー停止
    stopElapsedTimer() {
        if (this.elapsedInterval) {
            clearInterval(this.elapsedInterval);
            this.elapsedInterval = null;
        }
    },

    updateDisplay(current, total, filename, inProgress = 0) {
        // パーセント計算（in_progressを考慮した自然な進行）
        const effectiveProgress = current + (inProgress * 0.5);
        const actualPercent = total > 0 ? (effectiveProgress / total) * 100 : 0;

        // 直接パーセントを使用（リアルな進捗）
        // ただし完了直前まで100%にしない
        this.targetPercent = actualPercent >= 100 ? 100 : Math.min(99, actualPercent);

        // ファイル数表示
        const currentEl = $('processingCurrent');
        const totalEl = $('processingTotal');
        const filenameEl = $('processingFilename');

        if (currentEl) {
            currentEl.textContent = current;
        }
        if (totalEl) totalEl.textContent = total;
        if (filenameEl && filename) {
            filenameEl.textContent = filename;
        }
    },

    startAnimation() {
        this.stopAnimation();

        const animate = () => {
            const diff = this.targetPercent - this.currentPercent;

            if (Math.abs(diff) < 0.1) {
                this.currentPercent = this.targetPercent;
            } else {
                // スムーズなイージング
                this.currentPercent += diff * 0.1;
            }

            // パーセント表示
            const percentEl = $('processingPercent');
            if (percentEl) percentEl.textContent = Math.round(this.currentPercent);

            // インクバー更新（印刷工房スタイル）
            const inkFill = $('processingBar');
            if (inkFill) {
                inkFill.style.width = `${this.currentPercent}%`;
            }

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.animationFrame = requestAnimationFrame(animate);
    },

    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
};

/**
 * カスタムアラートを表示
 * @param {string} message - 表示メッセージ
 * @param {string} kind - 'warning' | 'error' | 'info'
 * @returns {Promise} OKボタンが押されたら解決
 */
function showAlert(message, kind = 'warning') {
    return new Promise((resolve) => {
        const modal = $('alertModal');
        const icon = $('alertModalIcon');
        const msg = $('alertModalMessage');
        const okBtn = $('alertModalOk');

        // アイコン設定
        icon.className = 'alert-modal-icon ' + kind;
        const icons = {
            warning: '⚠',
            error: '✕',
            info: 'ℹ',
            success: '✓'
        };
        icon.textContent = icons[kind] || icons.warning;

        // メッセージ設定
        msg.textContent = message;

        // モーダル表示
        modal.style.display = 'flex';

        // OKボタンにフォーカス
        setTimeout(() => okBtn.focus(), 50);

        // イベントハンドラ
        const close = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', close);
            document.removeEventListener('keydown', keyHandler);
            resolve();
        };

        const keyHandler = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };

        okBtn.addEventListener('click', close);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * 現在の状態をスナップショットとして取得
 */
function getCurrentState() {
    return {
        guides: JSON.parse(JSON.stringify(guides)),
        cropValues: {
            left: parseInt($('cropLeftFull')?.value) || 0,
            top: parseInt($('cropTopFull')?.value) || 0,
            right: parseInt($('cropRightFull')?.value) || 0,
            bottom: parseInt($('cropBottomFull')?.value) || 0
        }
    };
}

/**
 * 状態を復元
 */
function restoreState(state) {
    guides = JSON.parse(JSON.stringify(state.guides));
    if ($('cropLeftFull')) $('cropLeftFull').value = state.cropValues.left;
    if ($('cropTopFull')) $('cropTopFull').value = state.cropValues.top;
    if ($('cropRightFull')) $('cropRightFull').value = state.cropValues.right;
    if ($('cropBottomFull')) $('cropBottomFull').value = state.cropValues.bottom;

    // UI更新
    renderGuides();
    updateGuideList();
    updateSelectionVisual();
    updateFillStrokePreview();
    updateCropModeHint();
    updateApplyButtonState();
    updateGuideButtonHighlight();
}

/**
 * 操作前に現在の状態を履歴に保存
 */
function saveToHistory() {
    const state = getCurrentState();
    undoHistory.push(state);

    // 履歴が最大数を超えたら古いものを削除
    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    }

    // 新しい操作が行われたらRedoをクリア
    redoHistory = [];
}

/**
 * Undo実行
 */
function undo() {
    if (undoHistory.length === 0) {
        setStatus('これ以上戻れません');
        return;
    }

    // 現在の状態をRedo履歴に保存
    redoHistory.push(getCurrentState());

    // 前の状態を復元
    const prevState = undoHistory.pop();
    restoreState(prevState);

    setStatus('操作を元に戻しました (Ctrl+Y でやり直し)');
}

/**
 * Redo実行
 */
function redo() {
    if (redoHistory.length === 0) {
        setStatus('やり直す操作がありません');
        return;
    }

    // 現在の状態をUndo履歴に保存
    undoHistory.push(getCurrentState());

    // 次の状態を復元
    const nextState = redoHistory.pop();
    restoreState(nextState);

    setStatus('操作をやり直しました');
}

/**
 * 履歴をクリア（画像選択モードを開いたとき）
 */
function clearHistory() {
    undoHistory = [];
    redoHistory = [];
}

// 出力形式の選択状態（複数選択可能）
let selectedOutputs = {
    spreadPdf: true,   // 見開きPDF（デフォルトON）
    singlePdf: false,  // 単ページPDF
    jpeg: false        // JPEG
};

// 色名とカラーコードの対応
const COLOR_MAP = {
    black: '#000000',
    white: '#ffffff',
    cyan: '#00bfff'
};

// DOM要素
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
    setupEvents();
    setupPresetCards();
    setupTachikiriCards();
    // 初期状態でタチキリ設定を表示（デフォルトが外を塗る）
    updateTachikiriSettings();
    updateExecuteBtn();

    // 保存された設定を読み込み
    loadSettings();

    // 設定変更時の自動保存を有効化
    setupSettingsAutoSave();

    // デフォルト出力フォルダを設定（デスクトップ/処理結果PDF）
    await initDefaultOutputFolder();
});

async function initDefaultOutputFolder() {
    if (!invoke) {
        console.warn('invoke not available yet, retrying...');
        setTimeout(initDefaultOutputFolder, 100);
        return;
    }
    try {
        const defaultFolder = await invoke('get_default_output_folder');
        if (defaultFolder && !outputFolder) {
            outputFolder = defaultFolder;
            updateOutputInfo();
            console.log('デフォルト出力フォルダを設定:', outputFolder);
        }
    } catch (e) {
        console.error('デフォルト出力フォルダの取得に失敗:', e);
    }
}

function setupEvents() {
    console.log('[setupEvents] イベント設定開始');
    console.log('[setupEvents] invoke関数:', invoke ? '利用可能' : '未定義');
    console.log('[setupEvents] listen関数:', listen ? '利用可能' : '未定義');
    // ドラッグ＆ドロップ設定（Tauri v2 イベントシステム使用）
    const dropZone = $('dropZone');

    // Tauriのドラッグ＆ドロップイベントをリッスン
    if (listen) {
        // ドラッグ進入時
        listen('tauri://drag-enter', (event) => {
            console.log('[DragDrop] drag-enter', event.payload);
            if (dropZone) dropZone.classList.add('drag-over');
        });

        // ドラッグホバー時
        listen('tauri://drag-over', (event) => {
            if (dropZone) dropZone.classList.add('drag-over');
        });

        // ドラッグ離脱時
        listen('tauri://drag-leave', (event) => {
            console.log('[DragDrop] drag-leave');
            if (dropZone) dropZone.classList.remove('drag-over');
        });

        // ドロップ時
        listen('tauri://drag-drop', async (event) => {
            console.log('[DragDrop] drag-drop', event.payload);
            if (dropZone) dropZone.classList.remove('drag-over');
            const paths = event.payload?.paths;
            if (paths && paths.length > 0) {
                await handleDroppedPaths(paths);
            }
        });
    }

    // ウィンドウ全体のデフォルト動作を防止
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // ドロップエリアをクリックでフォルダ選択
    if (dropZone) {
        dropZone.onclick = async () => {
            const folder = await openDialog({ directory: true });
            if (folder) {
                try {
                    const files = await invoke('get_image_files', { folderPath: folder });
                    if (files.length === 0) {
                        setStatus('フォルダ内に対応する画像ファイルがありません');
                        return;
                    }
                    inputFolder = folder;
                    targetFiles = files;
                    updateFileInfo();
                    setStatus(`${targetFiles.length} ファイルを読み込みました`);
                } catch (e) {
                    setStatus('エラー: ' + e);
                }
            }
        };
    }

    // 出力フォルダ選択
    $('btnSelectOutput').onclick = async () => {
        const folder = await openDialog({ directory: true });
        if (folder) {
            outputFolder = folder;
            updateOutputInfo();
            setStatus('出力先を設定しました');
        }
    };

    // 出力フォルダをデフォルトに戻す
    $('btnResetOutput').onclick = async () => {
        await initDefaultOutputFolder();
        setStatus('出力先をデフォルトに戻しました');
    };

    // クリアボタン
    $('btnClearFiles').onclick = () => {
        resetFileSelection();
        setStatus('ファイル選択をクリアしました');
    };

    // JSONファイル読み込み
    // GドライブのJSONフォルダを初期パスに設定（JSXスクリプトと同じ）
    // ※ JSON_FOLDER_PATH はグローバル定数として定義済み

    // JSONファイル選択モーダル（フォルダ階層ナビゲーション対応＋検索機能）
    // グローバル変数に代入（登録機能から参照するため）
    jsonSelectModal = {
        basePath: JSON_FOLDER_PATH,
        currentPath: JSON_FOLDER_PATH,
        pathHistory: [],
        searchTimer: null,
        isSearchMode: false,
        onFileSelected: null,  // 外部コールバック（ファイル選択時に呼ばれる）

        show: async function() {
            this.currentPath = this.basePath;
            this.pathHistory = [];
            this.isSearchMode = false;
            $('jsonSearchInput').value = '';
            $('btnJsonSearchClear').style.display = 'none';
            $('jsonSelectModal').style.display = 'flex';
            await this.loadContents();
        },

        hide: function() {
            $('jsonSelectModal').style.display = 'none';
            this.clearSearch();
        },

        clearSearch: function() {
            $('jsonSearchInput').value = '';
            $('btnJsonSearchClear').style.display = 'none';
            this.isSearchMode = false;
            if (this.searchTimer) {
                clearTimeout(this.searchTimer);
                this.searchTimer = null;
            }
        },

        updatePathDisplay: function() {
            if (this.isSearchMode) {
                $('jsonSelectPath').textContent = '検索結果';
                return;
            }
            // ベースパスからの相対パスを表示
            const relativePath = this.currentPath.replace(this.basePath, '').replace(/^[\/\\]/, '');
            const displayPath = relativePath || 'JSONフォルダ';
            $('jsonSelectPath').textContent = displayPath;
        },

        search: async function(query) {
            if (!query.trim()) {
                this.isSearchMode = false;
                await this.loadContents();
                return;
            }

            this.isSearchMode = true;
            const listEl = $('jsonSelectList');
            listEl.innerHTML = '<div class="json-select-loading">検索中...</div>';
            this.updatePathDisplay();

            try {
                console.log('検索クエリ:', query.trim(), 'ベースパス:', this.basePath);
                const results = await invoke('search_json_folders', {
                    basePath: this.basePath,
                    query: query.trim()
                });
                console.log('検索結果:', results);

                listEl.innerHTML = '';

                if (results.length === 0) {
                    listEl.innerHTML = '<div class="json-select-empty">該当する作品が見つかりません</div>';
                    return;
                }

                // 検索結果を表示
                results.forEach(result => {
                    const item = document.createElement('div');
                    item.className = 'json-select-item';
                    item.innerHTML = `
                        <span class="json-select-item-icon">📁</span>
                        <span class="json-select-item-name">
                            <span class="search-result-title">${result.title}</span>
                            <span class="search-result-label">${result.label}</span>
                        </span>
                    `;
                    item.onclick = () => this.enterSearchResult(result);
                    listEl.appendChild(item);
                });
            } catch (e) {
                listEl.innerHTML = `<div class="json-select-error">エラー: ${e}</div>`;
            }
        },

        enterSearchResult: async function(result) {
            // 検索結果はJSONファイルのフルパスなので直接読み込む
            console.log('読み込むパス:', result.path);
            try {
                const content = await readTextFile(result.path);
                console.log('読み込み成功');
                const data = JSON.parse(content);

                // 外部コールバックがある場合はそちらを呼ぶ
                if (this.onFileSelected) {
                    this.onFileSelected(result.path, data);
                    return;
                }

                jsonData = data;
                parseJsonData(data, result.title + '.json');
                this.hide();
            } catch (e) {
                console.error('読み込みエラー:', e);
                $('jsonInfo').textContent = 'エラー: ' + e;
                $('jsonInfo').className = 'json-status error';
                jsonData = null;
                selectionRanges = [];
            }
        },

        loadContents: async function() {
            const listEl = $('jsonSelectList');
            listEl.innerHTML = '<div class="json-select-loading">読み込み中...</div>';
            this.updatePathDisplay();

            try {
                const contents = await invoke('list_folder_contents', { folderPath: this.currentPath });

                listEl.innerHTML = '';

                // 戻るボタン（ルートでなければ表示）
                if (this.currentPath !== this.basePath) {
                    const backItem = document.createElement('div');
                    backItem.className = 'json-select-item json-select-back';
                    backItem.innerHTML = `
                        <span class="json-select-item-icon">⬅</span>
                        <span class="json-select-item-name">戻る</span>
                    `;
                    backItem.onclick = () => this.goBack();
                    listEl.appendChild(backItem);
                }

                // フォルダを表示
                contents.folders.forEach(folderName => {
                    const item = document.createElement('div');
                    item.className = 'json-select-item';
                    item.innerHTML = `
                        <span class="json-select-item-icon">📁</span>
                        <span class="json-select-item-name">${folderName}</span>
                    `;
                    item.onclick = () => this.enterFolder(folderName);
                    listEl.appendChild(item);
                });

                // JSONファイルを表示
                contents.json_files.forEach(filename => {
                    const item = document.createElement('div');
                    item.className = 'json-select-item';
                    item.innerHTML = `
                        <span class="json-select-item-icon">📄</span>
                        <span class="json-select-item-name">${filename}</span>
                    `;
                    item.onclick = () => this.selectFile(filename);
                    listEl.appendChild(item);
                });

                // 何もなければメッセージ表示
                if (contents.folders.length === 0 && contents.json_files.length === 0) {
                    if (this.currentPath !== this.basePath) {
                        const empty = document.createElement('div');
                        empty.className = 'json-select-empty';
                        empty.textContent = 'フォルダが空です';
                        listEl.appendChild(empty);
                    } else {
                        listEl.innerHTML = '<div class="json-select-empty">フォルダが空です</div>';
                    }
                }
            } catch (e) {
                listEl.innerHTML = `<div class="json-select-error">エラー: ${e}</div>`;
            }
        },

        enterFolder: async function(folderName) {
            this.pathHistory.push(this.currentPath);
            this.currentPath = this.currentPath + '/' + folderName;

            try {
                const contents = await invoke('list_folder_contents', { folderPath: this.currentPath });

                // JSONファイルが1つだけあり、サブフォルダがない場合は自動選択
                if (contents.json_files.length === 1 && contents.folders.length === 0) {
                    await this.selectFile(contents.json_files[0]);
                    return;
                }

                await this.loadContents();
            } catch (e) {
                await this.loadContents();
            }
        },

        goBack: function() {
            if (this.pathHistory.length > 0) {
                this.currentPath = this.pathHistory.pop();
                this.loadContents();
            }
        },

        selectFile: async function(filename) {
            const filePath = this.currentPath + '/' + filename;
            console.log('selectFile パス:', filePath);
            try {
                const content = await readTextFile(filePath);
                console.log('読み込み成功');
                const data = JSON.parse(content);

                // 外部コールバックがある場合はそちらを呼ぶ
                if (this.onFileSelected) {
                    this.onFileSelected(filePath, data);
                    return;
                }

                jsonData = data;
                parseJsonData(data, filename);
                this.hide();
            } catch (e) {
                console.error('selectFile エラー:', e);
                $('jsonInfo').textContent = 'エラー: ' + e;
                $('jsonInfo').className = 'json-status error';
                jsonData = null;
                selectionRanges = [];
            }
        },

        browseOther: async function() {
            // ローカルのデスクトップを開く
            let localPath = null;
            if (desktopDir) {
                try {
                    localPath = await desktopDir();
                } catch (e) {
                    console.warn('デスクトップパス取得失敗:', e);
                }
            }
            const selected = await openDialog({
                defaultPath: localPath,
                filters: [{ name: 'JSONファイル', extensions: ['json'] }]
            });
            if (selected) {
                try {
                    const content = await readTextFile(selected);
                    const data = JSON.parse(content);
                    const fileName = selected.split(/[\\\/]/).pop();

                    // 外部コールバックがある場合はそちらを呼ぶ
                    if (this.onFileSelected) {
                        this.onFileSelected(selected, data);
                        return;
                    }

                    jsonData = data;
                    parseJsonData(data, fileName);
                    this.hide();
                } catch (e) {
                    $('jsonInfo').textContent = 'エラー: ' + e;
                    $('jsonInfo').className = 'json-status error';
                    jsonData = null;
                    selectionRanges = [];
                }
            }
        }
    };

    // 検索入力イベント
    $('jsonSearchInput').oninput = (e) => {
        const query = e.target.value;
        $('btnJsonSearchClear').style.display = query ? 'block' : 'none';

        // デバウンス処理
        if (jsonSelectModal.searchTimer) {
            clearTimeout(jsonSelectModal.searchTimer);
        }
        jsonSelectModal.searchTimer = setTimeout(() => {
            jsonSelectModal.search(query);
        }, 300);
    };

    $('btnJsonSearchClear').onclick = () => {
        jsonSelectModal.clearSearch();
        jsonSelectModal.loadContents();
    };

    $('btnLoadJson').onclick = () => jsonSelectModal.show();
    $('btnJsonSelectClose').onclick = () => jsonSelectModal.hide();
    $('jsonSelectModal').querySelector('.json-select-backdrop').onclick = () => jsonSelectModal.hide();
    $('btnJsonSelectBrowse').onclick = () => jsonSelectModal.browseOther();

    // 画像プレビューで範囲選択
    const btnLoadPreview = $('btnLoadPreview');
    console.log('[setupEvents] btnLoadPreview要素:', btnLoadPreview);
    if (btnLoadPreview) {
        btnLoadPreview.onclick = async () => {
            console.log('[btnLoadPreview] クリック - targetFiles:', targetFiles.length, 'inputFolder:', inputFolder);
            if (targetFiles.length === 0) {
                await showAlert('ファイルを選択してください', 'warning');
                return;
            }
            // 最初のページから開始
            currentPreviewPageIndex = 0;
            try {
                await loadPreviewImageByIndex(currentPreviewPageIndex);
            } catch (e) {
                console.error('[btnLoadPreview] エラー:', e);
                setStatus('エラー: ' + e.message);
            }
        };
    }

    // クロップモードのページナビゲーション
    $('btnPrevPage').onclick = async () => {
        if (currentPreviewPageIndex > 0) {
            currentPreviewPageIndex--;
            await loadPreviewImageByIndex(currentPreviewPageIndex, true);
        }
    };

    $('btnNextPage').onclick = async () => {
        if (currentPreviewPageIndex < targetFiles.length - 1) {
            currentPreviewPageIndex++;
            await loadPreviewImageByIndex(currentPreviewPageIndex, true);
        }
    };

    // ラベル選択変更
    $('labelSelect').onchange = () => {
        const index = parseInt($('labelSelect').value);
        if (selectionRanges[index]) {
            applySelectionRange(selectionRanges[index]);
        }
    };

    // タチキリ設定表示切替（ドロップダウン）
    $('tachikiriSelect').onchange = updateTachikiriSettings;

    // 色選択変更時のプレビュー更新
    $('strokeColor').onchange = () => {
        $('strokeColorPreview').style.background = COLOR_MAP[$('strokeColor').value];
        updateSpreadPreview();
        updateSinglePreview();
        updateJpegPreview();
    };
    $('fillColor').onchange = () => {
        $('fillColorPreview').style.background = COLOR_MAP[$('fillColor').value];
        updateSpreadPreview();
        updateSinglePreview();
        updateJpegPreview();
    };

    // 不透明度スライダー変更時の表示更新
    $('fillOpacity').oninput = () => {
        $('fillOpacityValue').textContent = $('fillOpacity').value + '%';
    };

    // メイン画面のクロップ入力欄変更時のステータス更新
    ['cropLeft', 'cropTop', 'cropRight', 'cropBottom'].forEach(id => {
        const el = $(id);
        if (el) el.oninput = updateCropRangeStatus;
    });

    // リサイズ設定表示切替（ドロップダウン）
    $('resizeSelect').onchange = () => {
        $('percentSettings').style.display =
            $('resizeSelect').value === 'percent' ? 'flex' : 'none';
    };

    // ノンブル設定表示切替（旧UIは削除済み、各パネルで個別管理）

    // 実行
    $('btnExecute').onclick = execute;

    // モーダル
    $('btnOpenFolder').onclick = async () => {
        if (outputFolder && invoke) {
            try {
                // Rustのコマンドで直接フォルダを開く（より確実）
                await invoke('open_folder', { path: outputFolder });
            } catch (e) {
                console.error('フォルダを開けませんでした:', e);
                // フォールバック: shell.open を試す
                try {
                    if (openPath) {
                        await openPath(outputFolder);
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
    listen('progress', (event) => {
        updateProgress(event.payload);
    });

    // 画像選択モードのボタン
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
        // ESCキーで画像選択モードを閉じる
        if (e.key === 'Escape' && cropModeOpen) {
            closeCropMode(false);
        }

        // 画像選択モード中のUndo/Redo
        if (cropModeOpen) {
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

            // スペースキー: パンモード（押し続けている間もpreventDefault）
            if (e.key === ' ') {
                e.preventDefault();
                if (!isSpacePressed) {
                    isSpacePressed = true;
                    const container = $('cropPreviewContainerFull');
                    if (container && currentZoom > 1) {
                        container.style.cursor = 'grab';
                    }
                }
            }

            // 矢印キー: 選択範囲を10pxずつ移動
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                const left = parseInt($('cropLeftFull').value) || 0;
                const top = parseInt($('cropTopFull').value) || 0;
                const right = parseInt($('cropRightFull').value) || 0;
                const bottom = parseInt($('cropBottomFull').value) || 0;

                // 選択範囲が存在する場合のみ
                if (left !== 0 || top !== 0 || right !== 0 || bottom !== 0) {
                    e.preventDefault();

                    const step = 10;
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
                    if (newRight > previewImageSize.width) {
                        const shift = newRight - previewImageSize.width;
                        newRight = previewImageSize.width;
                        newLeft -= shift;
                    }
                    if (newBottom > previewImageSize.height) {
                        const shift = newBottom - previewImageSize.height;
                        newBottom = previewImageSize.height;
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
        }
    });

    // keyupイベント
    document.addEventListener('keyup', (e) => {
        if (cropModeOpen) {
            // スペースキー: パンモード終了
            if (e.key === ' ') {
                e.preventDefault();
                isSpacePressed = false;
                isPanning = false;
                const container = $('cropPreviewContainerFull');
                if (container) {
                    container.style.cursor = 'crosshair';
                }
            }
        }
    });

    // ガイド機能
    $('btnClearGuides').onclick = () => {
        if (guides.length > 0) {
            saveToHistory();  // Undo用に現在の状態を保存
        }
        guides = [];
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
        guides = [];
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
        jsonSelectModal.show();
        // JSON読み込み後はparseJsonData内でupdateCropModeLabelSelectが呼ばれる
    };

    // クロップモード内のラベル選択変更
    $('labelSelectInCrop').onchange = () => {
        const index = parseInt($('labelSelectInCrop').value);
        if (selectionRanges[index]) {
            applySelectionRangeInCropMode(selectionRanges[index]);
        }
    };

    // ===== JSON新規登録モーダル =====
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

    // ===== 機能アンロックモーダル =====
    $('btnFeatureLock').onclick = () => showFeatureUnlockModal();
    $('btnFeatureUnlockClose').onclick = () => hideFeatureUnlockModal();
    $('featureUnlockModal').querySelector('.feature-unlock-backdrop').onclick = () => hideFeatureUnlockModal();
    $('btnUnlock').onclick = () => attemptUnlock();
    $('unlockPassword').onkeydown = (e) => {
        if (e.key === 'Enter') attemptUnlock();
    };
    $('btnLockAgain').onclick = () => lockFeature();

    // ===== アップデートチェック =====
    $('btnCheckUpdate').onclick = () => checkForUpdate();

    // 起動時の状態反映
    updateLockIcon();
    updateJsonRegisterButtonVisibility();

    // 起動時の自動アップデートチェック
    checkForUpdateOnStartup();
}

/**
 * 出力形式カードの初期化（複数選択対応）
 */
function setupPresetCards() {
    const cards = document.querySelectorAll('.output-type-card');

    // カードクリックイベント（トグル選択）
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;

            // 選択状態をトグル
            card.classList.toggle('selected');

            // 状態を更新
            if (type === 'spread-pdf') {
                selectedOutputs.spreadPdf = card.classList.contains('selected');
            } else if (type === 'single-pdf') {
                selectedOutputs.singlePdf = card.classList.contains('selected');
            } else if (type === 'jpeg') {
                selectedOutputs.jpeg = card.classList.contains('selected');
            }

            // パネル表示を更新
            updateOutputPanels();

            // 実行ボタンの状態を更新
            updateExecuteBtn();
        });
    });

    // 見開きPDF設定のイベント
    setupSpreadPdfEvents();

    // 単ページPDF設定のイベント
    setupSinglePdfEvents();

    // JPEG設定のイベント
    setupJpegEvents();

    // 初期状態のパネル表示
    updateOutputPanels();

    // 初期状態のプレビュー更新
    updateSpreadPreview();
    updateSinglePreview();
    updateJpegPreview();
}

/**
 * 出力形式パネルの表示/非表示を更新
 */
function updateOutputPanels() {
    const spreadPanel = $('spreadPdfPanel');
    const singlePanel = $('singlePdfPanel');
    const jpegPanel = $('jpegPanel');

    if (spreadPanel) {
        spreadPanel.style.display = selectedOutputs.spreadPdf ? 'block' : 'none';
    }
    if (singlePanel) {
        singlePanel.style.display = selectedOutputs.singlePdf ? 'block' : 'none';
    }
    if (jpegPanel) {
        jpegPanel.style.display = selectedOutputs.jpeg ? 'block' : 'none';
    }

    // JPEGパネル内のノンブル設定表示を更新
    updateJpegNombreSectionVisibility();

    // プレビューを更新
    updateJpegPreview();
}

/**
 * 見開きPDF設定のイベント初期化
 */
function setupSpreadPdfEvents() {
    // ノド有効/無効トグル
    const gutterEnabled = $('spreadGutterEnabled');
    const gutterSliderArea = $('spreadGutterSliderArea');
    if (gutterEnabled && gutterSliderArea) {
        gutterEnabled.addEventListener('change', () => {
            gutterSliderArea.classList.toggle('disabled', !gutterEnabled.checked);
            updateSpreadPreview();
        });
    }

    // 余白有効/無効トグル
    const paddingEnabled = $('spreadPaddingEnabled');
    const paddingSliderArea = $('spreadPaddingSliderArea');
    if (paddingEnabled && paddingSliderArea) {
        paddingEnabled.addEventListener('change', () => {
            paddingSliderArea.classList.toggle('disabled', !paddingEnabled.checked);
            updateSpreadPreview();
            // ノンブルヒントを更新
            updateSpreadNombreHint();
        });
    }

    // ノドスライダー
    const gutterSlider = $('spreadGutterSlider');
    if (gutterSlider) {
        gutterSlider.addEventListener('input', () => {
            $('spreadGutterValue').textContent = gutterSlider.value;
            updateSpreadPreview();
        });
    }

    // 余白スライダー
    const paddingSlider = $('spreadPaddingSlider');
    if (paddingSlider) {
        paddingSlider.addEventListener('input', () => {
            $('spreadPaddingValue').textContent = paddingSlider.value;
            updateSpreadPreview();
        });
    }

    // 先頭白紙追加チェック
    const whitePage = $('spreadWhitePage');
    if (whitePage) {
        whitePage.addEventListener('change', () => {
            updateSpreadPreview();
        });
    }

    // 作品情報印字チェック
    const workInfo = $('spreadWorkInfo');
    if (workInfo) {
        workInfo.addEventListener('change', () => {
            updateSpreadPreview();
        });
    }

    // ノンブル追加チェック
    const addNombre = $('spreadAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('spreadNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            updateSpreadPreview();
            // 他のパネルのノンブル設定も同期
            syncNombreSettings('spread');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('spreadNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            updateSpreadPreview();
            updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('spread');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('spreadNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('spread');
        });
    }

    // 初期状態でノンブルヒントを設定
    updateSpreadNombreHint();
}

/**
 * 単ページPDF設定のイベント初期化
 */
function setupSinglePdfEvents() {
    // ノンブル追加チェック
    const addNombre = $('singleAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('singleNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            updateSinglePreview();
            // 他のパネルのノンブル設定も同期
            syncNombreSettings('single');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('singleNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            updateSinglePreview();
            updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('single');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('singleNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('single');
        });
    }
}

/**
 * 単ページPDFプレビューを更新
 */
function updateSinglePreview() {
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
 * 見開きPDFのノンブルヒントを更新
 */
function updateSpreadNombreHint() {
    const hint = $('spreadNombreHint');
    if (!hint) return;

    const paddingEnabled = $('spreadPaddingEnabled')?.checked ?? true;
    if (paddingEnabled) {
        hint.textContent = '※ 余白有効時はPDF余白に追加';
    } else {
        hint.textContent = '※ 余白無効時は画像に追加（タチキリ領域内）';
    }
}

/**
 * ノンブル設定を他のパネルと同期
 */
function syncNombreSettings(source) {
    const spreadCheck = $('spreadAddNombre');
    const singleCheck = $('singleAddNombre');
    const jpegCheck = $('jpegAddNombre');

    let isChecked = false;
    let startValue = '1';
    let sizeValue = 'medium';

    // ソースから値を取得
    if (source === 'spread' && spreadCheck) {
        isChecked = spreadCheck.checked;
        startValue = $('spreadNombreStart')?.value || '1';
        sizeValue = $('spreadNombreSize')?.value || 'medium';
    } else if (source === 'single' && singleCheck) {
        isChecked = singleCheck.checked;
        startValue = $('singleNombreStart')?.value || '1';
        sizeValue = $('singleNombreSize')?.value || 'medium';
    } else if (source === 'jpeg' && jpegCheck) {
        isChecked = jpegCheck.checked;
        startValue = $('jpegNombreStart')?.value || '1';
        sizeValue = $('jpegNombreSize')?.value || 'medium';
    }

    // 他のパネルに同期
    if (source !== 'spread' && spreadCheck) {
        spreadCheck.checked = isChecked;
        if ($('spreadNombreStart')) $('spreadNombreStart').value = startValue;
        if ($('spreadNombreSize')) $('spreadNombreSize').value = sizeValue;
        if ($('spreadNombreSettings')) {
            $('spreadNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'single' && singleCheck) {
        singleCheck.checked = isChecked;
        if ($('singleNombreStart')) $('singleNombreStart').value = startValue;
        if ($('singleNombreSize')) $('singleNombreSize').value = sizeValue;
        if ($('singleNombreSettings')) {
            $('singleNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }
    if (source !== 'jpeg' && jpegCheck) {
        jpegCheck.checked = isChecked;
        if ($('jpegNombreStart')) $('jpegNombreStart').value = startValue;
        if ($('jpegNombreSize')) $('jpegNombreSize').value = sizeValue;
        if ($('jpegNombreSettings')) {
            $('jpegNombreSettings').style.display = isChecked ? 'flex' : 'none';
        }
    }

    // 各プレビューを更新
    updateSpreadPreview();
    updateSinglePreview();
    updateJpegPreview();
}

/**
 * JPEG設定のイベント初期化
 */
function setupJpegEvents() {
    // ノンブル追加チェックボックス
    const addNombre = $('jpegAddNombre');
    if (addNombre) {
        addNombre.addEventListener('change', () => {
            const settings = $('jpegNombreSettings');
            if (settings) {
                settings.style.display = addNombre.checked ? 'flex' : 'none';
            }
            updateJpegPreview();
            // 他のパネルにも同期
            syncNombreSettings('jpeg');
        });
    }

    // ノンブル開始番号
    const nombreStart = $('jpegNombreStart');
    if (nombreStart) {
        nombreStart.addEventListener('input', () => {
            updateJpegPreview();
            syncNombreSettings('jpeg');
        });
    }

    // ノンブルサイズ
    const nombreSize = $('jpegNombreSize');
    if (nombreSize) {
        nombreSize.addEventListener('change', () => {
            syncNombreSettings('jpeg');
        });
    }
}

/**
 * 見開きPDFプレビューを更新
 */
function updateSpreadPreview() {
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
 * 範囲選択ステータスを更新
 * タチキリ処理が有効な場合、範囲が設定されているかどうかを視覚的に表示
 */
function updateCropRangeStatus() {
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
        statusEl.textContent = '✓ 設定済';
    } else {
        statusEl.className = 'crop-range-status warning';
        statusEl.textContent = '⚠ 未設定';
    }
}

/**
 * JPEGプレビューを更新（ノンブル＋タチキリ表示）
 */
function updateJpegPreview() {
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
    const hasPdf = selectedOutputs.spreadPdf || selectedOutputs.singlePdf;
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

/**
 * JPEGパネル内のノンブル設定セクションの表示/非表示を更新
 * PDFが選択されている場合は「PDF設定と共通」メッセージを表示
 * JPEG単独の場合は独自のノンブル設定を表示
 */
function updateJpegNombreSectionVisibility() {
    const jpegNombreSection = $('jpegNombreSection');
    const jpegPdfSyncNote = $('jpegPdfSyncNote');

    if (!jpegNombreSection || !jpegPdfSyncNote) return;

    const hasPdf = selectedOutputs.spreadPdf || selectedOutputs.singlePdf;

    if (hasPdf) {
        // PDFが選択されている場合、ノンブル設定は非表示にし、同期メッセージを表示
        jpegNombreSection.style.display = 'none';
        jpegPdfSyncNote.style.display = 'block';
    } else {
        // JPEG単独の場合、独自のノンブル設定を表示
        jpegNombreSection.style.display = 'flex';
        jpegPdfSyncNote.style.display = 'none';
    }
}

/**
 * 互換性のため残す（旧関数名）
 */
function updateJpegOptionsAvailability() {
    updateJpegNombreSectionVisibility();
}

/**
 * タチキリカードの初期化
 */
function setupTachikiriCards() {
    const cards = document.querySelectorAll('.tachikiri-card-sm');
    const select = $('tachikiriSelect');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            // 選択状態を更新
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            // 隠しセレクトの値を更新
            const value = card.dataset.value;
            select.value = value;

            // 既存の設定更新処理を呼び出し
            updateTachikiriSettings();
        });
    });
}

/**
 * ローディングオーバーレイを表示（カウントダウン形式）
 */
let loadingTimerInterval = null;
let loadingRemainingTime = 0;

/**
 * ファイルサイズと拡張子から推定読み込み時間を取得（秒）
 * 実際の処理時間に基づいた計算
 */
async function getEstimatedLoadTime(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();

    // ファイルサイズを取得（MB単位）
    let fileSizeMB = 10; // デフォルト（取得失敗時）
    try {
        if (statFile) {
            const stat = await statFile(filePath);
            fileSizeMB = stat.size / (1024 * 1024);
        }
    } catch (e) {
        console.warn('ファイルサイズ取得失敗:', e);
    }

    // ファイル形式ごとの処理速度係数（秒/MB）
    // 実測値に基づいて調整（4倍補正済み）
    let secondsPerMB;
    switch (ext) {
        case 'psd':
            secondsPerMB = 0.6;   // PSD: 100MBで約60秒
            break;
        case 'psb':
            secondsPerMB = 0.5;   // PSB: 100MBで約50秒
            break;
        case 'tif':
        case 'tiff':
            secondsPerMB = 0.32;  // TIFF: 100MBで約32秒
            break;
        case 'png':
            secondsPerMB = 0.2;   // PNG: 100MBで約20秒
            break;
        default:
            secondsPerMB = 0.08;  // JPEG等: 100MBで約8秒
    }

    // 推定時間を計算（最低1秒、最大120秒）
    const estimatedSeconds = Math.max(1, Math.min(120, Math.ceil(fileSizeMB * secondsPerMB)));

    console.log(`推定読み込み時間: ${filePath} (${fileSizeMB.toFixed(1)}MB, ${ext}) → ${estimatedSeconds}秒`);

    return estimatedSeconds;
}

async function showLoadingOverlay(filePath) {
    const overlay = $('imageLoadingOverlay');
    const remainingEl = $('loadingRemaining');
    const prefixEl = $('loadingTimePrefix');
    const suffixEl = $('loadingTimeSuffix');
    const hintEl = $('loadingHint');

    // オーバーレイを先に表示（ファイルサイズ取得中）
    overlay.style.display = 'flex';
    prefixEl.textContent = '';
    remainingEl.textContent = '計算中';
    suffixEl.textContent = '';
    hintEl.textContent = 'ファイル情報を取得中...';

    // 推定時間を取得（ファイルサイズから計算）
    loadingRemainingTime = await getEstimatedLoadTime(filePath);

    // 表示を更新
    prefixEl.textContent = '残り約';
    remainingEl.textContent = loadingRemainingTime;
    suffixEl.textContent = '秒';

    // ファイル形式に応じたヒント
    const ext = filePath.split('.').pop().toLowerCase();
    if (ext === 'psd' || ext === 'psb') {
        hintEl.textContent = 'PSD/PSBファイルの読み込みには時間がかかる場合があります';
    } else if (ext === 'tif' || ext === 'tiff') {
        hintEl.textContent = 'TIFFファイルを処理中です';
    } else {
        hintEl.textContent = '画像を処理中です';
    }

    // 1秒ごとにカウントダウン
    loadingTimerInterval = setInterval(() => {
        loadingRemainingTime--;

        if (loadingRemainingTime > 0) {
            remainingEl.textContent = loadingRemainingTime;
        } else if (loadingRemainingTime === 0) {
            remainingEl.textContent = '0';
        } else {
            // 0秒を過ぎても終わらない場合
            prefixEl.textContent = '';
            remainingEl.textContent = 'あともうちょっと';
            suffixEl.textContent = '';
            hintEl.textContent = '大きなファイルの処理中です...';
        }
    }, 1000);
}

function hideLoadingOverlay() {
    const overlay = $('imageLoadingOverlay');
    overlay.style.display = 'none';

    if (loadingTimerInterval) {
        clearInterval(loadingTimerInterval);
        loadingTimerInterval = null;
    }
}

/**
 * ページインデックスからプレビュー画像を読み込む
 * @param {number} pageIndex - 表示するページのインデックス
 * @param {boolean} keepOpen - trueの場合、既に開いているクロップモードを維持
 */
async function loadPreviewImageByIndex(pageIndex, keepOpen = false) {
    if (targetFiles.length === 0) return;
    if (pageIndex < 0 || pageIndex >= targetFiles.length) return;

    const fullPath = inputFolder + '\\' + targetFiles[pageIndex];
    await loadPreviewImage(fullPath, keepOpen);

    // ページ情報を更新
    updateCropPageNav();
}

/**
 * クロップモードのページナビゲーションを更新
 */
function updateCropPageNav() {
    const pageInfo = $('cropPageInfo');
    const btnPrev = $('btnPrevPage');
    const btnNext = $('btnNextPage');

    if (pageInfo) {
        pageInfo.textContent = `${currentPreviewPageIndex + 1} / ${targetFiles.length}`;
    }
    if (btnPrev) {
        btnPrev.disabled = currentPreviewPageIndex <= 0;
    }
    if (btnNext) {
        btnNext.disabled = currentPreviewPageIndex >= targetFiles.length - 1;
    }
}

/**
 * プレビュー画像を読み込む（画像選択モードを開く）
 * 高速化版：ファイルシステム経由転送 + 非同期処理
 * @param {boolean} keepOpen - trueの場合、既存のモードを維持して画像のみ差し替え
 */
async function loadPreviewImage(filePath, keepOpen = false) {
    console.log('[loadPreviewImage] 開始 - filePath:', filePath, 'keepOpen:', keepOpen);

    // invoke が未初期化の場合はエラー
    if (!invoke) {
        console.error('[loadPreviewImage] invoke関数が未初期化です');
        setStatus('エラー: Tauri APIが初期化されていません');
        return;
    }

    try {
        $('btnLoadPreview').disabled = true;

        // 高速化版：ファイルシステム経由で画像を取得
        // maxSize: 1200でトンボが見える解像度を維持しつつ処理時間を短縮
        console.log('[loadPreviewImage] invoke呼び出し前');
        const previewInfo = await invoke('get_image_preview_as_file', {
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
        const assetUrl = convertFileSrc(previewInfo.file_path);
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
            openCropMode(imageData);
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
function updateCropModeImage(imageData) {
    const previewImg = $('cropPreviewImgFull');

    // 画像サイズを更新
    previewImageSize.width = imageData.width;
    previewImageSize.height = imageData.height;

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
        $('cropModeDocSize').textContent = `画像サイズ: ${previewImageSize.width} × ${previewImageSize.height} px`;
        $('docSizeInfo').textContent = `(${previewImageSize.width} × ${previewImageSize.height})`;

        // 定規を再描画
        drawRulers();

        // ガイドを再描画（既存のガイドを維持）
        renderGuides();

        // 選択範囲のプレビューを更新
        updateFillStrokePreview();

        // ページナビゲーションを更新
        updateCropPageNav();

        setStatus(`ページ ${currentPreviewPageIndex + 1} を表示中`);
    };
}

/**
 * 画像選択モードを開く
 */
function openCropMode(imageData) {
    const overlay = $('cropModeOverlay');
    const previewImg = $('cropPreviewImgFull');
    const container = $('cropPreviewContainerFull');
    const selection = $('cropSelectionFull');

    // 現在の値を保存（キャンセル時に戻す）
    savedCropValues = {
        left: parseInt($('cropLeft').value) || 0,
        top: parseInt($('cropTop').value) || 0,
        right: parseInt($('cropRight').value) || 0,
        bottom: parseInt($('cropBottom').value) || 0
    };

    // 画像サイズを設定
    previewImageSize.width = imageData.width;
    previewImageSize.height = imageData.height;

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
        $('cropModeDocSize').textContent = `画像サイズ: ${previewImageSize.width} × ${previewImageSize.height} px`;
        $('docSizeInfo').textContent = `(${previewImageSize.width} × ${previewImageSize.height})`;

        // 現在の値をオーバーレイ側に反映
        $('cropLeftFull').value = savedCropValues.left;
        $('cropTopFull').value = savedCropValues.top;
        $('cropRightFull').value = savedCropValues.right;
        $('cropBottomFull').value = savedCropValues.bottom;

        // 色設定を同期
        syncColorSettingsToOverlay();

        // 選択範囲をリセット
        selection.style.display = 'none';

        // 塗り・ストロークプレビューをリセット
        clearFillStrokePreview();

        // ガイドをリセット
        guides = [];
        guideMode = null;
        rulerDragging = null;
        renderGuides();
        updateGuideList();

        // Undo/Redo履歴をクリア
        clearHistory();

        // ズームとパン状態をリセット
        currentZoom = 1.0;
        baseContainerSize = { width: 0, height: 0 };  // 基準サイズもリセット
        lastMousePos = { x: 0, y: 0 };
        isSpacePressed = false;
        isPanning = false;
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
        cropModeOpen = true;

        // JSON新規登録ボタンの表示状態を更新（アンロック状態に応じて）
        updateJsonRegisterButtonVisibility();

        // 数値入力欄の有効/無効を更新（アンロック時は比率固定のため無効化）
        updateCropInputsDisabledState();

        // ページナビゲーションを更新
        updateCropPageNav();

        // UI改修: ステップインジケーター初期化
        cropModeStep = 'select';
        updateCropModeStep('select');

        // UI改修: ヒントを初期化
        updateCropModeHint();

        // UI改修: 適用ボタンの状態を更新
        updateApplyButtonState();

        // UI改修: ガイドボタンのハイライトを更新
        updateGuideButtonHighlight();

        // UI改修: 初回表示時は定規にパルスアニメーション
        if (isFirstCropModeOpen) {
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
            isFirstCropModeOpen = false;
        }

        // JSON読み込み済みの場合、ラベル選択を表示
        updateCropModeLabelSelect();

        setStatus('ドラッグで範囲を選択してください');
    };
}

/**
 * 画像選択モードを閉じる
 */
function closeCropMode(apply) {
    const overlay = $('cropModeOverlay');

    if (apply) {
        // ステップを「適用」に進める
        updateCropModeStep('apply');

        // ☑マークのアニメーションを表示
        showApplySuccessAnimation(() => {
            // アニメーション完了後に実際の処理を実行
            finalizeCropMode(overlay, true);
        });
    } else {
        // キャンセル: 保存した値に戻す
        $('cropLeft').value = savedCropValues.left;
        $('cropTop').value = savedCropValues.top;
        $('cropRight').value = savedCropValues.right;
        $('cropBottom').value = savedCropValues.bottom;

        setStatus('範囲選択をキャンセルしました');

        // 範囲選択ステータスを更新
        updateCropRangeStatus();

        // プレビューをクリア
        clearFillStrokePreview();

        overlay.style.display = 'none';
        cropModeOpen = false;

        // UI改修: ステップをリセット
        cropModeStep = 'select';
    }
}

/**
 * 適用成功アニメーションを表示
 */
function showApplySuccessAnimation(callback) {
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
function finalizeCropMode(overlay, apply) {
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
    updateCropRangeStatus();

    // プレビューをクリア
    clearFillStrokePreview();

    overlay.style.display = 'none';
    cropModeOpen = false;

    // UI改修: ステップをリセット
    cropModeStep = 'select';
}

// ========================================
// UI改修: クロップモードUI改善ヘルパー関数
// ========================================

/**
 * ステップインジケーターを更新
 * @param {string} step - 'select' | 'confirm' | 'apply'
 */
function updateCropModeStep(step) {
    cropModeStep = step;
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

/**
 * クロップモードのヒントを状態に応じて更新
 */
function updateCropModeHint() {
    const hint = $('cropModeHint');
    if (!hint) return;

    const hasSelection = hasValidCropSelection();
    const guideCount = guides.length;

    let message = '';
    let highlight = false;

    if (hasSelection) {
        message = '✓ 範囲OK！「適用」を押して完了';
        highlight = true;
        // 範囲が設定されたらステップを「確認」に進める
        if (cropModeStep === 'select') {
            updateCropModeStep('confirm');
        }
    } else if (guideCount === 0) {
        message = '下のボタンで操作方法を確認できます';
    } else if (guideCount < 4) {
        const remaining = 4 - guideCount;
        message = `あと${remaining}本ガイドを引いてください（計4本必要）`;
    } else if (guideCount >= 4) {
        if (isFeatureUnlocked()) {
            // 機能解除時はドラッグで範囲を決定
            message = '✓ ガイドを目安にドラッグで範囲を決定';
        } else {
            message = '✓「ガイドから範囲を設定」をクリック';
        }
        highlight = true;
    }

    hint.textContent = message;
    hint.classList.toggle('highlight', highlight);
}

/**
 * ヒントを一時的に変更（アニメーション用）
 */
function showTemporaryHint(message, duration = 2000) {
    const hint = $('cropModeHint');
    if (!hint) return;

    hint.textContent = message;
    hint.classList.remove('highlight');

    // 指定時間後に通常のヒントに戻す
    setTimeout(() => {
        updateCropModeHint();
    }, duration);
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

/**
 * 適用ボタンの状態を更新
 */
function updateApplyButtonState() {
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
function updateGuideButtonHighlight() {
    const btn = $('btnApplyGuides');
    if (!btn) return;

    const guideCount = guides.length;

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

/**
 * ドラッグヒントアニメーションを表示
 * 左上から右下に選択範囲を引くアニメーション
 */
function showDragHintAnimation() {
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
function showRulerHighlightAnimation() {
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

/**
 * 定規ホバー時のヒント表示
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
    updateCropModeHint();
}

/**
 * クロップモード内のラベル選択を更新
 */
function updateCropModeLabelSelect() {
    console.log('updateCropModeLabelSelect called, selectionRanges:', selectionRanges.length);
    const selectArea = $('cropModeLabelSelect');
    const select = $('labelSelectInCrop');
    if (!selectArea || !select) {
        console.log('updateCropModeLabelSelect: elements not found');
        return;
    }

    if (selectionRanges.length > 0) {
        // ラベル選択を表示・更新
        select.innerHTML = '';
        selectionRanges.forEach((range, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = range.label || `範囲 ${index + 1}`;
            select.appendChild(option);
        });
        selectArea.style.display = 'block';
        console.log('updateCropModeLabelSelect: select displayed');

        // 最初の範囲を自動適用
        if (selectionRanges[0]) {
            applySelectionRangeInCropMode(selectionRanges[0]);
        }
    } else {
        selectArea.style.display = 'none';
        console.log('updateCropModeLabelSelect: no ranges, hidden');
    }
}

/**
 * クロップモード内で範囲選択を適用（ビジュアル表示付き）
 */
function applySelectionRangeInCropMode(range) {
    console.log('applySelectionRangeInCropMode called:', range);
    selectedRange = range;

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

/**
 * 選択範囲をビジュアルで表示
 */
function updateSelectionVisual() {
    const img = $('cropPreviewImgFull');
    const selection = $('cropSelectionFull');
    if (!img || !selection) {
        console.log('updateSelectionVisual: img or selection not found');
        return;
    }

    // 画像が読み込まれていない場合はスキップ
    if (!previewImageSize.width || !previewImageSize.height) {
        console.log('updateSelectionVisual: previewImageSize not set', previewImageSize);
        return;
    }

    const bounds = getActualImageBounds(img);
    if (!bounds || !bounds.displayWidth || !bounds.displayHeight) {
        console.log('updateSelectionVisual: bounds invalid', bounds);
        return;
    }

    // 画像座標から表示座標へのスケール
    const scaleX = bounds.displayWidth / previewImageSize.width;
    const scaleY = bounds.displayHeight / previewImageSize.height;

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
        floatingClearBtn.style.display = (hasSelection || guides.length > 0) ? 'flex' : 'none';
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

/**
 * プレビューをズーム（倍率を乗算）- マウス位置を中心にズーム
 * @param {number} factor - 乗算する倍率（1.25で拡大、0.8で縮小）
 */
function zoomPreview(factor) {
    const container = $('cropPreviewContainerFull');
    const zoomWrapper = $('zoomWrapper');
    if (!container || !zoomWrapper) return;

    const oldZoom = currentZoom;

    // 新しいズーム倍率を計算（0.5〜8倍の範囲で制限）
    const newZoom = Math.max(0.5, Math.min(8, currentZoom * factor));
    if (newZoom === currentZoom) return;

    // マウス位置をコンテンツ座標に変換（スクロール込み）
    const mouseContentX = container.scrollLeft + lastMousePos.x;
    const mouseContentY = container.scrollTop + lastMousePos.y;

    currentZoom = newZoom;
    applyZoom();

    // マウス位置を中心にスクロール位置を調整
    const ratio = currentZoom / oldZoom;
    const newScrollX = mouseContentX * ratio - lastMousePos.x;
    const newScrollY = mouseContentY * ratio - lastMousePos.y;
    container.scrollLeft = Math.max(0, newScrollX);
    container.scrollTop = Math.max(0, newScrollY);
}

/**
 * ズームをリセット（フィット表示に戻す）
 */
function resetZoom() {
    currentZoom = 1.0;
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
function applyZoom() {
    const container = $('cropPreviewContainerFull');
    const zoomWrapper = $('zoomWrapper');
    const img = $('cropPreviewImgFull');
    if (!container || !zoomWrapper || !img) return;

    // 基準サイズが未設定なら現在のコンテナサイズを保存
    if (baseContainerSize.width === 0) {
        baseContainerSize.width = container.clientWidth;
        baseContainerSize.height = container.clientHeight;
    }

    if (currentZoom > 1) {
        // 画像のアスペクト比を維持しながらズーム
        const imageAspect = previewImageSize.width / previewImageSize.height;
        const containerAspect = baseContainerSize.width / baseContainerSize.height;

        let baseDisplayWidth, baseDisplayHeight;
        if (imageAspect > containerAspect) {
            // 横長画像: 幅に合わせる
            baseDisplayWidth = baseContainerSize.width;
            baseDisplayHeight = baseContainerSize.width / imageAspect;
        } else {
            // 縦長画像: 高さに合わせる
            baseDisplayHeight = baseContainerSize.height;
            baseDisplayWidth = baseContainerSize.height * imageAspect;
        }

        // ズーム適用後のサイズ
        const zoomedWidth = baseDisplayWidth * currentZoom;
        const zoomedHeight = baseDisplayHeight * currentZoom;

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
    const zoomPercent = Math.round(currentZoom * 100);
    setStatus(`ズーム: ${zoomPercent}%（Ctrl+0でリセット）`);
}

/**
 * 入力欄の値から選択範囲の表示を更新
 */
function updateSelectionDisplay() {
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
    const scaleX = bounds.displayWidth / previewImageSize.width;
    const scaleY = bounds.displayHeight / previewImageSize.height;

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

/**
 * 色設定をオーバーレイに同期
 */
function syncColorSettingsToOverlay() {
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

/**
 * object-fit: contain で表示されている画像の実際の表示サイズとオフセットを計算
 * @returns { displayWidth, displayHeight, offsetX, offsetY }
 */
function getActualImageBounds(img) {
    const containerWidth = img.offsetWidth;
    const containerHeight = img.offsetHeight;
    const imageAspect = previewImageSize.width / previewImageSize.height;
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
 * フルスクリーン用の範囲選択ドラッグイベント
 */
function setupCropDragEventsFull(container) {
    const selection = $('cropSelectionFull');
    const img = $('cropPreviewImgFull');

    container.onmousedown = (e) => {
        if (e.button !== 0) return;

        // スペースキーが押されている場合はパン操作
        if (isSpacePressed && currentZoom > 1) {
            isPanning = true;
            panStart.x = e.clientX;
            panStart.y = e.clientY;
            panStart.scrollX = container.scrollLeft;
            panStart.scrollY = container.scrollTop;
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

        // Undo用に現在の状態を保存（ドラッグ開始時）
        saveToHistory();

        // ドラッグ開始時に塗りプレビューをクリア（背景画像を見えるように）
        clearFillStrokePreview();

        // 通常の範囲選択開始（オフセットを加味した位置で保存）
        dragStart.x = clickX + bounds.offsetX;
        dragStart.y = clickY + bounds.offsetY;
        isDragging = true;

        selection.style.display = 'block';
        selection.style.left = dragStart.x + 'px';
        selection.style.top = dragStart.y + 'px';
        selection.style.width = '0px';
        selection.style.height = '0px';

        e.preventDefault();
    };

    container.onmousemove = (e) => {
        // マウス位置を常に追跡（ズーム用）
        const containerRect = container.getBoundingClientRect();
        lastMousePos.x = e.clientX - containerRect.left;
        lastMousePos.y = e.clientY - containerRect.top;

        // パン操作中
        if (isPanning) {
            e.preventDefault();
            const dx = e.clientX - panStart.x;
            const dy = e.clientY - panStart.y;
            container.scrollLeft = panStart.scrollX - dx;
            container.scrollTop = panStart.scrollY - dy;
            return;
        }

        if (!isDragging) return;

        const rect = img.getBoundingClientRect();
        const bounds = getActualImageBounds(img);

        // 現在位置を画像の実際の表示領域内の座標に変換
        let currentX = e.clientX - rect.left - bounds.offsetX;
        let currentY = e.clientY - rect.top - bounds.offsetY;

        // 画像範囲内にクランプ
        currentX = Math.max(0, Math.min(currentX, bounds.displayWidth));
        currentY = Math.max(0, Math.min(currentY, bounds.displayHeight));

        // オフセットを加味した表示座標
        let displayCurrentX = currentX + bounds.offsetX;
        let displayCurrentY = currentY + bounds.offsetY;

        let width = Math.abs(displayCurrentX - dragStart.x);
        let height = Math.abs(displayCurrentY - dragStart.y);

        // 機能解除時は640:909の比率を維持（ポインター=右下角に完全固定）
        if (isFeatureUnlocked()) {
            // マウス位置を比率の対角線上に投影して、ポインターが常に右下角になるようにする
            const dx = displayCurrentX - dragStart.x;
            const dy = displayCurrentY - dragStart.y;

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
                const maxWidth = maxX - dragStart.x;
                const maxHeight = maxY - dragStart.y;

                // 幅と高さを制限（比率を維持しながら）
                if (width > maxWidth) {
                    width = maxWidth;
                    height = width / JSON_REGISTER_ASPECT_RATIO;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                    width = height * JSON_REGISTER_ASPECT_RATIO;
                }

                displayCurrentX = dragStart.x + width;
                displayCurrentY = dragStart.y + height;
                currentX = dragStart.x - bounds.offsetX + width;
                currentY = dragStart.y - bounds.offsetY + height;
            } else {
                // 左上方向は枠なし
                width = 0;
                height = 0;
            }

            // 開始点=左上、現在点=右下
            selection.style.left = dragStart.x + 'px';
            selection.style.top = dragStart.y + 'px';
            selection.style.width = width + 'px';
            selection.style.height = height + 'px';

            // 画像座標系で計算
            const imgLeft = dragStart.x - bounds.offsetX;
            const imgTop = dragStart.y - bounds.offsetY;
            const imgRight = imgLeft + width;
            const imgBottom = imgTop + height;

            updateCropInputsFromSelectionFull(imgLeft, imgTop, imgRight, imgBottom, img, bounds);
            return;
        }

        const left = Math.min(dragStart.x, displayCurrentX);
        const top = Math.min(dragStart.y, displayCurrentY);

        selection.style.left = left + 'px';
        selection.style.top = top + 'px';
        selection.style.width = width + 'px';
        selection.style.height = height + 'px';

        // リアルタイムで座標を更新（オーバーレイ側の入力欄）
        // 画像座標系（オフセット除去後）で計算
        const imgLeft = Math.min(dragStart.x - bounds.offsetX, currentX);
        const imgTop = Math.min(dragStart.y - bounds.offsetY, currentY);
        const imgRight = Math.max(dragStart.x - bounds.offsetX, currentX);
        const imgBottom = Math.max(dragStart.y - bounds.offsetY, currentY);

        updateCropInputsFromSelectionFull(imgLeft, imgTop, imgRight, imgBottom, img, bounds);
    };

    container.onmouseup = (e) => {
        // パン操作終了
        if (isPanning) {
            e.preventDefault();
            isPanning = false;
            container.style.cursor = isSpacePressed ? 'grab' : 'crosshair';
            return;
        }

        if (isDragging) {
            isDragging = false;
            // 選択完了後にビジュアルとプレビューを更新
            updateSelectionVisual();
            updateFillStrokePreview();
        }
    };

    container.onmouseleave = () => {
        // パン操作終了
        if (isPanning) {
            isPanning = false;
            container.style.cursor = isSpacePressed ? 'grab' : 'crosshair';
        }

        if (isDragging) {
            isDragging = false;
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
function updateCropInputsFromSelectionFull(left, top, right, bottom, img, bounds) {
    // 表示座標から実際の画像座標に変換
    // bounds.displayWidth/Height は実際に表示されている画像の大きさ
    const scaleX = previewImageSize.width / bounds.displayWidth;
    const scaleY = previewImageSize.height / bounds.displayHeight;

    const realLeft = Math.max(0, Math.round(left * scaleX));
    const realTop = Math.max(0, Math.round(top * scaleY));
    const realRight = Math.min(previewImageSize.width, Math.round(right * scaleX));
    const realBottom = Math.min(previewImageSize.height, Math.round(bottom * scaleY));

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

/**
 * 塗り・ストロークのリアルタイムプレビューを更新
 */
function updateFillStrokePreview() {
    const img = $('cropPreviewImgFull');
    const container = $('cropPreviewContainerFull');
    if (!img || !container) return;

    const tachikiriType = $('tachikiriSelect').value;
    const needsStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);
    const needsFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);

    // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
    const bounds = getActualImageBounds(img);

    // 画像座標から表示座標へのスケール
    const scaleX = bounds.displayWidth / previewImageSize.width;
    const scaleY = bounds.displayHeight / previewImageSize.height;

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
function clearFillStrokePreview() {
    $('fillPreview').style.display = 'none';
    $('strokePreviewTop').style.display = 'none';
    $('strokePreviewBottom').style.display = 'none';
    $('strokePreviewLeft').style.display = 'none';
    $('strokePreviewRight').style.display = 'none';
}

/**
 * 定規を描画（Photoshop風）
 */
function drawRulers() {
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

    const scaleX = previewImageSize.width / imgWidth;
    const scaleY = previewImageSize.height / imgHeight;

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

/**
 * 定規からのドラッグイベントを設定
 */
function setupRulerDragEvents() {
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
        rulerDragging = { type: 'h' };
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
        rulerDragging = { type: 'v' };
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
        if (!rulerDragging || !cropModeOpen) return;

        const img = $('cropPreviewImgFull');
        const container = $('cropPreviewContainerFull');
        if (!img || !container) return;

        const imgRect = img.getBoundingClientRect();
        // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
        const bounds = getActualImageBounds(img);

        if (rulerDragging.type === 'h') {
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
        if (!rulerDragging || !cropModeOpen) return;

        const img = $('cropPreviewImgFull');
        if (!img) {
            rulerDragging = null;
            guidePreview.style.display = 'none';
            return;
        }

        const imgRect = img.getBoundingClientRect();
        // 実際の表示サイズを取得（object-fit: contain対応）
        const bounds = getActualImageBounds(img);
        const scaleX = previewImageSize.width / bounds.displayWidth;
        const scaleY = previewImageSize.height / bounds.displayHeight;

        if (rulerDragging.type === 'h') {
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

        rulerDragging = null;
        guidePreview.style.display = 'none';
    });
}

/**
 * ガイド線を描画
 */
function renderGuides() {
    const container = $('guideLinesContainer');
    const img = $('cropPreviewImgFull');
    const previewContainer = $('cropPreviewContainerFull');
    if (!container || !img || !previewContainer) return;

    container.innerHTML = '';

    // 実際の表示サイズとオフセットを取得（object-fit: contain対応）
    const bounds = getActualImageBounds(img);
    const scaleX = bounds.displayWidth / previewImageSize.width;
    const scaleY = bounds.displayHeight / previewImageSize.height;

    guides.forEach((guide, index) => {
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

/**
 * ガイドリストUIを更新
 */
function updateGuideList() {
    const list = $('guideList');
    if (!list) return;

    list.innerHTML = '';

    guides.forEach((guide, index) => {
        const item = document.createElement('div');
        item.className = 'guide-item';

        const info = document.createElement('span');
        info.className = 'guide-item-info';
        info.innerHTML = `<span class="guide-item-type">${guide.type === 'h' ? '─' : '│'}</span> ${Math.round(guide.position)} px`;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'guide-item-delete';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = () => removeGuide(index);

        item.appendChild(info);
        item.appendChild(deleteBtn);
        list.appendChild(item);
    });

    // ガイドセクションの表示切り替え
    const guideSection = $('guideSectionPanel');
    const guideCountEl = $('guideCount');
    if (guideSection) {
        guideSection.style.display = guides.length > 0 ? 'block' : 'none';
    }
    if (guideCountEl) {
        guideCountEl.textContent = guides.length;
    }

    // ガイドボタンの表示切り替え（4本以上で表示、ただし機能解除時は非表示）
    const hasEnoughGuides = guides.length >= 4;
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
        floatingClearBtn.style.display = (hasSelection || guides.length > 0) ? 'flex' : 'none';
    }
}

/**
 * ガイドを追加
 */
function addGuide(type, position) {
    saveToHistory();  // Undo用に現在の状態を保存
    guides.push({ type, position });
    renderGuides();
    updateGuideList();
    // UI改修: ヒントとガイドボタンを更新
    updateCropModeHint();
    updateGuideButtonHighlight();
}

/**
 * ガイドを削除
 */
function removeGuide(index) {
    saveToHistory();  // Undo用に現在の状態を保存
    guides.splice(index, 1);
    renderGuides();
    updateGuideList();
    // UI改修: ヒントとガイドボタンを更新
    updateCropModeHint();
    updateGuideButtonHighlight();
}

/**
 * ガイドからクロップ範囲を自動設定
 */
function applyGuidesToCrop() {
    saveToHistory();  // Undo用に現在の状態を保存

    const hGuides = guides.filter(g => g.type === 'h').map(g => g.position).sort((a, b) => a - b);
    const vGuides = guides.filter(g => g.type === 'v').map(g => g.position).sort((a, b) => a - b);

    if (vGuides.length >= 2) {
        $('cropLeftFull').value = Math.round(vGuides[0]);
        $('cropRightFull').value = Math.round(vGuides[vGuides.length - 1]);
    }
    if (hGuides.length >= 2) {
        $('cropTopFull').value = Math.round(hGuides[0]);
        $('cropBottomFull').value = Math.round(hGuides[hGuides.length - 1]);
    }

    // プレビューを更新
    updateFillStrokePreview();

    // UI改修: ヒントと適用ボタンの状態を更新
    updateCropModeHint();
    updateApplyButtonState();
}

/**
 * タチキリ設定の表示/非表示を切り替え
 */
function updateTachikiriSettings() {
    const value = $('tachikiriSelect').value;
    $('cropSettings').style.display = value !== 'none' ? 'block' : 'none';
    updateColorSettingsVisibility(value);

    // 範囲選択ステータスを更新
    if (value !== 'none') {
        updateCropRangeStatus();
    }

    // 画像選択モードが開いている場合、オーバーレイの色設定も更新
    if (cropModeOpen) {
        syncColorSettingsToOverlay();
        updateFillStrokePreview();
    }

    // JPEGオプションの無効化状態を更新
    updateJpegOptionsAvailability();

    // 全プレビューにタチキリ設定を反映
    updateSpreadPreview();
    updateSinglePreview();
    updateJpegPreview();
}

/**
 * 作品情報のプレビューテキストを取得
 */
function getWorkInfoPreviewText() {
    if (!jsonData) {
        return '作品情報未設定';
    }

    const preset = jsonData.presetData || jsonData;
    // workInfoオブジェクトから取得（JSXスクリプトの形式）
    const workInfo = preset.workInfo || {};

    const label = workInfo.label || '';
    const title = workInfo.title || '';
    const subtitle = workInfo.subtitle || '';
    const version = workInfo.volume || '';
    const authorType = workInfo.authorType || 'single';
    const author = workInfo.author || '';
    const artist = workInfo.artist || '';
    const original = workInfo.original || '';

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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * JSONデータを解析
 */
function parseJsonData(data, fileName) {
    selectionRanges = [];
    selectedRange = null;

    // presetData.selectionRanges を探す
    let ranges = null;
    if (data.presetData && data.presetData.selectionRanges) {
        ranges = data.presetData.selectionRanges;
    } else if (data.selectionRanges) {
        ranges = data.selectionRanges;
    }

    if (ranges && ranges.length > 0) {
        selectionRanges = ranges;

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
        if (cropModeOpen) {
            updateCropModeLabelSelect();
        }

        $('jsonInfo').textContent = fileName;
        $('jsonInfo').className = 'json-status success';
        setStatus(`JSON読み込み完了 (${ranges.length}件の範囲設定)`);

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
            setStatus('JSON読み込み完了 (ガイド形式)');

            // CropUIモードが開いている場合、CropUI入力欄も更新
            if (cropModeOpen) {
                $('cropLeftFull').value = Math.round(bounds.left);
                $('cropTopFull').value = Math.round(bounds.top);
                $('cropRightFull').value = Math.round(bounds.right);
                $('cropBottomFull').value = Math.round(bounds.bottom);
                updateSelectionVisual();
                updateFillStrokePreview();
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
        setStatus('JSON読み込み完了');

        // CropUIモードが開いている場合、CropUI入力欄も更新
        if (cropModeOpen) {
            $('cropLeftFull').value = Math.round(bounds.left);
            $('cropTopFull').value = Math.round(bounds.top);
            $('cropRightFull').value = Math.round(bounds.right);
            $('cropBottomFull').value = Math.round(bounds.bottom);
            updateSelectionVisual();
            updateFillStrokePreview();
        }
    } else {
        $('jsonInfo').textContent = '範囲設定が見つかりません';
        $('jsonInfo').className = 'json-status error';
    }

    // 作品情報プレビューを更新
    updateSpreadPreview();
}

/**
 * 範囲選択を適用
 */
function applySelectionRange(range) {
    selectedRange = range;

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
function applyCropBounds(bounds) {
    // メイン画面側の入力欄を更新
    $('cropLeft').value = Math.round(bounds.left);
    $('cropTop').value = Math.round(bounds.top);
    $('cropRight').value = Math.round(bounds.right);
    $('cropBottom').value = Math.round(bounds.bottom);
    updateCropRangeStatus();

    // クロップモードが開いている場合はクロップモード側の入力欄も同期
    if (cropModeOpen) {
        $('cropLeftFull').value = Math.round(bounds.left);
        $('cropTopFull').value = Math.round(bounds.top);
        $('cropRightFull').value = Math.round(bounds.right);
        $('cropBottomFull').value = Math.round(bounds.bottom);
        updateSelectionVisual();
        updateFillStrokePreview();
        updateApplyButtonState();
    }
}

// ========================================
// JSON新規登録機能
// ========================================

/**
 * JSON登録モーダルを表示
 */
function showJsonRegisterModal() {
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
    $('registerDocSize').textContent = `${previewImageSize.width} × ${previewImageSize.height}`;

    // デフォルトラベル名を設定
    const defaultLabel = `基本範囲_${previewImageSize.width}x${previewImageSize.height}`;
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
    registerModalSelectedFile = null;
    registerModalExistingData = null;

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
function hideJsonRegisterModal() {
    $('jsonRegisterModal').style.display = 'none';
}

/**
 * 現在の選択範囲データを取得
 */
function getCurrentSelectionData(labelName) {
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
            width: previewImageSize.width,
            height: previewImageSize.height
        },
        savedAt: new Date().toISOString()
    };
}

/**
 * 新規JSONファイルとして保存
 */
async function saveAsNewJson() {
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
    const fullRangeLabel = `${rangeLabel}_${previewImageSize.width}x${previewImageSize.height}`;

    // ファイル名に使えない文字を置換
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeTitle}.json`;
    const filePath = `${JSON_FOLDER_PATH}/${label}/${fileName}`;

    try {
        // ファイルが既に存在するか確認
        const exists = await invoke('file_exists', { path: filePath });

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
            const content = await invoke('read_json_file', { path: filePath });
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
async function saveJsonAndNotify(filePath, data, rangeLabel, label, title) {
    const content = JSON.stringify(data, null, 4);
    await invoke('save_json_file', { path: filePath, content });

    hideJsonRegisterModal();
    showAlert(
        `選択範囲を保存しました！\n\n` +
        `レーベル: ${label}\n` +
        `タイトル: ${title}\n` +
        `ラベル: ${rangeLabel}`,
        'success'
    );
    setStatus(`JSON保存完了: ${title}`);
}

/**
 * 既存JSONファイルを選択（登録用）
 */
async function selectExistingJsonForRegister() {
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
        registerModalSelectedFile = filePath;
        registerModalExistingData = data;

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
async function addToExistingJson() {
    if (!registerModalSelectedFile || !registerModalExistingData) {
        showAlert('JSONファイルを選択してください。', 'warning');
        return;
    }

    const rangeLabelInput = $('registerRangeLabelExisting').value.trim();
    const rangeLabel = rangeLabelInput || '基本範囲';
    const fullRangeLabel = `${rangeLabel}_${previewImageSize.width}x${previewImageSize.height}`;

    const selectionData = getCurrentSelectionData(fullRangeLabel);

    // 重複チェック
    if (checkDuplicateLabel(registerModalExistingData, fullRangeLabel)) {
        showDuplicateLabelModal(fullRangeLabel, async (action, newLabel) => {
            if (action === 'cancel') return;

            const finalLabel = action === 'addDate'
                ? generateDateTimeLabel(newLabel || fullRangeLabel)
                : (newLabel || fullRangeLabel);

            selectionData.label = finalLabel;
            addSelectionRangeToData(registerModalExistingData, selectionData, action === 'overwrite' ? fullRangeLabel : null);

            const content = JSON.stringify(registerModalExistingData, null, 4);
            await invoke('save_json_file', { path: registerModalSelectedFile, content });

            hideJsonRegisterModal();
            const fileName = registerModalSelectedFile.split('/').pop().split('\\').pop();
            showAlert(
                `選択範囲を追加しました！\n\n` +
                `ファイル: ${fileName}\n` +
                `ラベル: ${finalLabel}`,
                'success'
            );
            setStatus(`JSON更新完了: ${fileName}`);
        });
        return;
    }

    try {
        addSelectionRangeToData(registerModalExistingData, selectionData, null);

        const content = JSON.stringify(registerModalExistingData, null, 4);
        await invoke('save_json_file', { path: registerModalSelectedFile, content });

        hideJsonRegisterModal();
        const fileName = registerModalSelectedFile.split('/').pop().split('\\').pop();
        showAlert(
            `選択範囲を追加しました！\n\n` +
            `ファイル: ${fileName}\n` +
            `ラベル: ${fullRangeLabel}`,
            'success'
        );
        setStatus(`JSON更新完了: ${fileName}`);
    } catch (e) {
        console.error('JSON更新エラー:', e);
        showAlert(`更新エラー: ${e}`, 'error');
    }
}

/**
 * 選択範囲データをJSONオブジェクトに追加
 */
function addSelectionRangeToData(data, selectionData, overwriteLabel) {
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
function checkDuplicateLabel(data, labelName) {
    const ranges = data.presetData?.selectionRanges || data.selectionRanges || [];
    return ranges.some(range => range.label === labelName);
}

/**
 * 日時を追加したラベル名を生成
 */
function generateDateTimeLabel(labelName) {
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

// 重複ラベル解決用のコールバック
let duplicateLabelCallback = null;
let duplicateLabelOriginal = '';

/**
 * 重複ラベル確認モーダルを表示
 */
function showDuplicateLabelModal(labelName, callback) {
    duplicateLabelCallback = callback;
    duplicateLabelOriginal = labelName;
    $('duplicateLabelName').textContent = labelName;
    $('duplicateLabelModal').style.display = 'flex';
}

/**
 * 重複ラベル確認モーダルを非表示
 */
function hideDuplicateLabelModal() {
    $('duplicateLabelModal').style.display = 'none';
}

/**
 * 重複ラベルの処理を解決
 */
function resolveDuplicateLabel(action) {
    hideDuplicateLabelModal();

    if (!duplicateLabelCallback) return;

    if (action === 'cancel') {
        duplicateLabelCallback('cancel', null);
    } else if (action === 'overwrite') {
        duplicateLabelCallback('overwrite', duplicateLabelOriginal);
    } else if (action === 'addDate') {
        duplicateLabelCallback('addDate', duplicateLabelOriginal);
    } else if (action === 'rename') {
        const newLabel = prompt('新しいラベル名を入力してください:', duplicateLabelOriginal);
        if (newLabel && newLabel !== duplicateLabelOriginal) {
            duplicateLabelCallback('rename', newLabel);
        } else {
            duplicateLabelCallback('cancel', null);
        }
    }

    duplicateLabelCallback = null;
    duplicateLabelOriginal = '';
}

/**
 * ファイル選択をリセットする
 */
async function resetFileSelection() {
    inputFolder = null;
    targetFiles = [];
    jsonData = null;
    selectionRanges = [];
    selectedRange = null;

    // UI更新
    $('fileInfo').textContent = '未選択';
    $('outputName').value = '出力';
    $('jsonInfo').textContent = '';
    $('jsonInfo').className = 'json-status';
    $('labelSelectArea').style.display = 'none';
    $('cropRangeStatus').textContent = '⚠ 未設定';
    $('cropRangeStatus').className = 'crop-range-status warning';

    // タチキリ範囲をリセット
    $('cropLeft').value = 0;
    $('cropTop').value = 0;
    $('cropRight').value = 0;
    $('cropBottom').value = 0;
    $('docSizeInfo').textContent = '';

    // ドロップエリアをリセット
    const dropArea = $('dropZone');
    const emptyState = $('dropAreaEmpty');
    const loadedState = $('dropAreaLoaded');
    if (dropArea) dropArea.classList.remove('has-files');
    if (emptyState) emptyState.style.display = 'flex';
    if (loadedState) loadedState.style.display = 'none';

    // 出力フォルダをデフォルトに戻す
    await initDefaultOutputFolder();

    updateExecuteBtn();
}

/**
 * ドラッグ＆ドロップ処理（Tauri v2 パスベース）
 */
async function handleDroppedPaths(paths) {
    if (!paths || paths.length === 0) return;

    // 既存のファイル選択をリセット
    resetFileSelection();

    const supportedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'psd', 'tif', 'tiff'];
    const firstPath = paths[0];

    // フォルダかファイルかを判定（拡張子の有無で判断）
    const hasExtension = supportedExts.some(ext => firstPath.toLowerCase().endsWith('.' + ext));

    if (!hasExtension && paths.length === 1) {
        // フォルダがドロップされた場合
        try {
            setStatus('フォルダを読み込み中...');
            const files = await invoke('get_image_files', { folderPath: firstPath });

            if (files.length === 0) {
                setStatus('フォルダ内に対応する画像ファイルがありません');
                return;
            }

            inputFolder = firstPath;
            targetFiles = files;

            updateFileInfo();
            updateExecuteBtn();
            setStatus(`${targetFiles.length} ファイルを読み込みました`);
        } catch (e) {
            setStatus('フォルダの読み込みに失敗しました: ' + e);
        }
    } else {
        // ファイルがドロップされた場合
        const validPaths = paths.filter(p => {
            const ext = p.split('.').pop()?.toLowerCase();
            return supportedExts.includes(ext);
        });

        if (validPaths.length === 0) {
            setStatus('対応していないファイル形式です');
            return;
        }

        // 最初のファイルからフォルダパスを取得
        const fullPath = validPaths[0];
        const lastSep = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'));
        inputFolder = fullPath.substring(0, lastSep);

        // ファイル名のみを配列に格納
        targetFiles = validPaths.map(p => {
            const sep = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
            return p.substring(sep + 1);
        });
        targetFiles.sort();

        updateFileInfo();
        updateExecuteBtn();
        setStatus(`${targetFiles.length} ファイルを読み込みました`);
    }
}

/**
 * 入力フォルダ名から出力ファイル名を自動設定
 */
function updateOutputNameFromFolder() {
    if (!inputFolder) return;

    // フォルダパスから最後のフォルダ名を取得
    const parts = inputFolder.split(/[\\\/]/);
    const folderName = parts[parts.length - 1];

    if (folderName) {
        const outputNameInput = $('outputName');
        if (outputNameInput) {
            outputNameInput.value = folderName;
        }
    }
}

function updateFileInfo() {
    const dropArea = $('dropZone');
    const emptyState = $('dropAreaEmpty');
    const loadedState = $('dropAreaLoaded');

    if (targetFiles.length === 0) {
        $('fileInfo').textContent = '未選択';
        if (dropArea) dropArea.classList.remove('has-files');
        if (emptyState) emptyState.style.display = 'flex';
        if (loadedState) loadedState.style.display = 'none';
    } else if (targetFiles.length === 1) {
        const name = targetFiles[0].split(/[\\\/]/).pop();
        $('fileInfo').textContent = name;
        if (dropArea) dropArea.classList.add('has-files');
        if (emptyState) emptyState.style.display = 'none';
        if (loadedState) loadedState.style.display = 'flex';
        // フォルダ名から出力ファイル名を設定
        updateOutputNameFromFolder();
    } else {
        $('fileInfo').textContent = `${targetFiles.length} ファイル選択済み`;
        if (dropArea) dropArea.classList.add('has-files');
        if (emptyState) emptyState.style.display = 'none';
        if (loadedState) loadedState.style.display = 'flex';
        // フォルダ名から出力ファイル名を設定
        updateOutputNameFromFolder();
    }

    updateExecuteBtn();
}

function updateOutputInfo() {
    const outputInfoEl = $('outputInfo');
    const outputPathDisplay = $('outputPathDisplay');

    if (outputFolder) {
        // パスを省略表示（最後の2つのフォルダ名を表示）
        const parts = outputFolder.split(/[\\\/]/);
        let displayPath;
        if (parts.length <= 2) {
            displayPath = outputFolder;
        } else {
            displayPath = '…/' + parts.slice(-2).join('/');
        }
        outputInfoEl.textContent = displayPath;
        if (outputPathDisplay) {
            outputPathDisplay.title = outputFolder;
        }
    } else {
        outputInfoEl.textContent = '未選択';
        if (outputPathDisplay) {
            outputPathDisplay.title = '';
        }
    }
    updateExecuteBtn();
}

function updateExecuteBtn() {
    const hasFiles = targetFiles.length > 0;
    const hasOutput = outputFolder !== null;

    // 出力形式が1つ以上選択されているか判定
    let hasFormat = false;

    // 見開きPDF、単ページPDF、またはJPEGが選択されていれば出力あり
    if (selectedOutputs.spreadPdf || selectedOutputs.singlePdf || selectedOutputs.jpeg) {
        hasFormat = true;
    }

    $('btnExecute').disabled = !hasFiles || !hasOutput || !hasFormat || isProcessing;
}

function setStatus(text) {
    const el = $('status');
    if (el) el.textContent = text;
}

/**
 * タチキリタイプに応じて色設定の表示/非表示を切り替え
 */
function updateColorSettingsVisibility(tachikiriType) {
    const needsStroke = ['crop_and_stroke', 'stroke_only', 'fill_and_stroke'].includes(tachikiriType);
    const needsFill = ['fill_white', 'fill_and_stroke'].includes(tachikiriType);

    $('colorSettings').style.display = (needsStroke || needsFill) ? 'flex' : 'none';
    $('strokeColorRow').style.display = needsStroke ? 'flex' : 'none';
    $('fillColorRow').style.display = needsFill ? 'flex' : 'none';
    $('fillOpacityRow').style.display = needsFill ? 'flex' : 'none';
}

function updateProgress(data) {
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
        // フェーズ情報をファイル名に含める
        if (phase.includes('ファイル保存中')) {
            displayFilename = 'PDFファイルを保存中...';
        } else if (phase.includes('読み込み中')) {
            // 「読み込み中... (16 処理中)」からファイル数を抽出
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

function collectSettings() {
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
    if (selectedRange && selectedRange.documentSize) {
        referenceDocSize = selectedRange.documentSize;
    } else if (previewImageSize.width > 0 && previewImageSize.height > 0) {
        // 画像選択モードで設定された場合はプレビュー画像サイズを使用
        referenceDocSize = { width: previewImageSize.width, height: previewImageSize.height };
    }

    // 作品情報（JSONから取得）- JSX形式に合わせた構造
    let workInfo = null;
    if (jsonData) {
        const preset = jsonData.presetData || jsonData;
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
    if (selectedOutputs.spreadPdf) {
        outputSettings.savePdfSpread = true;
        const gutterEnabled = $('spreadGutterEnabled')?.checked ?? true;
        const paddingEnabled = $('spreadPaddingEnabled')?.checked ?? true;
        outputSettings.spreadGutter = gutterEnabled ? (parseInt($('spreadGutterSlider')?.value) || 70) : 0;
        outputSettings.spreadPadding = paddingEnabled ? (parseInt($('spreadPaddingSlider')?.value) || 150) : 0;
        outputSettings.addWhitePage = $('spreadWhitePage')?.checked || false;
        outputSettings.printWorkInfo = $('spreadWorkInfo')?.checked || false;
    }

    // 単ページPDFが選択されている場合
    if (selectedOutputs.singlePdf) {
        outputSettings.savePdfSingle = true;
    }

    // JPEGが選択されている場合
    if (selectedOutputs.jpeg) {
        outputSettings.saveJpeg = true;
    }

    // ノンブル設定: PDFが選択されている場合はPDFの設定、そうでなければJPEGの設定を使用
    const hasPdf = selectedOutputs.spreadPdf || selectedOutputs.singlePdf;
    let addNombre, nombreStartNumber, nombreSize;
    let addNombreToImage = true; // 画像処理時にノンブルを追加するか

    if (hasPdf) {
        addNombre = $('spreadAddNombre')?.checked ?? $('singleAddNombre')?.checked ?? true;
        nombreStartNumber = parseInt($('spreadNombreStart')?.value || $('singleNombreStart')?.value) || 1;
        nombreSize = $('spreadNombreSize')?.value || $('singleNombreSize')?.value || 'medium';

        // PDF出力時に余白がある場合、ノンブルはPDF余白に追加するため画像処理では追加しない
        const hasPdfPadding = (selectedOutputs.spreadPdf && outputSettings.spreadPadding > 0) ||
                              (selectedOutputs.singlePdf && addNombre); // 単ページPDFはノンブル有効時に自動で余白追加
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
        targetFiles,
        outputFolder,
        tachikiriType: tachikiri,
        cropBounds,
        referenceDocSize,
        strokeColor: $('strokeColor').value,
        fillColor: $('fillColor').value,
        fillOpacity: parseInt($('fillOpacity').value) || 50,
        resizeMode: resize,
        resizePercent: parseInt($('resizePercent').value) || 50,
        addNombre,
        addNombreToImage, // PDF余白にノンブル追加する場合はfalse
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

async function execute() {
    if (isProcessing) return;

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

    isProcessing = true;
    $('btnExecute').disabled = true;
    $('progressArea').style.display = 'block';
    setStatus('処理中...');

    // リッチ進捗オーバーレイを表示
    processingOverlay.show(targetFiles.length);

    try {
        const settings = collectSettings();
        let message = '';
        let processedImages = false;
        let tempFolderUsed = false;
        let actualOutputFolder = outputFolder;

        // PDF出力が有効かチェック（プリセットから判定）
        const savePdf = settings.savePdfSingle || settings.savePdfSpread;

        // タチキリ処理が必要かどうか判定
        const needsTachikiri = settings.tachikiriType && settings.tachikiriType !== 'none';

        // ノンブル機能が有効かどうか判定
        const needsNombre = settings.addNombre === true;

        // PDF出力のために画像処理が必要だが、JPEG保存が無効な場合
        // 一時フォルダに画像を出力してからPDFを生成
        const needsTempProcessing = savePdf && (needsTachikiri || needsNombre) && !settings.saveJpeg;

        if (needsTempProcessing) {
            // 一時フォルダを使用
            setStatus('PDF用の一時フォルダを準備中...');
            actualOutputFolder = outputFolder + '\\_temp_pdf_source';
            tempFolderUsed = true;
        }

        // 画像処理が必要な場合（JPEG保存が有効、またはPDF用の画像処理が必要）
        if (settings.saveJpeg || needsTempProcessing) {
            processingOverlay.setPhase('process');
            setStatus('画像処理を開始しています...');

            // Tauri用にオプションを変換（Rust側はsnake_caseを期待）
            const processOptions = {
                crop_left: settings.cropBounds?.left || 0,
                crop_top: settings.cropBounds?.top || 0,
                crop_right: settings.cropBounds?.right || 0,
                crop_bottom: settings.cropBounds?.bottom || 0,
                tachikiri_type: settings.tachikiriType || 'none',
                stroke_color: settings.strokeColor || 'black',
                fill_color: settings.fillColor || 'black',
                fill_opacity: settings.fillOpacity || 50,
                // 基準サイズ（スケーリング用）
                reference_width: settings.referenceDocSize?.width || 0,
                reference_height: settings.referenceDocSize?.height || 0,
                // ノンブル設定（PDF余白にノンブル追加する場合は画像には追加しない）
                add_nombre: settings.addNombreToImage && settings.addNombre,
                nombre_start_number: settings.nombreStartNumber || 1,
                nombre_size: settings.nombreSize || 'medium',
                // リサイズ設定
                resize_mode: settings.resizeMode || 'none',
                resize_percent: settings.resizePercent || 50
            };

            // 画像処理を実行
            const result = await invoke('process_images', {
                inputFolder: inputFolder,
                outputFolder: actualOutputFolder,
                files: targetFiles,
                options: processOptions
            });

            if (!tempFolderUsed) {
                message += `画像処理完了: ${result.processed}/${result.total} ファイル\n`;
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
        let pdfSourceFolder = inputFolder;
        let pdfFiles = targetFiles;

        if (processedImages) {
            // 処理済み画像を使用（拡張子を.jpgに変換）
            // JPEG保存が有効な場合は /jpg サブフォルダに出力される
            // 一時フォルダ使用時はそのまま
            if (tempFolderUsed) {
                pdfSourceFolder = actualOutputFolder;
            } else {
                pdfSourceFolder = actualOutputFolder + '\\jpg';
            }
            pdfFiles = targetFiles.map(f => {
                // 拡張子を.jpgに変換
                const baseName = f.replace(/\.[^/.]+$/, '');
                return baseName + '.jpg';
            });
        }

        // 単ページPDF出力
        if (settings.savePdfSingle) {
            processingOverlay.setPhase('pdf');
            setStatus('単ページPDFを生成中...');

            // 単ページPDFのノンブル設定取得
            const singleAddNombre = $('singleAddNombre')?.checked ?? false;
            const singleNombreSize = $('singleNombreSize')?.value || 'medium';
            // 単ページPDFの余白（ノンブルを余白に追加する場合に使用）
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

            const singlePdfPath = outputFolder + '\\' + (settings.outputName || '出力') + '_単ページ.pdf';

            await invoke('generate_pdf', {
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
            setStatus('見開きPDFを生成中...');

            // 見開きPDFのノンブル設定取得
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
                gutter: settings.spreadGutter || 70,
                padding: settings.spreadPadding || 150,
                is_spread: true,
                add_white_page: settings.addWhitePage || false,
                print_work_info: settings.printWorkInfo || false,
                work_info: settings.workInfo || null,
                add_nombre: spreadAddNombre,
                nombre_size: spreadNombreSize
            };

            const spreadPdfPath = outputFolder + '\\' + (settings.outputName || '出力') + '_見開き.pdf';

            await invoke('generate_pdf', {
                inputFolder: pdfSourceFolder,
                outputPath: spreadPdfPath,
                files: pdfFiles,
                options: spreadPdfOptions
            });

            message += `見開きPDF生成完了\n`;
        }

        // 一時フォルダを使用した場合は削除
        if (tempFolderUsed) {
            setStatus('一時ファイルを削除中...');
            try {
                await invoke('delete_folder', { path: actualOutputFolder });
            } catch (cleanupError) {
                console.warn('一時フォルダの削除に失敗:', cleanupError);
            }
        }

        // 処理時間を計算
        const elapsedMs = Date.now() - processingOverlay.startTime;
        const elapsedTime = processingOverlay.formatTime(elapsedMs);
        message += `\n処理時間: ${elapsedTime}`;
        message += `\n出力先: ${outputFolder}`;

        // 完了フェーズを表示（完了マークを見せる）
        processingOverlay.setPhase('complete');
        await new Promise(r => setTimeout(r, 1300));

        $('modalMessage').textContent = message;
        $('modal').style.display = 'flex';
        setStatus('処理完了');

    } catch (e) {
        setStatus(`エラー: ${e}`);
        $('modalMessage').textContent = `エラーが発生しました:\n${e}`;
        $('modal').style.display = 'flex';
    } finally {
        isProcessing = false;
        $('progressArea').style.display = 'none';
        processingOverlay.hide();
        updateExecuteBtn();
    }
}

// ========================================
// 設定の永続化（localStorage）
// ========================================
const SETTINGS_STORAGE_KEY = 'tachimi_settings';

/**
 * 現在の設定をlocalStorageに保存
 */
function saveSettings() {
    try {
        const settings = {
            // タチキリ処理
            tachikiriType: $('tachikiriSelect')?.value || 'fill_white',
            fillColor: $('fillColor')?.value || 'white',
            strokeColor: $('strokeColor')?.value || 'black',

            // 見開きPDF設定
            spreadGutterEnabled: $('spreadGutterEnabled')?.checked ?? true,
            spreadGutterValue: parseInt($('spreadGutterSlider')?.value) || 70,
            spreadPaddingEnabled: $('spreadPaddingEnabled')?.checked ?? true,
            spreadPaddingValue: parseInt($('spreadPaddingSlider')?.value) || 150,
            spreadWhitePage: $('spreadWhitePage')?.checked ?? false,
            spreadWorkInfo: $('spreadWorkInfo')?.checked ?? false,
            spreadAddNombre: $('spreadAddNombre')?.checked ?? true,
            spreadNombreStart: parseInt($('spreadNombreStart')?.value) || 1,
            spreadNombreSize: $('spreadNombreSize')?.value || 'small',

            // 単ページPDF設定
            singleAddNombre: $('singleAddNombre')?.checked ?? true,
            singleNombreStart: parseInt($('singleNombreStart')?.value) || 1,
            singleNombreSize: $('singleNombreSize')?.value || 'small',

            // JPEG設定
            jpegAddNombre: $('jpegAddNombre')?.checked ?? false,
            jpegNombreStart: parseInt($('jpegNombreStart')?.value) || 1,
            jpegNombreSize: $('jpegNombreSize')?.value || 'small',
            jpegQuality: parseInt($('jpegQuality')?.value) || 92,

            // 保存日時
            savedAt: new Date().toISOString()
        };

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        console.log('設定を保存しました');
    } catch (e) {
        console.warn('設定の保存に失敗:', e);
    }
}

/**
 * localStorageから設定を読み込んでUIに適用
 */
function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!saved) {
            console.log('保存された設定がありません（初回起動）');
            return;
        }

        const settings = JSON.parse(saved);
        console.log('設定を読み込み:', settings.savedAt);

        // タチキリ処理
        if (settings.tachikiriType) {
            const select = $('tachikiriSelect');
            if (select) select.value = settings.tachikiriType;
            // カードの選択状態も更新
            document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
                card.classList.toggle('selected', card.dataset.value === settings.tachikiriType);
            });
        }
        if (settings.fillColor) {
            const el = $('fillColor');
            if (el) el.value = settings.fillColor;
        }
        if (settings.strokeColor) {
            const el = $('strokeColor');
            if (el) el.value = settings.strokeColor;
        }

        // 見開きPDF設定
        const spreadGutterEnabled = $('spreadGutterEnabled');
        if (spreadGutterEnabled && settings.spreadGutterEnabled !== undefined) {
            spreadGutterEnabled.checked = settings.spreadGutterEnabled;
            $('spreadGutterSliderArea')?.classList.toggle('disabled', !settings.spreadGutterEnabled);
        }
        if (settings.spreadGutterValue !== undefined) {
            const slider = $('spreadGutterSlider');
            if (slider) {
                slider.value = settings.spreadGutterValue;
                const valueEl = $('spreadGutterValue');
                if (valueEl) valueEl.textContent = settings.spreadGutterValue;
            }
        }
        const spreadPaddingEnabled = $('spreadPaddingEnabled');
        if (spreadPaddingEnabled && settings.spreadPaddingEnabled !== undefined) {
            spreadPaddingEnabled.checked = settings.spreadPaddingEnabled;
            $('spreadPaddingSliderArea')?.classList.toggle('disabled', !settings.spreadPaddingEnabled);
        }
        if (settings.spreadPaddingValue !== undefined) {
            const slider = $('spreadPaddingSlider');
            if (slider) {
                slider.value = settings.spreadPaddingValue;
                const valueEl = $('spreadPaddingValue');
                if (valueEl) valueEl.textContent = settings.spreadPaddingValue;
            }
        }
        if (settings.spreadWhitePage !== undefined) {
            const el = $('spreadWhitePage');
            if (el) el.checked = settings.spreadWhitePage;
        }
        if (settings.spreadWorkInfo !== undefined) {
            const el = $('spreadWorkInfo');
            if (el) el.checked = settings.spreadWorkInfo;
        }
        if (settings.spreadAddNombre !== undefined) {
            const el = $('spreadAddNombre');
            if (el) {
                el.checked = settings.spreadAddNombre;
                const settingsPanel = $('spreadNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.spreadAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.spreadNombreStart !== undefined) {
            const el = $('spreadNombreStart');
            if (el) el.value = settings.spreadNombreStart;
        }
        if (settings.spreadNombreSize) {
            const el = $('spreadNombreSize');
            if (el) el.value = settings.spreadNombreSize;
        }

        // 単ページPDF設定
        if (settings.singleAddNombre !== undefined) {
            const el = $('singleAddNombre');
            if (el) {
                el.checked = settings.singleAddNombre;
                const settingsPanel = $('singleNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.singleAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.singleNombreStart !== undefined) {
            const el = $('singleNombreStart');
            if (el) el.value = settings.singleNombreStart;
        }
        if (settings.singleNombreSize) {
            const el = $('singleNombreSize');
            if (el) el.value = settings.singleNombreSize;
        }

        // JPEG設定
        if (settings.jpegAddNombre !== undefined) {
            const el = $('jpegAddNombre');
            if (el) {
                el.checked = settings.jpegAddNombre;
                const settingsPanel = $('jpegNombreSettings');
                if (settingsPanel) settingsPanel.style.display = settings.jpegAddNombre ? 'flex' : 'none';
            }
        }
        if (settings.jpegNombreStart !== undefined) {
            const el = $('jpegNombreStart');
            if (el) el.value = settings.jpegNombreStart;
        }
        if (settings.jpegNombreSize) {
            const el = $('jpegNombreSize');
            if (el) el.value = settings.jpegNombreSize;
        }
        if (settings.jpegQuality !== undefined) {
            const slider = $('jpegQuality');
            if (slider) {
                slider.value = settings.jpegQuality;
                const valueEl = $('jpegQualityValue');
                if (valueEl) valueEl.textContent = settings.jpegQuality;
            }
        }

        // プレビューを更新
        updateTachikiriSettings();
        updateSpreadPreview();
        updateSinglePreview();
        updateJpegPreview();

        console.log('設定の適用完了');
    } catch (e) {
        console.warn('設定の読み込みに失敗:', e);
    }
}

/**
 * 設定変更時に自動保存するイベントリスナーを設定
 */
function setupSettingsAutoSave() {
    // 監視対象の要素IDリスト
    const watchIds = [
        // タチキリ
        'tachikiriSelect', 'fillColor', 'strokeColor',
        // 見開きPDF
        'spreadGutterEnabled', 'spreadGutterSlider', 'spreadPaddingEnabled', 'spreadPaddingSlider',
        'spreadWhitePage', 'spreadWorkInfo', 'spreadAddNombre', 'spreadNombreStart', 'spreadNombreSize',
        // 単ページPDF
        'singleAddNombre', 'singleNombreStart', 'singleNombreSize',
        // JPEG
        'jpegAddNombre', 'jpegNombreStart', 'jpegNombreSize', 'jpegQuality'
    ];

    watchIds.forEach(id => {
        const el = $(id);
        if (el) {
            // inputとchangeの両方でキャッチ
            el.addEventListener('input', saveSettings);
            el.addEventListener('change', saveSettings);
        }
    });

    // タチキリカードのクリックも監視
    document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
        card.addEventListener('click', saveSettings);
    });

    console.log('設定の自動保存を有効化');

    // リセットボタン
    const resetBtn = $('btnResetSettings');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }
}

/**
 * 設定リセットの確認ダイアログを表示
 */
function resetSettings() {
    showConfirmModal('設定を初期状態に戻しますか？', doResetSettings);
}

/**
 * カスタム確認ダイアログを表示
 */
function showConfirmModal(message, onConfirm) {
    const modal = $('confirmModal');
    const messageEl = $('confirmModalMessage');
    const okBtn = $('confirmModalOk');
    const cancelBtn = $('confirmModalCancel');
    const backdrop = modal.querySelector('.confirm-modal-backdrop');

    if (!modal) return;

    messageEl.textContent = message;
    modal.style.display = 'flex';

    // イベントリスナーをクリーンアップ用に保持
    const handleOk = () => {
        modal.style.display = 'none';
        cleanup();
        if (onConfirm) onConfirm();
    };

    const handleCancel = () => {
        modal.style.display = 'none';
        cleanup();
    };

    const cleanup = () => {
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        backdrop.removeEventListener('click', handleCancel);
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    backdrop.addEventListener('click', handleCancel);
}

/**
 * 設定を実際にリセットする
 */
function doResetSettings() {
    // localStorageから設定を削除
    localStorage.removeItem(SETTINGS_STORAGE_KEY);

    // デフォルト値を適用
    const defaults = {
        // タチキリ
        tachikiriType: 'fill_white',
        fillColor: 'black',
        strokeColor: 'black',
        // 見開きPDF
        spreadGutterEnabled: true,
        spreadGutterValue: 70,
        spreadPaddingEnabled: true,
        spreadPaddingValue: 150,
        spreadWhitePage: true,
        spreadWorkInfo: false,
        spreadAddNombre: true,
        spreadNombreStart: 1,
        spreadNombreSize: 'small',
        // 単ページPDF
        singleAddNombre: true,
        singleNombreStart: 1,
        singleNombreSize: 'small',
        // JPEG
        jpegAddNombre: false,
        jpegNombreStart: 1,
        jpegNombreSize: 'small',
        jpegQuality: 92
    };

    // タチキリ
    const tachikiriSelect = $('tachikiriSelect');
    if (tachikiriSelect) tachikiriSelect.value = defaults.tachikiriType;
    document.querySelectorAll('.tachikiri-card-sm').forEach(card => {
        card.classList.toggle('selected', card.dataset.value === defaults.tachikiriType);
    });
    if ($('fillColor')) $('fillColor').value = defaults.fillColor;
    if ($('strokeColor')) $('strokeColor').value = defaults.strokeColor;

    // 見開きPDF
    const spreadGutterEnabled = $('spreadGutterEnabled');
    if (spreadGutterEnabled) {
        spreadGutterEnabled.checked = defaults.spreadGutterEnabled;
        $('spreadGutterSliderArea')?.classList.toggle('disabled', !defaults.spreadGutterEnabled);
    }
    const spreadGutterSlider = $('spreadGutterSlider');
    if (spreadGutterSlider) {
        spreadGutterSlider.value = defaults.spreadGutterValue;
        if ($('spreadGutterValue')) $('spreadGutterValue').textContent = defaults.spreadGutterValue;
    }
    const spreadPaddingEnabled = $('spreadPaddingEnabled');
    if (spreadPaddingEnabled) {
        spreadPaddingEnabled.checked = defaults.spreadPaddingEnabled;
        $('spreadPaddingSliderArea')?.classList.toggle('disabled', !defaults.spreadPaddingEnabled);
    }
    const spreadPaddingSlider = $('spreadPaddingSlider');
    if (spreadPaddingSlider) {
        spreadPaddingSlider.value = defaults.spreadPaddingValue;
        if ($('spreadPaddingValue')) $('spreadPaddingValue').textContent = defaults.spreadPaddingValue;
    }
    if ($('spreadWhitePage')) $('spreadWhitePage').checked = defaults.spreadWhitePage;
    if ($('spreadWorkInfo')) $('spreadWorkInfo').checked = defaults.spreadWorkInfo;
    const spreadAddNombre = $('spreadAddNombre');
    if (spreadAddNombre) {
        spreadAddNombre.checked = defaults.spreadAddNombre;
        const settings = $('spreadNombreSettings');
        if (settings) settings.style.display = defaults.spreadAddNombre ? 'flex' : 'none';
    }
    if ($('spreadNombreStart')) $('spreadNombreStart').value = defaults.spreadNombreStart;
    if ($('spreadNombreSize')) $('spreadNombreSize').value = defaults.spreadNombreSize;

    // 単ページPDF
    const singleAddNombre = $('singleAddNombre');
    if (singleAddNombre) {
        singleAddNombre.checked = defaults.singleAddNombre;
        const settings = $('singleNombreSettings');
        if (settings) settings.style.display = defaults.singleAddNombre ? 'flex' : 'none';
    }
    if ($('singleNombreStart')) $('singleNombreStart').value = defaults.singleNombreStart;
    if ($('singleNombreSize')) $('singleNombreSize').value = defaults.singleNombreSize;

    // JPEG
    const jpegAddNombre = $('jpegAddNombre');
    if (jpegAddNombre) {
        jpegAddNombre.checked = defaults.jpegAddNombre;
        const settings = $('jpegNombreSettings');
        if (settings) settings.style.display = defaults.jpegAddNombre ? 'flex' : 'none';
    }
    if ($('jpegNombreStart')) $('jpegNombreStart').value = defaults.jpegNombreStart;
    if ($('jpegNombreSize')) $('jpegNombreSize').value = defaults.jpegNombreSize;
    const jpegQualitySlider = $('jpegQuality');
    if (jpegQualitySlider) {
        jpegQualitySlider.value = defaults.jpegQuality;
        if ($('jpegQualityValue')) $('jpegQualityValue').textContent = defaults.jpegQuality;
    }

    // プレビューを更新
    updateTachikiriSettings();
    updateSpreadPreview();
    updateSinglePreview();
    updateJpegPreview();

    setStatus('設定を初期状態に戻しました');
    console.log('設定をリセットしました');
}

console.log('タチミ スタンドアロン版 起動');
