//! タチミ - 単ページPDF生成
//! 各画像を1ページとしたPDFを生成

use ::image::GenericImageView;
use printpdf::{BuiltinFont, ImageTransform, Mm, PdfDocument};
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use tauri::Emitter;

use super::common::{
    create_pdf_image, create_pdf_image_from_jpeg_file, create_white_page_image,
    get_image_dimensions, get_nombre_font_size_pt, px_to_mm, unique_output_path,
};
use crate::processor::image_loader::load_image;
use crate::processor::jpeg::is_jpeg_file;
use crate::processor::types::WorkInfo;

/// 単ページPDF生成（画像サイズ = ページサイズ）
pub fn generate_single_pdf(
    app_handle: Option<&tauri::AppHandle>,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    padding_mm: f32,
    add_nombre: bool,
    nombre_size: &str,
    nombre_from_filename: bool,
    add_white_page: bool,
    print_work_info: bool,
    work_info: Option<&WorkInfo>,
    dpi: f32,
) -> Result<String, String> {
    let input_path = Path::new(input_folder);
    let total = files.len();

    if total == 0 {
        return Err("処理するファイルがありません".to_string());
    }

    // ファイル名連動ノンブル: 各ファイルの変化部分の数字を採用
    let page_numbers = if nombre_from_filename {
        crate::processor::extract_page_numbers_from_filenames(files)
    } else {
        Vec::new()
    };

    // 最初の画像でドキュメントを初期化
    let first_file = input_path.join(&files[0]);
    let (first_w, first_h) = get_image_dimensions(&first_file)?;

    let first_page_width_mm = px_to_mm(first_w, dpi);
    let first_page_height_mm = px_to_mm(first_h, dpi);
    let first_page_width_with_padding = first_page_width_mm + padding_mm * 2.0;
    let first_page_height_with_padding = first_page_height_mm + padding_mm * 2.0;

    let (doc, page1, layer1) = PdfDocument::new(
        "タチミ出力",
        Mm(first_page_width_with_padding),
        Mm(first_page_height_with_padding),
        "Layer 1",
    );
    let mut current_layer = doc.get_page(page1).get_layer(layer1);

    // ノンブル用フォント
    let nombre_font = if add_nombre && padding_mm > 0.0 {
        doc.add_builtin_font(BuiltinFont::Helvetica).ok()
    } else {
        None
    };
    let nombre_font_size_pt = get_nombre_font_size_pt(nombre_size);

    // 先頭白紙ページ（作品情報の印字対応）。page1 を白紙として使う
    if add_white_page {
        if let Some(white_img) = create_white_page_image(first_w, first_h, work_info, print_work_info)
        {
            let transform = ImageTransform {
                translate_x: Some(Mm(padding_mm)),
                translate_y: Some(Mm(padding_mm)),
                scale_x: Some(1.0),
                scale_y: Some(1.0),
                dpi: Some(dpi),
                ..Default::default()
            };
            white_img.add_to_layer(current_layer.clone(), transform);
        }
        // 白紙にはノンブルを振らない
    }

    for (i, filename) in files.iter().enumerate() {
        // キャンセルチェック
        if crate::CANCEL_FLAG.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("処理がキャンセルされました".to_string());
        }

        // 進捗イベント発行
        if let Some(app_handle) = app_handle {
            let _ = app_handle.emit(
                "progress",
                crate::ProgressPayload {
                    current: i + 1,
                    total,
                    filename: filename.clone(),
                    phase: format!("PDF生成: 画像読み込み中 ({}/{})", i + 1, total),
                    in_progress: 0,
                },
            );
        }

        let file_path = input_path.join(filename);

        // 画像読み込み（JPEG高速パス対応）
        let (pdf_image, img_w, img_h) = if is_jpeg_file(&file_path) {
            match create_pdf_image_from_jpeg_file(&file_path) {
                Some((img, w, h)) => (img, w, h),
                None => {
                    eprintln!("PDF生成: JPEGファイル読み込みエラー: {}", filename);
                    continue;
                }
            }
        } else {
            let img = match load_image(&file_path) {
                Ok(img) => img,
                Err(e) => {
                    eprintln!("PDF生成: 画像読み込みエラー ({}): {}", filename, e);
                    continue;
                }
            };
            let (w, h) = img.dimensions();
            match create_pdf_image(&img) {
                Some(pdf_img) => (pdf_img, w, h),
                None => {
                    eprintln!("PDF生成: PDF画像変換エラー: {}", filename);
                    continue;
                }
            }
        };

        if let Some(app_handle) = app_handle {
            let _ = app_handle.emit(
                "progress",
                crate::ProgressPayload {
                    current: i + 1,
                    total,
                    filename: filename.clone(),
                    phase: format!("PDF生成: ページ追加中 ({}/{})", i + 1, total),
                    in_progress: 0,
                },
            );
        }

        let page_width_mm = px_to_mm(img_w, dpi);
        let page_height_mm = px_to_mm(img_h, dpi);
        let page_width_with_padding = page_width_mm + padding_mm * 2.0;
        let page_height_with_padding = page_height_mm + padding_mm * 2.0;

        // 2ページ目以降、または先頭白紙がある場合は新しいページを追加
        // （白紙がある場合は page1 が白紙なので最初の実画像も新ページにする）
        if i > 0 || add_white_page {
            let (page, layer) = doc.add_page(
                Mm(page_width_with_padding),
                Mm(page_height_with_padding),
                "Layer 1",
            );
            current_layer = doc.get_page(page).get_layer(layer);
        }

        // 画像配置
        let transform = ImageTransform {
            translate_x: Some(Mm(padding_mm)),
            translate_y: Some(Mm(padding_mm)),
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            dpi: Some(dpi),
            ..Default::default()
        };
        pdf_image.add_to_layer(current_layer.clone(), transform);

        // ノンブル描画
        if let Some(ref font) = nombre_font {
            let page_value = if nombre_from_filename {
                page_numbers.get(i).copied().unwrap_or((i + 1) as u32)
            } else {
                (i + 1) as u32
            };
            let page_num = page_value.to_string();
            let text_x = page_width_with_padding / 2.0
                - (page_num.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
            // 余白の下端から約65%の高さに配置（従来は中央付近で下寄りすぎたため引き上げ）
            let text_y = padding_mm * 0.65 - nombre_font_size_pt * 0.35 / 2.0;
            current_layer.use_text(&page_num, nombre_font_size_pt, Mm(text_x), Mm(text_y), font);
        }
    }

    // PDF保存
    if let Some(app_handle) = app_handle {
        let _ = app_handle.emit(
            "progress",
            crate::ProgressPayload {
                current: total,
                total,
                filename: "".to_string(),
                phase: "PDF生成: ファイル保存中...".to_string(),
                in_progress: 0,
            },
        );
    }

    let actual_path = unique_output_path(output_path);
    let file = File::create(&actual_path).map_err(|e| format!("PDFファイルの作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);

    doc.save(&mut writer)
        .map_err(|e| format!("PDFの保存に失敗: {}", e))?;

    Ok(actual_path)
}
