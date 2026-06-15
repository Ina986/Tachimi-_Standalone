mod processor;
mod security;
mod psd_safety;
mod updater_local;

/// デバッグ専用ログ。release では出力しない（本番でのパス露出・ログ漏れ防止）。
/// 起動時診断 [seal] は意図的に eprintln を残す（診断用）。
#[macro_export]
macro_rules! dlog {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)] eprintln!($($arg)*);
        #[cfg(not(debug_assertions))] { let _ = format_args!($($arg)*); }
    }};
}

use processor::{
    FileEntry, ImageInfo, PreviewFileInfo, ProcessOptions, ProcessResult, WorkInfo, WorkInfoPreview,
};
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
struct PdfJobBatch {
    jobs: Vec<PdfJobItem>,
    result_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PdfJobItem {
    input_folder: String,
    output_path: String,
    files: Vec<String>,
    options: processor::PdfOptions,
}

#[derive(Debug, Serialize)]
struct PdfJobBatchResult {
    success: bool,
    results: Vec<PdfJobItemResult>,
}

#[derive(Debug, Serialize)]
struct PdfJobItemResult {
    output_path: String,
    success: bool,
    error: Option<String>,
}

fn run_pdf_job_file(job_path: String) -> bool {
    let result = (|| -> PdfJobBatchResult {
        let content = match std::fs::read_to_string(&job_path) {
            Ok(content) => content,
            Err(e) => {
                return PdfJobBatchResult {
                    success: false,
                    results: vec![PdfJobItemResult {
                        output_path: String::new(),
                        success: false,
                        error: Some(format!("PDFジョブファイルを読み込めません: {}", e)),
                    }],
                };
            }
        };

        let batch: PdfJobBatch = match serde_json::from_str(&content) {
            Ok(batch) => batch,
            Err(e) => {
                return PdfJobBatchResult {
                    success: false,
                    results: vec![PdfJobItemResult {
                        output_path: String::new(),
                        success: false,
                        error: Some(format!("PDFジョブJSONを解析できません: {}", e)),
                    }],
                };
            }
        };

        let mut results = Vec::with_capacity(batch.jobs.len());
        for job in batch.jobs {
            let output_path = job.output_path.clone();
            // 連携元（CLI由来）パスを許可リスト検証してから処理（保護パスは拒否）
            let _ = security::grant_user_path(&job.input_folder);
            if let Some(parent) = std::path::Path::new(&job.output_path).parent() {
                let _ = security::grant_user_path(parent);
            }
            if security::ensure_directory_read_path(&job.input_folder).is_err()
                || security::ensure_write_path(&job.output_path).is_err()
            {
                results.push(PdfJobItemResult {
                    output_path,
                    success: false,
                    error: Some("forbidden path".to_string()),
                });
                continue;
            }
            let item = match processor::generate_pdf_headless(
                &job.input_folder,
                &job.output_path,
                &job.files,
                &job.options,
            ) {
                Ok(path) => PdfJobItemResult {
                    output_path: path,
                    success: true,
                    error: None,
                },
                Err(e) => PdfJobItemResult {
                    output_path,
                    success: false,
                    error: Some(e),
                },
            };
            results.push(item);
        }

        let success = results.iter().all(|r| r.success);
        let batch_result = PdfJobBatchResult { success, results };

        if let Some(result_path) = batch.result_path {
            if let Ok(json) = serde_json::to_string_pretty(&batch_result) {
                let _ = std::fs::write(result_path, json);
            }
        }

        batch_result
    })();

    result.success
}

/// 自然順ソート用の比較関数
/// 文字列中の数値部分を数値として比較する（例: "p2" < "p10"）
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut a_chars = a.chars().peekable();
    let mut b_chars = b.chars().peekable();

