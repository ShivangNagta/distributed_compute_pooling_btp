fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sd_plane(p: vec3<f32>) -> f32 {
    return p.y + 1.0;
}

// Returns vec2(dist, mat_id)  — avoids struct return type
fn map(p: vec3<f32>) -> vec2<f32> {
    let s  = sd_sphere(p, 0.5);
    let pl = sd_plane(p);
    if (s < pl) { return vec2<f32>(s,  0.0); }
    return      vec2<f32>(pl, 1.0);
}

fn calc_normal(p: vec3<f32>) -> vec3<f32> {
    let e = 0.001;
    return normalize(vec3<f32>(
        map(p + vec3<f32>(e,  0.0, 0.0)).x - map(p - vec3<f32>(e,  0.0, 0.0)).x,
        map(p + vec3<f32>(0.0, e,  0.0)).x - map(p - vec3<f32>(0.0, e,  0.0)).x,
        map(p + vec3<f32>(0.0, 0.0, e )).x - map(p - vec3<f32>(0.0, 0.0, e )).x,
    ));
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res = global_res();
    let uv  = (vec2<f32>(gid) * 2.0 - res) / res.y;

    let ro  = vec3<f32>(0.0, 0.4, 2.5);
    let rd  = normalize(vec3<f32>(uv, -1.6));

    // Sky gradient
    var col = mix(vec3<f32>(0.6, 0.7, 0.9), vec3<f32>(0.1, 0.15, 0.4),
                  clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));

    var t   = 0.02;
    var mat = -1.0;

    for (var i = 0; i < 64; i += 1) {
        let h = map(ro + rd * t);
        if (h.x < 0.001) { mat = h.y; break; }
        if (t  > 20.0  ) { break; }
        t += h.x;
    }

    if (mat >= 0.0) {
        let p     = ro + rd * t;
        let n     = calc_normal(p);
        let light = normalize(vec3<f32>(1.5, 2.5, 2.0));
        let h_vec = normalize(light - rd);
        let diff  = max(dot(n, light), 0.0);
        let spec  = pow(max(dot(n, h_vec), 0.0), 64.0);
        let amb   = 0.05;

        var base = vec3<f32>(0.0);
        if (mat < 0.5) {
            // Sphere — blue tint
            base = vec3<f32>(0.15, 0.4, 0.9);
        } else {
            // Ground — checkerboard
            let ck = floor(p.x) + floor(p.z);
            base   = select(vec3<f32>(0.25), vec3<f32>(0.85),
                            fract(ck * 0.5) < 0.25);
        }

        col = base * (amb + diff) + vec3<f32>(0.9, 0.95, 1.0) * spec * 0.5;

        // Fog
        col = mix(vec3<f32>(0.6, 0.7, 0.9), col, exp(-t * 0.07));
    }

    col = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.4545));
    write_pixel(out_idx, vec4<f32>(col, 1.0));
}