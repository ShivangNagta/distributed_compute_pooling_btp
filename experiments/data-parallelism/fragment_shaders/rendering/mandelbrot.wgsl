fn shade(gid: vec2<u32>, out_idx: u32) {
    let res = global_res();
    let uv  = (vec2<f32>(gid) * 2.0 - res) / res.y;
    let c   = vec2<f32>(uv.x * 1.5 - 0.5, uv.y);

    var z        = vec2<f32>(0.0);
    var i        = 0u;
    let max_iter = 256u;    // FIX: `max` is a WGSL built-in — renamed to max_iter

    for (var k = 0u; k < max_iter; k += 1u) {
        if (dot(z, z) > 4.0) { break; }
        z = vec2<f32>(z.x * z.x - z.y * z.y + c.x,
                      2.0 * z.x * z.y         + c.y);
        i += 1u;
    }

    var t = 0.0;
    if (i < max_iter) {
        // Safe smooth colouring — guard log argument so it never reaches 0
        let log_zn = log(max(dot(z, z), 0.0001)) * 0.5;
        let nu     = log(max(log_zn / 0.6931, 0.0001)) / 0.6931;
        t = (f32(i) + 1.0 - nu) / f32(max_iter);
        t = clamp(t, 0.0, 1.0);
    }

    let col = select(
        vec3<f32>(
            0.5 + 0.5 * cos(6.283 * (t * 3.0 + 0.00)),
            0.5 + 0.5 * cos(6.283 * (t * 3.0 + 0.33)),
            0.5 + 0.5 * cos(6.283 * (t * 3.0 + 0.67)),
        ),
        vec3<f32>(0.0),     // interior is black
        i >= max_iter
    );

    write_pixel(out_idx, vec4<f32>(col, 1.0));
}