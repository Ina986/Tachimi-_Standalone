//! タチミ - PDF共通ユーティリティ
//! PDF生成で共有される機能

use ::image::{DynamicImage, GenericImageView, Rgba, RgbaImage, ImageBuffer};
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use imageproc::drawing::draw_text_mut;
use printpdf::{Image, ImageXObject, ImageFilter, ColorSpace, ColorBits, Px};
use std::path::Path;

use crate::processor::jpeg::{encode_jpeg_mozjpeg, get_jpeg_dimensions, is_jpeg_file};
use crate::processor::image_loader::load_image;
use crate::processor::cache::get_cached_jp_font_data;
use crate::processor::types::WorkInfo;

/// デフォルトDPI
pub const DEFAULT_DPI: f32 = 350.0;

/// ピクセルをmmに変換
pub fn px_to_mm(px: u32, dpi: f32) -> f32 {
    px as f32 / dpi * 25.4
}

/// mmをピクセルに変換
pub fn mm_to_px(mm: f32, dpi: f32) -> u32 {
    (mm / 25.4 * dpi) as u32
}

/// ページサイズをmmで計算
pub fn calc_page_size_mm(width_px: u32, height_px: u32, dpi: f32) -> (f32, f32) {
    (px_to_mm(width_px, dpi), px_to_mm(height_px, dpi))
}

/// 画像のサイズを取得（JPEGの場合は高速パス）
pub fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    if is_jpeg_file(path) {
        let data = std::fs::read(path)
            .map_err(|e| format!("ファイルを開けません: {}", e))?;
        get_jpeg_dimensions(&data)
            .ok_or_else(|| "JPEGサイズの取得に失敗".to_string())
    } else {
        let img = load_image(path)?;
        Ok(img.dimensions())
    }
}

/// 画像をMozJPEGエンコードしてPDF用Imageを作成
pub fn create_pdf_image(img: &DynamicImage) -> Option<Image> {
    let rgb_img = img.to_rgb8();
    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 100.0)?;

    Some(Image::from(ImageXObject {
        width: Px(img.width() as usize),
        height: Px(img.height() as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    }))
}

