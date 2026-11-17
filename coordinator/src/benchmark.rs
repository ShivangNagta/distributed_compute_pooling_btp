use serde::Serialize;
use std::hint::black_box;
use std::time::Instant;

use btp_workloads::{add, compute};

pub const DEFAULT_WARMUP_RUNS: usize = 5;
pub const DEFAULT_MEASURED_RUNS: usize = 50;

#[derive(Serialize)]
pub struct BenchmarkResult {
    pub scenario: &'static str,
    pub workload: String,
    pub warmup_runs: usize,
    pub measured_runs: usize,
    pub samples_ms: Vec<f64>,
    pub summary: Summary,
}

#[derive(Serialize)]
pub struct Summary {
    pub min_ms: f64,
    pub mean_ms: f64,
    pub median_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone)]
pub struct NativeBenchmarkSpec {
    pub id: String,
    pub iterations: Option<i32>,
}

pub fn default_native_benchmarks() -> Vec<NativeBenchmarkSpec> {
    vec![
        NativeBenchmarkSpec {
            id: "sample-add".to_string(),
            iterations: None,
        },
        NativeBenchmarkSpec {
            id: "xorshift-loop-1k".to_string(),
            iterations: Some(1_000),
        },
        NativeBenchmarkSpec {
            id: "xorshift-loop-10k".to_string(),
            iterations: Some(10_000),
        },
        NativeBenchmarkSpec {
            id: "xorshift-loop-100k".to_string(),
            iterations: Some(100_000),
        },
        NativeBenchmarkSpec {
            id: "xorshift-loop-1m".to_string(),
            iterations: Some(1_000_000),
        },
    ]
}

pub fn run_native_benchmarks() -> Vec<BenchmarkResult> {
    run_native_benchmark_suite(
        DEFAULT_WARMUP_RUNS,
        DEFAULT_MEASURED_RUNS,
        &default_native_benchmarks(),
    )
}

pub fn run_native_benchmark_suite(
    warmup_runs: usize,
    measured_runs: usize,
    specs: &[NativeBenchmarkSpec],
) -> Vec<BenchmarkResult> {
    specs
        .iter()
        .map(|spec| run_benchmark(&spec.id, spec.iterations, warmup_runs, measured_runs))
        .collect()
}

fn run_benchmark(
    workload: &str,
    iterations: Option<i32>,
    warmup_runs: usize,
    measured_runs: usize,
) -> BenchmarkResult {
    let measured_runs = measured_runs.max(1);
    let mut operation: Box<dyn FnMut()> = match iterations {
        None => Box::new(|| {
            black_box(add(2, 3));
        }),
        Some(count) => Box::new(move || {
            black_box(compute(count));
        }),
    };

    for _ in 0..warmup_runs {
        operation();
    }

    let samples_ms = (0..measured_runs)
        .map(|_| {
            let started = Instant::now();
            operation();
            started.elapsed().as_secs_f64() * 1_000.0
        })
        .collect::<Vec<_>>();

    let mut sorted = samples_ms.clone();
    sorted.sort_by(f64::total_cmp);
    let percentile = |rank: f64| {
        let index = ((rank * sorted.len() as f64).ceil() as usize)
            .saturating_sub(1)
            .min(sorted.len() - 1);
        sorted[index]
    };

    BenchmarkResult {
        scenario: "native-backend",
        workload: workload.to_string(),
        warmup_runs,
        measured_runs,
        summary: Summary {
            min_ms: sorted[0],
            mean_ms: samples_ms.iter().sum::<f64>() / samples_ms.len() as f64,
            median_ms: percentile(0.5),
            p95_ms: percentile(0.95),
            p99_ms: percentile(0.99),
            max_ms: sorted[sorted.len() - 1],
        },
        samples_ms,
    }
}
