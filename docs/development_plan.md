# Immediate Development Plan (Phase 1: The Kernel)

This plan focuses on the immediate technical steps to achieve the **Phase 1 Milestone**: A working "Titan OS" Kernel that allows a single Zig codebase to run on Solana and Wasm.

## Objective
Create a minimal project where `src/main.zig` (User Logic) compiles successfully to:
1.  **Solana SBF** (`.so`)
2.  **WebAssembly** (`.wasm`)

## Step 1: Project Structure Setup
- [ ] Refine `build.zig` to explicitly define the two build targets.
- [ ] Create directory structure: `src/kernel/solana`, `src/kernel/wasm`, `src/user`.

## Step 2: Define the Kernel Interface (Titan Core)
- [ ] Create `src/titan.zig` (The public API).
- [ ] Define generic interfaces: `log(msg: []const u8)`, `exit(code: u32)`.

## Step 3: Implement Solana Kernel
- [ ] Implement `src/kernel/solana/entrypoint.zig`.
- [ ] Implement `sol_log` wrapper using inline assembly or extern definition.
- [ ] Implement SBF-specific linker scripts or flags in `build.zig`.

## Step 4: Implement Wasm Kernel (Generic)
- [ ] Implement `src/kernel/wasm/entrypoint.zig`.
- [ ] Define generic host function imports (e.g., `env.log`).
- [ ] Ensure valid Wasm module export structure.

## Step 5: The "User Space" Application
- [ ] Write `src/main.zig` that imports `titan`.
- [ ] Call `titan.log("Hello Titan OS")`.

## Step 6: Build & Verification
- [ ] Run `zig build -Dtarget=solana` and check for `titan_framework.so`.
- [ ] Run `zig build -Dtarget=wasm` and check for `titan_framework.wasm`.
- [ ] Use `readelf` or `wasm-objdump` to inspect the artifacts and verify imports/exports.