// A self-contained neon kaleidoscope. The framework provides global_res()
// and write_pixel(); all rendering logic intentionally stays in shade().
fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid) + vec2<f32>(0.5, 0.5);
    var uv = pixel / resolution * 2.0 - vec2<f32>(1.0, 1.0);
    let aspect = resolution.x / resolution.y;
    uv.x = uv.x * aspect;

    var point = uv;
    var color = vec3<f32>(0.004, 0.008, 0.025);

    for (var layer = 0; layer < 20; layer += 1) {
        let layer_f = f32(layer);
        let rotation = layer_f * 0.73;
        let cosine = cos(rotation);
        let sine = sin(rotation);
        point = abs(point) - vec2<f32>(0.34, 0.16);
        point = vec2<f32>(
            point.x * cosine - point.y * sine,
            point.x * sine + point.y * cosine,
        );

        let distance_to_ring = abs(length(point) - (0.08 + layer_f * 0.045));
        let glow = 1.0 / (1.0 + distance_to_ring * distance_to_ring * 1800.0);
        let palette = vec3<f32>(
            0.5 + 0.5 * sin(layer_f * 1.7 + 0.2),
            0.5 + 0.5 * sin(layer_f * 1.1 + 2.0),
            0.7 + 0.3 * cos(layer_f * 1.3),
        );
        color += palette * glow * (0.6 + 0.35 * sin(pixel.y * 0.035 + layer_f));
    }

    let lattice = sin(pixel.x * 0.12) * sin(pixel.y * 0.12);
    let lattice_glow = max(lattice, 0.0) * 0.08;
    color += vec3<f32>(0.05, 0.18, 0.3) * lattice_glow;

    let vignette = 1.0 - 0.28 * min(dot(uv, uv) / 2.0, 1.0);
    color *= vignette;
    color = color / (color + vec3<f32>(1.0, 1.0, 1.0));
    color = pow(
        clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0)),
        vec3<f32>(0.4545, 0.4545, 0.4545),
    );
    write_pixel(out_idx, vec4<f32>(color, 1.0));
}
