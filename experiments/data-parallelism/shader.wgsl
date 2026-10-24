// User shader contract:
// define only shade(). The framework injects uniforms, storage, bounds checks,
// global-coordinate translation, and pixel packing.

fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid);
    let uv = (pixel / resolution) * 2.0 - vec2<f32>(1.0);

    // A lit sphere with a checker/grid pattern and a soft vignette. All
    // coordinates come from gid, so the result stays continuous across tiles.
    let sphere_uv = vec2<f32>(uv.x, -uv.y);
    let radius = length(sphere_uv);
    var color = vec3<f32>(0.015, 0.025, 0.06);

    if (radius < 0.72) {
        let normalized = sphere_uv / 0.72;
        let z = sqrt(max(0.0, 1.0 - dot(normalized, normalized)));
        let normal = normalize(vec3<f32>(normalized, z));
        let light_direction = normalize(vec3<f32>(-0.45, 0.55, 1.0));
        let diffuse = max(dot(normal, light_direction), 0.0);
        let rim = pow(1.0 - max(normal.z, 0.0), 2.0);

        let grid = sin(pixel.x * 0.08) * sin(pixel.y * 0.08);
        let base = select(
            vec3<f32>(0.08, 0.3, 0.85),
            vec3<f32>(0.85, 0.22, 0.08),
            grid > 0.0,
        );
        color = base * (0.2 + 0.8 * diffuse) + vec3<f32>(0.12, 0.2, 0.45) * rim;
    }

    let vignette = 1.0 - 0.22 * min(dot(uv, uv), 1.0);
    write_pixel(out_idx, vec4<f32>(color * vignette, 1.0));
}
