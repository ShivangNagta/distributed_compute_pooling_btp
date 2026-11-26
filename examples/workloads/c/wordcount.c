// Freestanding C reference implementation. No libc, no imports.
//
// Bytes ABI: the host calls alloc(len), writes a UTF-8 shard, calls
// count_words(ptr, len), then reads a NUL-terminated JSON object of
// { "word": count }.
//
// Bytes >= 0x80 are treated as word characters so multi-byte UTF-8 sequences
// stay intact; lowercasing is ASCII-only. This is a deliberate simplification
// of the Rust version's Unicode-aware splitting.

typedef unsigned int u32;
typedef unsigned char u8;

typedef struct {
    u32 start;
    u32 len;
} Word;

static const u8 *input;
static u32 arena_top;

static u8 *arena_alloc(u32 size) {
    if (size == 0) size = 1;
    u32 base = arena_top;
    if (base == 0) base = __builtin_wasm_memory_size(0) * 65536u;
    u32 end = base + size;
    if (end < base) return 0;
    u32 pages = __builtin_wasm_memory_size(0);
    u32 needed = (end + 65535u) / 65536u;
    if (needed > pages) {
        if (__builtin_wasm_memory_grow(0, needed - pages) == (u32)-1) return 0;
    }
    arena_top = (end + 7u) & ~7u;
    return (u8 *)base;
}

__attribute__((visibility("default")))
u8 *alloc(u32 len) {
    return arena_alloc(len);
}

static int is_word_char(u8 c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z') || c == '\'' || c >= 0x80;
}

static u8 lower(u8 c) {
    return (c >= 'A' && c <= 'Z') ? (u8)(c + 32) : c;
}

static int word_cmp(const Word *a, const Word *b) {
    u32 n = a->len < b->len ? a->len : b->len;
    for (u32 i = 0; i < n; i++) {
        u8 ca = lower(input[a->start + i]);
        u8 cb = lower(input[b->start + i]);
        if (ca != cb) return (int)ca - (int)cb;
    }
    if (a->len == b->len) return 0;
    return a->len < b->len ? -1 : 1;
}

static void sift_down(Word *a, u32 root, u32 end) {
    for (;;) {
        u32 child = root * 2u + 1u;
        if (child > end) return;
        if (child + 1u <= end && word_cmp(&a[child], &a[child + 1u]) < 0)
            child++;
        if (word_cmp(&a[root], &a[child]) >= 0) return;
        Word tmp = a[root];
        a[root] = a[child];
        a[child] = tmp;
        root = child;
    }
}

static void heap_sort(Word *a, u32 n) {
    if (n < 2) return;
    for (u32 start = n / 2u; start > 0;) {
        start--;
        sift_down(a, start, n - 1u);
    }
    for (u32 end = n - 1u; end > 0; end--) {
        Word tmp = a[0];
        a[0] = a[end];
        a[end] = tmp;
        sift_down(a, 0, end - 1u);
    }
}

static u32 decimal_len(u32 value) {
    u32 len = 1;
    while (value >= 10) {
        value /= 10;
        len++;
    }
    return len;
}

static u32 write_uint(char *out, u32 pos, u32 value) {
    u32 len = decimal_len(value);
    u32 start = pos;
    pos += len;
    for (u32 i = 0; i < len; i++) {
        out[start + len - 1u - i] = (char)('0' + value % 10u);
        value /= 10u;
    }
    return pos;
}

__attribute__((visibility("default")))
const u8 *count_words(const u8 *text, u32 len) {
    static const u8 empty[] = "{}";

    if (len > 16u * 1024u * 1024u) return empty;

    input = text;
    u32 max_words = len / 2u + 1u;
    Word *words = (Word *)arena_alloc(max_words * (u32)sizeof(Word));
    if (!words) return empty;

    u32 count = 0;
    u32 i = 0;
    while (i < len) {
        if (!is_word_char(text[i])) {
            i++;
            continue;
        }
        u32 start = i;
        while (i < len && is_word_char(text[i])) i++;
        words[count].start = start;
        words[count].len = i - start;
        count++;
    }

    heap_sort(words, count);

    u32 out_len = 2u; // "{}"
    u32 entries = 0;
    for (u32 k = 0; k < count;) {
        u32 freq = 1;
        u32 next = k + 1u;
        while (next < count && word_cmp(&words[k], &words[next]) == 0) {
            freq++;
            next++;
        }
        if (entries > 0) out_len++; // comma
        out_len += words[k].len + 3u + decimal_len(freq);
        entries++;
        k = next;
    }

    char *out = (char *)arena_alloc(out_len + 1u);
    if (!out) return empty;

    u32 pos = 0;
    out[pos++] = '{';
    u32 first = 1;
    for (u32 k = 0; k < count;) {
        u32 freq = 1;
        u32 next = k + 1u;
        while (next < count && word_cmp(&words[k], &words[next]) == 0) {
            freq++;
            next++;
        }
        if (!first) out[pos++] = ',';
        first = 0;
        out[pos++] = '"';
        for (u32 j = 0; j < words[k].len; j++)
            out[pos++] = (char)lower(text[words[k].start + j]);
        out[pos++] = '"';
        out[pos++] = ':';
        pos = write_uint(out, pos, freq);
        k = next;
    }
    out[pos++] = '}';
    out[pos] = 0;
    return (const u8 *)out;
}
