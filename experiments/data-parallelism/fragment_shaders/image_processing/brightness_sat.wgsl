fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {
    let brightness =  0.15;   // -1.0 to 1.0
    let contrast   =  1.3;    // 0.0 to 3.0
    let saturation =  1.4;    // 0.0 to 3.0

    // Brightness + contrast
    var col = (input_pixel.rgb - vec3<f32>(0.5)) * contrast
            + vec3<f32>(0.5)
            + vec3<f32>(brightness);

    // Saturation via luminance
    let lum = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    col     = mix(vec3<f32>(lum), col, saturation);

    write_pixel(out_idx, vec4<f32>(col, input_pixel.a));
}