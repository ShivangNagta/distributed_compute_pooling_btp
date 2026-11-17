#[unsafe(no_mangle)]
pub extern "C" fn add(left: i32, right: i32) -> i32 {
    left + right
}

#[unsafe(no_mangle)]
pub extern "C" fn compute(mut count: i32) -> u32 {
    let mut state = 123_456_789_u32;
    while count > 0 {
        state ^= state.wrapping_shl(13);
        state ^= state.wrapping_shr(17);
        state ^= state.wrapping_shr(5);
        count -= 1;
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workloads_are_deterministic() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(compute(10), 149_847_757);
    }
}
