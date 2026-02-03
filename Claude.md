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
│   ├── index.html                    # メインHTML (720行)
│   ├── renderer.js                   # メインロジック (4,811行)
│   ├── styles.css                    # スタイル (5,634行)
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
│   │   ├── main.rs                   # エントリ (183行)
│   │   ├── lib.rs                    # Tauriコマンド定義 (466行)
│   │   └── processor/                # 画像処理モジュール群
│   │       ├── mod.rs                # モジュールエクスポート (160行)
│   │       ├── types.rs              # 型定義 (152行)
│   │       ├── cache.rs              # PSD/フォントキャッシュ (116行)
│   │       ├── image_loader.rs       # 画像読み込み (343行)
│   │       ├── image_processing.rs   # 画像処理 (338行)
│   │       ├── jpeg.rs               # MozJPEGエンコード (111行)
│   │       └── pdf/                  # PDF生成
│   │           ├── mod.rs            # PDFモジュール (10行)
│   │           ├── common.rs         # PDF共通処理 (345行)
│   │           ├── single.rs         # 単ページPDF (156行)
│   │           └── spread.rs         # 見開きPDF (256行)
│   ├── capabilities/
│   │   └── default.json              # パーミッション設定
│   ├── Cargo.toml
│   └── tauri.conf.json               # Tauri設定
├── タチミ起動.bat                     # npm start を実行
└── package.json
```

## 主要なTauriコマンド

| コマンド | 説明 |
|---------|------|
| `get_image_files` | フォルダ内の画像ファイル一覧を取得（PSDキャッシュも自動クリア） |
| `get_image_preview` | Base64形式でプレビュー取得（PSD高速読み込み+キャッシュ対応） |
| `get_image_preview_as_file` | ファイル経由でプレビュー取得（高速） |
| `process_images` | 画像処理（クロップ・タチキリ・リサイズ・ノンブル） |
| `generate_pdf` | 単ページ/見開きPDF生成（余白・ノンブル対応） |
| `open_folder` | エクスプローラーでフォルダを開く |
| `delete_folder` | フォルダを削除 |
| `clear_psd_cache` | PSD画像キャッシュを手動クリア |
| `list_json_files` | JSONファイル一覧取得（レガシー互換） |
| `list_folder_contents` | サブフォルダとJSONファイル一覧取得 |
| `search_json_folders` | JSONファイル全文検索（Label/Title.json構造） |

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
- `execute()` - メイン処理実行
- `updateFileInfo()` - ファイル情報表示更新
- `updateProgress(data)` - 進捗表示更新
- `handleDroppedPaths(paths)` - ドラッグ＆ドロップ処理
- `collectSettings()` - 設定値を収集
- `syncNombreSettings(source)` - ノンブル設定を各パネル間で同期
- `updateSpreadNombreHint()` - 見開きPDFのノンブルヒント更新（余白有無で切替）
- `updateOutputNameFromFolder()` - 入力フォルダ名から出力ファイル名を自動設定

### 進捗オーバーレイ（印刷工房デザイン）

`processingOverlay` オブジェクトで制御:
- `show(totalFiles)` - 表示開始、経過時間タイマー開始
- `hide()` - 非表示、アニメーション・タイマー停止
- `setPhase(phase)` - フェーズ切替（prepare/process/pdf/complete）
- `updateDisplay(current, total, filename, inProgress)` - 進捗更新
- `startAnimation()` / `stopAnimation()` - インクバーのスムーズアニメーション
- `startElapsedTimer()` / `stopElapsedTimer()` - 経過時間表示
- `formatTime(ms)` - 時間フォーマット（m:ss形式）

**進捗表示の設計思想: 「印刷工房」**
- **印刷機パネル風UI** → ダークメタリックなコントロールパネル
- **インクローラー進捗バー** → 両端にローラー、青いインクが広がる表現
- **工程ステップ表示** → 準備→変換→製本→完了の4段階
- **7セグ風ディスプレイ** → モノスペースフォントでパーセント表示
- **完了時の押印エフェクト** → 赤い印鑑がスタンプされるアニメーション
- **経過時間表示** → 処理時間をリアルタイム表示

## バックエンド

### Rustモジュール構成

```
processor/
├── mod.rs              # モジュールエクスポート
├── types.rs            # 構造体定義（ProcessOptions, PdfOptions等）
├── cache.rs            # PSD/フォントキャッシュ管理
├── image_loader.rs     # 画像読み込み（PSD高速読み込み含む）
├── image_processing.rs # 画像処理（クロップ、タチキリ、ノンブル）
├── jpeg.rs             # MozJPEGエンコード
└── pdf/
    ├── mod.rs          # PDFモジュール
    ├── common.rs       # PDF共通ユーティリティ
    ├── single.rs       # 単ページPDF生成
    └── spread.rs       # 見開きPDF生成