    loop {
        match (a_chars.peek(), b_chars.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    // 両方が数字: 数値として比較
                    let mut a_num = String::new();
                    while let Some(&c) = a_chars.peek() {
                        if c.is_ascii_digit() {
                            a_num.push(c);
                            a_chars.next();
                        } else {
                            break;
                        }
                    }
                    let mut b_num = String::new();
                    while let Some(&c) = b_chars.peek() {
                        if c.is_ascii_digit() {
                            b_num.push(c);
                            b_chars.next();
                        } else {
                            break;
                        }
                    }
                    let a_val: u64 = a_num.parse().unwrap_or(0);
                    let b_val: u64 = b_num.parse().unwrap_or(0);
                    match a_val.cmp(&b_val) {
                        std::cmp::Ordering::Equal => {
                            // 数値が同じなら桁数で比較（先頭ゼロ考慮）
                            match a_num.len().cmp(&b_num.len()) {
                                std::cmp::Ordering::Equal => continue,
                                other => return other,
                            }
                        }
                        other => return other,
                    }
                } else {
                    // 文字として比較（大文字小文字無視）
                    let al = ac.to_lowercase().next().unwrap_or(ac);
                    let bl = bc.to_lowercase().next().unwrap_or(bc);
                    match al.cmp(&bl) {
                        std::cmp::Ordering::Equal => {
                            a_chars.next();
                            b_chars.next();
                        }
                        other => return other,
                    }
                }
            }
        }
    }
}

/// CLI引数で渡されたファイルパス（起動時に一度だけ取得）
static CLI_FILES: Mutex<Option<Vec<String>>> = Mutex::new(None);

/// CLI引数 または トリガーファイルからファイルパスを取得（フロントエンド初期化後に呼ばれる）
#[tauri::command]
async fn get_cli_files() -> Option<Vec<String>> {
    // 1. まずCLI引数から（setup()で保存済み・grant済み）
    if let Some(paths) = CLI_FILES.lock().unwrap().take() {
        let _ = security::grant_user_paths(&paths);
        return Some(paths);
    }
    // 2. トリガーファイルから（連携アプリが書き出したJSON）
    let trigger_path = std::env::temp_dir().join("tachimi_cli_files.json");
    if trigger_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&trigger_path) {
            // 読み込んだら即削除（二重読み込み防止）
            let _ = std::fs::remove_file(&trigger_path);
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(&content) {
                if !paths.is_empty() {
                    // 連携元の正規パスを許可リストへ（grant_user_path が保護パスを拒否）
                    let _ = security::grant_user_paths(&paths);
                    return Some(paths);
                }
            }
        }
    }
    None
}

/// 処理キャンセル用のグローバルフラグ
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// 並列処理のスレッドプールを初期化
/// メモリ使用量を抑えるためCPUコア数と同数（最大8スレッド）
fn init_thread_pool() {
    let num_cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    // コア数（最大8スレッド）— メモリ消費を抑制
    let num_threads = num_cpus.min(8);

    if let Err(e) = ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build_global()
    {
        dlog!("スレッドプール初期化エラー: {}", e);
    } else {
        dlog!("並列処理: {}スレッドで初期化", num_threads);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub current: usize, // 完了数
    pub total: usize,   // 合計
    pub filename: String,
    pub phase: String,
    pub in_progress: usize, // 現在処理中のファイル数
}

/// フォルダ内の画像ファイル一覧を取得
#[tauri::command]
async fn get_image_files(folder_path: String) -> Result<Vec<String>, String> {
    let path = security::ensure_directory_read_path(&folder_path)?;

    // フォルダ切り替え時にPSDキャッシュをクリア
    processor::clear_psd_cache();

    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "psd", "tif", "tiff"];
    let mut files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if extensions.contains(&ext_lower.as_str()) {
                    if let Some(filename) = path.file_name() {
                        files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| natural_cmp(a, b));
    Ok(files)
}

/// フォルダ内の画像ファイル一覧を再帰的に取得（サブフォルダ対応）
#[tauri::command]
async fn get_image_files_recursive(folder_path: String) -> Result<Vec<FileEntry>, String> {
    let base_path = security::ensure_directory_read_path(&folder_path)?;

    // フォルダ切り替え時にPSDキャッシュをクリア
    processor::clear_psd_cache();

    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "psd", "tif", "tiff"];
    let mut entries: Vec<FileEntry> = Vec::new();

    for entry in walkdir::WalkDir::new(&base_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if extensions.contains(&ext_lower.as_str()) {
                    if let Ok(rel) = path.strip_prefix(&base_path) {
                        let relative_path = rel.to_string_lossy().to_string().replace('\\', "/");

                        let subfolder = rel
                            .parent()
                            .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                            .unwrap_or_default();

                        entries.push(FileEntry {
                            relative_path,
                            subfolder,
                        });
                    }
                }
            }
        }
    }

    // ソート: ルート直下ファイル → サブフォルダ内ファイル（自然順）
    entries.sort_by(|a, b| {
        let a_is_root = a.subfolder.is_empty();
        let b_is_root = b.subfolder.is_empty();
        match (a_is_root, b_is_root) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let folder_cmp = natural_cmp(&a.subfolder, &b.subfolder);
                if folder_cmp != std::cmp::Ordering::Equal {
                    folder_cmp
                } else {
                    natural_cmp(&a.relative_path, &b.relative_path)
                }
            }
        }
    });

    Ok(entries)
}

