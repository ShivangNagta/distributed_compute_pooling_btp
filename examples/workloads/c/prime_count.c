// Freestanding C reference implementation. No libc, no imports.
typedef unsigned int u32;

static int is_prime(u32 n) {
    if (n < 2) return 0;
    if (n % 2 == 0) return n == 2;
    u32 divisor = 3;
    while (divisor <= n / divisor) {
        if (n % divisor == 0) return 0;
        divisor += 2;
    }
    return 1;
}

__attribute__((visibility("default")))
u32 prime_count_range(u32 start, u32 end) {
    if (end <= start) return 0;
    u32 count = 0;
    u32 n = start < 2 ? 2 : start;
    while (n < end) {
        count += is_prime(n) ? 1 : 0;
        n += 1;
    }
    return count;
}

__attribute__((visibility("default")))
u32 prime_count(u32 end) {
    return prime_count_range(0, end);
}
