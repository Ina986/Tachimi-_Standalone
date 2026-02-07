# CLAUDE.md - タチミ Standalone

## プロジェクト概要

漫画原稿の一括処理アプリ。PSDファイルを読み込み、タチキリ処理・リサイズ・ノンブル追加を行い、JPEG/PDFとして出力する。

## 技術スタック

- **フロントエンド**: HTML/CSS/JavaScript（フレームワークなし、ES Modules対応）
- **バックエンド**: Rust + Tauri v2
- **画像処理**: image crate, imageproc, ab_glyph（フォント描画）, psd crate, mozjpeg
- **PDF生成**: printpdf crate

## ディレクトリ構成

```
tachimi_standalone/
├── src/                              # フロントエンド
│   ├── index.html                    # メインHTML (~900行)
│   ├── renderer.js                   # メインロジック (~6,100行)
│   ├── styles.css                    # スタイル (~7,400行)
│   ├── styles/                       # 分離済みCSS
│   │   ├── main.css                  # スタイルエントリ
│   │   ├── utilities/variables.css   # CSS変数
│   │   └── components/drop-zone.css  # ドロップゾーン
│   └── js/                           # ES Modules
│       ├── main.js                   # モジュールエントリポイント
│       ├── core/
│       │   ├── state.js              # StateStoreクラス（状態管理）
│       │   ├── events.js             # EventBusクラス（イベント通信）
│       │   └── tauri-api.js          # Tauri v2 APIラッパー
│       ├── ui/
│       │   ├── overlay.js            # ProcessingOverlay
│       │   └── alerts.js             # ダイアログユーティリティ
│       └── utils/
│           ├── dom.js                # DOM操作ヘルパー
│           ├── formatters.js         # フォーマット関数
│           └── storage.js            # LocalStorage管理
├── src-tauri/                        # Rustバックエンド
│   ├── src/
│   │   ├── main.rs                   # エントリ (6行)
│   │   ├── lib.rs                    # Tauriコマンド定義 (~550行)
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
│   │   └── default.json              # パーミッション設定
│   ├── Cargo.toml
│   └── tauri.conf.json               # Tauri設定
├── Tachimi起動.bat                    # npm start を実行
└── package.json
```

## 主要なTauriコマンド

| コマンド | 説明 |
|---------|------|
| `get_image_files` | フォルダ内の画像ファイル一覧を取得（PSDキャッシュも自動クリア） |
| `get_image_preview` | Base64形式でプレビュー取得（PSD高速読み込み+キャッシュ対応） |
| `get_image_preview_as_file` | ファイル経由でプレビュー取得（高速） |
| `process_images` | 画像処理（クロップ・タチキリ・リサイズ・ノンブル） |
| `cancel_processing` | 処理キャンセル（AtomicBoolフラグを設定） |
| `generate_pdf` | 単ページ/見開きPDF生成（余白・ノンブル対応） |
| `open_folder` | エクスプローラーでフォルダを開く |
| `delete_folder` | フォルダを削除 |
| `clear_psd_cache` | PSD画像キャッシュを手動クリア |
| `list_json_files` | JSONファイル一覧取得（レガシー互換） |
| `list_folder_contents` | サブフォルダとJSONファイル一覧取得 |
| `search_json_folders` | JSONファイル全文検索（Label/Title.json構造） |
| `save_json_file` | JSONファイル保存 |
| `read_json_file` | JSONファイル読み込み |
| `ensure_folder_exists` | フォルダ作成（存在しなければ） |
| `file_exists` | ファイル存在確認 |

## フロントエンド

### アーキテクチャ

**ES Modules（src/js/）**
- `StateStore` - ドット記法パスによる状態管理、リアクティブな購読機能
- `EventBus` - モジュール間の疎結合なイベント通信
- `tauri-api.js` - Tauri v2 APIの統一ラッパー

**レガシー（renderer.js）**
- メインロジック（段階的移行中）

### グローバル変数

```javascript
let inputFolder = null;      // 入力フォルダパス
let targetFiles = [];        // ファイル名配列（パスではない）
let outputFolder = null;     // 出力先フォルダ
let selectedOutputs = { spreadPdf: true, singlePdf: false, jpeg: false };
```

### 主要な関数

- `setupEvents()` - イベントリスナー設定
- `execute()` - メイン処理実行（キャンセル対応）
- `updateFileInfo()` - ファイル情報表示更新
- `updateProgress(data)` - 進捗表示更新
- `handleDroppedPaths(paths)` - ドラッグ＆ドロップ処理
- `collectSettings()` - 設定値を収集
- `syncNombreSettings(source)` - ノンブル設定を各パネル間で同期
- `updateSpreadNombreHint()` - 見開きPDFのノンブルヒント更新（余白有無で切替）
- `updateOutputNameFromFolder()` - 入力フォルダ名から出力ファイル名を自動設定

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
    pub resize_mode: String,         // none/percent/fixed
    pub resize_percent: u32,
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
}
```

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
- スレッド数: CPUコア数 × 2（最大32）
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
- PDF用一時JPEG: `outputFolder/_temp_pdf_source/`（処理後削除）
- PDF: `outputFolder/出力名_単ページ.pdf` または `出力名_見開き.pdf`
  - 同名ファイルが存在する場合は自動で連番付与: `出力名_見開き(1).pdf`

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

- `targetFiles` はファイル名のみ格納（フルパスではない）
- PDFソースは処理後JPEGの場合 `/jpg` サブフォルダを参照する必要あり
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
tauri = { version = "2", features = ["protocol-asset", "devtools"] }
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
opt-level = 2  # 画像処理を5-10倍高速化

[profile.dev.package.image]
opt-level = 3
# ... 他の画像/PDF系crateも同様
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

## 今後の改善候補

- [ ] プリセット保存/読み込み機能
- [ ] 処理履歴の表示
- [ ] 設定のエクスポート/インポート
- [ ] renderer.jsの段階的モジュール分割
- [ ] テスト基盤の構築