/// PSDキャッシュをクリア
#[tauri::command]
async fn clear_psd_cache() {
    processor::clear_psd_cache();
}

/// 画像のプレビューを取得（Base64）
#[tauri::command]
async fn get_image_preview(file_path: String, max_size: u32) -> Result<ImageInfo, String> {
    let file_path = security::ensure_read_path(&file_path)?.to_string_lossy().to_string();
    processor::get_image_preview(&file_path, max_size)
}

/// 画像のプレビューをファイルに保存して取得（高速化版）
/// Base64エンコードを回避し、ファイルシステム経由で転送
#[tauri::command]
async fn get_image_preview_as_file(
    app_handle: tauri::AppHandle,
    file_path: String,
    max_size: u32,
) -> Result<PreviewFileInfo, String> {
    // 進捗通知: 読み込み開始
    let _ = app_handle.emit("preview_progress", "reading");

    // 入力ファイルを許可リストで検証
    let file_path = security::ensure_read_path(&file_path)?.to_string_lossy().to_string();

    // 一時ディレクトリを取得
    let temp_dir = std::env::temp_dir().join("tachimi_preview");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("一時フォルダの作成に失敗: {}", e))?;
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    // 非同期でブロッキング処理を実行（UIフリーズを防止）
    let result = tokio::task::spawn_blocking(move || {
        processor::get_image_preview_file(&file_path, max_size, &temp_dir_str)
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))?;

    result
}

/// 処理をキャンセル
#[tauri::command]
async fn cancel_processing() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    dlog!("処理キャンセルが要求されました");
    Ok(())
}

