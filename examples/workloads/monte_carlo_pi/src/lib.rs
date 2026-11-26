//! Monte Carlo Pi estimator workload.
//!
//! Exports only scalar functions so the browser worker can call it with plain
//! JavaScript numbers. There are no imports.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monte_carlo_is_close() {
        let estimate = monte_carlo_pi(2_000_000, 12345);
        assert!((estimate - core::f64::consts::PI).abs() < 0.01);
    }
}
