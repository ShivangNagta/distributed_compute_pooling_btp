// Framework bindings for independent per-pixel image processing.
//
// User shader contract:
//   - Define only process_pixel(gid, input_pixel, out_idx).
//   - gid is the pixel's GLOBAL image coordinate.
//   - input_pixel is the corresponding source RGBA color in the 0.0..1.0 range.
//   - out_idx is the pixel's LOCAL index in this tile; pass it to write_pixel().
//
// Do not declare bindings, main(), or another framework helper.

struct ImageRegion {
    tile_offset: vec2<f32>,
    tile_size: vec2<f32>,
    global_res: vec2<f32>,
    _padding: vec2<f32>,
}

@group(0) @binding(0) var<uniform> region: ImageRegion;
@group(0) @binding(1) var<storage, read> input_pixels: array<u32>;
@group(0) @binding(2) var<storage, read_write> output_pixels: array<u32>;

fn global_res() -> vec2<f32> {
    return region.global_res;
}

fn write_pixel(idx: u32, color: vec4<f32>) {
    let clamped = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));
    let r = u32(clamped.r * 255.0) & 255u;
    let g = u32(clamped.g * 255.0) & 255u;
    let b = u32(clamped.b * 255.0) & 255u;
    let a = u32(clamped.a * 255.0) & 255u;
    output_pixels[idx] = r | (g << 8u) | (b << 16u) | (a << 24u);
}

fn source_pixel(idx: u32) -> vec4<f32> {
    let packed = input_pixels[idx];
    return vec4<f32>(
        f32(packed & 255u),
        f32((packed >> 8u) & 255u),
        f32((packed >> 16u) & 255u),
        f32((packed >> 24u) & 255u),
    ) / 255.0;
}
