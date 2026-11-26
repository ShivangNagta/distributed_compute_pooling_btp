//! Iterative Fibonacci workload.
//!
//! Exports only scalar functions so the browser worker can call it with plain
//! JavaScript numbers. There are no imports.

/// Iterative Fibonacci folded into `u32` (wrapping) so the cost is O(n).
#[unsafe(no_mangle)]
pub extern "C" fn fib(n: u32) -> u32 {
    let mut a = 0u32;
    let mut b = 1u32;
    let mut i = 0u32;
    while i < n {
        let next = a.wrapping_add(b);
        a = b;
        b = next;
        i += 1;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fib_matches_small_sequence() {
        assert_eq!(fib(0), 0);
        assert_eq!(fib(1), 1);
        assert_eq!(fib(10), 55);
        assert_eq!(fib(30), 832_040);
    }
}
