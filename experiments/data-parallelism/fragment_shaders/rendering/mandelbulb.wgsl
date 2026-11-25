fn mandelbulb_sdf(pos: vec3<f32>) -> f32 {
    var z  = pos;
    var dr = 1.0;
    var r  = 0.0;

    for (var i = 0; i < 6; i += 1) {
        r = length(z);
        if (r > 2.0) { break; }

        // Spherical coordinates — clamp to avoid acos domain error
        let theta = acos(clamp(z.z / r, -1.0, 1.0));
        let phi   = atan2(z.y, z.x);

        // Derivative update
        dr = pow(r, 7.0) * 8.0 * dr + 1.0;

        // Apply power-8 rotation and add c = pos (Mandelbulb, not Julia)
        let zr = pow(r, 8.0);
        z = pos + zr * vec3<f32>(
            sin(theta * 8.0) * cos(phi * 8.0),
            sin(theta * 8.0) * sin(phi * 8.0),
            cos(theta * 8.0),
        );
    }

    r = length(z);
    return 0.5 * log(max(r, 0.0001)) * r / max(dr, 0.0001);
}

fn mandelbulb_normal(p: vec3<f32>) -> vec3<f32> {
    let e = 0.0008;
    return normalize(vec3<f32>(
        mandelbulb_sdf(p + vec3<f32>(e,   0.0, 0.0)) - mandelbulb_sdf(p - vec3<f32>(e,   0.0, 0.0)),
        mandelbulb_sdf(p + vec3<f32>(0.0, e,   0.0)) - mandelbulb_sdf(p - vec3<f32>(0.0, e,   0.0)),
        mandelbulb_sdf(p + vec3<f32>(0.0, 0.0, e  )) - mandelbulb_sdf(p - vec3<f32>(0.0, 0.0, e  )),
    ));
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res = global_res();
    let uv  = (vec2<f32>(gid) * 2.0 - res) / res.y;

    let ro  = vec3<f32>(0.0, 0.3, 2.0);
    let rd  = normalize(vec3<f32>(uv.x, uv.y, -1.5));

    // Deep space background gradient
    let bg_t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    let bg   = mix(vec3<f32>(0.005, 0.005, 0.02),
                   vec3<f32>(0.01,  0.01,  0.04), bg_t);
    var col  = bg;

    var t   = 0.0;
    var hit = false;

    for (var i = 0; i < 48; i += 1) {
        let p = ro + rd * t;
        let d = mandelbulb_sdf(p);
        if (d < 0.0006) { hit = true; break; }
        if (t > 4.0   ) { break; }
        // Conservative step — Mandelbulb SDF underestimates near boundary
        t += d * 0.45;
    }

    if (hit) {
        let p  = ro + rd * t;
        let n  = mandelbulb_normal(p);

        let l1  = normalize(vec3<f32>( 1.5,  2.0,  1.5));
        let l2  = normalize(vec3<f32>(-1.0,  0.5, -1.0));
        let l3  = normalize(vec3<f32>( 0.0, -1.0,  0.5));

        let d1  = max(dot(n, l1), 0.0);
        let d2  = max(dot(n, l2), 0.0) * 0.4;
        let d3  = max(dot(n, l3), 0.0) * 0.2;
        let hv  = normalize(l1 - rd);
        let sp  = pow(max(dot(n, hv), 0.0), 48.0);
        let rim = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);

        // Iridescent coloring driven by surface position
        let hue  = fract(length(p) * 2.5 + p.y * 1.5);
        let base = vec3<f32>(
            0.5 + 0.5 * cos(6.2832 * (hue + 0.00)),
            0.5 + 0.5 * cos(6.2832 * (hue + 0.33)),
            0.5 + 0.5 * cos(6.2832 * (hue + 0.67)),
        );

        col = base  * (d1 + d2 + d3 + 0.04)
            + vec3<f32>(1.0, 0.95, 0.85) * sp  * 0.6
            + vec3<f32>(0.2, 0.5,  1.0 ) * rim * 0.5;

        // Depth fog into background
        col = mix(bg, col, exp(-t * 0.08));
    }

    // Vignette
    col *= 1.0 - 0.25 * dot(uv, uv);

    // Reinhard tone map + gamma
    col  = col / (col + vec3<f32>(1.0));
    col  = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.4545));
    write_pixel(out_idx, vec4<f32>(col, 1.0));
}