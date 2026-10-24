export const SHADER_TEMPLATE = `// Distributed WGSL shader template.
//
// Define only shade(). The framework injects bindings, bounds checks, and main().
// gid is the GLOBAL image coordinate, so use it for continuous UVs and patterns.
// out_idx is the LOCAL output index for this tile; pass it to write_pixel().
// global_res() returns the full image resolution.
// write_pixel() expects RGBA values in the 0.0..1.0 range.
//
// Start with this small sphere example, then add one feature at a time.
fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid) + vec2<f32>(0.5);
    let uv = (pixel / resolution) * 2.0 - vec2<f32>(1.0);

    let sphere_uv = vec2<f32>(uv.x, -uv.y);
    let radius = length(sphere_uv);
    var color = vec3<f32>(0.02, 0.03, 0.08);

    if (radius < 0.72) {
        let normalized = sphere_uv / 0.72;
        let z = sqrt(max(0.0, 1.0 - dot(normalized, normalized)));
        let normal = normalize(vec3<f32>(normalized, z));
        let light_direction = normalize(vec3<f32>(-0.45, 0.55, 1.0));
        let diffuse = max(dot(normal, light_direction), 0.0);
        color = vec3<f32>(0.08, 0.3, 0.85) * (0.2 + 0.8 * diffuse);
    }

    write_pixel(out_idx, vec4<f32>(color, 1.0));
}
`

export function downloadShaderTemplate() {
  const blob = new Blob([SHADER_TEMPLATE], { type: 'text/wgsl' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'shader-template.wgsl'
  link.click()
  URL.revokeObjectURL(url)
}
