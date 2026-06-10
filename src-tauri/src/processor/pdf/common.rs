//! タチミ - PDF共通ユーティリティ
//! PDF生成で共有される機能

use ::image::{DynamicImage, GenericImageView, Rgba, RgbaImage, ImageBuffer};
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use imageproc::drawing::draw_text_mut;
use printpdf::{Image, ImageXObject, ImageFilter, ColorSpace, ColorBits, Px};
use std::path::Path;

use crate::processor::jpeg::{get_jpeg_dimensions, is_jpeg_file};
use crate::processor::image_loader::load_image;
use crate::processor::cache::get_cached_jp_font_data;
use crate::processor::types::{WorkInfo, WorkInfoPreview};

/// デフォルトDPI
pub const DEFAULT_DPI: f32 = 350.0;

/// ピクセルをmmに変換
pub fn px_to_mm(px: u32, dpi: f32) -> f32 {
    px as f32 / dpi * 25.4
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
    let mut jpeg_data = Vec::new();
    {
        let mut encoder = ::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_data, 95);
        encoder.encode_image(&rgb_img).ok()?;
    }

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

fn direct_pdf_jpeg_color_space(data: &[u8]) -> Option<ColorSpace> {
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }

    let mut i = 2;
    while i + 9 < data.len() {
        while i < data.len() && data[i] != 0xFF {
            i += 1;
        }
        if i + 1 >= data.len() {
            break;
        }
        while i + 1 < data.len() && data[i + 1] == 0xFF {
            i += 1;
        }

        let marker = data[i + 1];
        if marker == 0x00 {
            i += 2;
            continue;
        }
        if marker == 0xC0 {
            return match data[i + 9] {
                1 => Some(ColorSpace::Greyscale),
                3 => Some(ColorSpace::Rgb),
                4 => Some(ColorSpace::Cmyk),
                _ => None,
            };
        }

        if matches!(marker, 0xC1..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            return None;
        }

        if marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }

        if i + 3 >= data.len() {
            break;
        }
        let len = ((data[i + 2] as usize) << 8) | data[i + 3] as usize;
        if len < 2 {
            return None;
        }
        i += 2 + len;
    }

    None
}

/// JPEGファイルからPDF用Imageを作成。
///
/// ベースラインJPEGはコンポーネント数に合う色空間で高速に直埋めし、
/// プログレッシブなどAcrobat互換性に不安があるJPEGだけRGB JPEGへ正規化する。
pub fn create_pdf_image_from_jpeg_file(path: &Path) -> Option<(Image, u32, u32)> {
    let jpeg_data = std::fs::read(path).ok()?;
    let (width, height) = get_jpeg_dimensions(&jpeg_data)?;

    if let Some(color_space) = direct_pdf_jpeg_color_space(&jpeg_data) {
        let image = Image::from(ImageXObject {
            width: Px(width as usize),
            height: Px(height as usize),
            color_space,
            bits_per_component: ColorBits::Bit8,
            interpolate: true,
            image_data: jpeg_data,
            image_filter: Some(ImageFilter::DCT),
            clipping_bbox: None,
            smask: None,
        });
        return Some((image, width, height));
    }

    let img = load_image(path).ok()?;
    create_pdf_image(&img).map(|image| (image, width, height))
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

    let mut jpeg_data = Vec::new();
    {
        let mut encoder = ::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_data, 95);
        encoder.encode_image(&rgb_img).ok()?;
    }

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

/// テキストを max_width に収まるよう文字単位で折り返す
fn wrap_text(text: &str, font: &FontRef, font_size: f32, max_width: f32) -> Vec<String> {
    let scale = PxScale::from(font_size);
    let scaled_font = font.as_scaled(scale);
    let total_width: f32 = text.chars()
        .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
        .sum();
    if total_width <= max_width {
        return vec![text.to_string()];
    }
    let mut lines = Vec::new();
    let mut current_line = String::new();
    let mut current_width: f32 = 0.0;
    for c in text.chars() {
        let char_width = scaled_font.h_advance(scaled_font.glyph_id(c));
        if current_width + char_width > max_width && !current_line.is_empty() {
            lines.push(current_line);
            current_line = String::new();
            current_width = 0.0;
        }
        current_line.push(c);
        current_width += char_width;
    }
    if !current_line.is_empty() {
        lines.push(current_line);
    }
    lines
}

/// 作品情報の著者テキストを生成
fn build_author_text(info: &WorkInfo) -> String {
    match info.author_type {
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
    }
}