```

### 画像処理パイプライン

```
Input File
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

### WorkInfo 構造体

```rust
pub struct WorkInfo {
    pub label: String,        // レーベル名
    pub author_type: u8,      // 0=単独, 1=分離, 2=そのまま
    pub author1: String,      // 作画
    pub author2: String,      // 原作
    pub title: String,        // タイトル
    pub subtitle: String,     // サブタイトル
    pub version: String,      // 巻数
}
```

### ノンブルサイズ

| サイズ | フォントサイズ |
|--------|---------------|
| small | 160px |
| medium | 240px |
| large | 320px |
| xlarge | 400px |

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
   - Photoshopの「互換性を最大に」オプションで保存されたPSDに対応

2. **フォールバック** (`load_psd_with_layers`)
   - フラット化画像が読めない場合は従来のpsd crateでレイヤー合成

### キャッシュ機構

**PSDキャッシュ:**
- 最大10ファイルをメモリキャッシュ
- フォルダ切り替え時に自動クリア
- `clear_psd_cache` コマンドで手動クリアも可能

**フォントキャッシュ:**
- `OnceLock`によるシングルインスタンス（スレッドセーフ）
- 日本語フォント検索（Yu Gothic, Meiryo, MS Gothic）

### 対応形式

- 圧縮方式: Raw (非圧縮)、RLE (PackBits)
- カラーモード: RGB、Grayscale
- ビット深度: 8bit

## 並列処理

- `rayon` で画像処理を並列化
- スレッド数: CPUコア数 × 2（最大32）
- 進捗は `AtomicUsize` でスレッドセーフに管理

## 進捗イベント

```rust
ProgressPayload {
    current: usize,      // 完了数
    total: usize,        // 合計
    filename: String,    // 処理中ファイル名
    phase: String,       // フェーズ表示
    in_progress: usize,  // 現在処理中のファイル数
}
```

## ドラッグ＆ドロップ

Tauri v2のネイティブイベントを使用:
- `tauri://drag-enter`
- `tauri://drag-over`
- `tauri://drag-leave`
- `tauri://drag-drop`

`tauri.conf.json` で `dragDropEnabled: true` が必要。

## 開発コマンド

```bash
npm start          # 開発サーバー起動
npm run tauri dev  # 同上
npm run tauri build --debug  # デバッグビルド
```

## GitHub リポジトリ & 自動更新

### リポジトリ情報

- **URL**: https://github.com/Ina986/Tachimi-_Standalone
- **GitHub Actions**: タグ push で自動ビルド＆リリース作成

### 署名キー（重要！）

自動更新機能には署名が必要。キーファイルは以下に保存:

```
.tauri/
├── tachimi.key      # 秘密鍵（絶対にコミットしない！.gitignore済み）
└── tachimi.key.pub  # 公開鍵（tauri.conf.json に設定済み）
```

**秘密鍵の値**（GitHub Secrets に設定済み）:
```
dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5VTNTRENYZU8wVW9obm5sTWtOWENvNTVTYkZXNnVjMXZHbnRISXdYczdyY0FBQkFBQUFBQUFBQUFBQUlBQUFBQTZlYWRicHZnT2k1d0ZpSlpEemdMMnl1Nm1sTTdKZ3pNRDUwQ0thTFhvQzBxQTFmeHhVZ3l6ZmJoM2xTTnUvNjE4NVJFdnhQOWd1OUduWlRaQVlWSVJnUERZcEdKRERtdGdLZW1yOFp3Y3hIVW9TVjB3RnF5Y3pETXc0RzgrcVo3RlNaZDI5OGhzZE09Cg==
```

