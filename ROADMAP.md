# ROADMAP

> Source of Truth for Titan OS project status.

## Status: 🏗️ Phase 1: Kernel Bootstrapping

- [ ] **Phase 1: The Kernel**
    - [ ] Setup build system with cross-compilation support (`solana`, `wasm`) `[STORY-001]`
    - [ ] Implement `TitanAllocator` for unified memory management
    - [ ] Implement basic syscall wrappers (`log`, `exit`)
    - [ ] Unified Entrypoint implementation
- [ ] **Phase 2: Standard Library**
    - [ ] `titan.math` (Safe math)
    - [ ] `titan.collections` (Optimized Map/List)
    - [ ] Chain-specific drivers (Near, Stylus)
- [ ] **Phase 3: Ecosystem & Tools**
    - [ ] `titan` CLI scaffolding
    - [ ] Deployment tools

## Milestones

- **M1: Cross-Chain Hello World** (Target: End of Week 1)
    - Successful compilation to both `.so` (Solana) and `.wasm` (Generic).
- **M2: Titan OS Alpha**
    - Standard library functional on at least 3 major chains.

## History
- **2026-01-08**: Project pivoted to **Titan OS** (Pure Zig vision). Initialized documentation.
