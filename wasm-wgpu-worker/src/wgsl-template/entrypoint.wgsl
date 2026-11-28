@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    let y = id.y;
    let width = u32(region.tile_size.x);
    let height = u32(region.tile_size.y);

    if (x >= width || y >= height) {
        return;
    }

    let gid = vec2<u32>(
        u32(region.tile_offset.x) + x,
        u32(region.tile_offset.y) + y,
    );
    let out_idx = y * width + x;

    shade(gid, out_idx);
}
