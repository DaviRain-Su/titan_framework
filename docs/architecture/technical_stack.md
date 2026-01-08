# Technical Stack & Architecture Matrix

Titan OS is structured like a traditional operating system, with a **User Space** (Applications) and a **Kernel Space** (Titan Core), both written in **Zig**.

## 1. User Space: Application Layer (ZIG)

*   **Role:** The "Userland".
*   **Developer Experience:** Developers write standard Zig code importing the `titan` standard library.
*   **Features:**
    *   **Unified Types:** `u64`, `u128`, `Address` (Abstracted).
    *   **Standard Library:** Collections (`ArrayList`, `HashMap`), Math, and Crypto primitives optimized for chains.
    *   **No "Magic":** Explicit memory management, ensuring predictable gas costs and performance.

## 2. Kernel Space: Titan Core (ZIG)

*   **Role:** The "HAL" (Hardware Abstraction Layer).
*   **Function:** Abstracts the underlying Virtual Machine differences using Zig's `comptime`.
*   **Components:**
    *   **Memory Manager:** Maps `Allocator` to Solana's Heap or Wasm's Linear Memory.
    *   **Syscall Interface:** 
        *   `titan.log()` -> `sol_log_compute_units()` (Solana) / `log_utf8` (Near).
        *   `titan.storage.read()` -> `sol_get_return_data()` (Solana) / `storage_read` (Near).
    *   **Entrypoint:** Generates the specific `entrypoint` symbol required by each chain (e.g., `entrypoint` for Solana, exported functions for Wasm).

## 3. Compilation Targets (The "Hardware")

We target the two main high-performance architectures in the blockchain world.

### Target Family A: SBF (Solana)
*   **Architecture:** Solana Bytecode Format (variant of eBPF).
*   **Implementation:** Zig LLVM Backend -> SBF.
*   **Status:** First-class citizen. Direct mapping of Zig pointers to Solana memory.

### Target Family B: WebAssembly (The "Generic" Arch)
*   **Architecture:** wasm32-unknown-unknown.
*   **Implementation:** Zig LLVM Backend -> Wasm.
*   **Sub-targets (Drivers):**
    *   **Near Protocol:** Implements `near_sdk` host functions.
    *   **Polkadot (Substrate):** Implements `seal` host functions.
    *   **Cosmos (CosmWasm):** Implements `cosmwasm` host functions.
    *   **Arbitrum Stylus:** Implements `stylus` host functions (allowing Zig to run on Ethereum L2).

### Target Family C: Experimental / Future
*   **TON (TVM):**
    *   *Challenge:* TVM is not stack/register based in a traditional sense (Cell-based).
    *   *Strategy:* Future research. Potential for a "Zig -> Tact" transpiler or a custom LLVM backend, but currently lower priority than establishing the SBF/Wasm dominance.

## Architecture Diagram

| Layer | Component | Language | Function |
| :--- | :--- | :--- | :--- |
| **User Space** | **dApps / Protocols** | **Zig** | Business Logic (DeFi, GameFi, Social) |
| **System Libs** | **Titan Std** | **Zig** | `titan.math`, `titan.token`, `titan.crypto` |
| **Kernel** | **Titan Core** | **Zig** | Memory Allocator, Syscall Wrappers, Entrypoint |
| **Hardware** | **Virtual Machines** | -- | **Solana VM**, **Wasm VM** (Near/Polkadot/Stylus) |