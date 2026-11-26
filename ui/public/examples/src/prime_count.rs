//! Prime counting workload.
//!
//! Exports only scalar functions so the browser worker can call it with plain
//! JavaScript numbers. There are no imports.

fn is_prime(n: u32) -> bool {
    if n < 2 {
        return false;
    }
    if n.is_multiple_of(2) {
        return n == 2;
    }
    let mut divisor = 3u32;
    while divisor <= n / divisor {
        if n.is_multiple_of(divisor) {
            return false;
        }
        divisor += 2;
    }
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn prime_count_range(start: u32, end: u32) -> u32 {
    if end <= start {
        return 0;
    }
    let mut count = 0u32;
    let mut n = start.max(2);
    while n < end {
        if is_prime(n) {
            count += 1;
        }
        n += 1;
    }
    count
}

#[unsafe(no_mangle)]
pub extern "C" fn prime_count(end: u32) -> u32 {
    prime_count_range(0, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prime_counts_are_correct() {
        assert_eq!(prime_count(10), 4);
        assert_eq!(prime_count(100), 25);
        assert_eq!(prime_count(1000), 168);
        assert_eq!(prime_count_range(10, 100), 21);
        assert_eq!(prime_count_range(100, 10), 0);
    }
}
