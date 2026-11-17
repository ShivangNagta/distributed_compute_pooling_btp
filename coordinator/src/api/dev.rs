use axum::Json;
use serde::Deserialize;

use crate::benchmark::{BenchmarkResult, NativeBenchmarkSpec, run_native_benchmark_suite};

fn default_warmup_runs() -> usize {
    crate::benchmark::DEFAULT_WARMUP_RUNS
}

fn default_measured_runs() -> usize {
    crate::benchmark::DEFAULT_MEASURED_RUNS
}

#[derive(Debug, Deserialize)]
pub struct NativeBenchmarkRequest {
    #[serde(default = "default_warmup_runs")]
    pub warmup_runs: usize,
    #[serde(default = "default_measured_runs")]
    pub measured_runs: usize,
    #[serde(default)]
    pub workloads: Vec<NativeBenchmarkWorkload>,
}

#[derive(Debug, Deserialize)]
pub struct NativeBenchmarkWorkload {
    pub id: String,
    #[serde(default)]
    pub iterations: Option<i32>,
}

pub async fn native_benchmarks_handler(
    Json(request): Json<NativeBenchmarkRequest>,
) -> Json<Vec<BenchmarkResult>> {
    if request.workloads.is_empty() {
        return Json(crate::benchmark::run_native_benchmarks());
    }

    let specs = request
        .workloads
        .iter()
        .map(|workload| NativeBenchmarkSpec {
            id: workload.id.clone(),
            iterations: workload.iterations,
        })
        .collect::<Vec<_>>();

    Json(run_native_benchmark_suite(
        request.warmup_runs,
        request.measured_runs,
        &specs,
    ))
}
