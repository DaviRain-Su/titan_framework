# 规范 022: 后端注册表 (Backend Registry)

本规范定义了 Titan OS 支持的所有编译后端及其实现状态。

**设计原则**: 后端是资源/IO 抽象的具体实现，必须遵循内核接口契约 (002)。

## 1. 后端架构概述

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Code (Business Logic)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                         titan.* (Unified API)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                         Kernel Interface (002)                           │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────┤
│  Solana  │   Near   │ CosmWasm │Substrate │   TON    │      Mock        │
│   (SBF)  │  (Wasm)  │  (Wasm)  │  (Wasm)  │  (TVM)   │    (Native)      │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────────────┤
│                         Target VMs / Runtimes                            │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. target_chain 枚举定义

```zig
// build_options.zig (由构建系统生成)

pub const TargetChain = enum {
    // ===== V1 支持 =====
    /// Solana SBF (Sealevel BPF)
    solana,
    /// 本地测试 Mock Runtime
    mock,

    // ===== V2 支持 =====
    /// Near Protocol (Wasm)
    near,
    /// 通用 Wasm32 (无特定链)
    generic_wasm,

    // ===== V2/V3 支持 =====
    /// Cosmos 生态 CosmWasm
    cosmwasm,
    /// Polkadot 生态 Substrate Contracts
    substrate,
    /// Arbitrum Stylus (EVM + Wasm)
    stylus,

    // ===== V3 支持 =====
    /// TON (需转译为 Tact/Fift)
    ton,
    /// Nervos CKB (RISC-V)
    ckb,
    /// 原生 EVM (Zig -> Yul 转译)
    evm_native,
};
```

## 3. 后端实现状态矩阵

### 3.1 编译目标映射

| target_chain | Target Triple | CPU/Arch | 输出格式 | 规范 |
| :--- | :--- | :--- | :--- | :--- |
| `solana` | `sbf-solana-solana` | `generic` | `.so` | 009 |
| `mock` | `native` | host | executable | - |
| `near` | `wasm32-unknown-unknown` | `generic` | `.wasm` | 010 |
| `generic_wasm` | `wasm32-unknown-unknown` | `generic` | `.wasm` | - |
| `cosmwasm` | `wasm32-unknown-unknown` | `generic` | `.wasm` | 016 |
| `substrate` | `wasm32-unknown-unknown` | `generic` | `.wasm` | 021 |
| `stylus` | `wasm32-unknown-unknown` | `generic` | `.wasm` | 015 |
| `ton` | N/A (转译) | N/A | `.tact` | 011 |
| `ckb` | `riscv64-unknown-none-elf` | `generic` | `.elf` | 019 |
| `evm_native` | N/A (转译) | N/A | `.yul` | 020 |

### 3.2 内核接口实现状态

| 接口 | solana | mock | near | cosmwasm | substrate | stylus | ton | ckb |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **V1 Core** |
| `exit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `log` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `read_input` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `set_output` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `heap_start/len` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | N/A | ✓ |
| **V1 Storage** |
| `storage_read` | struct | ✓ | ✓ | ✓ | ✓ | ✓ | map | cell |
| `storage_write` | struct | ✓ | ✓ | ✓ | ✓ | ✓ | map | cell |
| **V2 Extended** |
| `timestamp` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `block_height` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `invoke` | CPI | mock | promise | submsg | seal_call | call | send | N/A |
| `emit_event` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `random` | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |

**图例**:
- ✓ = 原生支持
- struct = 通过 Struct-based Mapping 实现
- map = 通过 Cell Map 模拟
- cell = Cell 模型特殊处理
- ✗ = 不支持
- N/A = 不适用 (转译模式)

### 3.3 序列化格式映射

| target_chain | 默认格式 | 外部接口 | 规范 |
| :--- | :--- | :--- | :--- |
| `solana` | Borsh | Borsh | 006 |
| `mock` | Borsh | - | 006 |
| `near` | Borsh | JSON | 006, 010 |
| `cosmwasm` | Borsh | JSON | 006, 016 |
| `substrate` | Borsh | SCALE | 006, 021 |
| `stylus` | Borsh | ABI | 006, 015 |
| `ton` | N/A | TL-B | 011 |
| `ckb` | Borsh | Molecule | 019 |

## 4. 后端源码结构

```
src/
├── kernel/
│   ├── mod.zig              # 内核入口，comptime 后端选择
│   └── interface.zig        # 接口契约定义
├── arch/
│   ├── sbf/                 # Solana SBF 后端
│   │   ├── mod.zig          # 后端入口
│   │   ├── syscalls.zig     # sol_* 系统调用
│   │   ├── entrypoint.zig   # export fn entrypoint
│   │   └── allocator.zig    # Bump Allocator
│   ├── wasm/                # Wasm 系后端共享代码
│   │   ├── mod.zig
│   │   ├── near.zig         # Near 宿主函数
│   │   ├── cosmwasm.zig     # CosmWasm 宿主函数
│   │   ├── substrate.zig    # Seal API
│   │   └── stylus.zig       # Stylus 宿主函数
│   ├── mock/                # 本地测试后端
│   │   ├── mod.zig
│   │   ├── runtime.zig      # Mock Runtime
│   │   └── storage.zig      # HashMap 存储
│   ├── riscv/               # RISC-V 后端 (CKB)
│   │   └── mod.zig
│   └── transpilers/         # 转译器后端
│       ├── ton/             # Zig -> Tact
│       └── evm/             # Zig -> Yul
└── drivers/                 # 链特定驱动
    ├── solana/
    │   ├── account.zig      # AccountInfo 处理
    │   └── cpi.zig          # CPI 调用
    ├── near/
    │   ├── promise.zig      # Promise 链
    │   └── storage.zig      # Trie 存储
    └── ...
