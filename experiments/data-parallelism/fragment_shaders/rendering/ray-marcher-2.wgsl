fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sd_torus(p: vec3<f32>, major: f32, minor: f32) -> f32 {
    let q = vec2<f32>(length(vec2<f32>(p.x, p.z)) - major, p.y);
    return length(q) - minor;
}

fn sd_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0)))
         + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sd_plane(p: vec3<f32>) -> f32 {
    return p.y + 0.9;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Returns vec2(dist, mat_id) — no structs
fn map(p: vec3<f32>) -> vec2<f32> {
    let sphere = sd_sphere(p, 0.4);
    let torus  = sd_torus(p, 0.65, 0.14);
    let box_d  = sd_box(p - vec3<f32>(1.3, -0.4, 0.0), vec3<f32>(0.22));
    let plane  = sd_plane(p);

    let merged = smin(smin(sphere, torus, 0.12), box_d, 0.05);

    if (merged < plane) { return vec2<f32>(merged, 0.0); }
    return                     vec2<f32>(plane,  1.0);
}

fn calc_normal(p: vec3<f32>) -> vec3<f32> {
    let e = 0.0005;
    return normalize(vec3<f32>(
        map(p + vec3<f32>(e,  0.0, 0.0)).x - map(p - vec3<f32>(e,  0.0, 0.0)).x,
        map(p + vec3<f32>(0.0, e,  0.0)).x - map(p - vec3<f32>(0.0, e,  0.0)).x,
        map(p + vec3<f32>(0.0, 0.0, e )).x - map(p - vec3<f32>(0.0, 0.0, e )).x,
    ));
}

fn soft_shadow(ro: vec3<f32>, rd: vec3<f32>, k: f32) -> f32 {
    var res = 1.0;
    var t   = 0.02;
    for (var i = 0; i < 16; i += 1) {
        let h = map(ro + rd * t).x;
        if (h < 0.001) { return 0.0; }
        res = min(res, k * h / t);
        t  += clamp(h, 0.01, 0.2);
        if (t > 6.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}

fn calc_ao(p: vec3<f32>, n: vec3<f32>) -> f32 {
    var ao  = 0.0;
    var sca = 1.0;
    for (var i = 0; i < 4; i += 1) {
        let h = 0.01 + 0.12 * f32(i) / 3.0;
        ao   += (h - map(p + n * h).x) * sca;
        sca  *= 0.9;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
}

fn sky(rd: vec3<f32>) -> vec3<f32> {
    let sun = normalize(vec3<f32>(1.5, 3.0, 2.5));
    let t   = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    let glow = pow(max(dot(rd, sun), 0.0), 48.0);
    return mix(vec3<f32>(0.6, 0.45, 0.3), vec3<f32>(0.1, 0.15, 0.4), pow(t, 0.6))
         + vec3<f32>(1.0, 0.9, 0.6) * glow;
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res    = global_res();
    let uv     = (vec2<f32>(gid) * 2.0 - res) / res.y;
    let aspect = res.x / res.y;

    let ro  = vec3<f32>(0.0, 0.5, 3.0);
    let rd  = normalize(vec3<f32>(uv.x * aspect, uv.y, -1.8));

    var col = sky(rd);
    var t   = 0.02;
    var mat = -1.0;

    for (var i = 0; i < 64; i += 1) {
        let h = map(ro + rd * t);
        if (h.x < 0.0008) { mat = h.y; break; }
        if (t  > 18.0    ) { break; }
        t += h.x * 0.95;
    }

    if (mat >= 0.0) {
        let p   = ro + rd * t;
        let n   = calc_normal(p);
        let ao  = calc_ao(p, n);
        let sun = normalize(vec3<f32>(1.5, 3.0, 2.5));
        let sh  = soft_shadow(p + n * 0.002, sun, 8.0);

        let diff = max(dot(n, sun), 0.0);
        let fill = max(dot(n, normalize(vec3<f32>(-1.5, 1.0, -1.0))), 0.0);
        let hv   = normalize(sun - rd);
        let spec = pow(max(dot(n, hv), 0.0), 64.0) * sh;

        var base = vec3<f32>(0.0);
        if (mat < 0.5) {
            // Objects — stripe pattern
            let stripe = fract(p.y * 3.0 + p.x * 1.5 + p.z * 1.5);
            base = mix(vec3<f32>(0.9, 0.3, 0.1),
                       vec3<f32>(0.1, 0.4, 0.9),
                       clamp(stripe, 0.0, 1.0));
        } else {
            // Ground — marble checkerboard
            let ck = floor(p.x) + floor(p.z);
            base   = select(vec3<f32>(0.2, 0.18, 0.15),
                            vec3<f32>(0.85, 0.82, 0.78),
                            fract(ck * 0.5) < 0.25);
        }

        col = base * (
            vec3<f32>(1.0, 0.85, 0.6) * diff * sh +
            vec3<f32>(0.3, 0.4,  0.7) * fill * 0.3 +
            vec3<f32>(0.04)           * ao
        ) + vec3<f32>(1.0, 0.95, 0.8) * spec * 0.5;

        col = mix(sky(rd), col, exp(-t * 0.05));
    }

    // ACES tone map + gamma
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.4545));
    write_pixel(out_idx, vec4<f32>(col, 1.0));
}fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sd_torus(p: vec3<f32>, major: f32, minor: f32) -> f32 {
    let q = vec2<f32>(length(vec2<f32>(p.x, p.z)) - major, p.y);
    return length(q) - minor;
}

fn sd_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0)))
         + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sd_plane(p: vec3<f32>) -> f32 {
    return p.y + 0.9;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Returns vec2(dist, mat_id) — no structs
fn map(p: vec3<f32>) -> vec2<f32> {
    let sphere = sd_sphere(p, 0.4);
    let torus  = sd_torus(p, 0.65, 0.14);
    let box_d  = sd_box(p - vec3<f32>(1.3, -0.4, 0.0), vec3<f32>(0.22));
    let plane  = sd_plane(p);

    let merged = smin(smin(sphere, torus, 0.12), box_d, 0.05);

    if (merged < plane) { return vec2<f32>(merged, 0.0); }
    return                     vec2<f32>(plane,  1.0);
}

fn calc_normal(p: vec3<f32>) -> vec3<f32> {
    let e = 0.0005;
    return normalize(vec3<f32>(
        map(p + vec3<f32>(e,  0.0, 0.0)).x - map(p - vec3<f32>(e,  0.0, 0.0)).x,
        map(p + vec3<f32>(0.0, e,  0.0)).x - map(p - vec3<f32>(0.0, e,  0.0)).x,
        map(p + vec3<f32>(0.0, 0.0, e )).x - map(p - vec3<f32>(0.0, 0.0, e )).x,
    ));
}

fn soft_shadow(ro: vec3<f32>, rd: vec3<f32>, k: f32) -> f32 {
    var res = 1.0;
    var t   = 0.02;
    for (var i = 0; i < 16; i += 1) {
        let h = map(ro + rd * t).x;
        if (h < 0.001) { return 0.0; }
        res = min(res, k * h / t);
        t  += clamp(h, 0.01, 0.2);
        if (t > 6.0) { break; }
    }
    return clamp(res, 0.0, 1.0);
}

fn calc_ao(p: vec3<f32>, n: vec3<f32>) -> f32 {
    var ao  = 0.0;
    var sca = 1.0;
    for (var i = 0; i < 4; i += 1) {
        let h = 0.01 + 0.12 * f32(i) / 3.0;
        ao   += (h - map(p + n * h).x) * sca;
        sca  *= 0.9;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
}

fn sky(rd: vec3<f32>) -> vec3<f32> {
    let sun = normalize(vec3<f32>(1.5, 3.0, 2.5));
    let t   = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    let glow = pow(max(dot(rd, sun), 0.0), 48.0);
    return mix(vec3<f32>(0.6, 0.45, 0.3), vec3<f32>(0.1, 0.15, 0.4), pow(t, 0.6))
         + vec3<f32>(1.0, 0.9, 0.6) * glow;
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res    = global_res();
    let uv     = (vec2<f32>(gid) * 2.0 - res) / res.y;
    let aspect = res.x / res.y;

    let ro  = vec3<f32>(0.0, 0.5, 3.0);
    let rd  = normalize(vec3<f32>(uv.x * aspect, uv.y, -1.8));

    var col = sky(rd);
    var t   = 0.02;
    var mat = -1.0;

    for (var i = 0; i < 64; i += 1) {
        let h = map(ro + rd * t);
        if (h.x < 0.0008) { mat = h.y; break; }
        if (t  > 18.0    ) { break; }
        t += h.x * 0.95;
    }

    if (mat >= 0.0) {
        let p   = ro + rd * t;
        let n   = calc_normal(p);
        let ao  = calc_ao(p, n);
        let sun = normalize(vec3<f32>(1.5, 3.0, 2.5));
        let sh  = soft_shadow(p + n * 0.002, sun, 8.0);

        let diff = max(dot(n, sun), 0.0);
        let fill = max(dot(n, normalize(vec3<f32>(-1.5, 1.0, -1.0))), 0.0);
        let hv   = normalize(sun - rd);
        let spec = pow(max(dot(n, hv), 0.0), 64.0) * sh;

        var base = vec3<f32>(0.0);
        if (mat < 0.5) {
            // Objects — stripe pattern
            let stripe = fract(p.y * 3.0 + p.x * 1.5 + p.z * 1.5);
            base = mix(vec3<f32>(0.9, 0.3, 0.1),
                       vec3<f32>(0.1, 0.4, 0.9),
                       clamp(stripe, 0.0, 1.0));
        } else {
            // Ground — marble checkerboard
            let ck = floor(p.x) + floor(p.z);
            base   = select(vec3<f32>(0.2, 0.18, 0.15),
                            vec3<f32>(0.85, 0.82, 0.78),
                            fract(ck * 0.5) < 0.25);
        }

        col = base * (
            vec3<f32>(1.0, 0.85, 0.6) * diff * sh +
            vec3<f32>(0.3, 0.4,  0.7) * fill * 0.3 +
            vec3<f32>(0.04)           * ao
        ) + vec3<f32>(1.0, 0.95, 0.8) * spec * 0.5;

        col = mix(sky(rd), col, exp(-t * 0.05));
    }

    // ACES tone map + gamma
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.4545));
    write_pixel(out_idx, vec4<f32>(col, 1.0));
}