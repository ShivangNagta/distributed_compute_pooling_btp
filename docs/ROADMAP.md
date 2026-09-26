# Roadmap

## 2026 Goal

Build a working system where multiple browsers contribute CPU/GPU resources and can execute CPU and GPU jobs remotely.

**2026:**

* Resource observability
* CPU job execution
* GPU job execution
* Manual job submission
* Security
* Performance

**2027:**

* Advanced scheduling
* Native execution

---

# Phase 0: Existing Systems 

### Goal

Understand existing systems before making our design decisions.

* [ ] Read Wasimoff thesis/paper
* [ ] Understand Wasimoff's worker and job model
* [ ] Understand how Wasimoff handles offloading
* [ ] Understand its scheduling approach
* [ ] Read BOINC at a high level
* [ ] Understand BOINC's worker/resource model
* [ ] Read about WebAssembly's security/sandbox model
* [ ] Read enough WebGPU to understand the compute programming model
* [ ] Write a short comparison of Wasimoff, BOINC and our proposed system
* [ ] Write down the parts we are intentionally not trying to solve yet

---

# Phase 1: Resource Observability

### Goal

Connect multiple browsers and continuously observe their available resources.

### Worker connection

* [ ] Create coordinator/server
* [ ] Browser can connect as a worker
* [ ] Maintain list of active workers

### Resource information

* [ ] Collect CPU information
* [ ] Collect memory information
* [ ] Detect WebGPU availability
* [ ] Collect basic GPU information
* [ ] Send resource information periodically
* [ ] Update resource information dynamically

---

# Phase 2: Manual Job Submission

### Goal

Submit a job to a specific browser and receive the result.

### Job lifecycle

* [ ] Define basic job representation
* [ ] Define job states
* [ ] Implement `Created`
* [ ] Implement `Submitted`
* [ ] Implement `Running`
* [ ] Implement `Completed`
* [ ] Implement `Failed`

### Submission

* [ ] Submit job from coordinator
* [ ] Manually select worker
* [ ] Send job to worker
* [ ] Execute job
* [ ] Return result
* [ ] Display result

### Reliability

* [ ] Handle worker disconnect
* [ ] Handle job failure
* [ ] Add basic timeout


---

# Phase 3: CPU Programming Model

### Goal

Define what a CPU job looks like and execute it remotely.

### Programming model

* [ ] Decide CPU job representation
* [ ] Decide how input is provided
* [ ] Decide how output is returned
* [ ] Decide how the WebAssembly module is provided

### Execution

* [ ] Execute WebAssembly module in browser
* [ ] Pass input to module
* [ ] Retrieve output
* [ ] Send output to coordinator

### Test workloads

* [ ] Vector addition
* [ ] Numerical computation
* [ ] Matrix operation
* [ ] One larger CPU workload


---

# Phase 4: GPU Programming Model

### Goal

Define and execute GPU jobs using WebGPU/ WGPU.

### WebGPU exploration

* [ ] Understand WebGPU adapter/device model
* [ ] Understand compute pipelines
* [ ] Understand buffers
* [ ] Understand WGSL
* [ ] Build standalone WebGPU compute example

### Programming model

* [ ] Decide how GPU jobs are represented
* [ ] Decide how input buffers are provided
* [ ] Decide how output buffers are returned


### Execution

* [ ] Initialize WebGPU in worker
* [ ] Create GPU buffers
* [ ] Upload input
* [ ] Execute compute shader
* [ ] Read result
* [ ] Return result

### Test workloads

* [ ] Vector addition
* [ ] Matrix operation
* [ ] One larger GPU workload


---


# Phase 5: Security

### Goal

Understand and test the security boundaries of the system.

### WebAssembly / Browser security

* [ ] Identify what the browser sandbox protects
* [ ] Identify what WebAssembly can access
* [ ] Identify what the job cannot access
* [ ] Test filesystem isolation
* [ ] Test network/capability restrictions where applicable
* [ ] Test resource abuse scenarios

### System security

* [ ] Basic worker authentication
* [ ] Basic job authentication
* [ ] Consider malicious job submission
* [ ] Consider malicious worker results
* [ ] Consider job tampering
* [ ] Define trust assumptions

---

# Phase 6: Performance Evaluation

### Goal

Measure the cost and usefulness of remote CPU/GPU execution.

### Measurements

* [ ] Local execution time
* [ ] Job upload time
* [ ] Remote execution time
* [ ] Result download time
* [ ] Total remote execution time

### CPU experiments

* [ ] Small CPU job
* [ ] Medium CPU job
* [ ] Large CPU job
* [ ] Compare local vs remote

### GPU experiments

* [ ] Small GPU job
* [ ] Medium GPU job
* [ ] Large GPU job
* [ ] Compare local vs remote

### Variables

* [ ] Input size
* [ ] Job size
* [ ] Worker hardware
* [ ] Number of workers
* [ ] Network conditions

### Results

* [ ] Record results
* [ ] Create graphs
* [ ] Identify communication overhead
* [ ] Identify execution overhead
* [ ] Identify workloads where remote execution is useful
* [ ] Identify workloads where remote execution is not useful


---

# 2027: Possible Extensions

### Scheduling

* [ ] Automatic worker selection
* [ ] Resource-aware scheduling
* [ ] Network-aware scheduling
* [ ] Job/workload-aware scheduling

### More Worker Types

* [ ] Native worker
* [ ] VM/isolated worker
* [ ] Other execution environments

### More Advanced Execution

* [ ] Multi-worker jobs
* [ ] Long-running jobs
* [ ] Fault recovery
* [ ] More complex workloads

### Questions

* [ ] How should heterogeneous workers be selected?
* [ ] When is browser-based offloading beneficial?
* [ ] How does GPU offloading differ from CPU offloading?
* [ ] How much does the browser security model limit execution?
* [ ] Can the same job model work across browser and native workers?

---