```

## 5. 后端选择逻辑

```zig
// src/kernel/mod.zig

const build_options = @import("build_options");

pub const impl = switch (build_options.target_chain) {
    // V1 后端
    .solana => @import("arch/sbf/mod.zig"),
    .mock => @import("arch/mock/mod.zig"),

    // V2 Wasm 后端
    .near => @import("arch/wasm/near.zig"),
    .generic_wasm => @import("arch/wasm/generic.zig"),
    .cosmwasm => @import("arch/wasm/cosmwasm.zig"),
    .substrate => @import("arch/wasm/substrate.zig"),
    .stylus => @import("arch/wasm/stylus.zig"),

    // V3 特殊后端
    .ton => @compileError("TON requires transpilation, use titan-ton-bridge CLI"),
    .ckb => @import("arch/riscv/mod.zig"),
    .evm_native => @compileError("EVM Native requires transpilation, use titan-evm-bridge CLI"),
};

// 统一接口导出
pub const log = impl.log;
pub const exit = impl.exit;
pub const read_input = impl.read_input;
pub const set_output = impl.set_output;
pub const heap_start = impl.heap_start;
pub const heap_len = impl.heap_len;

// 条件编译的接口
pub const storage_read = if (@hasDecl(impl, "storage_read")) impl.storage_read else @compileError("storage_read not available for " ++ @tagName(build_options.target_chain));
pub const storage_write = if (@hasDecl(impl, "storage_write")) impl.storage_write else @compileError("storage_write not available");
```

## 6. 后端实现路线图

### Phase 1: V1 (当前)
- [x] 设计: `solana` 后端规范 (009)
- [x] 设计: `mock` 后端规范 (004)
- [ ] 实现: `solana` 后端
- [ ] 实现: `mock` 后端

### Phase 2: V2 (Wasm 扩展)
- [x] 设计: `near` 后端规范 (010)
- [x] 设计: `cosmwasm` 后端规范 (016)
- [x] 设计: `substrate` 后端规范 (021)
- [x] 设计: `stylus` 后端规范 (015)
- [ ] 实现: Wasm 共享基础设施
- [ ] 实现: 各 Wasm 后端适配

### Phase 3: V3 (全链覆盖)
- [x] 设计: `ton` 转译规范 (011)
- [x] 设计: `ckb` 后端规范 (019)
- [x] 设计: `evm_native` 转译规范 (020)
- [ ] 实现: 转译器 CLI 工具
- [ ] 实现: RISC-V 后端

## 7. 新增后端指南

要添加新的后端支持，需要：

1. **创建适配器规范** (`docs/specs/0XX_adapter_<name>.md`)
   - 入口点映射
   - 宿主函数列表
   - 存储模型适配
   - 序列化格式

2. **扩展 TargetChain 枚举** (本文档 + `build.zig`)

3. **实现后端模块** (`src/arch/<name>/mod.zig`)
   - 实现 `002_kernel_interface.md` 中的所有必需接口

4. **添加测试** (`src/arch/<name>/tests/`)

5. **更新本注册表** (添加到状态矩阵)

## 8. 存储抽象策略总结

根据 `000_v1_convergence.md` 的决策，Titan 采用 **方案 B（暴露差异）**：

| 链类型 | 存储模型 | Titan 适配策略 |
| :--- | :--- | :--- |
| **KV 原生** (Near, CosmWasm) | Trie/IAVL | 直接映射 `storage_read/write` |
| **Account 模型** (Solana) | Account Data | Struct-based Mapping，不模拟 KV |
| **Cell 模型** (CKB) | UTXO Cell | Cell 输入/输出显式处理 |
| **Slot 模型** (EVM) | 256-bit Slots | 分片存储大数据 |
| **Contract Fields** (TON) | Cell Tree | 映射为 Tact 成员变量 |

**V1 约束**: 不提供通用 `titan.storage.set/get` KV 接口。
**V2 扩展**: 为 KV 原生链启用完整 KV API。

## 9. 编译命令速查

```bash
# V1 目标
zig build -Dtarget_chain=solana          # Solana .so
zig build -Dtarget_chain=mock            # Native 测试
zig build test                           # 运行测试 (自动使用 mock)

# V2 目标
zig build -Dtarget_chain=near            # Near .wasm
zig build -Dtarget_chain=cosmwasm        # CosmWasm .wasm
zig build -Dtarget_chain=substrate       # Substrate .wasm
zig build -Dtarget_chain=stylus          # Arbitrum Stylus .wasm

# V3 目标 (需要转译器)
titan-ton-bridge compile src/contract.zig -o contract.tact
titan-evm-bridge compile src/contract.zig -o contract.yul
zig build -Dtarget_chain=ckb             # CKB .elf
```

## 10. 结论

后端注册表是 Titan OS 多链架构的核心索引。通过统一的 `target_chain` 枚举和 comptime 后端选择机制，开发者可以用相同的代码部署到 10+ 种区块链平台。

**核心优势**:
1. **Write Once, Deploy Anywhere**: 单一代码库，多链部署
2. **Local First Testing**: Mock 后端实现 99% 逻辑的本地测试
3. **Zero Runtime Overhead**: comptime 选择，无运行时分发开销
4. **Extensible**: 清晰的后端添加流程
