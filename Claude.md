# CLAUDE.md - タチミ Standalone

## プロジェクト概要

漫画原稿の一括処理アプリ。PSDファイルを読み込み、タチキリ処理・リサイズ・ノンブル追加を行い、JPEG/PDFとして出力する。

## 技術スタック

- **フロントエンド**: HTML/CSS/JavaScript（フレームワークなし、完全ES Modules化）
- **バックエンド**: Rust + Tauri v2
- **画像処理**: image crate, imageproc, ab_glyph（フォント描画）, psd crate, mozjpeg
- **PDF生成**: printpdf crate

## ⚠️ セキュリティ重要事項（要維持）

> セキュリティレビュー実施日: 2026-05-29（v1.2.22）。過去に懸念とされた「WebViewからPC全ファイルへアクセス可能」「CSP無効」は**いずれも対策済み**であることを確認。**以下の防御は今後も崩さないこと。**

### 1. WebViewには最小権限しか与えない（全ファイルアクセス防止）
- [capabilities/default.json](src-tauri/capabilities/default.json) で許可しているのは **`core:app:allow-version` / `core:event:allow-listen,unlisten` / `dialog:allow-message` / `updater:allow-check,allow-download-and-install` のみ**。
- **`fs:*` / `shell:*` 権限は一切付与しない**こと。フロントからファイルシステムを直接叩く経路を作らない。
- `tauri-plugin-fs` / `tauri-plugin-shell` は Cargo.toml に依存として残っているが、[lib.rs](src-tauri/src/lib.rs) の `Builder` では **`.plugin()` 登録していない（= 無効）**。dialog と updater のみ登録。安易に有効化しない。

### 2. ファイルアクセスは全て「許可リスト方式」のRustコマンド経由
- ファイル操作は全てカスタムコマンド経由で行い、`SecurityState`（`allowed_roots`）の許可リストで制限する。
- 許可ルートに登録されるのは **OSダイアログ選択 / ドラッグ&ドロップ / CLI引数・トリガーファイル / ハードコードされた `JSON_FOLDER_PATH` / プレビュー用一時フォルダ** のみ。
- アクセス時は `canonicalize`（シンボリックリンク解決）してから許可ルート配下かを `starts_with` で検証（`ensure_allowed_canonical`）。
- パストラバーサル対策: `..`/`.` 拒否、書き込みは絶対パス必須、Windows予約名（CON/PRN等）・禁止文字・制御文字を拒否（`validate_safe_file_name`）。
- **新規コマンドを追加する際は、必ず `security.ensure_existing_*` / `ensure_write_*` を通すこと。** 生パスを直接 `std::fs` に渡さない。

### 3. CSPは有効に保つ（無効化しない）
- [tauri.conf.json](src-tauri/tauri.conf.json) の `app.security.csp` を設定済み。**`script-src 'self'`（インラインJS不可）/ `object-src 'none'` を維持**すること。
- `connect-src` は自己＋GitHub（更新チェック）に限定。`style-src 'unsafe-inline'` はCSSのみで許容範囲。
- `assetProtocol` のスコープは `$TEMP/tachimi_preview/**` に限定。広げない。

### 4. 自動更新は署名検証必須
- minisign公開鍵による署名検証 + HTTPS（GitHub Releases）。pubkey/endpoint を勝手に変更しない。

### 残存リスク（低・ローカル限定。対応は任意）
- **`--pdf-job` ヘッドレス経路は `SecurityState` 検証を通っていない**（`run_pdf_job_file` がジョブJSONの `input_folder`/`output_path` を直接使用）。WebViewからは到達不可で、悪用にはローカルでのプロセス起動権限が前提のため危険度は低い。固める場合はこの経路の `output_path` も許可リスト検証に通す。
- `get_cli_files` は `%TEMP%\tachimi_cli_files.json` を読んで許可リストへパスを追加する。ローカルプロセスが許可ルートを事前に仕込み得るが、実読み出しはアプリ自身のフロント（厳格CSPで改ざん不可）が要求しないと起きないため単独では情報漏洩に直結しない。

