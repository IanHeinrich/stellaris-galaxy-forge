//! The DDS container: a 124-byte header after the magic, optionally a DX10
//! extension, then mip 0 of the image (`docs/game-data-notes.md`).

use image::RgbaImage;

const MAGIC: &[u8; 4] = b"DDS ";
const HEADER_LEN: usize = 128;
const DX10_LEN: usize = 20;
const PF_ALPHAPIXELS: u32 = 0x1;
const PF_FOURCC: u32 = 0x4;
const PF_RGB: u32 = 0x40;
const PF_LUMINANCE: u32 = 0x20000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Block {
    Bc1,
    Bc2,
    Bc3,
    Bc4,
    Bc5,
    Bc6 { signed: bool },
    Bc7,
}

impl Block {
    fn bytes(self) -> usize {
        match self {
            Self::Bc1 | Self::Bc4 => 8,
            _ => 16,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Blocks(Block),
    Packed {
        bits: u32,
        masks: [u32; 4],
        luminance: bool,
    },
}

struct Header {
    width: u32,
    height: u32,
    format: Format,
    data_offset: usize,
}

pub(super) fn decode(bytes: &[u8]) -> Result<RgbaImage, String> {
    let header = parse_header(bytes)?;
    let data = &bytes[header.data_offset..];
    let (width, height) = (header.width, header.height);
    match header.format {
        Format::Blocks(block) => decode_blocks(block, data, width, height),
        Format::Packed {
            bits,
            masks,
            luminance,
        } => decode_packed(data, width, height, bits, masks, luminance),
    }
}

fn parse_header(bytes: &[u8]) -> Result<Header, String> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC {
        return Err("not a DDS file".to_owned());
    }
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    let (height, width) = (u32_at(12), u32_at(16));
    if width == 0 || height == 0 {
        return Err(format!("{width}x{height} image"));
    }
    let pf_flags = u32_at(80);
    let four_cc = &bytes[84..88];
    let bits = u32_at(88);
    let masks = [u32_at(92), u32_at(96), u32_at(100), u32_at(104)];
    let (format, data_offset) = if pf_flags & PF_FOURCC != 0 && four_cc == b"DX10" {
        if bytes.len() < HEADER_LEN + DX10_LEN {
            return Err("truncated DX10 header".to_owned());
        }
        (dxgi_format(u32_at(HEADER_LEN))?, HEADER_LEN + DX10_LEN)
    } else if pf_flags & PF_FOURCC != 0 {
        (Format::Blocks(four_cc_format(four_cc)?), HEADER_LEN)
    } else if pf_flags & (PF_RGB | PF_LUMINANCE | PF_ALPHAPIXELS) != 0 {
        let format = Format::Packed {
            bits,
            masks,
            luminance: pf_flags & PF_LUMINANCE != 0,
        };
        (format, HEADER_LEN)
    } else {
        return Err(format!("unsupported pixel format flags {pf_flags:#x}"));
    };
    Ok(Header {
        width,
        height,
        format,
        data_offset,
    })
}

fn four_cc_format(four_cc: &[u8]) -> Result<Block, String> {
    Ok(match four_cc {
        b"DXT1" => Block::Bc1,
        b"DXT2" | b"DXT3" => Block::Bc2,
        b"DXT4" | b"DXT5" => Block::Bc3,
        b"ATI1" | b"BC4U" => Block::Bc4,
        b"ATI2" | b"BC5U" => Block::Bc5,
        other => {
            return Err(format!(
                "unsupported fourCC `{}`",
                String::from_utf8_lossy(other)
            ));
        }
    })
}

fn dxgi_format(dxgi: u32) -> Result<Format, String> {
    let block = match dxgi {
        27..=29 => {
            return Ok(Format::Packed {
                bits: 32,
                masks: [0xff, 0xff00, 0xff0000, 0xff00_0000],
                luminance: false,
            });
        }
        87 | 91 => {
            return Ok(Format::Packed {
                bits: 32,
                masks: [0xff0000, 0xff00, 0xff, 0xff00_0000],
                luminance: false,
            });
        }
        88 => {
            return Ok(Format::Packed {
                bits: 32,
                masks: [0xff0000, 0xff00, 0xff, 0],
                luminance: false,
            });
        }
        70..=72 => Block::Bc1,
        73..=75 => Block::Bc2,
        76..=78 => Block::Bc3,
        79..=81 => Block::Bc4,
        82..=84 => Block::Bc5,
        94 | 95 => Block::Bc6 { signed: false },
        96 => Block::Bc6 { signed: true },
        97..=99 => Block::Bc7,
        other => return Err(format!("unsupported DXGI format {other}")),
    };
    Ok(Format::Blocks(block))
}

fn decode_blocks(block: Block, data: &[u8], width: u32, height: u32) -> Result<RgbaImage, String> {
    let (w, h) = (width as usize, height as usize);
    let needed = w.div_ceil(4) * h.div_ceil(4) * block.bytes();
    check_len(data, needed)?;
    let mut pixels = vec![0u32; w * h];
    use texture2ddecoder as t;
    match block {
        Block::Bc1 => t::decode_bc1a(data, w, h, &mut pixels),
        Block::Bc2 => t::decode_bc2(data, w, h, &mut pixels),
        Block::Bc3 => t::decode_bc3(data, w, h, &mut pixels),
        Block::Bc4 => t::decode_bc4(data, w, h, &mut pixels),
        Block::Bc5 => t::decode_bc5(data, w, h, &mut pixels),
        Block::Bc6 { signed } => t::decode_bc6(data, w, h, &mut pixels, signed),
        Block::Bc7 => t::decode_bc7(data, w, h, &mut pixels),
    }
    .map_err(str::to_owned)?;
    let rgba = pixels
        .iter()
        .flat_map(|px| {
            let [b, g, r, a] = px.to_le_bytes();
            [r, g, b, a]
        })
        .collect();
    RgbaImage::from_raw(width, height, rgba).ok_or_else(|| "decoded size mismatch".to_owned())
}

fn decode_packed(
    data: &[u8],
    width: u32,
    height: u32,
    bits: u32,
    masks: [u32; 4],
    luminance: bool,
) -> Result<RgbaImage, String> {
    if !matches!(bits, 8 | 16 | 24 | 32) {
        return Err(format!("unsupported {bits}-bit pixels"));
    }
    let bytes_per_pixel = (bits / 8) as usize;
    check_len(data, width as usize * height as usize * bytes_per_pixel)?;
    let rgba = data
        .chunks_exact(bytes_per_pixel)
        .take(width as usize * height as usize)
        .flat_map(|px| {
            let mut word = [0u8; 4];
            word[..px.len()].copy_from_slice(px);
            let value = u32::from_le_bytes(word);
            let channel = |mask: u32| unpack(value, mask);
            let alpha = if masks[3] == 0 {
                255
            } else {
                channel(masks[3])
            };
            if luminance {
                let l = channel(masks[0]);
                [l, l, l, alpha]
            } else {
                [
                    channel(masks[0]),
                    channel(masks[1]),
                    channel(masks[2]),
                    alpha,
                ]
            }
        })
        .collect();
    RgbaImage::from_raw(width, height, rgba).ok_or_else(|| "decoded size mismatch".to_owned())
}

fn check_len(data: &[u8], needed: usize) -> Result<(), String> {
    if data.len() < needed {
        return Err(format!(
            "truncated: {needed} bytes of pixel data expected, {} present",
            data.len()
        ));
    }
    Ok(())
}

/// The channel under `mask`, rescaled to 8 bits.
fn unpack(value: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shift = mask.trailing_zeros();
    let width = (mask >> shift).count_ones();
    let raw = (value & mask) >> shift;
    match width {
        8 => raw as u8,
        w if w < 8 => ((raw * 255) / ((1 << w) - 1)) as u8,
        w => (raw >> (w - 8)) as u8,
    }
}