/// 画像を処理（クロップ、タチキリ処理）
#[tauri::command]
async fn process_images(
    app_handle: tauri::AppHandle,
    input_folder: String,
    output_folder: String,
    files: Vec<String>,
    options: ProcessOptions,
) -> Result<ProcessResult, String> {
    // キャンセルフラグをリセット
    CANCEL_FLAG.store(false, Ordering::SeqCst);

    // 処理開始前にPSDキャッシュを解放してメモリを確保
    processor::clear_psd_cache();

    // 入力バリデーション
    if files.is_empty() {
        return Err("処理するファイルが選択されていません".to_string());
    }

    // 許可リスト検証（入力フォルダ=読み取り / 出力フォルダ=書き込み）
    let input_path = security::ensure_directory_read_path(&input_folder)?;
    security::ensure_write_path(&output_folder)?;

    let base_output_path = PathBuf::from(&output_folder);

    // JPEGは "jpg" サブフォルダに出力（一時フォルダの場合はそのまま）
    // 既存フォルダがある場合は連番で新しいフォルダを作成: jpg → jpg(1) → jpg(2) ...
    let output_path = if output_folder.contains("_temp_pdf_source") {
        base_output_path.clone()
    } else {
        let jpg_path = base_output_path.join("jpg");
        if jpg_path.exists() {
            let mut counter = 1u32;
            loop {
                let new_path = base_output_path.join(format!("jpg({})", counter));
                if !new_path.exists() {
                    break new_path;
                }
                counter += 1;
            }
        } else {
            jpg_path
        }
    };

    // 出力フォルダを作成
    std::fs::create_dir_all(&output_path)
        .map_err(|e| format!("出力フォルダの作成に失敗: {}", e))?;

    let total = files.len();
    let processed = AtomicUsize::new(0);
    let in_progress = AtomicUsize::new(0); // 現在処理中のファイル数
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    // ファイル名連動ノンブル用の番号テーブル（有効時のみ計算）
    let filename_page_numbers = if options.nombre_from_filename {
        processor::extract_page_numbers_from_filenames(&files)
    } else {
        Vec::new()
    };

    // rayon並列処理で複数ファイルを同時処理
    // enumerate()でインデックスを取得してノンブル用のページ番号に使用
    files.par_iter().enumerate().for_each(|(index, filename)| {
        // キャンセルチェック
        if CANCEL_FLAG.load(Ordering::Relaxed) {
            return;
        }

        // 処理開始を通知
        let started = in_progress.fetch_add(1, Ordering::SeqCst) + 1;
        let done = processed.load(Ordering::SeqCst);
        let _ = app_handle.emit(
            "progress",
            ProgressPayload {
                current: done,
                total,
                filename: filename.clone(),
                phase: format!("読み込み中... ({} 処理中)", started),
                in_progress: started,
            },
        );

        let input_file = input_path.join(filename);
        // 相対パス（例: "chapter01/p001.psd"）の場合、サブフォルダ構造を出力にミラー
        let relative_jpg = PathBuf::from(filename).with_extension("jpg");
        let output_file = output_path.join(&relative_jpg);

        // 出力サブフォルダが存在しない場合は作成
        if let Some(parent) = output_file.parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    if let Ok(mut errs) = errors.lock() {
                        errs.push(format!("{}: 出力サブフォルダの作成に失敗: {}", filename, e));
                    }
                    in_progress.fetch_sub(1, Ordering::SeqCst);
                    processed.fetch_add(1, Ordering::SeqCst);
                    return;
                }
            }
        }

        // ページ番号 = ファイル名連動なら抽出番号、そうでなければ 開始番号 + インデックス
        let page_number = if options.nombre_from_filename {
            filename_page_numbers
                .get(index)
                .copied()
                .unwrap_or(options.nombre_start_number + index as u32)
        } else {
            options.nombre_start_number + index as u32
        };

        // 画像処理を実行
        let result =
            processor::process_single_image(&input_file, &output_file, &options, page_number);

        // 処理完了後に進捗を送信
        in_progress.fetch_sub(1, Ordering::SeqCst);
        let completed = processed.fetch_add(1, Ordering::SeqCst) + 1;
        let currently_processing = in_progress.load(Ordering::SeqCst);
        let _ = app_handle.emit(
            "progress",
            ProgressPayload {
                current: completed,
                total,
                filename: filename.clone(),
                phase: if currently_processing > 0 {
                    format!(
                        "変換完了 ({}/{}) - {} 処理中",
                        completed, total, currently_processing
                    )
                } else {
                    format!("変換完了 ({}/{})", completed, total)
                },
                in_progress: currently_processing,
            },
        );

        match result {
            Ok(_) => {}
            Err(e) => {
                if let Ok(mut errs) = errors.lock() {
                    errs.push(format!("{}: {}", filename, e));
                }
            }
        }
    });

    // 実際のJPEG出力パス（連番フォルダの場合はjpg(N)になる）
    let actual_output_folder = output_path.to_string_lossy().to_string();

    // キャンセルされた場合は早期リターン
    if CANCEL_FLAG.load(Ordering::Relaxed) {
        let done = processed.load(Ordering::SeqCst);
        return Ok(ProcessResult {
            processed: done,
            total,
            errors: vec![format!(
                "処理がキャンセルされました ({}/{}完了)",
                done, total
            )],
            output_folder: actual_output_folder,
        });
    }

    // Mutexからエラーリストを取得（poisonedの場合は空リストを返す）
    let error_list = errors.into_inner().unwrap_or_else(|poisoned| {
        dlog!("エラーリストのMutexがpoisoned状態です");
        poisoned.into_inner()
    });

    Ok(ProcessResult {
        processed: processed.load(Ordering::SeqCst),
        total,
        errors: error_list,
        output_folder: actual_output_folder,
    })
}

