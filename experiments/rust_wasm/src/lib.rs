// cargo build --release --target wasm32-unknown-unknown
#[unsafe(no_mangle)]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[unsafe(no_mangle)]
pub extern "C" fn sub(a: i32, b: i32) -> i32 {
    a.wrapping_sub(b)
}
