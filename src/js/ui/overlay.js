/**
 * タチミ - 処理中オーバーレイモジュール
 * Tachimiストロークアニメーション + 進捗表示
 */

import { $ } from '../utils/dom.js';
import { formatTime } from '../utils/formatters.js';

/**
 * 処理中オーバーレイの制御クラス
 */
class ProcessingOverlay {
    constructor() {
        // 状態管理
        this.currentPhase = 'prepare';
        this.phases = ['prepare', 'process', 'pdf', 'complete'];
        this.phaseLabels = {
            prepare: '準備中',
            process: '変換中',
            pdf: '製本中',
            complete: '完了'
        };

        // 時間管理
        this.startTime = 0;
        this.elapsedInterval = null;

        // スムーズアニメーション用
        this.currentPercent = 0;
        this.targetPercent = 0;
        this.animationFrame = null;
        this.totalFiles = 0;

        // キャンセル状態
        this.cancelled = false;
    }

    /**
     * オーバーレイを表示
     * @param {number} totalFiles - 処理するファイル数
     */
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
        this.cancelled = false;

        // キャンセルボタン表示
        const cancelBtn = $('cancelProcessingBtn');
        if (cancelBtn) cancelBtn.style.display = 'flex';

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

        // Tachimi UI初期化
        const tachimiPercent = $('tachimiPercent');
        const tachimiFilename = $('tachimiFilename');
        const tachimiFill = $('tachimiProgressFill');
        if (tachimiPercent) tachimiPercent.textContent = '0%';
        if (tachimiFilename) tachimiFilename.textContent = '';
        if (tachimiFill) tachimiFill.style.width = '0%';

        this.setPhase('prepare');
        this.startAnimation();
        this.startElapsedTimer();
    }

    /**
     * オーバーレイを非表示
     */
    hide() {
        this.stopAnimation();
        this.stopElapsedTimer();
        const overlay = $('processingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        // キャンセルボタン非表示
        const cancelBtn = $('cancelProcessingBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
    }

    /**
     * フェーズを設定
     * @param {string} phase - フェーズ名
     */
    setPhase(phase) {
        this.currentPhase = phase;
        const idx = this.phases.indexOf(phase);

        // フェーズラベルを更新
        const labelEl = $('processingPhaseLabel');
        if (labelEl) {
            labelEl.textContent = this.phaseLabels[phase] || phase;
        }

        // ステップの状態を更新
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

            // 完了時間を表示
            const elapsed = Date.now() - this.startTime;
            const completionTimeEl = $('completionTime');
            if (completionTimeEl) {
                completionTimeEl.textContent = formatTime(elapsed) + ' で完了';
            }
        }
    }

    /**
     * 経過時間タイマー開始
     */
    startElapsedTimer() {
        this.stopElapsedTimer();
        const elapsedEl = $('processingElapsed');
        if (!elapsedEl) return;

        this.elapsedInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            elapsedEl.textContent = formatTime(elapsed);
        }, 1000);
    }

    /**
     * 経過時間タイマー停止
     */
    stopElapsedTimer() {
        if (this.elapsedInterval) {
            clearInterval(this.elapsedInterval);
            this.elapsedInterval = null;
        }
    }

    /**
     * 表示を更新
     * @param {number} current - 完了ファイル数
     * @param {number} total - 総ファイル数
     * @param {string} filename - 処理中のファイル名
     * @param {number} inProgress - 処理中のファイル数
     */
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

        // Tachimi UI更新
        const tachimiFilename = $('tachimiFilename');
        if (tachimiFilename && filename) {
            tachimiFilename.textContent = filename;
        }
    }

    /**
     * アニメーション開始
     */
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

            // インクバー更新
            const inkFill = $('processingBar');
            if (inkFill) {
                inkFill.style.width = `${this.currentPercent}%`;
            }

            // Tachimi UI更新
            const tachimiPercent = $('tachimiPercent');
            if (tachimiPercent) tachimiPercent.textContent = Math.round(this.currentPercent) + '%';
            const tachimiFill = $('tachimiProgressFill');
            if (tachimiFill) tachimiFill.style.width = `${this.currentPercent}%`;

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * アニメーション停止
     */
    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
}

// シングルトンインスタンス
const processingOverlay = new ProcessingOverlay();

// エクスポート
export { ProcessingOverlay, processingOverlay };
export default processingOverlay;
