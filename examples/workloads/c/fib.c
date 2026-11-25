// Freestanding C reference implementation. No libc, no imports.
typedef unsigned int u32;

__attribute__((visibility("default")))
u32 fib(u32 n) {
    u32 a = 0;
    u32 b = 1;
    u32 i = 0;
    while (i < n) {
        u32 next = a + b;
        a = b;
        b = next;
        i += 1;
    }
    return a;
}