/// PDF生成
#[tauri::command]
async fn generate_pdf(
    app_handle: tauri::AppHandle,
    input_folder: String,
    output_path: String,
    files: Vec<String>,
    options: processor::PdfOptions,
) -> Result<String, String> {
    // 許可リスト検証（入力=読み取り / 出力=書き込み）
    security::ensure_directory_read_path(&input_folder)?;
    security::ensure_write_path(&output_path)?;
    // PDF生成前にPSDキャッシュを解放してメモリを確保
    processor::clear_psd_cache();
    processor::generate_pdf(&app_handle, &input_folder, &output_path, &files, &options)
}

/// デフォルト出力フォルダのパスを取得（デスクトップ/Script_Output/処理結果PDF）
#[tauri::command]
async fn get_default_output_folder() -> Result<String, String> {
    // デスクトップパスを取得
    let desktop =
        dirs::desktop_dir().ok_or_else(|| "デスクトップパスを取得できません".to_string())?;

    let output_folder = desktop.join("Script_Output").join("処理結果PDF");

    // フォルダが存在しなければ作成
    if !output_folder.exists() {
        std::fs::create_dir_all(&output_folder)
            .map_err(|e| format!("出力フォルダの作成に失敗: {}", e))?;
    }

    Ok(output_folder.to_string_lossy().to_string())
}

/// フォルダを削除（中身ごと）
#[tauri::command]
async fn delete_folder(path: String) -> Result<(), String> {
    // 許可リスト検証 ＋ 用途限定（PDF生成用の一時フォルダ _temp_pdf_source 専用）
    let validated = security::ensure_write_path(&path)?;
    let is_temp_source = validated
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == "_temp_pdf_source")
        .unwrap_or(false);
    if !is_temp_source {
        return Err("削除はPDF一時フォルダのみ許可されています".to_string());
    }
    if validated.exists() {
        std::fs::remove_dir_all(&validated).map_err(|_| "フォルダの削除に失敗".to_string())?;
    }
    Ok(())
}

/// フォルダ内のサブフォルダとJSONファイル一覧を取得
#[derive(Debug, Clone, Serialize)]
pub struct FolderContents {
    pub folders: Vec<String>,
    pub json_files: Vec<String>,
}

#[tauri::command]
async fn list_folder_contents(folder_path: String) -> Result<FolderContents, String> {
    let path = security::ensure_directory_read_path(&folder_path)?;

    let mut folders: Vec<String> = Vec::new();
    let mut json_files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        // ルートディレクトリ自体はスキップ
        if entry_path == path {
            continue;
        }

        if entry_path.is_dir() {
            if let Some(name) = entry_path.file_name() {
                folders.push(name.to_string_lossy().to_string());
            }
        } else if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_name() {
                        json_files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    folders.sort_by(|a, b| natural_cmp(a, b));
    json_files.sort_by(|a, b| natural_cmp(a, b));
    Ok(FolderContents {
        folders,
        json_files,
    })
}

/// 作品タイトル検索結果
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub label: String, // レーベル名（親フォルダ名）
    pub title: String, // 作品タイトル（フォルダ名）
    pub path: String,  // フルパス
}

/// フォルダ内を検索（作品タイトルで検索）
/// 構造: JSONフォルダ / レーベル / 作品タイトル.json
#[tauri::command]
async fn search_json_folders(
    base_path: String,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    dlog!("検索開始: base_path={}, query={}", base_path, query);
    let path = security::ensure_directory_read_path(&base_path)?;

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();
    let mut entry_count = 0;

    // レーベルフォルダ内のJSONファイルを検索（深さ2 = レーベル/ファイル.json）
    for entry in walkdir::WalkDir::new(&path)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        entry_count += 1;
        let entry_path = entry.path();

        // JSONファイルのみ対象
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_stem() {
                        let title_str = filename.to_string_lossy().to_string();

                        // 検索クエリにマッチするか確認
                        if title_str.to_lowercase().contains(&query_lower) {
                            // 親フォルダ（レーベル）名を取得
                            let label = entry_path
                                .parent()
                                .and_then(|p| p.file_name())
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();

                            dlog!("マッチ: {} / {}", label, title_str);
                            results.push(SearchResult {
                                label,
                                title: title_str,
                                path: entry_path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // タイトルでソート
    results.sort_by(|a, b| a.title.cmp(&b.title));
    dlog!(
        "検索完了: エントリ数={}, 結果数={}",
        entry_count,
        results.len()
    );
    Ok(results)
}

/// JSONフォルダ内のJSONファイル一覧を取得（後方互換性のため維持）
#[tauri::command]
async fn list_json_files(folder_path: String) -> Result<Vec<String>, String> {
    let path = security::ensure_directory_read_path(&folder_path)?;

    let mut files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_name() {
                        files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| natural_cmp(a, b));
    Ok(files)
}

/// フォルダを開く（Windowsエクスプローラー）
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    // 許可リスト検証（フォルダのみ・シェル非経由で直接 explorer 起動）
    let path = security::ensure_directory_read_path(&path)?
        .to_string_lossy()
        .to_string();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|_| "フォルダを開けませんでした".to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {}", e))?;
    }
    Ok(())
}

/// JSONファイルを保存
#[tauri::command]
async fn save_json_file(path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    // 許可リスト検証（書き込み）
    let file_path = security::ensure_write_path(&path)?;

    // 親フォルダが存在しない場合は作成
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|_| "フォルダの作成に失敗".to_string())?;
        }
    }

    // UTF-8 BOMなしで保存
    let mut file = fs::File::create(&file_path).map_err(|_| "ファイルの作成に失敗".to_string())?;

    file.write_all(content.as_bytes())
        .map_err(|_| "ファイルの書き込みに失敗".to_string())?;

    dlog!("JSONファイル保存完了: {}", path);
    Ok(())
}