/// 作品情報の折り返し行をプレビュー用に計算
pub fn compute_work_info_lines(info: &WorkInfo, width: u32, height: u32) -> WorkInfoPreview {
    let font_data = match get_cached_jp_font_data() {
        Some(data) => data,
        None => return WorkInfoPreview::default(),
    };
    let font = match FontRef::try_from_slice(font_data) {
        Ok(f) => f,
        Err(_) => return WorkInfoPreview::default(),
    };

    let base_size = height as f32 / 30.0;
    let title_size = base_size * 2.0;
    let subtitle_size = base_size * 1.0;
    let version_size = base_size * 1.2;
    let author_size = base_size * 0.85;
    let label_size = base_size * 0.7;
    let max_text_width = width as f32 * 0.85;

    let label = if !info.label.is_empty() {
        wrap_text(&info.label, &font, label_size, max_text_width)
    } else {
        Vec::new()
    };
    let title = if !info.title.is_empty() {
        wrap_text(&info.title, &font, title_size, max_text_width)
    } else {
        Vec::new()
    };
    let subtitle = if !info.subtitle.is_empty() {
        wrap_text(&info.subtitle, &font, subtitle_size, max_text_width)
    } else {
        Vec::new()
    };
    let version = if !info.version.is_empty() {
        wrap_text(&info.version, &font, version_size, max_text_width)
    } else {
        Vec::new()
    };
    let author_text = build_author_text(info);
    let author = if !author_text.is_empty() {
        wrap_text(&author_text, &font, author_size, max_text_width)
    } else {
        Vec::new()
    };

    WorkInfoPreview { label, title, subtitle, version, author }
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
    let max_text_width = width as f32 * 0.85;

    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    let gray = Rgba([80u8, 80u8, 80u8, 255u8]);

    let page_center_y = height as f32 / 2.0;
    let golden_ratio = 0.35;
    let title_center_y = height as f32 * golden_ratio;

    // タイトルブロック（各エントリが複数行になりうる）
    let mut title_block: Vec<(Vec<String>, f32, Rgba<u8>)> = Vec::new();
    if !info.title.is_empty() {
        let lines = wrap_text(&info.title, &font, title_size, max_text_width);
        title_block.push((lines, title_size, black));
    }
    if !info.subtitle.is_empty() {
        let lines = wrap_text(&info.subtitle, &font, subtitle_size, max_text_width);
        title_block.push((lines, subtitle_size, black));
    }
    if !info.version.is_empty() {
        let lines = wrap_text(&info.version, &font, version_size, max_text_width);
        title_block.push((lines, version_size, black));
    }

    // 上部ブロック（レーベル）
    let mut top_block: Vec<(Vec<String>, f32, Rgba<u8>)> = Vec::new();
    if !info.label.is_empty() {
        let lines = wrap_text(&info.label, &font, label_size, max_text_width);
        top_block.push((lines, label_size, gray));
    }

    // 下部ブロック（著者）
    let mut bottom_block: Vec<(Vec<String>, f32, Rgba<u8>)> = Vec::new();
    let author_text = build_author_text(info);
    if !author_text.is_empty() {
        let lines = wrap_text(&author_text, &font, author_size, max_text_width);
        bottom_block.push((lines, author_size, gray));
    }

    // タイトルブロック描画
    let title_line_height = 1.6;
    let title_total_height: f32 = title_block.iter()
        .map(|(lines, size, _)| size * title_line_height * lines.len() as f32)
        .sum();
    let title_start_y = title_center_y - title_total_height / 2.0;
    let mut current_y = title_start_y;

    for (lines, font_size, color) in &title_block {
        let scale = PxScale::from(*font_size);
        let scaled_font = font.as_scaled(scale);
        for line in lines {
            let text_width: f32 = line.chars()
                .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                .sum();
            let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
            draw_text_mut(img, *color, x, current_y as i32, scale, &font, line);
            current_y += font_size * title_line_height;
        }
    }

    // 上部ブロック描画
    if !top_block.is_empty() {
        let top_spacing = base_size * 3.0;
        let top_line_height = 1.4;
        let top_total_height: f32 = top_block.iter()
            .map(|(lines, size, _)| size * top_line_height * lines.len() as f32)
            .sum();
        let mut top_y = title_start_y - top_spacing - top_total_height;

        for (lines, font_size, color) in &top_block {
            let scale = PxScale::from(*font_size);
            let scaled_font = font.as_scaled(scale);
            for line in lines {
                let text_width: f32 = line.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, top_y as i32, scale, &font, line);
                top_y += font_size * top_line_height;
            }
        }
    }

    // 下部ブロック描画
    if !bottom_block.is_empty() {
        let bottom_margin = base_size * 2.5;
        let bottom_line_height = 1.4;
        let bottom_total_height: f32 = bottom_block.iter()
            .map(|(lines, size, _)| size * bottom_line_height * lines.len() as f32)
            .sum();
        let mut bottom_y = page_center_y - bottom_margin - bottom_total_height;

        // タイトルブロック（巻数を含む）の下端と重ならないよう最低位置をクランプ。
        // current_y はタイトルブロック描画後の y（＝ブロック下端）。
        let min_author_top = current_y + base_size * 1.2;
        if bottom_y < min_author_top {
            bottom_y = min_author_top;
        }

        for (lines, font_size, color) in &bottom_block {
            let scale = PxScale::from(*font_size);
            let scaled_font = font.as_scaled(scale);
            for line in lines {
                let text_width: f32 = line.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, bottom_y as i32, scale, &font, line);
                bottom_y += font_size * bottom_line_height;
            }
        }
    }
}
