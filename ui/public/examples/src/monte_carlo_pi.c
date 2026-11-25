// Freestanding C reference implementation. No libc, no imports.
typedef unsigned int u32;
typedef double f64;

static u32 xorshift(u32 state) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
}

__attribute__((visibility("default")))
f64 monte_carlo_pi(u32 iterations, u32 seed) {
    if (iterations == 0) return 0.0;
    u32 state = seed == 0 ? 1 : seed;
    u32 inside = 0;
    u32 i = 0;
    while (i < iterations) {
        state = xorshift(state);
        f64 x = (f64)(state >> 8) * (1.0 / 16777216.0);
        state = xorshift(state);
        f64 y = (f64)(state >> 8) * (1.0 / 16777216.0);
        if (x * x + y * y <= 1.0) inside += 1;
        i += 1;
    }
    return 4.0 * (f64)inside / (f64)iterations;
}
