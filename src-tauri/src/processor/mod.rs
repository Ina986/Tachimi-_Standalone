//! タチミ - 画像処理モジュール
//! 画像処理とPDF生成の中心モジュール

pub mod cache;
pub mod image_loader;
pub mod image_processing;
pub mod jpeg;
pub mod pdf;
pub mod types;

// 型のre-export
pub use types::{
    FileEntry, ImageInfo, PdfOptions, PreviewFileInfo, ProcessOptions, ProcessResult, WorkInfo,
    WorkInfoPreview,
};

// キャッシュ関連のre-export
pub use cache::{clear_psd_cache, get_or_cache_psd};

// 画像処理のre-export
pub use image_processing::process_single_image;

use ::image::imageops::FilterType;
use ::image::GenericImageView;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

use jpeg::{encode_jpeg_mozjpeg, write_jpeg_mozjpeg_to_file};
use pdf::{generate_single_pdf, generate_spread_pdf, DEFAULT_DPI};

/// 文字列から最初の連続した数字列を u32 として取り出す
fn parse_first_number(s: &str) -> Option<u32> {
    let digits: String = s
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

/// ファイル名群から「各ファイルで変化する部分」の数字を取り出してノンブル番号にする。
///
/// 全ファイルに共通する先頭(prefix)・末尾(suffix)を取り除き、
/// 残った中央部分（＝ファイルごとに変わる箇所）の数字を採用する。
/// 中央部分に数字が無い場合はファイル名全体の最初の数字、
/// それも無ければ index+1 にフォールバックする。
pub fn extract_page_numbers_from_filenames(files: &[String]) -> Vec<u32> {
    // ディレクトリ部分を除いたベース名（char配列）
    let names: Vec<Vec<char>> = files
        .iter()
        .map(|f| {
            let base = Path::new(f)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| f.clone());
            base.chars().collect()
        })
        .collect();

    let n = names.len();
    if n == 0 {
        return Vec::new();
    }

    let min_len = names.iter().map(|x| x.len()).min().unwrap_or(0);

    // 共通の先頭長
    let mut prefix = 0;
    while prefix < min_len {
        let c = names[0][prefix];
        if names.iter().all(|name| name[prefix] == c) {
            prefix += 1;
        } else {
            break;
        }
    }

    // 共通の末尾長（先頭と重ならない範囲で）
    let mut suffix = 0;
    let max_suffix = min_len.saturating_sub(prefix);
    while suffix < max_suffix {
        let c = names[0][names[0].len() - 1 - suffix];
        if names.iter().all(|name| name[name.len() - 1 - suffix] == c) {
            suffix += 1;
        } else {
            break;
        }
    }

    names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let start = prefix.min(name.len());
            let end = name.len().saturating_sub(suffix).max(start);
            let middle: String = name[start..end].iter().collect();
            let whole: String = name.iter().collect();
            parse_first_number(&middle)
                .or_else(|| parse_first_number(&whole))
                .unwrap_or((i + 1) as u32)
        })
        .collect()
}

/// 画像のプレビューを取得（Base64）
pub fn get_image_preview(file_path: &str, max_size: u32) -> Result<ImageInfo, String> {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // PSDの場合はキャッシュを使用
    let (img, orig_width, orig_height) = if ext == "psd" {
        let img = get_or_cache_psd(path)?;
        let (w, h) = img.dimensions();
        (img, w, h)
    } else {
        let img = ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))?;
        let (w, h) = img.dimensions();
        (img, w, h)
    };

    // リサイズ
    let (current_w, current_h) = img.dimensions();
    let resized = if current_w > max_size || current_h > max_size {
        img.resize(max_size, max_size, FilterType::CatmullRom)
    } else {
        img
    };

    // MozJPEGでエンコード
    let rgb_img = resized.to_rgb8();
    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 100.0)
        .ok_or("MozJPEGエンコードに失敗")?;

    let base64_str = STANDARD.encode(&jpeg_data);

    Ok(ImageInfo {
        width: orig_width,
        height: orig_height,
        base64: format!("data:image/jpeg;base64,{}", base64_str),
    })
}

/// 画像のプレビューをファイルに保存（高速化版）
pub fn get_image_preview_file(
    file_path: &str,
    max_size: u32,
    temp_dir: &str,
) -> Result<PreviewFileInfo, String> {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // PSDの場合はキャッシュを使用
    let (img, orig_width, orig_height) = if ext == "psd" {
        let img = get_or_cache_psd(path)?;
        let (w, h) = img.dimensions();
        (img, w, h)
    } else {
        let img = ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))?;
        let (w, h) = img.dimensions();
        (img, w, h)
    };

    // リサイズ
    let (current_w, current_h) = img.dimensions();
    let resized = if current_w > max_size || current_h > max_size {
        img.resize(max_size, max_size, FilterType::Triangle)
    } else {
        img
    };

    // 一時ファイルのパスを生成
    let file_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("preview");
    let temp_file_path = Path::new(temp_dir).join(format!("{}_preview.jpg", file_name));

    // MozJPEGでファイルに保存
    let rgb_img = resized.to_rgb8();
    write_jpeg_mozjpeg_to_file(
        rgb_img.as_raw(),
        rgb_img.width(),
        rgb_img.height(),
        80.0,
        &temp_file_path,
    )?;

    Ok(PreviewFileInfo {
        width: orig_width,
        height: orig_height,
        file_path: temp_file_path.to_string_lossy().to_string(),
    })
}

/// PDF生成（見開き/単ページの分岐）
fn generate_pdf_inner(
    app_handle: Option<&tauri::AppHandle>,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    options: &PdfOptions,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("処理するファイルがありません".to_string());
    }

    // 最初の画像から実DPIを自動計算（目標ページサイズに収まるように）
    let first_file = std::path::Path::new(input_folder).join(&files[0]);
    let (first_w, first_h) = pdf::common::get_image_dimensions(&first_file)?;
    let dpi_x = first_w as f32 / (options.width_mm / 25.4);
    let dpi_y = first_h as f32 / (options.height_mm / 25.4);
    let image_dpi = dpi_x.max(dpi_y);

    // 余白・ノドはDEFAULT_DPI基準で変換（UIスライダー値の物理サイズを維持）
    let px_to_mm_ratio = 25.4 / DEFAULT_DPI;
    let padding_mm = options.padding as f32 * px_to_mm_ratio;
    let gutter_mm = options.gutter as f32 * px_to_mm_ratio;

    if options.is_spread {
        generate_spread_pdf(
            app_handle,
            input_folder,
            output_path,
            files,
            padding_mm,
            gutter_mm,
            options.add_white_page,
            options.print_work_info,
            options.work_info.as_ref(),
            options.add_nombre,
            &options.nombre_size,
            options.nombre_from_filename,
            image_dpi,
        )
    } else {
        generate_single_pdf(
            app_handle,
            input_folder,
            output_path,
            files,
            padding_mm,
            options.add_nombre,
            &options.nombre_size,
            options.nombre_from_filename,
            options.add_white_page,
            options.print_work_info,
            options.work_info.as_ref(),
            image_dpi,
        )
    }
}

pub fn generate_pdf(
    app_handle: &tauri::AppHandle,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    options: &PdfOptions,
) -> Result<String, String> {
    generate_pdf_inner(Some(app_handle), input_folder, output_path, files, options)
}

pub fn generate_pdf_headless(
    input_folder: &str,
    output_path: &str,
    files: &[String],
    options: &PdfOptions,
) -> Result<String, String> {
    generate_pdf_inner(None, input_folder, output_path, files, options)
}