/// JPEGファイルから直接PDF用Imageを作成（デコード不要で高速）
pub fn create_pdf_image_from_jpeg_file(path: &Path) -> Option<(Image, u32, u32)> {
    let jpeg_data = std::fs::read(path).ok()?;
    let (width, height) = get_jpeg_dimensions(&jpeg_data)?;

    let image = Image::from(ImageXObject {
        width: Px(width as usize),
        height: Px(height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    });

    Some((image, width, height))
}

/// 画像を読み込んでPDF用Imageを作成
pub fn load_and_create_pdf_image(path: &Path) -> Result<(Image, u32, u32), String> {
    if is_jpeg_file(path) {
        create_pdf_image_from_jpeg_file(path)
            .ok_or_else(|| "JPEGファイルの読み込みに失敗".to_string())
    } else {
        let img = load_image(path)?;
        let (w, h) = img.dimensions();
        create_pdf_image(&img)
            .map(|pdf_img| (pdf_img, w, h))
            .ok_or_else(|| "PDF画像の変換に失敗".to_string())
    }
}

/// 2枚の画像を横に結合（見開き用）
pub fn combine_images_horizontal(left: &DynamicImage, right: Option<&DynamicImage>, gutter_px: u32) -> DynamicImage {
    let left_rgba = left.to_rgba8();
    let (left_w, left_h) = left_rgba.dimensions();
    let left_raw = left_rgba.as_raw();

    let (right_rgba, right_w, right_h) = if let Some(r) = right {
        let rgba = r.to_rgba8();
        let (w, h) = rgba.dimensions();
        (Some(rgba), w, h)
    } else {
        (None, 0, 0)
    };

    let combined_width = left_w + right_w + gutter_px;
    let combined_height = left_h.max(right_h);
    let mut combined = vec![255u8; (combined_width * combined_height * 4) as usize];
    let stride = combined_width as usize * 4;

    // 左画像をコピー
    let left_stride = left_w as usize * 4;
    for y in 0..left_h as usize {
        let src_start = y * left_stride;
        let dst_start = y * stride;
        combined[dst_start..dst_start + left_stride].copy_from_slice(&left_raw[src_start..src_start + left_stride]);
    }

    // 右画像をコピー
    if let Some(ref right_data) = right_rgba {
        let right_raw = right_data.as_raw();
        let right_stride = right_w as usize * 4;
        let right_offset = (left_w + gutter_px) as usize * 4;
        for y in 0..right_h as usize {
            let src_start = y * right_stride;
            let dst_start = y * stride + right_offset;
            combined[dst_start..dst_start + right_stride].copy_from_slice(&right_raw[src_start..src_start + right_stride]);
        }
    }

    let img_buffer: RgbaImage = ImageBuffer::from_raw(combined_width, combined_height, combined)
        .expect("Combined image buffer creation failed");
    DynamicImage::ImageRgba8(img_buffer)
}

/// 画像に余白を追加
pub fn add_padding_to_image(img: &DynamicImage, padding_px: u32) -> DynamicImage {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let raw = rgba.as_raw();

    let new_width = w + padding_px * 2;
    let new_height = h + padding_px * 2;
    let mut padded = vec![255u8; (new_width * new_height * 4) as usize];
    let new_stride = new_width as usize * 4;
    let old_stride = w as usize * 4;

    for y in 0..h as usize {
        let src_start = y * old_stride;
        let dst_start = (y + padding_px as usize) * new_stride + (padding_px as usize * 4);
        padded[dst_start..dst_start + old_stride].copy_from_slice(&raw[src_start..src_start + old_stride]);
    }

    let img_buffer: RgbaImage = ImageBuffer::from_raw(new_width, new_height, padded)
        .expect("Padded image buffer creation failed");
    DynamicImage::ImageRgba8(img_buffer)
}

/// 出力パスが既存の場合、連番を付与してユニークなパスを返す
/// 例: output.pdf → output(1).pdf → output(2).pdf
pub fn unique_output_path(path: &str) -> String {
    let p = Path::new(path);
    if !p.exists() {
        return path.to_string();
    }
    let parent = p.parent().unwrap_or(Path::new(""));
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let ext = p.extension().unwrap_or_default().to_string_lossy();
    let mut counter = 1u32;
    loop {
        let new_path = parent.join(format!("{}({}).{}", stem, counter, ext));
        if !new_path.exists() {
            return new_path.to_string_lossy().to_string();
        }
        counter += 1;
    }
}

/// ノンブルのフォントサイズ（pt単位）を取得
pub fn get_nombre_font_size_pt(nombre_size: &str) -> f32 {
    match nombre_size {
        "large" => 12.0,
        "medium" => 9.0,
        "xlarge" => 14.0,
        _ => 7.0, // small
    }
}

/// 白紙ページのPDF用Imageを作成（作品情報印字対応）
pub fn create_white_page_image(width: u32, height: u32, work_info: Option<&WorkInfo>, print_work_info: bool) -> Option<Image> {
    let mut white_img: RgbaImage = ImageBuffer::from_fn(width, height, |_, _| {
        Rgba([255u8, 255u8, 255u8, 255u8])
    });

    if print_work_info {
        if let Some(info) = work_info {
            draw_work_info_on_image(&mut white_img, info);
        }
    }

    let rgb_img: ImageBuffer<::image::Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
        let p = white_img.get_pixel(x, y);
        ::image::Rgb([p[0], p[1], p[2]])
    });

    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), width, height, 100.0)?;

    Some(Image::from(ImageXObject {
        width: Px(width as usize),
        height: Px(height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    }))
}

