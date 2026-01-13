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
pub const spl_token = @import("spl_token.zig");
pub const poseidon = @import("poseidon.zig");

// 指令类型
pub const Instruction = enum(u8) {
    /// 初始化流动性池
    InitializePool = 0,
    /// 存入资产 (公开 → 隐私)
    Deposit = 1,
    /// 取出资产 (隐私 → 公开)
    Withdraw = 2,
    /// 隐私交换 (需要 ZK 证明)
    Swap = 3,
    /// 添加流动性 (LP) - 公开
    AddLiquidity = 4,
    /// 移除流动性 (LP) - 公开
    RemoveLiquidity = 5,
    /// 公开交换 (用于测试 AMM 逻辑)
    PublicSwap = 6,
    /// 隐私添加流动性 (需要 ZK 证明)
    PrivateAddLiquidity = 7,
    /// 隐私移除流动性 (需要 ZK 证明)
    PrivateRemoveLiquidity = 8,
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
        .PublicSwap => handlePublicSwap(context, ix_data),
        .PrivateAddLiquidity => handlePrivateAddLiquidity(context, ix_data),
        .PrivateRemoveLiquidity => handlePrivateRemoveLiquidity(context, ix_data),
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

    // Account layout:
    // [0] depositor: User depositing funds (signer)
    // [1] pool_account: Pool state
    // [2] merkle_account: Merkle tree state
    // [3] user_token_account: User's token account (optional - for token deposits)
    // [4] pool_vault: Pool's token vault (optional - for token deposits)
    // [5] token_program: SPL Token program (optional)

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

    // If token accounts are provided, transfer tokens from user to pool vault
    if (context.accounts.len >= 5 and params.amount > 0) {
        const user_token_account = context.accounts[3];
        const pool_vault = context.accounts[4];

        spl_token.transfer(user_token_account, pool_vault, depositor, params.amount) catch {
            sol.log.log("Token transfer failed");
            return @intFromEnum(ErrorCode.InvalidAccountData);
        };
    }

    // Insert commitment into Merkle tree
    _ = merkle.insertLeaf(merkle_account, params.commitment) catch {
        return @intFromEnum(ErrorCode.MerkleTreeFull);
    };

    // Update pool state
    pool.updateAfterDeposit(pool_account, params) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Deposit done");
    return 0;
}

