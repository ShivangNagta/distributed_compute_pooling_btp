//! Scalar WebAssembly workloads used by the demo catalog and benchmarks.
//!
//! Every export takes and returns only `i32`/`u32`/`f64` so the browser worker
//! can call it with plain JavaScript numbers. There are no imports, so modules
//! build with `wasm32-unknown-unknown` and run in the import-free worker.

#[inline]
fn xorshift(mut state: u32) -> u32 {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    state
}

/// xorshift collapses to zero for a zero seed, so map zero to one while
/// preserving every other seed exactly (unlike `seed | 1`).
#[inline]
fn nonzero_seed(seed: u32) -> u32 {
    if seed == 0 { 1 } else { seed }
}

#[unsafe(no_mangle)]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[unsafe(no_mangle)]
pub extern "C" fn sub(a: i32, b: i32) -> i32 {
    a.wrapping_sub(b)
}

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

fn is_prime(n: u32) -> bool {
    if n < 2 {
        return false;
    }
    if n % 2 == 0 {
        return n == 2;
    }
    let mut divisor = 3u32;
    while divisor <= n / divisor {
        if n % divisor == 0 {
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

#[unsafe(no_mangle)]
pub extern "C" fn monte_carlo_pi(iterations: u32, seed: u32) -> f64 {
    if iterations == 0 {
        return 0.0;
    }
    let mut state = nonzero_seed(seed);
    let mut inside = 0u32;
    let mut i = 0u32;
    while i < iterations {
        state = xorshift(state);
        let x = f64::from(state >> 8) * (1.0 / 16_777_216.0);
        state = xorshift(state);
        let y = f64::from(state >> 8) * (1.0 / 16_777_216.0);
        if x * x + y * y <= 1.0 {
            inside += 1;
        }
        i += 1;
    }
    4.0 * f64::from(inside) / f64::from(iterations)
}

/// Deterministic integer matrix multiply over rows `[start_row, end_row)`.
/// Returns a wrapping checksum of the result matrix.
#[unsafe(no_mangle)]
pub extern "C" fn matmul_checksum_range(n: u32, start_row: u32, end_row: u32, seed: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    let end = end_row.min(n);
    let mut checksum = 0u32;
    let mut row = start_row;
    while row < end {
        let mut col = 0u32;
        while col < n {
            let mut sum = 0u32;
            let mut k = 0u32;
            while k < n {
                let a = xorshift(
                    seed ^ row
                        .wrapping_mul(73_856_093)
                        .wrapping_add(k.wrapping_mul(19_349_663)),
                ) & 0xff;
                let b = xorshift(
                    seed ^ k
                        .wrapping_mul(83_492_791)
                        .wrapping_add(col.wrapping_mul(2_654_435_761)),
                ) & 0xff;
                sum = sum.wrapping_add(a.wrapping_mul(b));
                k += 1;
            }
            checksum = checksum.wrapping_add(sum);
            col += 1;
        }
        row += 1;
    }
    checksum
}

#[unsafe(no_mangle)]
pub extern "C" fn matmul_checksum(n: u32, seed: u32) -> u32 {
    matmul_checksum_range(n, 0, n, seed)
}

#[unsafe(no_mangle)]
pub extern "C" fn hash_chain(iterations: u32, seed: u32) -> u32 {
    let mut state = nonzero_seed(seed);
    let mut i = 0u32;
    while i < iterations {
        state = xorshift(state);
        i += 1;
    }
    state
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

    #[test]
    fn fib_matches_small_sequence() {
        assert_eq!(fib(0), 0);
        assert_eq!(fib(1), 1);
        assert_eq!(fib(10), 55);
        assert_eq!(fib(30), 832_040);
    }

    #[test]
    fn prime_counts_are_correct() {
        assert_eq!(prime_count(10), 4);
        assert_eq!(prime_count(100), 25);
        assert_eq!(prime_count(1000), 168);
        assert_eq!(prime_count_range(10, 100), 21);
        assert_eq!(prime_count_range(100, 10), 0);
    }

    #[test]
    fn monte_carlo_is_close() {
        let estimate = monte_carlo_pi(2_000_000, 12345);
        assert!((estimate - core::f64::consts::PI).abs() < 0.01);
    }

    #[test]
    fn matmul_checksum_ranges_sum() {
        let whole = matmul_checksum(16, 7);
        let first = matmul_checksum_range(16, 0, 8, 7);
        let second = matmul_checksum_range(16, 8, 16, 7);
        assert_eq!(whole, first.wrapping_add(second));
    }

    #[test]
    fn hash_chain_is_deterministic() {
        assert_eq!(hash_chain(1000, 42), hash_chain(1000, 42));
        assert_ne!(hash_chain(1000, 42), hash_chain(1000, 43));
    }
}