## ディレクトリ構成

```
tachimi_standalone/
├── src/                              # フロントエンド
│   ├── index.html                    # メインHTML (~900行)
│   ├── styles.css                    # スタイル (~7,400行)
│   ├── styles/                       # 分離済みCSS
│   │   ├── main.css                  # スタイルエントリ
│   │   ├── utilities/variables.css   # CSS変数
│   │   └── components/drop-zone.css  # ドロップゾーン
│   └── js/                           # ES Modules（全ロジック）
│       ├── main.js                   # エントリポイント（初期化・window公開）
│       ├── core/
│       │   ├── app-state.js          # 共有ミュータブル状態（旧グローバル変数）
│       │   ├── state.js              # StateStoreクラス（状態管理）
│       │   ├── events.js             # EventBusクラス（イベント通信）
│       │   └── tauri-api.js          # Tauri v2 APIラッパー
│       ├── ui/
│       │   ├── overlay.js            # ProcessingOverlay（キャンセル対応）
│       │   ├── alerts.js             # ダイアログユーティリティ
│       │   └── loading-overlay.js    # ロード中タイマーオーバーレイ
│       ├── utils/
│       │   ├── dom.js                # DOM操作ヘルパー
│       │   ├── formatters.js         # フォーマット関数
│       │   └── storage.js            # LocalStorage管理
│       └── features/
│           ├── constants.js          # 定数定義
│           ├── undo-redo.js          # Undo/Redo（コールバック登録パターン）
│           ├── feature-unlock.js     # 機能アンロック（パスワード保護）
│           ├── update-system.js      # 自動更新
│           ├── file-handling.js      # ファイルD&D・複数フォルダ対応・出力先管理（localStorage永続化）
│           ├── json-parsing.js       # JSON解析・適用
│           ├── json-modal.js         # JSONセレクションモーダル
│           ├── json-register.js      # JSON登録・保存
│           ├── output-panels.js      # 出力形式パネル（見開き/単/JPEG）
│           ├── preview.js            # プレビュー表示・ページナビ
│           ├── guides.js             # ルーラー・ガイド管理
│           ├── crop-mode.js          # クロップモード全体（最大モジュール）
│           ├── execution.js          # 処理実行・進捗管理
│           └── settings.js           # 設定保存・読み込み・リセット
├── src-tauri/                        # Rustバックエンド
│   ├── src/
│   │   ├── main.rs                   # エントリ (6行)
│   │   ├── lib.rs                    # Tauriコマンド定義・セキュリティ検証 (~1,450行)
│   │   └── processor/                # 画像処理モジュール群
│   │       ├── mod.rs                # モジュールエクスポート (160行)
│   │       ├── types.rs              # 型定義 (153行)
│   │       ├── cache.rs              # PSD/フォントキャッシュ (116行)
│   │       ├── image_loader.rs       # 画像読み込み (343行)
│   │       ├── image_processing.rs   # 画像処理 (338行)
│   │       ├── jpeg.rs               # MozJPEGエンコード (111行)
│   │       └── pdf/                  # PDF生成
│   │           ├── mod.rs            # PDFモジュール (10行)
│   │           ├── common.rs         # PDF共通処理 (365行)
│   │           ├── single.rs         # 単ページPDF (157行)
│   │           └── spread.rs         # 見開きPDF (257行)
│   ├── capabilities/
│   │   └── default.json              # WebView権限設定（最小権限）
│   ├── windows/
│   │   └── hooks.nsh                 # NSISインストーラフック
│   ├── build.rs                      # tauri-build
│   ├── Cargo.toml
│   └── tauri.conf.json               # Tauri設定（CSP・assetProtocol含む）
├── Tachimi起動.bat                    # npm start を実行
└── package.json
```

## 主要なTauriコマンド