fn handleWithdraw(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("Withdraw");

    // Account layout:
    // [0] pool_account: Pool state
    // [1] merkle_account: Merkle tree state
    // [2] nullifier_account: Nullifier set
    // [3] pool_vault: Pool's token vault (optional - for token withdrawals)
    // [4] recipient_token_account: Recipient's token account (optional)
    // [5] pool_authority: PDA authority for the pool (optional)
    // [6] token_program: SPL Token program (optional)

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

    // 标记 nullifier
    nullifier_set.insert(nullifier_account, params.nullifier) catch {
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // If token accounts are provided, transfer tokens from pool vault to recipient
    if (context.accounts.len >= 6 and params.amount > 0) {
        const pool_vault = context.accounts[3];
        const recipient_token_account = context.accounts[4];
        const pool_authority = context.accounts[5];

        // Get bump from pool state for PDA signing
        const pool_data = pool_account.data();
        const bump_value = pool_data[1]; // bump is at offset 1 in PoolState
        const bump_slice: [1]u8 = .{bump_value};

        const pool_info = pool_account.info();
        const pool_seeds = getPoolAuthoritySeedsWithBump(pool_info, &bump_slice);
        spl_token.transferSigned(pool_vault, recipient_token_account, pool_authority, params.amount, &pool_seeds) catch {
            sol.log.log("Token transfer failed");
            return @intFromEnum(ErrorCode.InvalidAccountData);
        };
    }

    // Update pool state
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

    sol.log.log("Proof valid, checking nullifiers");

    // 检查 nullifiers
    for (params.public_inputs.input_nullifier) |nullifier| {
        if (nullifier_set.contains(nullifier_account, nullifier)) {
            sol.log.log("Nullifier already used");
            return @intFromEnum(ErrorCode.NullifierAlreadyUsed);
        }
    }

    sol.log.log("Marking nullifiers");

    // 标记 nullifiers
    for (params.public_inputs.input_nullifier) |nullifier| {
        nullifier_set.insert(nullifier_account, nullifier) catch {
            sol.log.log("Nullifier insert failed");
            return @intFromEnum(ErrorCode.InvalidAccountData);
        };
    }

    sol.log.log("Updating pool");

    pool.updateAfterSwap(pool_account, params) catch {
        sol.log.log("Pool update failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("Swap done");
    return 0;
}

fn handleAddLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("AddLiquidity");

    // Account layout:
    // [0] provider: LP provider (signer)
    // [1] pool_account: Pool state
    // [2] user_token_a: User's token A account
    // [3] user_token_b: User's token B account
    // [4] pool_vault_a: Pool's token A vault
    // [5] pool_vault_b: Pool's token B vault
    // [6] lp_mint: LP token mint
    // [7] user_lp_account: User's LP token account
    // [8] pool_authority: PDA authority for the pool
    // [9] token_program: SPL Token program

    if (context.accounts.len < 10) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const provider = context.accounts[0];
    if (!provider.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    const user_token_a = context.accounts[2];
    const user_token_b = context.accounts[3];
    const pool_vault_a = context.accounts[4];
    const pool_vault_b = context.accounts[5];
    const lp_mint = context.accounts[6];
    const user_lp_account = context.accounts[7];
    const pool_authority = context.accounts[8];
    // accounts[9] = token_program (not directly used, passed via CPI)

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

    // Transfer token A from user to pool vault
    spl_token.transfer(user_token_a, pool_vault_a, provider, result.a) catch {
        sol.log.log("Token A transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // Transfer token B from user to pool vault
    spl_token.transfer(user_token_b, pool_vault_b, provider, result.b) catch {
        sol.log.log("Token B transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // Mint LP tokens to user (pool_authority is PDA signer)
    // Get bump from pool state
    const pool_data = pool_account.data();
    const bump_value = pool_data[1]; // bump is at offset 1 in PoolState
    const bump_slice: [1]u8 = .{bump_value};

    // Get PDA seeds for pool authority with bump
    const pool_info = pool_account.info();
    const pool_seeds = getPoolAuthoritySeedsWithBump(pool_info, &bump_slice);
    spl_token.mintToSigned(lp_mint, user_lp_account, pool_authority, result.lp, &pool_seeds) catch {
        sol.log.log("LP mint failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("AddLiquidity done");
    return 0;
}

fn handleRemoveLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("RemoveLiquidity");

    // Account layout:
    // [0] provider: LP provider (signer)
    // [1] pool_account: Pool state
    // [2] user_token_a: User's token A account
    // [3] user_token_b: User's token B account
    // [4] pool_vault_a: Pool's token A vault
    // [5] pool_vault_b: Pool's token B vault
    // [6] lp_mint: LP token mint
    // [7] user_lp_account: User's LP token account
    // [8] pool_authority: PDA authority for the pool
    // [9] token_program: SPL Token program

    if (context.accounts.len < 10) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const provider = context.accounts[0];
    if (!provider.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    const user_token_a = context.accounts[2];
    const user_token_b = context.accounts[3];
    const pool_vault_a = context.accounts[4];
    const pool_vault_b = context.accounts[5];
    const lp_mint = context.accounts[6];
    const user_lp_account = context.accounts[7];
    const pool_authority = context.accounts[8];
    // accounts[9] = token_program

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

    // Burn LP tokens from user
    spl_token.burn(user_lp_account, lp_mint, provider, params.lp_amount) catch {
        sol.log.log("LP burn failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // Transfer token A from pool vault to user (pool_authority is PDA signer)
    // Get bump from pool state
    const pool_data = pool_account.data();
    const bump_value = pool_data[1]; // bump is at offset 1 in PoolState
    const bump_slice: [1]u8 = .{bump_value};

    const pool_info = pool_account.info();
    const pool_seeds = getPoolAuthoritySeedsWithBump(pool_info, &bump_slice);
    spl_token.transferSigned(pool_vault_a, user_token_a, pool_authority, result.a, &pool_seeds) catch {
        sol.log.log("Token A transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // Transfer token B from pool vault to user
    spl_token.transferSigned(pool_vault_b, user_token_b, pool_authority, result.b, &pool_seeds) catch {
        sol.log.log("Token B transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("RemoveLiquidity done");
    return 0;
}

fn handlePublicSwap(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("PublicSwap");

    // Account layout:
    // [0] swapper: User performing the swap (signer)
    // [1] pool_account: Pool state
    // [2] user_token_in: User's input token account
    // [3] user_token_out: User's output token account
    // [4] pool_vault_in: Pool's input token vault
    // [5] pool_vault_out: Pool's output token vault
    // [6] pool_authority: PDA authority for the pool
    // [7] token_program: SPL Token program

    if (context.accounts.len < 8) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const swapper = context.accounts[0];
    if (!swapper.isSigner()) {
        return @intFromEnum(ErrorCode.MissingRequiredSignature);
    }

    const pool_account = context.accounts[1];
    const user_token_in = context.accounts[2];
    const user_token_out = context.accounts[3];
    const pool_vault_in = context.accounts[4];
    const pool_vault_out = context.accounts[5];
    const pool_authority = context.accounts[6];
    // accounts[7] = token_program

    const params = pool.PublicSwapParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    // Execute swap calculation
    const result = pool.publicSwap(pool_account, params) catch |err| {
        return switch (err) {
            error.InsufficientLiquidity => @intFromEnum(ErrorCode.InsufficientLiquidity),
            error.SlippageExceeded => @intFromEnum(ErrorCode.SlippageExceeded),
            error.InvalidInstructionData => @intFromEnum(ErrorCode.InvalidInstructionData),
            else => @intFromEnum(ErrorCode.InvalidAccountData),
        };
    };

    // Transfer input tokens from user to pool vault
    spl_token.transfer(user_token_in, pool_vault_in, swapper, params.amount_in) catch {
        sol.log.log("Input transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // Transfer output tokens from pool vault to user (pool_authority is PDA signer)
    const pool_data = pool_account.data();
    const bump_value = pool_data[1]; // bump is at offset 1 in PoolState
    const bump_slice: [1]u8 = .{bump_value};

    const pool_info = pool_account.info();
    const pool_seeds = getPoolAuthoritySeedsWithBump(pool_info, &bump_slice);
    spl_token.transferSigned(pool_vault_out, user_token_out, pool_authority, result.amount_out, &pool_seeds) catch {
        sol.log.log("Output transfer failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("PublicSwap done");
    return 0;
}

/// Pool authority PDA seed prefix
const POOL_AUTHORITY_SEED: []const u8 = "pool_authority";

/// Get PDA seeds for pool authority including bump
/// The pool authority PDA is derived from: ["pool_authority", pool_pubkey, bump]
fn getPoolAuthoritySeedsWithBump(pool_info: sol.account.Account.Info, bump: *const [1]u8) [3][]const u8 {
    return .{
        POOL_AUTHORITY_SEED,
        &pool_info.id.bytes,
        bump,
    };
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
// 隐私流动性指令处理
// ============================================================================

fn handlePrivateAddLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("PrivateAddLiquidity");

    // Account layout:
    // [0] pool_account: Pool state
    // [1] merkle_account: Merkle tree state
    // [2] nullifier_account: Nullifier set

    if (context.accounts.len < 3) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    const params = pool.PrivateAddLiquidityParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    // 获取 Merkle 根
    const merkle_root = merkle.getRoot(merkle_account);

    // 验证 ZK 证明
    if (!verifyPrivateLiquidityProof(&params.proof, &params.public_inputs, merkle_root)) {
        sol.log.log("Proof invalid");
        return @intFromEnum(ErrorCode.InvalidProof);
    }

    sol.log.log("Proof valid, checking nullifiers");

    // 检查输入 nullifiers
    for (params.input_nullifiers) |nullifier| {
        if (nullifier_set.contains(nullifier_account, nullifier)) {
            sol.log.log("Nullifier already used");
            return @intFromEnum(ErrorCode.NullifierAlreadyUsed);
        }
    }

    // 标记 nullifiers
    for (params.input_nullifiers) |nullifier| {
        nullifier_set.insert(nullifier_account, nullifier) catch {
            sol.log.log("Nullifier insert failed");
            return @intFromEnum(ErrorCode.InvalidAccountData);
        };
    }

    // 插入新的 LP Token commitment 到 Merkle 树
    _ = merkle.insertLeaf(merkle_account, params.output_commitment) catch {
        return @intFromEnum(ErrorCode.MerkleTreeFull);
    };

    // 更新池状态
    pool.updateAfterPrivateAddLiquidity(pool_account, params) catch {
        sol.log.log("Pool update failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("PrivateAddLiquidity done");
    return 0;
}

fn handlePrivateRemoveLiquidity(context: sol.context.Context, data: []const u8) u64 {
    sol.log.log("PrivateRemoveLiquidity");

    // Account layout:
    // [0] pool_account: Pool state
    // [1] merkle_account: Merkle tree state
    // [2] nullifier_account: Nullifier set

    if (context.accounts.len < 3) {
        return @intFromEnum(ErrorCode.NotEnoughAccountKeys);
    }

    const pool_account = context.accounts[0];
    const merkle_account = context.accounts[1];
    const nullifier_account = context.accounts[2];

    const params = pool.PrivateRemoveLiquidityParams.deserialize(data) catch {
        return @intFromEnum(ErrorCode.InvalidInstructionData);
    };

    // 获取 Merkle 根
    const merkle_root = merkle.getRoot(merkle_account);

    // 验证 ZK 证明
    if (!verifyPrivateLiquidityProof(&params.proof, &params.public_inputs, merkle_root)) {
        sol.log.log("Proof invalid");
        return @intFromEnum(ErrorCode.InvalidProof);
    }

    sol.log.log("Proof valid, checking nullifier");

    // 检查输入 nullifier
    if (nullifier_set.contains(nullifier_account, params.input_nullifier)) {
        sol.log.log("Nullifier already used");
        return @intFromEnum(ErrorCode.NullifierAlreadyUsed);
    }

    // 标记 nullifier
    nullifier_set.insert(nullifier_account, params.input_nullifier) catch {
        sol.log.log("Nullifier insert failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    // 插入新的 Token A/B commitments 到 Merkle 树
    for (params.output_commitments) |commitment| {
        _ = merkle.insertLeaf(merkle_account, commitment) catch {
            return @intFromEnum(ErrorCode.MerkleTreeFull);
        };
    }

    // 更新池状态
    pool.updateAfterPrivateRemoveLiquidity(pool_account, params) catch {
        sol.log.log("Pool update failed");
        return @intFromEnum(ErrorCode.InvalidAccountData);
    };

    sol.log.log("PrivateRemoveLiquidity done");
    return 0;
}

/// 验证隐私流动性证明
fn verifyPrivateLiquidityProof(
    proof: *const verifier.Proof,
    inputs: *const verifier.SwapPublicInputs,
    expected_root: [32]u8,
) bool {
    // 复用 Swap 证明验证逻辑
    // 注意: 实际生产环境可能需要专门的流动性电路
    return verifier.verifySwapProof(
        proof.*,
        inputs.*,
        expected_root,
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

    const public_swap: Instruction = .PublicSwap;
    try std.testing.expectEqual(@as(u8, 6), @intFromEnum(public_swap));

    const private_add_liq: Instruction = .PrivateAddLiquidity;
    try std.testing.expectEqual(@as(u8, 7), @intFromEnum(private_add_liq));

    const private_remove_liq: Instruction = .PrivateRemoveLiquidity;
    try std.testing.expectEqual(@as(u8, 8), @intFromEnum(private_remove_liq));
}

test "imports" {
    _ = verifier;
    _ = merkle;
    _ = pool;
    _ = nullifier_set;
    _ = vk;
    _ = spl_token;
    _ = poseidon;
}
