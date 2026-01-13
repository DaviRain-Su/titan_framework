// Privacy AMM - Solana On-Chain Program
// 隐私 AMM 链上程序入口

const std = @import("std");
const sol = @import("solana_program_sdk");

// 导入子模块
pub const verifier = @import("verifier.zig");
pub const merkle = @import("merkle.zig");
pub const pool = @import("pool.zig");
pub const nullifier_set = @import("nullifier_set.zig");
pub const vk = @import("vk.zig");

// 指令类型
pub const Instruction = enum(u8) {
    /// 初始化流动性池
    InitializePool = 0,
    /// 存入资产 (公开 → 隐私)
    Deposit = 1,
    /// 取出资产 (隐私 → 公开)
    Withdraw = 2,
    /// 隐私交换
    Swap = 3,
};

// 程序错误
pub const ProgramError = error{
    InvalidAccountData,
    InvalidInstructionData,
    NotEnoughAccountKeys,
    MissingRequiredSignature,
    InvalidProof,
    NullifierAlreadyUsed,
    MerkleTreeFull,
    InsufficientLiquidity,
    SlippageExceeded,
    AccountNotWritable,
};

/// 程序入口点
pub export fn entrypoint(input: [*]u8) callconv(.c) u64 {
    const result = processInstruction(input) catch |err| {
        sol.log.print("Error: {}", .{err});
        return 1;
    };
    _ = result;
    return 0;
}

fn processInstruction(input: [*]u8) !void {
    const context = sol.context.Context.load(input) catch {
        return ProgramError.InvalidAccountData;
    };

    const data = context.data;
    if (data.len == 0) {
        return ProgramError.InvalidInstructionData;
    }

    const instruction: Instruction = @enumFromInt(data[0]);
    const ix_data = data[1..];

    switch (instruction) {
        .InitializePool => try processInitializePool(context, ix_data),
        .Deposit => try processDeposit(context, ix_data),
        .Withdraw => try processWithdraw(context, ix_data),
        .Swap => try processSwap(context, ix_data),
    }
}

// ============================================================================
// 指令处理函数
// ============================================================================

fn processInitializePool(context: sol.context.Context, data: []const u8) !void {
    sol.log.log("Processing InitializePool");

    // 账户:
    // 0. [signer] 初始化者
    // 1. [writable] Pool 账户
    // 2. [writable] Merkle Tree 账户
    // 3. [writable] Nullifier Set 账户

    if (context.accounts.len < 4) {
        return ProgramError.NotEnoughAccountKeys;
    }

    const initializer = context.accounts[0];
    const pool_account = context.accounts[1];
    const merkle_account = context.accounts[2];
    const nullifier_account = context.accounts[3];

    if (!initializer.isSigner()) {
        return ProgramError.MissingRequiredSignature;
    }

    // 解析初始化参数
    const params = pool.InitializeParams.deserialize(data) catch {
        return ProgramError.InvalidInstructionData;
    };

    // 初始化 Pool 状态
    try pool.initialize(pool_account, params);

    // 初始化 Merkle 树
    try merkle.initialize(merkle_account);

    // 初始化 Nullifier 集合
    try nullifier_set.initialize(nullifier_account);

    sol.log.log("Pool initialized successfully");
}

fn processDeposit(context: sol.context.Context, data: []const u8) !void {
    sol.log.log("Processing Deposit");

    // 账户:
    // 0. [signer] 存款人
    // 1. [writable] Pool 账户
    // 2. [writable] Merkle Tree 账户

    if (context.accounts.len < 3) {
        return ProgramError.NotEnoughAccountKeys;
    }

    const depositor = context.accounts[0];
    const pool_account = context.accounts[1];
    const merkle_account = context.accounts[2];

    if (!depositor.isSigner()) {
        return ProgramError.MissingRequiredSignature;
    }

    // 解析存款参数 (包含 commitment)
    const params = pool.DepositParams.deserialize(data) catch {
        return ProgramError.InvalidInstructionData;
    };

    // 将 commitment 添加到 Merkle 树
    _ = try merkle.insertLeaf(merkle_account, params.commitment);

    // 更新池状态
    try pool.updateAfterDeposit(pool_account, params);

    sol.log.log("Deposit completed");
}

fn processWithdraw(context: sol.context.Context, data: []const u8) !void {
    sol.log.log("Processing Withdraw");

    // 账户:
    // 0. [writable] Pool 账户
    // 1. [] Merkle Tree 账户
    // 2. [writable] Nullifier Set 账户

    if (context.accounts.len < 3) {
        return ProgramError.NotEnoughAccountKeys;
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    // 解析取款参数 (包含 ZK 证明)
    const params = pool.WithdrawParams.deserialize(data) catch {
        return ProgramError.InvalidInstructionData;
    };

    // 获取 Merkle 根
    const merkle_root = merkle.getRoot(merkle_account);

    // 验证根匹配
    if (!std.mem.eql(u8, &params.root, &merkle_root)) {
        sol.log.log("Merkle root mismatch");
        return ProgramError.InvalidProof;
    }

    // 检查 nullifier 未被使用
    if (nullifier_set.contains(nullifier_account, params.nullifier)) {
        return ProgramError.NullifierAlreadyUsed;
    }

    // 标记 nullifier 为已使用
    try nullifier_set.insert(nullifier_account, params.nullifier);

    // 更新池状态
    try pool.updateAfterWithdraw(pool_account, params);

    sol.log.log("Withdraw completed");
}

fn processSwap(context: sol.context.Context, data: []const u8) !void {
    sol.log.log("Processing Swap");

    // 账户:
    // 0. [writable] Pool 账户
    // 1. [] Merkle Tree 账户
    // 2. [writable] Nullifier Set 账户

    if (context.accounts.len < 3) {
        return ProgramError.NotEnoughAccountKeys;
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    // 解析 Swap 参数 (包含 ZK 证明)
    const params = pool.SwapParams.deserialize(data) catch {
        return ProgramError.InvalidInstructionData;
    };

    // 获取当前 Merkle 根
    const merkle_root = merkle.getRoot(merkle_account);

    // 验证 ZK 证明
    const is_valid = verifier.verifySwapProof(
        params.proof,
        params.public_inputs,
        merkle_root,
    ) catch {
        sol.log.log("Proof verification error");
        return ProgramError.InvalidProof;
    };

    if (!is_valid) {
        sol.log.log("Proof verification failed");
        return ProgramError.InvalidProof;
    }

    // 检查所有 nullifier 未被使用
    for (params.public_inputs.input_nullifier) |nullifier| {
        if (nullifier_set.contains(nullifier_account, nullifier)) {
            return ProgramError.NullifierAlreadyUsed;
        }
    }

    // 标记 nullifier 为已使用
    for (params.public_inputs.input_nullifier) |nullifier| {
        try nullifier_set.insert(nullifier_account, nullifier);
    }

    // 更新池状态
    try pool.updateAfterSwap(pool_account, params);

    sol.log.log("Swap completed successfully");
}

// ============================================================================
// 测试
// ============================================================================

test "instruction enum" {
    const init: Instruction = .InitializePool;
    try std.testing.expectEqual(@as(u8, 0), @intFromEnum(init));

    const swap: Instruction = .Swap;
    try std.testing.expectEqual(@as(u8, 3), @intFromEnum(swap));
}

test "imports" {
    // Verify all modules can be imported
    _ = verifier;
    _ = merkle;
    _ = pool;
    _ = nullifier_set;
    _ = vk;
}
