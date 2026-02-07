/**
 * json-modal.js - JSON選択モーダル
 * フォルダ階層ナビゲーション対応＋検索機能
 */

import { $ } from '../utils/dom.js';
import appState from '../core/app-state.js';
import { JSON_FOLDER_PATH } from './constants.js';
import { parseJsonData } from './json-parsing.js';

/**
 * JSONファイル選択モーダルオブジェクト
 */
export const jsonSelectModal = {
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
            const results = await appState.invoke('search_json_folders', {
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
            const content = await appState.readTextFile(result.path);
            console.log('読み込み成功');
            const data = JSON.parse(content);

            // 外部コールバックがある場合はそちらを呼ぶ
            if (this.onFileSelected) {
                this.onFileSelected(result.path, data);
                return;
            }

            appState.jsonData = data;
            parseJsonData(data, result.title + '.json');
            this.hide();
        } catch (e) {
            console.error('読み込みエラー:', e);
            $('jsonInfo').textContent = 'エラー: ' + e;
            $('jsonInfo').className = 'json-status error';
            appState.jsonData = null;
            appState.selectionRanges = [];
        }
    },

    loadContents: async function() {
        const listEl = $('jsonSelectList');
        listEl.innerHTML = '<div class="json-select-loading">読み込み中...</div>';
        this.updatePathDisplay();

        try {
            const contents = await appState.invoke('list_folder_contents', { folderPath: this.currentPath });

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
            const contents = await appState.invoke('list_folder_contents', { folderPath: this.currentPath });

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
            const content = await appState.readTextFile(filePath);
            console.log('読み込み成功');
            const data = JSON.parse(content);

            // 外部コールバックがある場合はそちらを呼ぶ
            if (this.onFileSelected) {
                this.onFileSelected(filePath, data);
                return;
            }

            appState.jsonData = data;
            parseJsonData(data, filename);
            this.hide();
        } catch (e) {
            console.error('selectFile エラー:', e);
            $('jsonInfo').textContent = 'エラー: ' + e;
            $('jsonInfo').className = 'json-status error';
            appState.jsonData = null;
            appState.selectionRanges = [];
        }
    },

    browseOther: async function() {
        // ローカルのデスクトップを開く
        let localPath = null;
        if (appState.desktopDir) {
            try {
                localPath = await appState.desktopDir();
            } catch (e) {
                console.warn('デスクトップパス取得失敗:', e);
            }
        }
        const selected = await appState.openDialog({
            defaultPath: localPath,
            filters: [{ name: 'JSONファイル', extensions: ['json'] }]
        });
        if (selected) {
            try {
                const content = await appState.readTextFile(selected);
                const data = JSON.parse(content);
                const fileName = selected.split(/[\\\/]/).pop();

                // 外部コールバックがある場合はそちらを呼ぶ
                if (this.onFileSelected) {
                    this.onFileSelected(selected, data);
                    return;
                }

                appState.jsonData = data;
                parseJsonData(data, fileName);
                this.hide();
            } catch (e) {
                $('jsonInfo').textContent = 'エラー: ' + e;
                $('jsonInfo').className = 'json-status error';
                appState.jsonData = null;
                appState.selectionRanges = [];
            }
        }
    }
};

// appStateにも設定（他モジュールからの参照用）
appState.jsonSelectModal = jsonSelectModal;

/**
 * イベントリスナーのセットアップ
 */
export function setupJsonModalEvents() {
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
}
