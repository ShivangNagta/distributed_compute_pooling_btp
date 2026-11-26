//! Arithmetic smoke-test workload.
//!
//! Exports only scalar functions so the browser worker can call it with plain
//! JavaScript numbers. There are no imports.

#[unsafe(no_mangle)]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[unsafe(no_mangle)]
pub extern "C" fn sub(a: i32, b: i32) -> i32 {
    a.wrapping_sub(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arithmetic_wraps() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(sub(2, 3), -1);
        assert_eq!(add(i32::MAX, 1), i32::MIN);
    }
}
