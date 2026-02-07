//! タチミ - 見開きPDF生成
//! 2ページずつ見開きで配置したPDFを生成

use ::image::GenericImageView;
use printpdf::{BuiltinFont, Image, ImageTransform, Mm, PdfDocument};
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use tauri::Emitter;

use super::common::{
    create_pdf_image, create_pdf_image_from_jpeg_file, create_white_page_image,
    get_image_dimensions, get_nombre_font_size_pt, px_to_mm, unique_output_path, DEFAULT_DPI,
};
use crate::processor::jpeg::is_jpeg_file;
use crate::processor::image_loader::load_image;
use crate::processor::types::WorkInfo;

/// 見開きPDF生成
pub fn generate_spread_pdf(
    app_handle: &tauri::AppHandle,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    padding_mm: f32,
    gutter_mm: f32,
    add_white_page: bool,
    print_work_info: bool,
    work_info: Option<&WorkInfo>,
    add_nombre: bool,
    nombre_size: &str,
) -> Result<String, String> {
    let input_path = Path::new(input_folder);
    let total = files.len();
    let dpi = DEFAULT_DPI;

    if total == 0 {
        return Err("処理するファイルがありません".to_string());
    }

    // 最初の画像でサイズを取得
    let first_file = input_path.join(&files[0]);
    let (first_w, first_h) = get_image_dimensions(&first_file)?;

    let first_width_mm = px_to_mm(first_w, dpi);
    let first_height_mm = px_to_mm(first_h, dpi);

    // 初期ページサイズ（見開き: 画像×2 + ノド + 余白）
    let init_page_width = first_width_mm * 2.0 + gutter_mm + padding_mm * 2.0;
    let init_page_height = first_height_mm + padding_mm * 2.0;

    let (doc, page1, layer1) = PdfDocument::new(
        "タチミ出力（見開き）",
        Mm(init_page_width),
        Mm(init_page_height),
        "Layer 1"
    );
    let mut current_layer = doc.get_page(page1).get_layer(layer1);

    // ノンブル用フォント
    let nombre_font = if add_nombre && padding_mm > 0.0 {
        doc.add_builtin_font(BuiltinFont::Helvetica).ok()
    } else {
        None
    };
    let nombre_font_size_pt = get_nombre_font_size_pt(nombre_size);

    let mut is_first_page = true;
    let effective_total = if add_white_page { total + 1 } else { total };
    let spread_total = (effective_total + 1) / 2;
    let mut spread_index = 0;
    let mut file_idx: i32 = if add_white_page { -1 } else { 0 };

    while (file_idx as usize) < total || (add_white_page && file_idx == -1) {
        // キャンセルチェック
        if crate::CANCEL_FLAG.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("処理がキャンセルされました".to_string());
        }

        spread_index += 1;
        let current_file_idx = file_idx.max(0) as usize;
        let filename = files.get(current_file_idx).cloned().unwrap_or_default();

        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: (file_idx.max(0) + 1) as usize,
            total,
            filename: filename.clone(),
            phase: format!("見開きPDF: 画像読み込み中 ({}/{})", spread_index, spread_total),
            in_progress: 0,
        });

        // 右ページを取得
        let (pdf_right, right_w, right_h): (Image, u32, u32) = if file_idx == -1 {
            // 白紙ページ
            match create_white_page_image(first_w, first_h, work_info, print_work_info) {
                Some(img) => (img, first_w, first_h),
                None => {
                    file_idx += 2;
                    continue;
                }
            }
        } else {
            let right_file = input_path.join(&files[file_idx as usize]);
            if is_jpeg_file(&right_file) {
                match create_pdf_image_from_jpeg_file(&right_file) {
                    Some((img, w, h)) => (img, w, h),
                    None => {
                        file_idx += 2;
                        continue;
                    }
                }
            } else {
                let right_img = match load_image(&right_file) {
                    Ok(img) => img,
                    Err(_) => {
                        file_idx += 2;
                        continue;
                    }
                };
                let (w, h) = right_img.dimensions();
                match create_pdf_image(&right_img) {
                    Some(pdf_img) => (pdf_img, w, h),
                    None => {
                        file_idx += 2;
                        continue;
                    }
                }
            }
        };

        let right_width_mm = px_to_mm(right_w, dpi);
        let right_height_mm = px_to_mm(right_h, dpi);

        // 左ページのファイルインデックス
        let left_file_idx = file_idx + 1;

        // 左ページ（存在すれば）
        let (pdf_left, left_width_mm, left_height_mm) = if left_file_idx >= 0 && (left_file_idx as usize) < total {
            let left_file = input_path.join(&files[left_file_idx as usize]);

            if is_jpeg_file(&left_file) {
                match create_pdf_image_from_jpeg_file(&left_file) {
                    Some((img, w, h)) => {
                        let lw = px_to_mm(w, dpi);
                        let lh = px_to_mm(h, dpi);
                        (Some(img), lw, lh)
                    }
                    None => (None, right_width_mm, right_height_mm)
                }
            } else {
                match load_image(&left_file) {
                    Ok(left_img) => {
                        let (w, h) = left_img.dimensions();
                        let lw = px_to_mm(w, dpi);
                        let lh = px_to_mm(h, dpi);
                        match create_pdf_image(&left_img) {
                            Some(pdf_img) => (Some(pdf_img), lw, lh),
                            None => (None, right_width_mm, right_height_mm)
                        }
                    }
                    Err(_) => (None, right_width_mm, right_height_mm)
                }
            }
        } else {
            (None, right_width_mm, right_height_mm)
        };

        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: (file_idx.max(0) + 1) as usize,
            total,
            filename: filename.clone(),
            phase: format!("見開きPDF: ページ追加中 ({}/{})", spread_index, spread_total),
            in_progress: 0,
        });

        let has_left_page = pdf_left.is_some();
        let page_width_mm = right_width_mm + left_width_mm + gutter_mm + padding_mm * 2.0;
        let page_height_mm = right_height_mm.max(left_height_mm) + padding_mm * 2.0;

        // 2ページ目以降は新しいページを追加
        if !is_first_page {
            let (page, layer) = doc.add_page(Mm(page_width_mm), Mm(page_height_mm), "Layer 1");
            current_layer = doc.get_page(page).get_layer(layer);
        }
        is_first_page = false;

        // 右ページを配置
        let right_x = padding_mm + left_width_mm + gutter_mm;
        let transform = ImageTransform {
            translate_x: Some(Mm(right_x)),
            translate_y: Some(Mm(padding_mm)),
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            dpi: Some(dpi),
            ..Default::default()
        };
        pdf_right.add_to_layer(current_layer.clone(), transform);

        // 左ページを配置
        if let Some(left_img) = pdf_left {
            let transform = ImageTransform {
                translate_x: Some(Mm(padding_mm)),
                translate_y: Some(Mm(padding_mm)),
                scale_x: Some(1.0),
                scale_y: Some(1.0),
                dpi: Some(dpi),
                ..Default::default()
            };
            left_img.add_to_layer(current_layer.clone(), transform);
        }

        // ノンブル描画
        if let Some(ref font) = nombre_font {
            let text_y = padding_mm / 2.0 - nombre_font_size_pt * 0.35 / 2.0;

            if file_idx == -1 {
                // 白紙見開き: 左ページのみノンブル
                if has_left_page {
                    let left_num_str = "1".to_string();
                    let left_text_x = padding_mm + left_width_mm / 2.0 - (left_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                    current_layer.use_text(&left_num_str, nombre_font_size_pt, Mm(left_text_x), Mm(text_y), font);
                }
            } else {
                let right_page_num = file_idx as usize + 1;
                let left_page_num = right_page_num + 1;

                // 右ページのノンブル
                let right_num_str = right_page_num.to_string();
                let right_text_x = right_x + right_width_mm / 2.0 - (right_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                current_layer.use_text(&right_num_str, nombre_font_size_pt, Mm(right_text_x), Mm(text_y), font);

                // 左ページのノンブル
                if has_left_page {
                    let left_num_str = left_page_num.to_string();
                    let left_text_x = padding_mm + left_width_mm / 2.0 - (left_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                    current_layer.use_text(&left_num_str, nombre_font_size_pt, Mm(left_text_x), Mm(text_y), font);
                }
            }
        }

        file_idx += 2;
    }

    // PDF保存
    let _ = app_handle.emit("progress", crate::ProgressPayload {
        current: total,
        total,
        filename: "".to_string(),
        phase: "見開きPDF: ファイル保存中...".to_string(),
        in_progress: 0,
    });

    let actual_path = unique_output_path(output_path);
    let file = File::create(&actual_path)
        .map_err(|e| format!("PDFファイルの作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);

    doc.save(&mut writer)
        .map_err(|e| format!("PDFの保存に失敗: {}", e))?;

    Ok(actual_path)
}
