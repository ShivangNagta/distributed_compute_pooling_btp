//! Distributed word-count workload (bytes ABI).
//!
//! The host copies a UTF-8 shard into linear memory with `alloc`, calls
//! `count_words`, and reads back a NUL-terminated JSON object of
//! `{ word: count }`. There are no imports.

/// Allocates `len` bytes of linear memory so the host can write task input.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    let mut buffer = vec![0u8; len as usize];
    let pointer = buffer.as_mut_ptr();
    core::mem::forget(buffer);
    pointer
}

fn word_count_json(text: &str) -> String {
    let mut counts: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
    for word in text.split(|c: char| !c.is_alphanumeric() && c != '\'') {
        if word.is_empty() {
            continue;
        }
        *counts.entry(word.to_lowercase()).or_insert(0) += 1;
    }

    let mut json = String::from("{");
    let mut first = true;
    for (word, count) in &counts {
        if !first {
            json.push(',');
        }
        first = false;
        json.push('"');
        json.push_str(word);
        json.push_str("\":");
        json.push_str(&count.to_string());
    }
    json.push('}');
    json
}

/// Counts words in a UTF-8 byte range and returns a NUL-terminated JSON object
/// of `{ word: count }` in linear memory.
///
/// # Safety
///
/// `pointer` must point to at least `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn count_words(pointer: *const u8, len: u32) -> *const u8 {
    let bytes = unsafe { core::slice::from_raw_parts(pointer, len as usize) };
    let text = String::from_utf8_lossy(bytes);
    let mut output = word_count_json(&text).into_bytes();
    output.push(0);
    let pointer = output.as_ptr();
    core::mem::forget(output);
    pointer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_words_across_punctuation_and_case() {
        let json = word_count_json("Hello, world! Hello  world.\nHELLO");
        assert_eq!(json, "{\"hello\":3,\"world\":2}");
    }

    #[test]
    fn word_count_returns_nul_terminated_json() {
        let input = b"a a b";
        let mut len = 0;
        unsafe {
            let pointer = count_words(input.as_ptr(), input.len() as u32);
            while *pointer.add(len) != 0 {
                len += 1;
            }
            let output = core::slice::from_raw_parts(pointer, len);
            assert_eq!(core::str::from_utf8(output).unwrap(), "{\"a\":2,\"b\":1}");
        }
    }
}
