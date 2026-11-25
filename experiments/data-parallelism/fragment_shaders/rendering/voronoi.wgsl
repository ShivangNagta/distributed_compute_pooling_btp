fn hash2(p: vec2<f32>) -> vec2<f32> {
    let q = vec2<f32>(
        dot(p, vec2<f32>(127.1, 311.7)),
        dot(p, vec2<f32>(269.5, 183.3))
    );
    return fract(sin(q) * 43758.5453);
}

fn voronoi(p: vec2<f32>) -> vec3<f32> {
    let ip = floor(p);
    let fp = fract(p);
    var d1 = 8.0;
    var d2 = 8.0;
    var mc = vec2<f32>(0.0);

    for (var j: i32 = -1; j <= 1; j += 1) {
        for (var i: i32 = -1; i <= 1; i += 1) {
            let g = vec2<f32>(f32(i), f32(j));
            let o = hash2(ip + g);
            let r = g + o - fp;
            let d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; mc = o; }
            else if (d < d2) { d2 = d; }
        }
    }
    return vec3<f32>(sqrt(d1), sqrt(d2), mc.x);
}

fn shade(gid: vec2<u32>, out_idx: u32) {
    let res = global_res();
    let uv  = (vec2<f32>(gid) * 2.0 - res) / res.y;

    let v    = voronoi(uv * 5.0);
    let edge = smoothstep(0.0, 0.08, v.y - v.x);
    let hue  = v.z;

    // HSV-like coloring from cell hash
    let col  = vec3<f32>(
        0.5 + 0.5 * cos(6.283 * (hue + 0.0)),
        0.5 + 0.5 * cos(6.283 * (hue + 0.33)),
        0.5 + 0.5 * cos(6.283 * (hue + 0.67))
    ) * edge;

    let vignette = smoothstep(1.4, 0.4, length(uv));
    write_pixel(out_idx, vec4<f32>(col * vignette, 1.0));
}