/// JSONファイルを読み込み
#[tauri::command]
async fn read_json_file(path: String) -> Result<String, String> {
    use std::fs;

    // 許可リスト検証（読み取り）
    let file_path = security::ensure_read_path(&path)?;

    fs::read_to_string(&file_path).map_err(|_| "ファイルの読み込みに失敗".to_string())
}

/// フォルダが存在しない場合は作成
#[tauri::command]
async fn ensure_folder_exists(path: String) -> Result<(), String> {
    use std::fs;

    // 許可リスト検証（作成＝書き込み）
    let folder_path = security::ensure_write_path(&path)?;

    if !folder_path.exists() {
        fs::create_dir_all(&folder_path).map_err(|_| "フォルダの作成に失敗".to_string())?;
        dlog!("フォルダ作成: {}", path);
    }

    Ok(())
}

/// ファイルが存在するか確認（許可外は存在オラクルにせず一律 false）
#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    match security::ensure_query_path(&path) {
        Ok(p) => Ok(p.exists()),
        Err(_) => Ok(false),
    }
}

/// PSDファイルからガイド情報を取得
#[tauri::command]
async fn get_psd_guides(
    file_path: String,
) -> Result<Vec<processor::image_loader::PsdGuide>, String> {
    let path = security::ensure_read_path(&file_path)?;
    psd_safety::guard_psd_file_size(&path)?;
    processor::image_loader::extract_psd_guides(&path)
}

/// 作品情報の折り返しプレビューを計算
#[tauri::command]
async fn preview_work_info(
    work_info: WorkInfo,
    width: u32,
    height: u32,
) -> Result<WorkInfoPreview, String> {
    Ok(processor::pdf::common::compute_work_info_lines(
        &work_info, width, height,
    ))
}

// ---- secure ダイアログ（Rust側でピック→grant→パス返却。生 dialog プラグインは使わせない）----

#[derive(Debug, Deserialize, Default)]
struct PickOptions {
    #[serde(default)]
    directory: bool,
    #[serde(default)]
    multiple: bool,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    filter_name: Option<String>,
    #[serde(default)]
    filter_exts: Option<Vec<String>>,
}

fn build_file_dialog(
    app: &tauri::AppHandle,
    options: &PickOptions,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut builder = app.dialog().file();
    if let Some(t) = &options.title {
        builder = builder.set_title(t);
    }
    if let (Some(name), Some(exts)) = (&options.filter_name, &options.filter_exts) {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &refs);
    }
    builder
}

