# Story 001: Kernel Bootstrap

## Context
As the first step of **Titan OS**, we need a build system that can target both Solana (SBF) and WebAssembly (WASM). This foundation allows us to write unified Zig code for different blockchain environments.

## Goals
- [ ] Establish directory structure for Kernel and User space.
- [ ] Configure `build.zig` to support `solana` and `wasm` targets.
- [ ] Create a minimal `titan.zig` API.

## Design
The project will be split into:
- `src/titan.zig`: Public API for user applications.
- `src/kernel/`: Internal implementation for different chains.
- `src/user/`: User application logic.

## Tasks
- [x] Initial design and documentation.
- [ ] Create `src/titan.zig`.
- [ ] Refactor `build.zig` to support `-Dtarget_chain=[solana|near|generic]`.
- [ ] Implement dummy entrypoints for validation.

## Verification Plan
- Build for Solana: `./solana-zig/zig build -Dtarget_chain=solana` -> Expect `titan_os.so`.
- Build for Wasm: `./solana-zig/zig build -Dtarget_chain=near` -> Expect `titan_os.wasm`.