> 一覧は [lib.rs](src-tauri/src/lib.rs) の `invoke_handler` 登録順と一致（全25コマンド）。**全コマンドが `SecurityState` 検証を通す**（⚠️セキュリティ重要事項 参照）。

| コマンド | 説明 |
|---------|------|
| `get_cli_files` | CLI引数/トリガーファイルから連携ファイルパスを取得し許可リストへ登録 |
| `select_input_paths` | OSダイアログで入力フォルダを選択し、選択実体だけを許可 |
| `select_output_folder` | OSダイアログで出力フォルダを選択し、書き込み許可 |
| `select_json_file` | OSダイアログでJSONファイルを選択し読み込み |
| `get_image_files` | フォルダ内の画像ファイル一覧を取得（PSDキャッシュも自動クリア） |
| `get_image_files_recursive` | 画像ファイル一覧を再帰取得（サブフォルダ対応、FileEntry配列） |
| `get_image_preview` | Base64形式でプレビュー取得（PSD高速読み込み+キャッシュ対応） |
| `get_image_preview_as_file` | ファイル経由でプレビュー取得（高速） |
| `process_images` | 画像処理（クロップ・タチキリ・リサイズ・ノンブル） |
| `cancel_processing` | 処理キャンセル（AtomicBoolフラグを設定） |
| `generate_pdf` | 単ページ/見開きPDF生成（余白・ノンブル対応） |
| `get_default_output_folder` | デフォルト出力先（デスクトップ/Script_Output/処理結果PDF）を取得 |
| `open_folder` | エクスプローラーでフォルダを開く |
| `delete_folder` | フォルダを削除（`_temp_pdf_source` のみ許可） |
| `clear_psd_cache` | PSD画像キャッシュを手動クリア |
| `list_json_files` | JSONファイル一覧取得（レガシー互換） |
| `list_folder_contents` | サブフォルダとJSONファイル一覧取得 |
| `search_json_folders` | JSONファイル全文検索（Label/Title.json構造） |
| `save_json_file` | JSONファイル保存 |
| `read_json_file` | JSONファイル読み込み |
| `ensure_folder_exists` | フォルダ作成（存在しなければ） |
| `file_exists` | ファイル存在確認 |
| `file_stat` | ファイルサイズ取得 |
| `get_psd_guides` | PSDファイルからガイド情報を抽出 |
| `preview_work_info` | 作品情報の折り返しプレビューを計算 |

## フロントエンド

### アーキテクチャ

**完全ES Modules化（src/js/）**
- `main.js` - エントリポイント。全モジュールimport → Tauri API初期化 → window公開 → setupEvents呼び出し
- `core/app-state.js` - 共有ミュータブル状態（旧renderer.jsグローバル変数の1:1マッピング）
- `features/` - 機能別モジュール（各モジュールが `setupXxxEvents()` をexport）
- `StateStore` / `EventBus` - リアクティブ状態管理・イベント通信
- `tauri-api.js` - Tauri v2 APIの統一ラッパー

### モジュール間通信パターン

- **共有状態**: `appState` オブジェクト（`core/app-state.js`）を各モジュールがimport
- **クロスモジュール呼び出し**: `main.js` が全関数を `window.*` に公開、各モジュールは `if (typeof window.xxx === 'function') window.xxx()` で呼び出し
- **循環依存回避**: `undo-redo.js` は `onRestore()` コールバック登録パターンで crop-mode の関数を呼ぶ。`guides.js` は `crop-mode.js` をimportしない
- **初期化順序**: Tauri API → window公開 → onRestore登録 → 全setupEvents → loadSettings → デフォルト出力フォルダ

### 主要な関数（モジュール別）

