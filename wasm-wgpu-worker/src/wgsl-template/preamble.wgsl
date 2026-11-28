// Injected by the distributed rendering framework.
//
// User shader contract:
//   - Define only shade(gid: vec2<u32>, out_idx: u32).
//   - gid is the pixel's GLOBAL image coordinate, not its coordinate within
//     the current tile. Use it for UVs and procedural patterns so tile seams
//     do not appear.
//   - out_idx is the pixel's LOCAL index in this tile. Pass it unchanged to
//     write_pixel().
//   - Colors passed to write_pixel() should normally be in the 0.0..1.0 range.
//
// Available helpers:
//   global_res()  -> full image resolution in pixels.
//   write_pixel() -> writes one RGBA pixel to this tile's output buffer.
//
// Example user shader:
//   fn shade(gid: vec2<u32>, out_idx: u32) {
//       let uv = (vec2<f32>(gid) / global_res()) * 2.0 - vec2<f32>(1.0);
//       let color = vec3<f32>(0.5 + 0.5 * uv.x, 0.5 + 0.5 * uv.y, 0.2);
//       write_pixel(out_idx, vec4<f32>(color, 1.0));
//   }
//
// Do not declare bindings, main(), or another shade() function. They are
// supplied by the framework.

struct RenderRegion {
    tile_offset: vec2<f32>,
    tile_size: vec2<f32>,
    global_res: vec2<f32>,
    _padding: vec2<f32>,
}

@group(0) @binding(0) var<uniform> region: RenderRegion;
@group(0) @binding(1) var<storage, read_write> output_pixels: array<u32>;

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
