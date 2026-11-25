fn tile_sample(lx: i32, ly: i32) -> vec4<f32> {
    let w  = i32(region.tile_size.x);
    let h  = i32(region.tile_size.y);
    let cx = u32(clamp(lx, 0, w - 1));
    let cy = u32(clamp(ly, 0, h - 1));
    return source_pixel(cy * u32(w) + cx);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

// Compute mean and variance of a 5×5 quadrant
// ox, oy = top-left corner of the quadrant relative to local pixel
fn kuwahara_quadrant(lx: i32, ly: i32, ox: i32, oy: i32) -> vec4<f32> {
    var mean  = vec3<f32>(0.0);
    var mean2 = 0.0;
    let n     = 25.0;   // 5×5

    for (var dy: i32 = 0; dy < 5; dy += 1) {
        for (var dx: i32 = 0; dx < 5; dx += 1) {
            let c = tile_sample(lx + ox + dx, ly + oy + dy).rgb;
            mean  += c;
            let l  = luma(c);
            mean2 += l * l;
        }
    }

    mean /= n;
    let variance = mean2 / n - luma(mean) * luma(mean);
    // Pack: xyz = mean color, w = variance
    return vec4<f32>(mean, variance);
}

fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {
    let lx = i32(gid.x) - i32(region.tile_offset.x);
    let ly = i32(gid.y) - i32(region.tile_offset.y);

    // Four overlapping 5×5 quadrants around the pixel
    // Top-left, top-right, bottom-left, bottom-right
    let q0 = kuwahara_quadrant(lx, ly, -4, -4);  // top-left
    let q1 = kuwahara_quadrant(lx, ly,  0, -4);  // top-right
    let q2 = kuwahara_quadrant(lx, ly, -4,  0);  // bottom-left
    let q3 = kuwahara_quadrant(lx, ly,  0,  0);  // bottom-right

    // Pick the quadrant with the lowest variance
    var best = q0;
    if (q1.w < best.w) { best = q1; }
    if (q2.w < best.w) { best = q2; }
    if (q3.w < best.w) { best = q3; }

    write_pixel(out_idx, vec4<f32>(best.rgb, input_pixel.a));
}