- `execution.js`: `execute()`, `collectSettings()`, `updateProgress()`, `groupFilesBySubfolder()`
- `file-handling.js`: `handleDroppedPaths()`, `updateFileInfo()`, `updateOutputInfo()`, `resetFileSelection()`
- `output-panels.js`: `setupPresetCards()`, `updateOutputPanels()`, `syncNombreSettings()`
- `preview.js`: `updateSpreadPreview()`, `loadPreviewImageByIndex()`
- `crop-mode.js`: `openCropMode()`, `closeCropMode()`, `updateSelectionVisual()`
- `guides.js`: `drawRulers()`, `renderGuides()`, `addGuide()`, `removeGuide()`
- `settings.js`: `loadSettings()`, `saveSettings()`, `resetSettings()`

### 進捗オーバーレイ（Tachimiアニメーション）

`processingOverlay` オブジェクトで制御:
- `show(totalFiles)` - 表示開始、経過時間タイマー開始、キャンセルボタン表示
- `hide()` - 非表示、アニメーション・タイマー停止、キャンセルボタン非表示
- `setPhase(phase)` - フェーズ切替（prepare/process/pdf/complete）
- `updateDisplay(current, total, filename, inProgress)` - 進捗更新
- `startAnimation()` / `stopAnimation()` - プログレスバーのスムーズアニメーション
- `cancelled` - キャンセル状態フラグ

**進捗表示の設計思想:**
- **Tachimiストロークアニメーション** → SVGテキストが1文字ずつ描画→グロー→フェードアウトのループ
- **極細プログレスライン** → シアンのグラデーション、Cormorant Garamond italicでパーセント表示
- **キャンセルボタン** → 画面右下に固定（position: fixed）、控えめな×ボタン（通常はほぼ透明、ホバーで表示）
- **完了チェックマーク** → ローズ色のストローク描画アニメーション

## バックエンド

### 処理キャンセル機構

`CANCEL_FLAG: AtomicBool` をグローバルに配置:
- `cancel_processing` コマンドで `true` に設定
- `process_images` 開始時に `false` にリセット
- rayonループ内で各ファイル処理前にチェック → `return`でスキップ
- PDF生成ループ内でもチェック → `Err`で中断
- キャンセル時は `ProcessResult` に「処理がキャンセルされました」メッセージを含めて返す

### 画像処理パイプライン

```
Input File
    ↓
[Cancel Check] → キャンセル時はスキップ
    ↓
[Load Image] → PSD cache check → PSD fast-load OR 標準読み込み
    ↓
[Apply Crop] → リファレンスサイズへスケーリング → 境界検証
    ↓
[Tachikiri] → 6種類のボーダー処理
    ↓
[Add Nombre] → タチキリタイプに応じた配置（下部マージン）
    ↓
[Resize] → スケーリングモード適用（none/percent/fixed）
    ↓
[Encode JPEG] → MozJPEG quality 95%
    ↓
Output JPEG → output/jpg/filename.jpg
    ↓
[PDF Generation] → Spread/Single（マージン、ノド、ノンブル付き）
    ↓
Output PDF → output/output_name_spread.pdf or _single.pdf
```

### タチキリタイプ（6種類）

| タイプ | 説明 |
|--------|------|
| `none` | 処理なし |
| `crop` | クロップのみ |
| `crop_and_stroke` | クロップ＋線 |
| `stroke_only` | 線のみ |
| `fill_white` | 白塗りつぶし |
| `fill_and_stroke` | 塗りつぶし＋線 |

### ProcessOptions 構造体

```rust
pub struct ProcessOptions {
    pub crop_left: u32,
    pub crop_top: u32,
    pub crop_right: u32,
    pub crop_bottom: u32,
    pub tachikiri_type: String,     // タチキリタイプ
    pub stroke_color: String,        // 線の色
    pub fill_color: String,          // 塗りの色
    pub fill_opacity: u8,            // 0-100
    pub reference_width: u32,        // リファレンス幅
    pub reference_height: u32,       // リファレンス高さ
    pub add_nombre: bool,
    pub nombre_start_number: u32,
    pub nombre_size: String,         // small/medium/large/xlarge
    pub nombre_from_filename: bool,  // ファイル名の数字をノンブルに使う
    pub resize_mode: String,         // none/percent/custom/fixed
    pub resize_percent: u32,
    pub resize_width: u32,           // custom時の収まり先幅(px)
    pub resize_height: u32,          // custom時の収まり先高さ(px)
}
```

