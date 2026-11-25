// Helper: clamp-to-edge sample using LOCAL tile coordinates
fn tile_sample(lx: i32, ly: i32) -> vec4<f32> {
    let w  = i32(region.tile_size.x);
    let h  = i32(region.tile_size.y);
    let cx = u32(clamp(lx, 0, w - 1));
    let cy = u32(clamp(ly, 0, h - 1));
    return source_pixel(cy * u32(w) + cx);
}

fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {
    // Local coordinate within this tile
    let lx = i32(gid.x) - i32(region.tile_offset.x);
    let ly = i32(gid.y) - i32(region.tile_offset.y);

    // 7-tap Gaussian kernel coefficients (sigma ≈ 1.4)
    let k = array<f32, 7>(
        0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125
    );

    var acc = vec4<f32>(0.0);
    for (var dy: i32 = -3; dy <= 3; dy += 1) {
        for (var dx: i32 = -3; dx <= 3; dx += 1) {
            let w = k[dx + 3] * k[dy + 3];
            acc  += tile_sample(lx + dx, ly + dy) * w;
        }
    }

    write_pixel(out_idx, vec4<f32>(acc.rgb, input_pixel.a));
}