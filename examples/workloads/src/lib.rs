//! Native-facing aggregator for the demo workloads.
//!
//! Each wasm workload lives in its own crate so it compiles to a standalone,
//! import-free module. This crate re-exports the scalar ones for native
//! benchmarks and tests.

pub use add::{add, sub};
pub use fib::fib;
pub use monte_carlo_pi::monte_carlo_pi;
pub use prime_count::{prime_count, prime_count_range};