### PdfOptions 構造体

```rust
pub struct PdfOptions {
    pub preset: String,
    pub width_mm: f32,
    pub height_mm: f32,
    pub gutter: u32,              // ノド幅（px）
    pub padding: u32,             // 余白（px）
    pub is_spread: bool,
    pub add_white_page: bool,     // 白紙ページ追加
    pub print_work_info: bool,    // 作品情報印刷
    pub work_info: Option<WorkInfo>,
    pub add_nombre: bool,         // PDF余白にノンブルを追加
    pub nombre_size: String,      // small/medium/large/xlarge
    pub nombre_from_filename: bool, // ファイル名の数字をノンブルに使う
}
```

> `add_white_page` / `print_work_info` / `work_info` は**見開き・単ページの両方**で有効（v1.2.24〜）。単ページは先頭に白紙ページ（作品情報の印字対応）を挿入する。

### ノンブルサイズ

| サイズ | 画像焼き込み（余白なし時） | PDF余白（余白あり時） |
|--------|---------------------------|---------------------|
| small | 80px | 7pt |
| medium | 120px | 9pt |
| large | 160px | 12pt |
| xlarge | 200px | 14pt |

### ノンブル配置ロジック

```
PDF出力の場合:
├─ 余白有効 → PDF余白に追加（画像には追加しない）
└─ 余白無効 → 画像に追加（タチキリ領域内）

JPEG出力のみの場合:
└─ 画像に追加（タチキリ領域内）
```

## PSD高速読み込み

### 実装概要

2段階のアプローチを実装:

1. **フラット化画像の直接読み込み** (`load_psd_composite`)
   - PSDファイルのImage Dataセクション（保存時に生成される合成済み画像）を直接読み取る
   - レイヤー合成をスキップし、10倍以上の高速化を実現

2. **フォールバック** (`load_psd_with_layers`)
   - フラット化画像が読めない場合は従来のpsd crateでレイヤー合成

### キャッシュ機構

- PSDキャッシュ: 最大10ファイル、フォルダ切り替え時に自動クリア
- フォントキャッシュ: `OnceLock`によるスレッドセーフなシングルインスタンス

## 並列処理

- `rayon` で画像処理を並列化（キャンセル対応）
- スレッド数: CPUコア数と同数（最大8スレッド、メモリ消費抑制のため）— `init_thread_pool()`
- 進捗は `AtomicUsize` でスレッドセーフに管理
- キャンセルは `AtomicBool` フラグで制御

## 開発コマンド

```bash
npm start          # 開発サーバー起動
npm run tauri dev  # 同上
npm run tauri build --debug  # デバッグビルド
```

## 出力パス規則

- JPEG: `outputFolder/jpg/` サブフォルダ
  - 既存フォルダがある場合は自動で連番付与: `jpg(1)/`, `jpg(2)/`, ...
- PDF用一時JPEG: `outputFolder/_temp_pdf_source/`（処理後削除）
- PDF: `outputFolder/出力名_単ページ.pdf` または `出力名_見開き.pdf`
  - 同名ファイルが存在する場合は自動で連番付与: `出力名_見開き(1).pdf`
- `process_images` コマンドは実際のJPEG出力パスを `ProcessResult.output_folder` で返す（PDF生成時のソース参照用）

## UI/UX

### デザイン方針: ダークテーマ + ローズアクセント

漫画原稿処理ツールとして、ダークUIにブラッシュローズのアクセントカラーを採用。

### カラースキーム

