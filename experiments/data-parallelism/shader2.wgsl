fn shade(gid: vec2<u32>, out_idx: u32) {
    let resolution = global_res();
    let pixel = vec2<f32>(gid) + vec2<f32>(0.5, 0.5);
    let uv = pixel / resolution * 2.0 - vec2<f32>(1.0, 1.0);
    let aspect = resolution.x / resolution.y;

    let camera = vec3<f32>(0.0, 0.35, 3.4);
    let target = vec3<f32>(0.0, -0.05, 0.0);
    let forward = normalize(target - camera);
    let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
    let up = normalize(cross(right, forward));
    let ray = normalize(
        forward * 1.7
            + right * uv.x * aspect
            + up * uv.y,
    );

    let height = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
    let horizon = vec3<f32>(0.95, 0.55, 0.22);
    let zenith = vec3<f32>(0.08, 0.24, 0.72);
    let sun_direction = normalize(vec3<f32>(-0.4, 0.65, 1.0));
    let sun = pow(max(dot(ray, sun_direction), 0.0), 32.0);
    var color = mix(horizon, zenith, height)
        + vec3<f32>(1.0, 0.8, 0.35) * sun;

    var distance = 0.02;
    var hit = false;
    var material = 0.0;
    var hit_distance = 0.0;
    var point = camera;

    for (var step = 0; step < 64; step += 1) {
        point = camera + ray * distance;

        let floor_distance = point.y + 0.85;
        let sphere_offset = point - vec3<f32>(0.0, 0.05, 0.0);
        let sphere_distance = length(sphere_offset) - 0.62;

        let left_q = abs(point - vec3<f32>(-1.05, -0.25, 0.0))
            - vec3<f32>(0.22, 0.22, 0.22);
        let left_box_distance = length(max(left_q, vec3<f32>(0.0)))
            + min(max(left_q.x, max(left_q.y, left_q.z)), 0.0);

        let right_q = abs(point - vec3<f32>(1.05, -0.25, 0.0))
            - vec3<f32>(0.22, 0.22, 0.22);
        let right_box_distance = length(max(right_q, vec3<f32>(0.0)))
            + min(max(right_q.x, max(right_q.y, right_q.z)), 0.0);

        let object_distance = min(
            sphere_distance,
            min(left_box_distance, right_box_distance),
        );
        hit_distance = min(floor_distance, object_distance);
        material = select(0.0, 1.0, floor_distance < object_distance);

        if (hit_distance < 0.001) {
            hit = true;
            break;
        }
        distance += max(hit_distance * 0.9, 0.002);
        if (distance > 14.0) {
            break;
        }
    }

    if (hit) {
        var normal = vec3<f32>(0.0, 1.0, 0.0);
        if (material < 0.5) {
            let sphere_distance = length(point - vec3<f32>(0.0, 0.05, 0.0)) - 0.62;
            let left_distance = length(max(
                abs(point - vec3<f32>(-1.05, -0.25, 0.0))
                    - vec3<f32>(0.22, 0.22, 0.22),
                vec3<f32>(0.0),
            ));
            let right_distance = length(max(
                abs(point - vec3<f32>(1.05, -0.25, 0.0))
                    - vec3<f32>(0.22, 0.22, 0.22),
                vec3<f32>(0.0),
            ));

            if (sphere_distance <= left_distance && sphere_distance <= right_distance) {
                normal = normalize(point - vec3<f32>(0.0, 0.05, 0.0));
            } else {
                let center = select(
                    vec3<f32>(1.05, -0.25, 0.0),
                    vec3<f32>(-1.05, -0.25, 0.0),
                    left_distance < right_distance,
                );
                let delta = point - center;
                let absolute = abs(delta);
                normal = select(
                    vec3<f32>(sign(delta.x), 0.0, 0.0),
                    select(
                        vec3<f32>(0.0, sign(delta.y), 0.0),
                        vec3<f32>(0.0, 0.0, sign(delta.z)),
                        absolute.z >= absolute.y,
                    ),
                    absolute.x >= max(absolute.y, absolute.z),
                );
            }
        }

        let light_direction = normalize(vec3<f32>(-0.5, 0.8, 1.0));
        let fill_direction = normalize(vec3<f32>(0.7, 0.25, -0.6));
        let diffuse = max(dot(normal, light_direction), 0.0);
        let fill = max(dot(normal, fill_direction), 0.0) * 0.25;
        let lighting = 0.28 + diffuse + fill;

        if (material > 0.5) {
            let checker = sin(point.x * 4.0) * sin(point.z * 4.0);
            let floor_color = select(
                vec3<f32>(0.12, 0.18, 0.3),
                vec3<f32>(0.35, 0.42, 0.58),
                checker > 0.0,
            );
            color = floor_color * lighting;
        } else {
            let stripe = 0.5 + 0.5 * sin(point.y * 10.0 + point.x * 4.0);
            let object_color = mix(
                vec3<f32>(1.0, 0.2, 0.04),
                vec3<f32>(0.04, 0.4, 1.0),
                stripe,
            );
            let rim = pow(1.0 - max(dot(normal, -ray), 0.0), 2.0);
            color = object_color * lighting
                + vec3<f32>(0.25, 0.4, 1.0) * rim;
        }
    }

    color = color * 1.5;
    color = color / (color + vec3<f32>(1.0));
    color = pow(
        clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)),
        vec3<f32>(0.4545),
    );
    write_pixel(out_idx, vec4<f32>(color, 1.0));
}
