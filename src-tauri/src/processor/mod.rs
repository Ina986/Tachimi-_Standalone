//! タチミ - 画像処理モジュール
//! 画像処理とPDF生成の中心モジュール

pub mod types;
pub mod cache;
pub mod jpeg;
pub mod image_loader;
pub mod image_processing;
pub mod pdf;

// 型のre-export
pub use types::{
    ImageInfo, PreviewFileInfo, ProcessOptions, ProcessResult,
    PdfOptions,
};

// キャッシュ関連のre-export
pub use cache::{clear_psd_cache, get_or_cache_psd};

// 画像処理のre-export
pub use image_processing::process_single_image;

use ::image::GenericImageView;
use ::image::imageops::FilterType;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

use jpeg::{encode_jpeg_mozjpeg, write_jpeg_mozjpeg_to_file};
use pdf::{generate_single_pdf, generate_spread_pdf, DEFAULT_DPI};

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
pub fn get_image_preview_file(file_path: &str, max_size: u32, temp_dir: &str) -> Result<PreviewFileInfo, String> {
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
    let file_name = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("preview");
    let temp_file_path = Path::new(temp_dir).join(format!("{}_preview.jpg", file_name));

    // MozJPEGでファイルに保存
    let rgb_img = resized.to_rgb8();
    write_jpeg_mozjpeg_to_file(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 80.0, &temp_file_path)?;

    Ok(PreviewFileInfo {
        width: orig_width,
        height: orig_height,
        file_path: temp_file_path.to_string_lossy().to_string(),
    })
}

/// PDF生成（見開き/単ページの分岐）
pub fn generate_pdf(
    app_handle: &tauri::AppHandle,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    options: &PdfOptions,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("処理するファイルがありません".to_string());
    }

    let dpi = DEFAULT_DPI;
    let px_to_mm_ratio = 25.4 / dpi;
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
        )
    }
}
