fn tile_sample(lx: i32, ly: i32) -> vec4<f32> {
    let w  = i32(region.tile_size.x);
    let h  = i32(region.tile_size.y);
    let cx = u32(clamp(lx, 0, w - 1));
    let cy = u32(clamp(ly, 0, h - 1));
    return source_pixel(cy * u32(w) + cx);
}

fn luma(c: vec4<f32>) -> f32 {
    return dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
}

fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {
    let lx = i32(gid.x) - i32(region.tile_offset.x);
    let ly = i32(gid.y) - i32(region.tile_offset.y);

    // Sample 3×3 neighbourhood
    let tl = luma(tile_sample(lx - 1, ly - 1));
    let tc = luma(tile_sample(lx,     ly - 1));
    let tr = luma(tile_sample(lx + 1, ly - 1));
    let ml = luma(tile_sample(lx - 1, ly    ));
    let mr = luma(tile_sample(lx + 1, ly    ));
    let bl = luma(tile_sample(lx - 1, ly + 1));
    let bc = luma(tile_sample(lx,     ly + 1));
    let br = luma(tile_sample(lx + 1, ly + 1));

    // Sobel kernels
    let gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    let gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    let edge = clamp(sqrt(gx*gx + gy*gy), 0.0, 1.0);

    write_pixel(out_idx, vec4<f32>(vec3<f32>(edge), input_pixel.a));
}