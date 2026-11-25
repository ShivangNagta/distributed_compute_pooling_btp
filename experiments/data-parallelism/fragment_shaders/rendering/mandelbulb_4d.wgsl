fn quat_sq_plus_c(q: vec4<f32>, c: vec4<f32>) -> vec4<f32> {
    // q^2 in quaternion algebra: (a+bi+cj+dk)^2
    return vec4<f32>(
        q.x*q.x - q.y*q.y - q.z*q.z - q.w*q.w + c.x,
        2.0*q.x*q.y + c.y,
        2.0*q.x*q.z + c.z,
        2.0*q.x*q.w + c.w,
    );
}

fn quat_mul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.x*b.x - a.y*b.y - a.z*b.z - a.w*b.w,
        a.x*b.y + a.y*b.x + a.z*b.w - a.w*b.z,
        a.x*b.z - a.y*b.w + a.z*b.x + a.w*b.y,
        a.x*b.w + a.y*b.z - a.z*b.y + a.w*b.x,
    );
}

fn qjulia_sdf(pos: vec3<f32>, c: vec4<f32>) -> f32 {
    // 3D cross-section: embed pos into 4D with w = 0
    var q  = vec4<f32>(pos, 0.0);
    var dq = vec4<f32>(1.0, 0.0, 0.0, 0.0);

    for (var i = 0; i < 8; i += 1) {
        // dq = 2 * q * dq  (chain rule for derivative)
        dq = 2.0 * quat_mul(q, dq);
        // q = q^2 + c
        q  = quat_sq_plus_c(q, c);
        if (dot(q, q) > 16.0) { break; }
    }

    let r = length(q);
    return 0.5 * log(max(r, 0.0001)) * r / max(length(dq), 0.0001);
}

fn qjulia_normal(p: vec3<f32>, c: vec4<f32>) -> vec3<f32> {
    let e = 0.001;
    return normalize(vec3<f32>(
        qjulia_sdf(p + vec3<f32>(e,   0.0, 0.0), c) - qjulia_sdf(p - vec3<f32>(e,   0.0, 0.0), c),
        qjulia_sdf(p + vec3<f32>(0.0, e,   0.0), c) - qjulia_sdf(p - vec3<f32>(0.0, e,   0.0), c),
        qjulia_sdf(p + vec3<f32>(0.0, 0.0, e  ), c) - qjulia_sdf(p - vec3<f32>(0.0, 0.0, e  ), c),
    ));
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res = global_res();
    let uv  = (vec2<f32>(gid) * 2.0 - res) / res.y;

    // Julia parameter — 4 components define the 4D shape
    // Try varying these to explore different cross-sections
    let c = vec4<f32>(-0.2, 0.6, 0.2, 0.0);   // classic interesting shape
    // let c = vec4<f32>(0.3, 0.5, 0.4, 0.2);   // rounder variant
    // let c = vec4<f32>(-0.4, 0.6, 0.0, 0.0);  // spikier variant

    let ro  = vec3<f32>(0.0, 0.0, 2.2);
    let rd  = normalize(vec3<f32>(uv.x, uv.y, -1.6));

    // Dark iridescent background
    let bg_hue = fract(length(uv) * 0.3);
    let bg     = vec3<f32>(
        0.01 + 0.015 * (0.5 + 0.5 * cos(6.2832 * (bg_hue + 0.00))),
        0.01 + 0.015 * (0.5 + 0.5 * cos(6.2832 * (bg_hue + 0.33))),
        0.03 + 0.015 * (0.5 + 0.5 * cos(6.2832 * (bg_hue + 0.67))),
    );
    var col = bg;

    var t   = 0.0;
    var hit = false;

    for (var i = 0; i < 48; i += 1) {
        let p = ro + rd * t;
        let d = qjulia_sdf(p, c);
        if (d < 0.0005) { hit = true; break; }
        if (t > 5.0   ) { break; }
        t += d * 0.5;
    }

    if (hit) {
        let p  = ro + rd * t;
        let n  = qjulia_normal(p, c);

        let l1  = normalize(vec3<f32>( 2.0, 3.0,  2.0));
        let l2  = normalize(vec3<f32>(-1.5, 0.5, -1.0));
        let l3  = normalize(vec3<f32>( 0.0, -2.0, 1.0));

        let d1  = max(dot(n, l1), 0.0);
        let d2  = max(dot(n, l2), 0.0) * 0.35;
        let d3  = max(dot(n, l3), 0.0) * 0.15;
        let hv  = normalize(l1 - rd);
        let sp  = pow(max(dot(n, hv), 0.0), 64.0);
        let fr  = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);

        // Color driven by surface position and normal
        // This reveals the 4D structure through color variation
        let hue  = fract(dot(abs(n), vec3<f32>(0.4, 0.7, 0.3)) + length(p) * 1.8);
        let base = vec3<f32>(
            0.5 + 0.5 * cos(6.2832 * (hue + 0.00)),
            0.5 + 0.5 * cos(6.2832 * (hue + 0.33)),
            0.5 + 0.5 * cos(6.2832 * (hue + 0.67)),
        );

        col = base  * (d1 + d2 + d3 + 0.04)
            + vec3<f32>(1.0, 0.95, 0.9) * sp  * 0.7
            + vec3<f32>(0.4, 0.6,  1.0) * fr  * 0.4;

        col = mix(bg, col, exp(-t * 0.06));
    }

    col *= 1.0 - 0.2 * dot(uv, uv);

    // ACES tone map + gamma
    col  = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col  = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.4545));
    write_pixel(out_idx, vec4<f32>(col, 1.0));
}