### GitHub Secrets 設定

リポジトリの **Settings → Secrets and variables → Actions** に以下を設定済み:

| Secret名 | 説明 |
|----------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | 上記の秘密鍵の値 |

### 新バージョンのリリース手順

#### 1. コードを修正する

#### 2. バージョン番号を更新
`src-tauri/tauri.conf.json` の `version` を変更:
```json
{
  "version": "1.0.1"  // ← ここを更新
}
```

#### 3. コミット & プッシュ
```bash
git add -A
git commit -m "v1.0.1: 変更内容の説明"
git push origin main
```

#### 4. タグを作成してプッシュ
```bash
git tag v1.0.1
git push origin v1.0.1
```

#### 5. GitHub Actions を確認
https://github.com/Ina986/Tachimi-_Standalone/actions でビルド状況を確認

#### 6. リリースを公開
https://github.com/Ina986/Tachimi-_Standalone/releases でドラフトを確認し、「Publish release」をクリック

### 自動更新の仕組み

1. ユーザーがアプリの設定画面（鍵アイコン）で「更新を確認」をクリック
2. アプリが `latest.json` を取得して新バージョンがあるか確認
3. 新バージョンがあれば「ダウンロードしてインストール」ボタンを表示
4. クリックすると自動でダウンロード＆インストール＆再起動

### 設定ファイル

