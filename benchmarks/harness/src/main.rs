use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{Value, json};
use wasmtime::{Engine, Instance, Module, Store};

#[derive(Debug, Deserialize)]
struct BenchConfig {
    iterations: u32,
    warmup: u32,
    wasm: String,
    cases: Vec<Case>,
}

#[derive(Debug, Clone, Deserialize)]
struct Case {
    id: String,
    entry: String,
    args: Vec<f64>,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("bench-harness: {error}");
            ExitCode::FAILURE
        }
    }
}

fn usage() -> String {
    "usage: bench-harness <native|wasmtime> [--config <bench.json>] [--out <file.json>]".into()
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(mode) = args.first() else {
        return Err(usage());
    };
    let config_path =
        flag(&args, "--config").unwrap_or_else(|| "benchmarks/bench.json".to_string());
    let out_path = flag(&args, "--out");

    let config = load_config(Path::new(&config_path))?;
    let result = match mode.as_str() {
        "native" => run_native(&config)?,
        "wasmtime" => run_wasmtime(&config, Path::new(&config_path))?,
        _ => return Err(usage()),
    };

    let json = serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?;
    match out_path {
        Some(path) => {
            if let Some(parent) = Path::new(&path).parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(&path, format!("{json}\n")).map_err(|error| error.to_string())?;
            println!("wrote {path}");
        }
        None => println!("{json}"),
    }
    Ok(())
}

fn load_config(path: &Path) -> Result<BenchConfig, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("parse {}: {error}", path.display()))
}

fn summarize(samples: &[f64]) -> Value {
    if samples.is_empty() {
        return json!({ "samples": [] });
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
    json!({
        "samples": samples,
        "mean_ms": round(mean),
        "p50_ms": round(percentile(&sorted, 0.50)),
        "p95_ms": round(percentile(&sorted, 0.95)),
        "min_ms": round(sorted[0]),
        "max_ms": round(sorted[sorted.len() - 1]),
    })
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = ((p * sorted.len() as f64).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[rank]
}

fn round(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn call_native(entry: &str, args: &[f64]) -> Result<f64, String> {
    let arg = |index: usize| {
        args.get(index)
            .copied()
            .ok_or_else(|| format!("{entry} is missing argument {index}"))
    };
    let u = |index: usize| -> Result<u32, String> { Ok(arg(index)? as u32) };
    let i = |index: usize| -> Result<i32, String> { Ok(arg(index)? as i32) };

    Ok(match entry {
        "add" => workloads::add(i(0)?, i(1)?) as f64,
        "sub" => workloads::sub(i(0)?, i(1)?) as f64,
        "fib" => workloads::fib(u(0)?) as f64,
        "prime_count" => workloads::prime_count(u(0)?) as f64,
        "prime_count_range" => workloads::prime_count_range(u(0)?, u(1)?) as f64,
        "monte_carlo_pi" => workloads::monte_carlo_pi(u(0)?, u(1)?),
        "matmul_checksum" => workloads::matmul_checksum(u(0)?, u(1)?) as f64,
        "matmul_checksum_range" => {
            workloads::matmul_checksum_range(u(0)?, u(1)?, u(2)?, u(3)?) as f64
        }
        "hash_chain" => workloads::hash_chain(u(0)?, u(1)?) as f64,
        other => return Err(format!("unknown workload {other}")),
    })
}

fn run_native(config: &BenchConfig) -> Result<Value, String> {
    let mut cases = Vec::new();
    for case in &config.cases {
        let result = call_native(&case.entry, &case.args)?;
        for _ in 0..config.warmup {
            black_box(call_native(&case.entry, &case.args)?);
        }
        let mut samples = Vec::new();
        for _ in 0..config.iterations {
            let start = Instant::now();
            let value = call_native(&case.entry, &case.args)?;
            samples.push(ms(start.elapsed()));
            black_box(value);
        }
        cases.push(json!({
            "id": case.id,
            "entry": case.entry,
            "args": case.args,
            "result": result,
            "call": summarize(&samples),
        }));
    }
    Ok(json!({
        "mode": "native",
        "iterations": config.iterations,
        "warmup": config.warmup,
        "cases": cases,
    }))
}

fn resolve_wasm(config_path: &Path, wasm: &str) -> PathBuf {
    let base = config_path.parent().unwrap_or_else(|| Path::new("."));
    base.join(wasm)
}

fn call_wasmtime(
    store: &mut Store<()>,
    instance: &Instance,
    entry: &str,
    args: &[f64],
) -> Result<f64, String> {
    let arg = |index: usize| {
        args.get(index)
            .copied()
            .ok_or_else(|| format!("{entry} is missing argument {index}"))
    };
    let u = |index: usize| -> Result<u32, String> { Ok(arg(index)? as u32) };
    let i = |index: usize| -> Result<i32, String> { Ok(arg(index)? as i32) };

    match entry {
        "add" => {
            let func = instance
                .get_typed_func::<(i32, i32), i32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (i(0)?, i(1)?))
                .map_err(|error| error.to_string())? as f64)
        }
        "sub" => {
            let func = instance
                .get_typed_func::<(i32, i32), i32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (i(0)?, i(1)?))
                .map_err(|error| error.to_string())? as f64)
        }
        "fib" => {
            let func = instance
                .get_typed_func::<(u32,), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?,))
                .map_err(|error| error.to_string())? as f64)
        }
        "prime_count" => {
            let func = instance
                .get_typed_func::<(u32,), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?,))
                .map_err(|error| error.to_string())? as f64)
        }
        "prime_count_range" => {
            let func = instance
                .get_typed_func::<(u32, u32), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?, u(1)?))
                .map_err(|error| error.to_string())? as f64)
        }
        "monte_carlo_pi" => {
            let func = instance
                .get_typed_func::<(u32, u32), f64>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            func.call(&mut *store, (u(0)?, u(1)?))
                .map_err(|error| error.to_string())
        }
        "matmul_checksum" => {
            let func = instance
                .get_typed_func::<(u32, u32), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?, u(1)?))
                .map_err(|error| error.to_string())? as f64)
        }
        "matmul_checksum_range" => {
            let func = instance
                .get_typed_func::<(u32, u32, u32, u32), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?, u(1)?, u(2)?, u(3)?))
                .map_err(|error| error.to_string())? as f64)
        }
        "hash_chain" => {
            let func = instance
                .get_typed_func::<(u32, u32), u32>(&mut *store, entry)
                .map_err(|error| error.to_string())?;
            Ok(func
                .call(&mut *store, (u(0)?, u(1)?))
                .map_err(|error| error.to_string())? as f64)
        }
        other => Err(format!("unknown workload {other}")),
    }
}

