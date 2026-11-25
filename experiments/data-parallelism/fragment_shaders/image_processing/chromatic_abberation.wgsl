fn tile_sample(lx: i32, ly: i32) -> vec4<f32> {
    let w  = i32(region.tile_size.x);
    let h  = i32(region.tile_size.y);
    let cx = u32(clamp(lx, 0, w - 1));
    let cy = u32(clamp(ly, 0, h - 1));
    return source_pixel(cy * u32(w) + cx);
}

fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {
    let lx = i32(gid.x) - i32(region.tile_offset.x);
    let ly = i32(gid.y) - i32(region.tile_offset.y);

    // Direction from image center to this pixel (in global space)
    let res      = region.global_res;
    let centered = vec2<f32>(gid) - res * 0.5;
    let dist     = length(centered / (res * 0.5));  // 0 at center, 1 at corner
    let dir      = normalize(centered + vec2<f32>(0.0001)); // avoid zero-div
    let strength = dist * dist * 6.0;   // aberration grows with distance

    // Shift R outward, B inward by a few pixels
    let r_off = vec2<i32>(i32(dir.x * strength),  i32(dir.y * strength));
    let b_off = vec2<i32>(i32(-dir.x * strength), i32(-dir.y * strength));

    let r = tile_sample(lx + r_off.x, ly + r_off.y).r;
    let g = input_pixel.g;
    let b = tile_sample(lx + b_off.x, ly + b_off.y).b;

    // Vignette
    let vignette = 1.0 - smoothstep(0.5, 1.4, dist);

    write_pixel(out_idx, vec4<f32>(
        vec3<f32>(r, g, b) * vignette,
        input_pixel.a
    ));
}