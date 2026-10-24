fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid) + vec2<f32>(0.5, 0.5);
    let uv = pixel / resolution * 2.0 - vec2<f32>(1.0, 1.0);
    let aspect = resolution.x / resolution.y;

    let forward = vec3<f32>(0.0, 0.0, -1.0);
    let right = vec3<f32>(1.0, 0.0, 0.0);
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let ray = normalize(
        forward
            + right * uv.x * aspect
            - up * uv.y,
    );

    let camera = vec3<f32>(0.0, 0.0, 3.4);
    let sphere_center = vec3<f32>(0.0, 0.0, 0.0);
    let sphere_radius = 0.62;
    let offset = camera - sphere_center;
    let projection = dot(offset, ray);
    let discriminant = projection * projection
        - (dot(offset, offset) - sphere_radius * sphere_radius);
    let sphere_hit = discriminant >= 0.0 && projection < 0.0;
    let sphere_distance = -projection - sqrt(max(discriminant, 0.0));
    let floor_y = -0.85;
    let floor_hit = ray.y < -0.001;
    let floor_distance = (floor_y - camera.y) / ray.y;
    let box_center = vec3<f32>(-1.05, -0.25, 0.0);
    let box_half_size = vec3<f32>(0.22, 0.22, 0.22);
    let box_min = box_center - box_half_size;
    let box_max = box_center + box_half_size;
    let box_t0 = (box_min - camera) / ray;
    let box_t1 = (box_max - camera) / ray;
    let box_near = min(box_t0, box_t1);
    let box_far = max(box_t0, box_t1);
    let box_enter = max(box_near.x, max(box_near.y, box_near.z));
    let box_exit = min(box_far.x, min(box_far.y, box_far.z));
    let box_hit = box_exit >= max(box_enter, 0.0);
    let box_distance = max(box_enter, 0.0);
    let right_box_center = vec3<f32>(1.05, -0.25, 0.0);
    let right_box_min = right_box_center - box_half_size;
    let right_box_max = right_box_center + box_half_size;
    let right_box_t0 = (right_box_min - camera) / ray;
    let right_box_t1 = (right_box_max - camera) / ray;
    let right_box_near = min(right_box_t0, right_box_t1);
    let right_box_far = max(right_box_t0, right_box_t1);
    let right_box_enter = max(
        right_box_near.x,
        max(right_box_near.y, right_box_near.z),
    );
    let right_box_exit = min(
        right_box_far.x,
        min(right_box_far.y, right_box_far.z),
    );
    let right_box_hit = right_box_exit >= max(right_box_enter, 0.0);
    let right_box_distance = max(right_box_enter, 0.0);
    var color = vec3<f32>(0.04, 0.08, 0.2);

    let left_box_is_nearest = box_hit
        && (!right_box_hit || box_distance < right_box_distance)
        && (!sphere_hit || box_distance < sphere_distance)
        && (!floor_hit || box_distance < floor_distance);
    let right_box_is_nearest = right_box_hit
        && (!box_hit || right_box_distance < box_distance)
        && (!sphere_hit || right_box_distance < sphere_distance)
        && (!floor_hit || right_box_distance < floor_distance);

    if (left_box_is_nearest) {
        color = vec3<f32>(0.9, 0.2, 0.05);
    } else if (right_box_is_nearest) {
        color = vec3<f32>(0.05, 0.8, 0.35);
    } else if (sphere_hit
        && (!floor_hit || sphere_distance < floor_distance)
        && (!box_hit || sphere_distance < box_distance)
        && (!right_box_hit || sphere_distance < right_box_distance)) {
        let point = camera + ray * sphere_distance;
        let normal = normalize(point - sphere_center);
        let light_direction = normalize(vec3<f32>(-0.5, 0.8, 1.0));
        let diffuse = max(dot(normal, light_direction), 0.0);
        let sphere_color = vec3<f32>(0.08, 0.4, 1.0);
        color = sphere_color * (0.2 + 0.8 * diffuse);
    } else if (floor_hit
        && (!sphere_hit || floor_distance < sphere_distance)
        && (!box_hit || floor_distance < box_distance)
        && (!right_box_hit || floor_distance < right_box_distance)) {
        let point = camera + ray * floor_distance;
        let normal = vec3<f32>(0.0, 1.0, 0.0);
        let light_direction = normalize(vec3<f32>(-0.5, 0.8, 1.0));
        let diffuse = max(dot(normal, light_direction), 0.0);
        let checker = sin(point.x * 4.0) * sin(point.z * 4.0);
        let floor_color = select(
            vec3<f32>(0.12, 0.18, 0.3),
            vec3<f32>(0.35, 0.42, 0.58),
            checker > 0.0,
        );
        color = floor_color * (0.28 + diffuse);
    }

    write_pixel(out_idx, vec4<f32>(color, 1.0));
}