fn run_wasmtime(config: &BenchConfig, config_path: &Path) -> Result<Value, String> {
    let wasm_path = resolve_wasm(config_path, &config.wasm);
    let bytes = std::fs::read(&wasm_path)
        .map_err(|error| format!("read {}: {error}", wasm_path.display()))?;
    let engine = Engine::default();

    let mut cases = Vec::new();
    for case in &config.cases {
        let start = Instant::now();
        let module = Module::new(&engine, &bytes).map_err(|error| error.to_string())?;
        let compile_ms = ms(start.elapsed());

        let start = Instant::now();
        let mut store = Store::new(&engine, ());
        let instance =
            Instance::new(&mut store, &module, &[]).map_err(|error| error.to_string())?;
        let instantiate_ms = ms(start.elapsed());

        let result = call_wasmtime(&mut store, &instance, &case.entry, &case.args)?;
        for _ in 0..config.warmup {
            black_box(call_wasmtime(
                &mut store,
                &instance,
                &case.entry,
                &case.args,
            )?);
        }
        let mut warm_samples = Vec::new();
        for _ in 0..config.iterations {
            let start = Instant::now();
            let value = call_wasmtime(&mut store, &instance, &case.entry, &case.args)?;
            warm_samples.push(ms(start.elapsed()));
            black_box(value);
        }

        let mut cold_compile = Vec::new();
        let mut cold_instantiate = Vec::new();
        let mut cold_call = Vec::new();
        for _ in 0..config.iterations {
            let start = Instant::now();
            let cold_module = Module::new(&engine, &bytes).map_err(|error| error.to_string())?;
            cold_compile.push(ms(start.elapsed()));

            let start = Instant::now();
            let mut cold_store = Store::new(&engine, ());
            let cold_instance = Instance::new(&mut cold_store, &cold_module, &[])
                .map_err(|error| error.to_string())?;
            cold_instantiate.push(ms(start.elapsed()));

            let start = Instant::now();
            let value = call_wasmtime(&mut cold_store, &cold_instance, &case.entry, &case.args)?;
            cold_call.push(ms(start.elapsed()));
            black_box(value);
        }

        cases.push(json!({
            "id": case.id,
            "entry": case.entry,
            "args": case.args,
            "result": result,
            "warm": {
                "compile_ms": round(compile_ms),
                "instantiate_ms": round(instantiate_ms),
                "call": summarize(&warm_samples),
            },
            "cold": {
                "compile": summarize(&cold_compile),
                "instantiate": summarize(&cold_instantiate),
                "call": summarize(&cold_call),
            },
        }));
    }

    Ok(json!({
        "mode": "wasmtime",
        "iterations": config.iterations,
        "warmup": config.warmup,
        "wasm": wasm_path.display().to_string(),
        "cases": cases,
    }))
}
