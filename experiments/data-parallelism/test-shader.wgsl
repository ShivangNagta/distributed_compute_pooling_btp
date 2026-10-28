// Tiled optical-diamond shader adapted to the distributed shade() contract.
// The framework provides global_res() and write_pixel().
fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid) + vec2<f32>(0.5, 0.5);

    // Center and normalize coordinates while preserving the image aspect ratio.
    let uv = (pixel * 2.0 - resolution) / resolution.y;
    let grid_scale = 8.0;
    let grid_uv = fract(uv * grid_scale) - vec2<f32>(0.5, 0.5);
    let cell_id = floor(uv * grid_scale);
    let pattern_weight = sin(cell_id.x * 0.5) * cos(cell_id.y * 0.5);
    let cell_distance = abs(grid_uv.x) + abs(grid_uv.y);

    let col = select(
        0.0,
        1.0,
        fract(cell_distance * 3.0 + pattern_weight) > 0.5,
    );
    let vignette = smoothstep(1.5, 0.3, length(uv));
    let color = vec3<f32>(col)
        * vignette
        * vec3<f32>(0.9, 0.85, 0.75);

    write_pixel(out_idx, vec4<f32>(color, 1.0));
}