/// 白紙画像に作品情報を描画
pub fn draw_work_info_on_image(img: &mut RgbaImage, info: &WorkInfo) {
    let (width, height) = img.dimensions();

    let font_data = match get_cached_jp_font_data() {
        Some(data) => data,
        None => return,
    };

    let font = match FontRef::try_from_slice(font_data) {
        Ok(f) => f,
        Err(_) => return,
    };

    let base_size = height as f32 / 30.0;
    let title_size = base_size * 2.0;
    let subtitle_size = base_size * 1.0;
    let version_size = base_size * 1.2;
    let author_size = base_size * 0.85;
    let label_size = base_size * 0.7;

    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    let gray = Rgba([80u8, 80u8, 80u8, 255u8]);

    let page_center_y = height as f32 / 2.0;
    let golden_ratio = 0.35;
    let title_center_y = height as f32 * golden_ratio;

    // タイトルブロック
    let mut title_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();
    if !info.title.is_empty() {
        title_block.push((info.title.clone(), title_size, black));
    }
    if !info.subtitle.is_empty() {
        title_block.push((info.subtitle.clone(), subtitle_size, black));
    }
    if !info.version.is_empty() {
        title_block.push((info.version.clone(), version_size, black));
    }

    // 上部ブロック（レーベル）
    let mut top_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();
    if !info.label.is_empty() {
        top_block.push((info.label.clone(), label_size, gray));
    }

    // 下部ブロック（著者）
    let mut bottom_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();
    let author_text = match info.author_type {
        0 => {
            if !info.author1.is_empty() {
                format!("著　{}", info.author1)
            } else {
                String::new()
            }
        }
        1 => {
            let mut parts = Vec::new();
            if !info.author1.is_empty() {
                parts.push(format!("作画　{}", info.author1));
            }
            if !info.author2.is_empty() {
                parts.push(format!("原作　{}", info.author2));
            }
            parts.join("　　")
        }
        _ => info.author1.clone(),
    };
    if !author_text.is_empty() {
        bottom_block.push((author_text, author_size, gray));
    }

    // タイトルブロック描画
    let title_line_height = 1.6;
    let title_total_height: f32 = title_block.iter()
        .map(|(_, size, _)| size * title_line_height)
        .sum();
    let title_start_y = title_center_y - title_total_height / 2.0;
    let mut current_y = title_start_y;

    for (text, font_size, color) in &title_block {
        if !text.is_empty() {
            let scale = PxScale::from(*font_size);
            let scaled_font = font.as_scaled(scale);
            let text_width: f32 = text.chars()
                .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                .sum();
            let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
            draw_text_mut(img, *color, x, current_y as i32, scale, &font, text);
        }
        current_y += font_size * title_line_height;
    }

    // 上部ブロック描画
    if !top_block.is_empty() {
        let top_spacing = base_size * 3.0;
        let top_line_height = 1.4;
        let top_total_height: f32 = top_block.iter()
            .map(|(_, size, _)| size * top_line_height)
            .sum();
        let mut top_y = title_start_y - top_spacing - top_total_height;

        for (text, font_size, color) in &top_block {
            if !text.is_empty() {
                let scale = PxScale::from(*font_size);
                let scaled_font = font.as_scaled(scale);
                let text_width: f32 = text.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, top_y as i32, scale, &font, text);
            }
            top_y += font_size * top_line_height;
        }
    }

    // 下部ブロック描画
    if !bottom_block.is_empty() {
        let bottom_margin = base_size * 2.5;
        let bottom_line_height = 1.4;
        let bottom_total_height: f32 = bottom_block.iter()
            .map(|(_, size, _)| size * bottom_line_height)
            .sum();
        let mut bottom_y = page_center_y - bottom_margin - bottom_total_height;

        for (text, font_size, color) in &bottom_block {
            if !text.is_empty() {
                let scale = PxScale::from(*font_size);
                let scaled_font = font.as_scaled(scale);
                let text_width: f32 = text.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, bottom_y as i32, scale, &font, text);
            }
            bottom_y += font_size * bottom_line_height;
        }
    }
}
