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
    /// 添加流动性 (LP)
    AddLiquidity = 4,
    /// 移除流动性 (LP)
    RemoveLiquidity = 5,
};

// 程序错误码
pub const ErrorCode = enum(u32) {
    InvalidAccountData = 1,
    InvalidInstructionData = 2,
    NotEnoughAccountKeys = 3,
    MissingRequiredSignature = 4,
    InvalidProof = 5,
    NullifierAlreadyUsed = 6,
    MerkleTreeFull = 7,
    InsufficientLiquidity = 8,
    SlippageExceeded = 9,
    AccountNotWritable = 10,
};

/// 程序入口点 - 最小化栈使用
pub export fn entrypoint(input: [*]u8) callconv(.c) u64 {
    return processEntry(input);
}

fn processEntry(input: [*]u8) u64 {
    const context = sol.context.Context.load(input) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    const data = context.data;
    if (data.len == 0) {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    }

    const instruction: Instruction = @enumFromInt(data[0]);
    const ix_data = data[1..];

    const result = switch (instruction) {
        .InitializePool => handleInitialize(context, ix_data),
        .Deposit => handleDeposit(context, ix_data),
        .Withdraw => handleWithdraw(context, ix_data),
        .Swap => handleSwap(context, ix_data),
        .AddLiquidity => handleAddLiquidity(context, ix_data),
        .RemoveLiquidity => handleRemoveLiquidity(context, ix_data),
    };

    return result;
}

// ============================================================================
// 指令处理函数 - 优化栈使用
// ============================================================================

fn handleInitialize(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("InitializePool");

    if (context.accounts.len < 4) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const initializer = context.accounts[0];
    if (!initializer.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    const merkle_account = context.accounts[2];
    const nullifier_account = context.accounts[3];

    // 解析并初始化
    const params = pool.InitializeParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    pool.initialize(pool_account, params) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    merkle.initialize(merkle_account) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    nullifier_set.initialize(nullifier_account) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Pool initialized");
    return 0;
}

fn handleDeposit(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("Deposit");

    if (context.accounts.len < 3) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const depositor = context.accounts[0];
    if (!depositor.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    const merkle_account = context.accounts[2];

    const params = pool.DepositParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    _ = merkle.insertLeaf(merkle_account, params.commitment) catch {
        return @intFromEnum(ErrorCode.MerkleTreeFull);
    };

    pool.updateAfterDeposit(pool_account, params) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Deposit done");
    return 0;
}

fn handleWithdraw(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("Withdraw");

    if (context.accounts.len < 3) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    const params = pool.WithdrawParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    // 验证 Merkle 根
    const merkle_root = merkle.getRoot(merkle_account);
    if (!std.mem.eql(u8, &params.root, &merkle_root)) {
        sol.log.log("Root mismatch");
        return @intFromEnum(ErrorCode.InvalidProof);
    }

    // 检查 nullifier
    if (nullifier_set.contains(nullifier_account, params.nullifier)) {
        return @intFromEnum(ErrorCode.NullifierAlreadyUsed);
    }

    nullifier_set.insert(nullifier_account, params.nullifier) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    pool.updateAfterWithdraw(pool_account, params) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Withdraw done");
    return 0;
}

fn handleSwap(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("Swap");

    if (context.accounts.len < 3) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    const params = pool.SwapParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    // 获取 Merkle 根并验证 ZK 证明
    const merkle_root = merkle.getRoot(merkle_account);

    // 调用独立的验证函数以减少栈使用
    if (!verifySwapProofWrapper(&params, merkle_root)) {
        sol.log.log("Proof invalid");
        return @intFromEnum(ErrorCode.InvalidProof);
    }

    // 检查 nullifiers
    for (params.public_inputs.input_nullifier) |nullifier| {
        if (nullifier_set.contains(nullifier_account, nullifier)) {
            return @intFromEnum(ErrorCode.NullifierAlreadyUsed);
        }
    }

    // 标记 nullifiers
    for (params.public_inputs.input_nullifier) |nullifier| {
        nullifier_set.insert(nullifier_account, nullifier) catch {
            return @intFromEnum(ErrorCode.InvalidAccountData);
        };
    }

    pool.updateAfterSwap(pool_account, params) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Swap done");
    return 0;
}

fn handleAddLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("AddLiquidity");

    if (context.accounts.len < 5) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const provider = context.accounts[0];
    if (!provider.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    // accounts[2] = token_a_account (LP 的 token A)
    // accounts[3] = token_b_account (LP 的 token B)
    // accounts[4] = pool_token_a_vault
    // accounts[5] = pool_token_b_vault

    const params = pool.AddLiquidityParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    const result = pool.addLiquidity(pool_account, params) catch |err| {
        return switch (err) {
            error.InsufficientLiquidity => @intFromEnum(ErrorCode.InsufficientLiquidity),
            error.SlippageExceeded => @intFromEnum(ErrorCode.SlippageExceeded),
            else => @intFromEnum(ErrorCode.InvalidAccountData),
        };
    };

    // TODO: 执行实际的 SPL Token 转账
    // - 从 provider 的 token_a_account 转移 result.a 到 pool_token_a_vault
    // - 从 provider 的 token_b_account 转移 result.b 到 pool_token_b_vault
    // - 铸造 result.lp 个 LP token 给 provider

    _ = result;
    sol.log.log("AddLiquidity done");
    return 0;
}

fn handleRemoveLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("RemoveLiquidity");

    if (context.accounts.len < 5) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const provider = context.accounts[0];
    if (!provider.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];

    const params = pool.RemoveLiquidityParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    const result = pool.removeLiquidity(pool_account, params) catch |err| {
        return switch (err) {
            error.InsufficientLiquidity => @intFromEnum(ErrorCode.InsufficientLiquidity),
            error.SlippageExceeded => @intFromEnum(ErrorCode.SlippageExceeded),
            else => @intFromEnum(ErrorCode.InvalidAccountData),
        };
    };

    // TODO: 执行实际的 SPL Token 转账
    // - 从 pool_token_a_vault 转移 result.a 到 provider 的 token_a_account
    // - 从 pool_token_b_vault 转移 result.b 到 provider 的 token_b_account
    // - 销毁 provider 的 LP token

    _ = result;
    sol.log.log("RemoveLiquidity done");
    return 0;
}

/// 包装验证函数以隔离栈使用
fn verifySwapProofWrapper(params: *const pool.SwapParams, merkle_root: [32]u8) bool {
    return verifier.verifySwapProof(
        params.proof,
        params.public_inputs,
        merkle_root,
    ) catch false;
}

// ============================================================================
// 测试
// ============================================================================

test "instruction enum" {
    const init: Instruction = .InitializePool;
    try std.testing.expectEqual(@as(u8, 0), @intFromEnum(init));

    const swap: Instruction = .Swap;
    try std.testing.expectEqual(@as(u8, 3), @intFromEnum(swap));

    const add_liq: Instruction = .AddLiquidity;
    try std.testing.expectEqual(@as(u8, 4), @intFromEnum(add_liq));

    const remove_liq: Instruction = .RemoveLiquidity;
    try std.testing.expectEqual(@as(u8, 5), @intFromEnum(remove_liq));
}

test "imports" {
    _ = verifier;
    _ = merkle;
    _ = pool;
    _ = nullifier_set;
    _ = vk;
}
