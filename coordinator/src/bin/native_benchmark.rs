use coordinator::benchmark::run_native_benchmarks;

fn main() {
    let results = run_native_benchmarks();
    let output =
        serde_json::to_string_pretty(&results).expect("benchmark results should serialize");
    println!("{output}");

    if let Ok(path) = std::env::var("BENCHMARK_OUTPUT") {
        std::fs::write(path, format!("{output}\n")).expect("benchmark results should be writable");
    }
}