```css
/* 背景 */
--bg-deep: #0a0a0d;
--bg: #131316;
--bg2: #1c1c21;
--bg3: #26262d;

/* テキスト */
--text: #e8e8ec;
--text2: #a0a0a8;
--text3: #606068;

/* アクセント: ブラッシュローズ */
--accent: #a0787e;
--accent2: #d4a8b0;

/* 朱色 */
--vermillion: #c41e3a;

/* ボーダー */
--border: #3a3a42;
```

### コンテキスト別カラー

| コンテキスト | カラー | 用途 |
|-------------|--------|------|
| グローバル | rose #a0787e / #d4a8b0 | メインアクセント |
| チェックボックス | slate blue #7088a0 / #4e6478 | 選択状態 |
| クロップモード | blue #1565c0 / #2196f3 | スコープオーバーライド |
| アラートOKボタン | blue #1565c0 | 個別オーバーライド |
| クロップ適用 | vermillion #c41e3a | 適用ボタン |
| JSON UI | rose (globalから継承) | JSON関連パネル |
| Tachimiアニメーション | rose #d4a8b0 / cream #fde8ec | ストローク＋グロー |
| 完了チェックマーク | rose #d4a8b0 | 完了アニメーション |
| ファイル選択チェック | mint #5ec6a4 | ファイル読込状態 |
| クロップ完了ステップ | gold #c9a55c | 完了済みステップ |

### クロップモード

- フルスクリーンルーラーベースの画像プレビュー
- ルーラー上でドラッグしてガイド作成
- LED風の数値入力フィールド
- ページナビゲーション（前/次ボタン）
- Undo/Redo対応（最大50履歴）

### JSONセレクションモーダル

- リアルタイムフィルタリング付き検索入力
- フォルダナビゲーション付きファイルブラウザ
- JSON新規登録/既存追加（パスワードロック）

## 注意事項

- `targetFiles` は相対パスを格納（複数フォルダ時は `フォルダ名/ファイル名` 形式）
- `fileEntries` は `{relative_path, subfolder}` の配列。`subfolderMode` はフォルダ読み込み時に自動判定
- `splitPdfBySubfolder` が `true` の場合、PDF生成時にサブフォルダごとに分割出力
- PDFソースは `process_images` が返す `output_folder`（実際のJPEG出力パス）を参照
- ノンブル設定は各パネル間で自動同期される
- `JSON_FOLDER_PATH` は `G:/共有ドライブ/...` にハードコードされている

## 依存関係

### Node.js (package.json)

```json
{
  "devDependencies": {
    "@tauri-apps/cli": "^2.9.6"
  }
}
```
（ランタイム依存なし、フレームワークなし）

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }  # devtoolsは無効（本番ビルドで開発者ツールを開かせない）
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
image = { version = "0.25", features = ["png", "jpeg", "gif", "webp"] }
imageproc = "0.24"
ab_glyph = "0.2"
psd = "0.3"
mozjpeg = "0.10"
printpdf = "0.7"
base64 = "0.22"
walkdir = "2"
rayon = "1.10"
dirs = "5"
tokio = { version = "1", features = ["rt", "sync"] }
```

### devプロファイル最適化

```toml
[profile.dev]
opt-level = 1  # コンパイル速度優先（重い依存のみ個別に opt-level=3）