/// フォルダ/ファイルを選択し、選択実体だけを許可リストへ付与してパスを返す。
#[tauri::command]
fn secure_open_dialog(app: tauri::AppHandle, options: PickOptions) -> Result<Vec<String>, String> {
    let picked: Vec<tauri_plugin_dialog::FilePath> = if options.directory {
        if options.multiple {
            build_file_dialog(&app, &options).blocking_pick_folders().unwrap_or_default()
        } else {
            build_file_dialog(&app, &options).blocking_pick_folder().into_iter().collect()
        }
    } else if options.multiple {
        build_file_dialog(&app, &options).blocking_pick_files().unwrap_or_default()
    } else {
        build_file_dialog(&app, &options).blocking_pick_file().into_iter().collect()
    };
    let mut out = Vec::new();
    for fp in picked {
        if let Ok(p) = fp.into_path() {
            security::grant_user_path(&p)?;
            out.push(p.to_string_lossy().to_string());
        }
    }
    Ok(out)
}

/// 保存先を選択し、その親フォルダを許可リストへ付与してパスを返す。
#[tauri::command]
fn secure_save_dialog(
    app: tauri::AppHandle,
    options: PickOptions,
) -> Result<Option<String>, String> {
    match build_file_dialog(&app, &options).blocking_save_file() {
        Some(fp) => {
            let p = fp.into_path().map_err(|_| "パス取得失敗".to_string())?;
            if let Some(parent) = p.parent() {
                security::grant_user_path(parent)?;
            }
            Ok(Some(p.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// メッセージダイアログ（パスを扱わないので検証不要）。
#[tauri::command]
fn secure_message(app: tauri::AppHandle, message: String) {
    let _ = app.dialog().message(message).blocking_show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 並列処理のスレッドプールを初期化（CPUコア数の2倍）
    init_thread_pool();

    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--pdf-job") {
        if let Some(job_path) = args.get(pos + 1) {
            let success = run_pdf_job_file(job_path.clone());
            std::process::exit(if success { 0 } else { 1 });
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|_window, event| {
            // 実D&D で投入されたパスを Rust が直接許可リストへ（保護パスは拒否）
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let _ = security::grant_user_paths(paths.iter());
            }
        })
        .setup(|app| {
            // セキュリティ初期化（許可ルート・temp ACL）
            security::init();
            security::harden_temp_dir();

            let args: Vec<String> = std::env::args().collect();

            if let Some(pos) = args.iter().position(|a| a == "--pdf-job") {
                if let Some(job_path) = args.get(pos + 1) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    let success = run_pdf_job_file(job_path.clone());
                    std::process::exit(if success { 0 } else { 1 });
                }
            }

            // 1. --files <json_path> フラグからの読み込み（COMIC-Bridge等からの連携用）
            if let Some(pos) = args.iter().position(|a| a == "--files") {
                if let Some(json_path) = args.get(pos + 1) {
                    if let Ok(content) = std::fs::read_to_string(json_path) {
                        if let Ok(paths) = serde_json::from_str::<Vec<String>>(&content) {
                            *CLI_FILES.lock().unwrap() = Some(paths);
                            return Ok(());
                        }
                    }
                }
            }

            // 2. 位置引数からフォルダ/ファイルパスを検出
            //    デスクトップアイコンへのD&D時、Windowsがパスを引数として渡す
            //    args[0]は実行ファイル自身なのでスキップ、"-"始まりのフラグも除外
            let paths: Vec<String> = args
                .iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter(|a| std::path::Path::new(a).exists())
                .cloned()
                .collect();

            if !paths.is_empty() {
                *CLI_FILES.lock().unwrap() = Some(paths);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cli_files,
            get_image_files,
            get_image_files_recursive,
            get_image_preview,
            get_image_preview_as_file,
            process_images,
            cancel_processing,
            generate_pdf,
            get_default_output_folder,
            open_folder,
            delete_folder,
            clear_psd_cache,
            list_json_files,
            list_folder_contents,
            search_json_folders,
            save_json_file,
            read_json_file,
            ensure_folder_exists,
            file_exists,
            get_psd_guides,
            preview_work_info,
            // secure_* ファイル操作（生 plugin-fs/shell の代替）
            security::secure_read_dir,
            security::secure_read_text_file,
            security::secure_read_binary_file,
            security::secure_stat,
            security::secure_open_path,
            // secure ダイアログ（Rust側ピック→grant）
            secure_open_dialog,
            secure_save_dialog,
            secure_message,
            // 脱git 自動更新（G:更新置き場・minisign検証）
            updater_local::check_local_update,
            updater_local::apply_local_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