**tauri.conf.json の updater 設定**:
```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/Ina986/Tachimi-_Standalone/releases/latest/download/latest.json"
      ],
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJFM0FFMDlCNkU5REU2RTkKUldUcDVwMXVtK0E2THZiaDNsU051LzYxODVSRXZ4UDlndTlHblpUWkFZVklSZ1BEWXBHSkREbXQK"
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

### トラブルシューティング

**ビルドが失敗する場合:**
1. GitHub Actions のログを確認
2. `TAURI_SIGNING_PRIVATE_KEY` が正しく設定されているか確認

**latest.json が生成されない場合:**
- `tauri.conf.json` に `"createUpdaterArtifacts": true` があるか確認
- ワークフローに `includeUpdaterJson: true` があるか確認

**署名キーを紛失した場合:**
新しいキーを生成する必要がある（既存ユーザーは手動再インストールが必要）:
```bash
npx tauri signer generate --ci -p "" -w .tauri/tachimi.key
```
→ 新しい公開鍵を `tauri.conf.json` に設定し、秘密鍵を GitHub Secrets に再設定

## 出力パス規則

- JPEG: `outputFolder/jpg/` サブフォルダ
- PDF用一時JPEG: `outputFolder/_temp_pdf_source/`（処理後削除）
- PDF: `outputFolder/出力名_単ページ.pdf` または `出力名_見開き.pdf`

## UI/UX

### デザイン方針: 「印刷工房」- 職人的な洗練

漫画原稿処理ツールとして、印刷・製本の世界観を取り入れた職人的なダークUIを採用。

**チェックボックス「押印」スタイル:**
- インセットシャドウで「押す」ような深みを表現
- チェック時は赤い印鑑グラデーション（#c41e3a → #8b0000）
- `stampIn`アニメーションで印を押すような動き

**スライダー「精密ダイヤル」スタイル:**
- トラック: 青グラデーション + 深いインセットシャドウ
- サム: 金属的な放射状グラデーション（メタリックシルバー）
- ホバー時に光沢増加 + 青いグロー

**レイアウト「コントロールパネル」スタイル:**
- スライダーグループ: ダークグラデーション背景 + 上部に青いアクセントライン
- オプション行: 個別カード化、チェック時に赤いグロー
- 数値表示: 白文字 + 青いテキストシャドウで強調

**プレビューエリア:**
- 中央から広がる微細な青いグラデーション背景
- 深い多層シャドウで浮遊感
- ホバー時に上昇 + グロー効果

### クロップモード

- フルスクリーンルーラーベースの画像プレビュー
- ルーラー上でドラッグしてガイド作成
- フローティングガイドアクションボタン
- LED風の数値入力フィールド
- ページナビゲーション（前/次ボタン）

### JSONセレクションモーダル

- リアルタイムフィルタリング付き検索入力
- フォルダナビゲーション付きファイルブラウザ
- 階層的なLabel/Title表示
- ローカルファイルピッカー用「Browse」ボタン

### ドロップゾーン

- 固定サイズ（110px）で読み込み状態でもサイズ変化なし
- 空状態/読み込み済み状態で表示を切替
- クリアボタンで入力をリセット

### 出力設定

- 出力パスは省略表示（先頭...末尾）+ ツールチップでフルパス
- 出力ファイル名は入力フォルダ名から自動設定
- 手動編集可能

### 出力タイプカード

- 見開きPDF / 単ページPDF / JPEG の3種類
- 複数選択可能
- 選択時は文字・アイコンが白に変化（青くならない）

### ノンブル設定ヒント

各パネルにノンブル配置場所の説明を表示:
- 見開きPDF: 「※ 余白有効時はPDF余白に追加」（余白OFF時は動的に更新）
- 単ページPDF: 「※ 有効時はPDF下部に余白を追加」
- JPEG: 「※ 画像下部に追加（タチキリ領域内）」

## 注意事項

- `targetFiles` はファイル名のみ格納（フルパスではない）
- PDFソースは処理後JPEGの場合 `/jpg` サブフォルダを参照する必要あり
- ノンブル設定は各パネル間で自動同期される

## CSS変数

```css
--bg: #1a1a1a;
--bg2: #222;
--bg3: #2a2a2a;
--text: #fff;
--text2: #ccc;
--text3: #888;
--accent: #1a8cff;
--accent2: #4dabff;
--border: #333;
```

### 主要なUIコンポーネント（styles.css内）

| コンポーネント | クラス | 特徴 |
|---------------|--------|------|
| チェックボックス | `.checkbox-sm` | 押印スタイル、赤グラデーション |
| スライダー | `.slider-sm` | 精密ダイヤル、メタリックサム |
| スライダーグループ | `.toggle-slider-group` | コントロールパネル風 |
| オプション行 | `.spread-options-row` | カード化されたチェックボックス |
| ノンブル設定 | `.spread-nombre-section` | ダークパネル |
| プレビューエリア | `.spread-preview-area` | 青グラデーション背景 |
| 印刷機パネル | `.print-machine` | ダークメタリック、インセットシャドウ |
| インクローラー | `.ink-roller-container` | 青いインクバー、両端にローラー |
| 工程ステップ | `.process-steps` | 準備→変換→製本→完了 |
| 押印完了 | `.stamp-complete` | 赤い印鑑、スタンプアニメーション |
| 経過時間 | `.time-display` | モノスペースフォント表示 |

## 依存関係

### Node.js (package.json)

```json
{
  "dependencies": {
    "pdf-lib": "^1.17.1",
    "psd": "^3.4.0",
    "sharp": "^0.33.2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.9.6"
  }
}
```

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-shell = "2"
image = { version = "0.25", features = ["png", "jpeg", "gif", "webp"] }
imageproc = "0.24"
ab_glyph = "0.2"
psd = "0.3"
mozjpeg = "0.10"
printpdf = "0.7"
base64 = "0.22"
walkdir = "2"
rayon = "1.10"
tokio = { version = "1", features = ["rt", "sync"] }
```

## 実装済みの改善

- [x] 進捗オーバーレイ刷新（印刷工房デザイン、インクローラーバー、押印完了）
- [x] UIデザイン刷新（押印チェックボックス、精密ダイヤルスライダー）
- [x] Rustモジュール分割（processor/配下へ整理）
- [x] ES Modulesシステム（src/js/）
- [x] PSD高速読み込み（フラット化画像直接読み取り）
- [x] フォントキャッシュシステム
- [x] JSONモーダル（検索・ナビゲーション機能）
- [x] ルーラーベースガイドシステム
- [x] ノンブルサイズ拡張（xlarge追加）

## 今後の改善候補

- [ ] プリセット保存/読み込み機能
- [ ] バッチ処理のキャンセル機能
- [ ] 処理履歴の表示
- [ ] 設定のエクスポート/インポート