[profile.dev.package.image]
opt-level = 3
# ... 他の画像/PDF系crate（imageproc, mozjpeg, psd, png, printpdf, rayon 等）も opt-level=3
```

## 自動更新機能

GitHub Releases + tauri-plugin-updater + minisign署名。
詳細は `tauri.conf.json` の `plugins.updater` と `.github/workflows/release.yml` を参照。

### リリース手順

1. `tauri.conf.json` と `Cargo.toml` の `version` を更新
2. コミット＆プッシュ
3. タグを作成してプッシュ: `git tag v1.0.x && git push origin main && git push origin v1.0.x`
4. GitHub Actions が自動でビルド・リリース作成

### GitHub リポジトリ

https://github.com/Ina986/Tachimi-_Standalone

## 実装済みの改善

- [x] 進捗オーバーレイ刷新（Tachimiストロークアニメーション）
- [x] UIデザイン刷新（ダークテーマ + ローズアクセント）
- [x] Rustモジュール分割（processor/配下へ整理）
- [x] ES Modulesシステム（src/js/）
- [x] PSD高速読み込み（フラット化画像直接読み取り）
- [x] フォントキャッシュシステム
- [x] JSONモーダル（検索・ナビゲーション・新規登録機能）
- [x] ルーラーベースガイドシステム
- [x] ノンブルサイズ拡張（xlarge追加）
- [x] 機能アンロック（パスワード保護、640:909比率固定）
- [x] 自動更新機能（GitHub Releases + tauri-plugin-updater）
- [x] CSP/assetProtocol設定の最適化
- [x] PDF出力の同名ファイル自動連番（上書き防止）
- [x] バッチ処理のキャンセル機能（AtomicBoolフラグ + 控えめな×ボタン）
- [x] renderer.js → ES Modules完全移行（6,138行 → 16モジュールに分割）
- [x] JPEG出力の連番フォルダ対応（jpg → jpg(1) → jpg(2)...）
- [x] 複数フォルダ対応（D&D・ダイアログ複数選択・サブフォルダ自動検出）
- [x] PDF分割出力トグル（単一PDF / 分割PDF切り替えボタン）
- [x] デスクトップアイコンへのフォルダD&Dで起動（複数フォルダ対応、位置引数からパス検出）
- [x] PDF出力の画質改善（PDF用中間JPEGをquality100に変更）
- [x] PDF出力のタイル状アーティファクトを修正（interpolateをtrueに維持）
- [x] PDFページサイズの自動DPI計算（画像寸法と目標B5サイズから実DPIを算出、100%表示で画面に収まるように）
- [x] 1200dpi原稿のJPEG品質自動切替（長辺7000px超でquality100を適用）
- [x] 開発ビルド高速化（profile.dev opt-level 2→1に変更）
- [x] 出力先フォルダの永続化（次回起動時に前回選択した出力先を自動復元、`OUTPUT_FOLDER_STORAGE_KEY`をlocalStorageに保存／リセットボタンで削除）
- [x] セキュリティ強化（許可リスト方式の`SecurityState`、パストラバーサル対策、最小権限capabilities、CSP有効化）— レビュー確認済 2026-05-29

## 今後の改善候補

- [ ] プリセット保存/読み込み機能
- [ ] 処理履歴の表示
- [ ] 設定のエクスポート/インポート
- [ ] テスト基盤の構築

---

## v1.2.22: Daiwari PDFジョブ連携・Acrobat互換JPEG埋め込み・デッドコード削除

### A. Daiwari ManagerからのPDFジョブ実行に対応

A1. **`--pdf-job` ヘッドレス実行を追加** ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)): Daiwari Managerから渡されたジョブJSONを読み取り、UIを表示せず `generate_pdf_headless` を実行して結果JSONを書き戻す経路を追加。

A2. **アプリ内PDF生成とヘッドレスPDF生成を共通化** ([src-tauri/src/processor/mod.rs](src-tauri/src/processor/mod.rs), [src-tauri/src/processor/pdf/single.rs](src-tauri/src/processor/pdf/single.rs), [src-tauri/src/processor/pdf/spread.rs](src-tauri/src/processor/pdf/spread.rs)): Tauriの進捗イベントが不要なヘッドレス実行でも同じPDF生成処理を使えるよう、`AppHandle` を任意扱いにした。

### B. PDF画像破損対策

B1. **JPEG直埋め時の色空間判定を追加** ([src-tauri/src/processor/pdf/common.rs](src-tauri/src/processor/pdf/common.rs)): JPEG SOFマーカーからコンポーネント数を読み取り、グレースケール/RGB/CMYKを正しい `ColorSpace` でPDFに埋め込むようにした。

B2. **Acrobat互換性が不安なJPEGだけ再エンコード**: プログレッシブJPEGなど安全に直埋めできない形式はRGB JPEGへ正規化し、通常のベースラインJPEGは高速に直埋めする。

B3. **白ページ生成JPEGを標準エンコーダへ変更**: PDF内の白紙ページ生成で画像データ不足が起きないよう、白JPEGの生成経路を安定化した。

### C. デッドコード削除

C1. **未使用ヘルパーを削除**: `extract_psd_thumbnail`, `blend_pixels`, `mm_to_px`, `calc_page_size_mm`, `load_and_create_pdf_image`, `combine_images_horizontal`, `add_padding_to_image` を削除し、関連する未使用importも整理。

### バージョン同期

`src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.2.22`** に更新。

---

## v1.2.24: 設定永続化の拡充・単ページ余白/白紙・ファイル名連動ノンブル・リサイズ手入力

### A. 設定の永続化を拡充（[settings.js](src/js/features/settings.js)）

A1. **塗りの不透明度・リサイズ設定を記憶**: `fillOpacity` / `resizeMode` / `resizePercent` / `resizeWidth` / `resizeHeight` を localStorage に保存・復元・リセット対応へ追加（従来は塗り色・保存先のみ永続化）。

### B. 数値スライダーの操作性向上（[index.html](src/index.html), [output-panels.js](src/js/features/output-panels.js)）

B1. **5刻み＋手入力**: ノド・余白・不透明度スライダーを `step=5` 化。値表示を直接入力できる number 欄に置換し、スライダーと双方向同期（`bindSliderValuePair`、`.slider-value-input`、min/maxクランプ）。

### C. 単ページPDFの機能拡張

C1. **余白（padding）スライダーを追加**（[single.rs](src-tauri/src/processor/pdf/single.rs) は元々padding対応、UI/受け渡しを追加）。`singlePaddingEnabled` / `singlePaddingSlider`。ノンブル有効時は最低120px確保。

C2. **ノンブル位置を引き上げ**: 単ページのノンブルが下寄りすぎたため `text_y = padding_mm * 0.65 - …` に変更。

C3. **先頭白紙＋作品情報に対応**: `singleWhitePage` / `singleWorkInfo` を追加。`generate_single_pdf` に `add_white_page` / `print_work_info` / `work_info` を追加し、先頭に白紙ページ（作品情報印字対応・`create_white_page_image`）を挿入。作品情報チェックは見開きと共通の `setupWorkInfoCheckbox`（JSON/手動ダイアログ → `appState.workInfoSource`）に集約。

### D. ファイル名連動ノンブル（[mod.rs](src-tauri/src/processor/mod.rs), single/spread, [lib.rs](src-tauri/src/lib.rs)）

D1. **「ファイル名の番号を使う」**: 各出力パネルにチェックを追加し `nombre_from_filename` を `PdfOptions` / `ProcessOptions` に追加。Rust `extract_page_numbers_from_filenames` が**全ファイル共通の先頭/末尾を除いた“変化部分”の数字**を採用（単一はファイル名全体、数字無しは連番にフォールバック）。単ページ・見開き・画像焼き込みすべてに適用。

### E. リサイズ「サイズ指定（手入力）」モード（[image_processing.rs](src-tauri/src/processor/image_processing.rs)）

E1. **`custom` モード追加**: 手入力の幅×高さに**アスペクト比を保って収める**（`fixed` と同じfitロジック）。`resize_width` / `resize_height` を `ProcessOptions` に追加。入力欄は見やすいよう幅を拡大。

### F. 作品情報レイアウト修正（[common.rs](src-tauri/src/processor/pdf/common.rs)）

F1. **巻数と著者の重なりを解消**: 著者ブロックの上端をタイトルブロック（巻数を含む）の下端より下にクランプ（`min_author_top = current_y + base_size*1.2`）。

### バージョン同期

`src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json` を **`1.2.24`** に更新。
