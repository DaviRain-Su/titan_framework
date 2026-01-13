// AMM Pool State Management
// AMM 流动性池状态管理

const std = @import("std");
const sol = @import("solana_program_sdk");
const verifier = @import("verifier.zig");

/// Pool 状态
/// 存储 AMM 池的核心信息
pub const PoolState = struct {
    /// 是否已初始化
    is_initialized: bool,
    /// Pool bump seed (PDA)
    bump: u8,
    /// Token A 的 mint 地址
    token_a_mint: [32]u8,
    /// Token B 的 mint 地址
    token_b_mint: [32]u8,
    /// Token A 储备量
    reserve_a: u64,
    /// Token B 储备量
    reserve_b: u64,
    /// 总 LP Token 供应量
    total_lp: u64,
    /// Pool 公钥 (用于状态哈希)
    pool_pubkey: [32]u8,
    /// 池状态随机因子
    blinding: [32]u8,
    /// 最后更新的 slot
    last_update_slot: u64,

    pub const SIZE: usize = 1 + 1 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 8;

    pub fn deserialize(data: []const u8) !PoolState {
        if (data.len < SIZE) {
            return error.InvalidAccountData;
        }

        var state: PoolState = undefined;
        var offset: usize = 0;

        state.is_initialized = data[offset] != 0;
        offset += 1;

        state.bump = data[offset];
        offset += 1;

        @memcpy(&state.token_a_mint, data[offset..][0..32]);
        offset += 32;

        @memcpy(&state.token_b_mint, data[offset..][0..32]);
        offset += 32;

        state.reserve_a = std.mem.readInt(u64, data[offset..][0..8], .little);
        offset += 8;

        state.reserve_b = std.mem.readInt(u64, data[offset..][0..8], .little);
        offset += 8;

        state.total_lp = std.mem.readInt(u64, data[offset..][0..8], .little);
        offset += 8;

        @memcpy(&state.pool_pubkey, data[offset..][0..32]);
        offset += 32;

        @memcpy(&state.blinding, data[offset..][0..32]);
        offset += 32;

        state.last_update_slot = std.mem.readInt(u64, data[offset..][0..8], .little);

        return state;
    }

    pub fn serialize(self: *const PoolState, data: []u8) !void {
        if (data.len < SIZE) {
            return error.BufferTooSmall;
        }

        var offset: usize = 0;

        data[offset] = if (self.is_initialized) 1 else 0;
        offset += 1;

        data[offset] = self.bump;
        offset += 1;

        @memcpy(data[offset..][0..32], &self.token_a_mint);
        offset += 32;

        @memcpy(data[offset..][0..32], &self.token_b_mint);
        offset += 32;

        std.mem.writeInt(u64, data[offset..][0..8], self.reserve_a, .little);
        offset += 8;

        std.mem.writeInt(u64, data[offset..][0..8], self.reserve_b, .little);
        offset += 8;

        std.mem.writeInt(u64, data[offset..][0..8], self.total_lp, .little);
        offset += 8;

        @memcpy(data[offset..][0..32], &self.pool_pubkey);
        offset += 32;

        @memcpy(data[offset..][0..32], &self.blinding);
        offset += 32;

        std.mem.writeInt(u64, data[offset..][0..8], self.last_update_slot, .little);
    }
};

// ============================================================================
// 指令参数
// ============================================================================

/// 初始化参数
pub const InitializeParams = struct {
    token_a_mint: [32]u8,
    token_b_mint: [32]u8,
    pool_pubkey: [32]u8,
    initial_blinding: [32]u8,
    bump: u8,

    pub fn deserialize(data: []const u8) !InitializeParams {
        if (data.len < 129) {
            return error.InvalidInstructionData;
        }
        var params: InitializeParams = undefined;
        @memcpy(&params.token_a_mint, data[0..32]);
        @memcpy(&params.token_b_mint, data[32..64]);
        @memcpy(&params.pool_pubkey, data[64..96]);
        @memcpy(&params.initial_blinding, data[96..128]);
        params.bump = data[128];
        return params;
    }
};

/// 存款参数
pub const DepositParams = struct {
    /// 存入的 commitment
    commitment: [32]u8,
    /// 存入金额
    amount: u64,
    /// 资产类型 (0 = Token A, 1 = Token B)
    asset_type: u8,

    pub fn deserialize(data: []const u8) !DepositParams {
        if (data.len < 41) {
            return error.InvalidInstructionData;
        }
        var params: DepositParams = undefined;
        @memcpy(&params.commitment, data[0..32]);
        params.amount = std.mem.readInt(u64, data[32..40], .little);
        params.asset_type = data[40];
        return params;
    }
};

/// 取款参数
pub const WithdrawParams = struct {
    /// Merkle 根
    root: [32]u8,
    /// Nullifier
    nullifier: [32]u8,
    /// 取款金额
    amount: u64,
    /// 资产类型
    asset_type: u8,

    pub fn deserialize(data: []const u8) !WithdrawParams {
        if (data.len < 73) {
            return error.InvalidInstructionData;
        }
        var params: WithdrawParams = undefined;
        @memcpy(&params.root, data[0..32]);
        @memcpy(&params.nullifier, data[32..64]);
        params.amount = std.mem.readInt(u64, data[64..72], .little);
        params.asset_type = data[72];
        return params;
    }
};

/// 添加流动性参数
pub const AddLiquidityParams = struct {
    /// Token A 数量
    amount_a: u64,
    /// Token B 数量
    amount_b: u64,
    /// 最小 LP token 数量（滑点保护）
    min_lp: u64,

    pub fn deserialize(data: []const u8) !AddLiquidityParams {
        if (data.len < 24) {
            return error.InvalidInstructionData;
        }
        var params: AddLiquidityParams = undefined;
        params.amount_a = std.mem.readInt(u64, data[0..8], .little);
        params.amount_b = std.mem.readInt(u64, data[8..16], .little);
        params.min_lp = std.mem.readInt(u64, data[16..24], .little);
        return params;
    }
};

/// 移除流动性参数
pub const RemoveLiquidityParams = struct {
    /// 要销毁的 LP token 数量
    lp_amount: u64,
    /// 最小 Token A 数量（滑点保护）
    min_amount_a: u64,
    /// 最小 Token B 数量（滑点保护）
    min_amount_b: u64,

    pub fn deserialize(data: []const u8) !RemoveLiquidityParams {
        if (data.len < 24) {
            return error.InvalidInstructionData;
        }
        var params: RemoveLiquidityParams = undefined;
        params.lp_amount = std.mem.readInt(u64, data[0..8], .little);
        params.min_amount_a = std.mem.readInt(u64, data[8..16], .little);
        params.min_amount_b = std.mem.readInt(u64, data[16..24], .little);
        return params;
    }
};

/// 公开交换参数 (用于测试 AMM 逻辑)
pub const PublicSwapParams = struct {
    /// 输入金额
    amount_in: u64,
    /// 最小输出金额 (滑点保护)
    min_amount_out: u64,
    /// 交换方向: 0 = A→B, 1 = B→A
    direction: u8,

    pub fn deserialize(data: []const u8) !PublicSwapParams {
        if (data.len < 17) {
            return error.InvalidInstructionData;
        }
        var params: PublicSwapParams = undefined;
        params.amount_in = std.mem.readInt(u64, data[0..8], .little);
        params.min_amount_out = std.mem.readInt(u64, data[8..16], .little);
        params.direction = data[16];
        return params;
    }
};

/// Swap 参数
pub const SwapParams = struct {
    /// ZK 证明
    proof: verifier.Proof,
    /// 公开输入
    public_inputs: verifier.SwapPublicInputs,
    /// Nullifiers
    nullifiers: [2][32]u8,
    /// 新 commitments
    new_commitments: [2][32]u8,
    /// 新池状态哈希
    new_pool_state_hash: [32]u8,
    /// 新 blinding
    new_blinding: [32]u8,

    pub fn deserialize(data: []const u8) !SwapParams {
        if (data.len < 256 + 256 + 64 + 64 + 32 + 32) {
            return error.InvalidInstructionData;
        }
        var params: SwapParams = undefined;
        var offset: usize = 0;

        params.proof = try verifier.Proof.deserialize(data[offset..][0..256]);
        offset += 256;

        params.public_inputs = try verifier.SwapPublicInputs.deserialize(data[offset..][0..256]);
        offset += 256;

        @memcpy(&params.nullifiers[0], data[offset..][0..32]);
        offset += 32;
        @memcpy(&params.nullifiers[1], data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_commitments[0], data[offset..][0..32]);
        offset += 32;
        @memcpy(&params.new_commitments[1], data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_pool_state_hash, data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_blinding, data[offset..][0..32]);

        return params;
    }
};

// ============================================================================
// 状态更新函数
// ============================================================================

/// 初始化池
pub fn initialize(account: sol.account.Account, params: InitializeParams) !void {
    const data = account.data();

    var state = PoolState{
        .is_initialized = true,
        .bump = params.bump,
        .token_a_mint = params.token_a_mint,
        .token_b_mint = params.token_b_mint,
        .reserve_a = 0,
        .reserve_b = 0,
        .total_lp = 0,
        .pool_pubkey = params.pool_pubkey,
        .blinding = params.initial_blinding,
        .last_update_slot = 0, // TODO: 获取当前 slot
    };

    try state.serialize(data);
}

/// 存款后更新
pub fn updateAfterDeposit(account: sol.account.Account, params: DepositParams) !void {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 更新储备量
    if (params.asset_type == 0) {
        state.reserve_a += params.amount;
    } else {
        state.reserve_b += params.amount;
    }

    // TODO: 更新 slot
    try state.serialize(data);
}

/// 取款后更新
pub fn updateAfterWithdraw(account: sol.account.Account, params: WithdrawParams) !void {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 检查流动性
    if (params.asset_type == 0) {
        if (state.reserve_a < params.amount) {
            return error.InsufficientLiquidity;
        }
        state.reserve_a -= params.amount;
    } else {
        if (state.reserve_b < params.amount) {
            return error.InsufficientLiquidity;
        }
        state.reserve_b -= params.amount;
    }

    try state.serialize(data);
}

/// Swap 后更新
pub fn updateAfterSwap(account: sol.account.Account, params: SwapParams) !void {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 从公开输入中提取新的池状态
    // 注意: 实际的储备量变化已在 ZK 证明中验证
    // 这里只需要更新 blinding
    state.blinding = params.new_blinding;

    // 实际实现中，新的 reserve_a 和 reserve_b 应该
    // 从加密通道传递或从证明中推导

    try state.serialize(data);
}

/// 添加流动性
/// 返回: (lp_minted, actual_amount_a, actual_amount_b)
pub fn addLiquidity(account: sol.account.Account, params: AddLiquidityParams) !struct { lp: u64, a: u64, b: u64 } {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    var lp_to_mint: u64 = 0;
    var actual_a: u64 = params.amount_a;
    var actual_b: u64 = params.amount_b;

    if (state.total_lp == 0) {
        // 首次添加流动性: LP = sqrt(amount_a * amount_b)
        // 为避免精度问题，使用简化计算
        const product = @as(u128, params.amount_a) * @as(u128, params.amount_b);
        lp_to_mint = sqrt_u128(product);

        if (lp_to_mint == 0) {
            return error.InsufficientLiquidity;
        }
    } else {
        // 后续添加: 按比例计算
        // LP = min(amount_a/reserve_a, amount_b/reserve_b) * total_lp
        const lp_from_a = @as(u128, params.amount_a) * @as(u128, state.total_lp) / @as(u128, state.reserve_a);
        const lp_from_b = @as(u128, params.amount_b) * @as(u128, state.total_lp) / @as(u128, state.reserve_b);

        if (lp_from_a <= lp_from_b) {
            lp_to_mint = @truncate(lp_from_a);
            // 调整 actual_b 以匹配比例
            actual_b = @truncate(@as(u128, params.amount_a) * @as(u128, state.reserve_b) / @as(u128, state.reserve_a));
        } else {
            lp_to_mint = @truncate(lp_from_b);
            // 调整 actual_a 以匹配比例
            actual_a = @truncate(@as(u128, params.amount_b) * @as(u128, state.reserve_a) / @as(u128, state.reserve_b));
        }
    }

    // 检查滑点
    if (lp_to_mint < params.min_lp) {
        return error.SlippageExceeded;
    }

    // 更新状态
    state.reserve_a += actual_a;
    state.reserve_b += actual_b;
    state.total_lp += lp_to_mint;

    try state.serialize(data);

    return .{ .lp = lp_to_mint, .a = actual_a, .b = actual_b };
}

/// 移除流动性
/// 返回: (amount_a, amount_b)
pub fn removeLiquidity(account: sol.account.Account, params: RemoveLiquidityParams) !struct { a: u64, b: u64 } {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    if (state.total_lp == 0 or params.lp_amount > state.total_lp) {
        return error.InsufficientLiquidity;
    }

    // 计算取回的代币数量
    // amount_a = lp_amount / total_lp * reserve_a
    // amount_b = lp_amount / total_lp * reserve_b
    const amount_a: u64 = @truncate(@as(u128, params.lp_amount) * @as(u128, state.reserve_a) / @as(u128, state.total_lp));
    const amount_b: u64 = @truncate(@as(u128, params.lp_amount) * @as(u128, state.reserve_b) / @as(u128, state.total_lp));

    // 检查滑点
    if (amount_a < params.min_amount_a or amount_b < params.min_amount_b) {
        return error.SlippageExceeded;
    }

    // 更新状态
    state.reserve_a -= amount_a;
    state.reserve_b -= amount_b;
    state.total_lp -= params.lp_amount;

    try state.serialize(data);

    return .{ .a = amount_a, .b = amount_b };
}

/// 公开交换 (恒定乘积 AMM)
/// 公式: dy = (y * dx * 997) / (x * 1000 + dx * 997)
/// 0.3% 手续费
pub fn publicSwap(account: sol.account.Account, params: PublicSwapParams) !struct { amount_out: u64 } {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 检查池是否已初始化
    if (!state.is_initialized) {
        return error.InvalidAccountData;
    }

    // 确定输入/输出储备
    var reserve_in: u64 = undefined;
    var reserve_out: u64 = undefined;

    if (params.direction == 0) {
        // A → B
        reserve_in = state.reserve_a;
        reserve_out = state.reserve_b;
    } else {
        // B → A
        reserve_in = state.reserve_b;
        reserve_out = state.reserve_a;
    }

    // 检查输入有效性
    if (params.amount_in == 0) {
        return error.InvalidInstructionData;
    }

    // 检查流动性
    if (reserve_in == 0 or reserve_out == 0) {
        return error.InsufficientLiquidity;
    }

    // 恒定乘积公式 (含 0.3% 手续费)
    // amount_out = (reserve_out * amount_in * 997) / (reserve_in * 1000 + amount_in * 997)
    const amount_in_with_fee = @as(u128, params.amount_in) * 997;
    const numerator = @as(u128, reserve_out) * amount_in_with_fee;
    const denominator = @as(u128, reserve_in) * 1000 + amount_in_with_fee;

    const amount_out: u64 = @truncate(numerator / denominator);

    // 检查输出有效性
    if (amount_out == 0) {
        return error.InsufficientLiquidity;
    }

    // 检查输出不超过储备
    if (amount_out >= reserve_out) {
        return error.InsufficientLiquidity;
    }

    // 检查滑点
    if (amount_out < params.min_amount_out) {
        return error.SlippageExceeded;
    }

    // 更新储备量
    if (params.direction == 0) {
        // A → B
        state.reserve_a += params.amount_in;
        state.reserve_b -= amount_out;
    } else {
        // B → A
        state.reserve_b += params.amount_in;
        state.reserve_a -= amount_out;
    }

    try state.serialize(data);

    return .{ .amount_out = amount_out };
}

/// 整数平方根 (牛顿法)
fn sqrt_u128(n: u128) u64 {
    if (n == 0) return 0;

    var x: u128 = n;
    var y: u128 = (x + 1) / 2;

    while (y < x) {
        x = y;
        y = (x + n / x) / 2;
    }

    return @truncate(x);
}

// ============================================================================
// 隐私流动性 (Private Liquidity)
// ============================================================================

/// 隐私添加流动性参数
/// 用户通过 ZK 证明将隐私 UTXO 转换为 LP Token UTXO
pub const PrivateAddLiquidityParams = struct {
    /// ZK 证明
    proof: verifier.Proof,
    /// 公开输入 (复用 SwapPublicInputs 结构)
    public_inputs: verifier.SwapPublicInputs,
    /// 输入 UTXO nullifiers (2 个: Token A 和 Token B)
    input_nullifiers: [2][32]u8,
    /// 输出 LP Token UTXO commitment
    output_commitment: [32]u8,
    /// 新池状态哈希
    new_pool_state_hash: [32]u8,
    /// 新 blinding
    new_blinding: [32]u8,

    pub fn deserialize(data: []const u8) !PrivateAddLiquidityParams {
        const min_size = 256 + 256 + 64 + 32 + 32 + 32;
        if (data.len < min_size) {
            return error.InvalidInstructionData;
        }

        var params: PrivateAddLiquidityParams = undefined;
        var offset: usize = 0;

        params.proof = try verifier.Proof.deserialize(data[offset..][0..256]);
        offset += 256;

        params.public_inputs = try verifier.SwapPublicInputs.deserialize(data[offset..][0..256]);
        offset += 256;

        @memcpy(&params.input_nullifiers[0], data[offset..][0..32]);
        offset += 32;
        @memcpy(&params.input_nullifiers[1], data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.output_commitment, data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_pool_state_hash, data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_blinding, data[offset..][0..32]);

        return params;
    }
};

/// 隐私移除流动性参数
/// 用户通过 ZK 证明将 LP Token UTXO 转换为 Token A/B UTXO
pub const PrivateRemoveLiquidityParams = struct {
    /// ZK 证明
    proof: verifier.Proof,
    /// 公开输入
    public_inputs: verifier.SwapPublicInputs,
    /// 输入 LP Token UTXO nullifier
    input_nullifier: [32]u8,
    /// 输出 UTXO commitments (2 个: Token A 和 Token B)
    output_commitments: [2][32]u8,
    /// 新池状态哈希
    new_pool_state_hash: [32]u8,
    /// 新 blinding
    new_blinding: [32]u8,

    pub fn deserialize(data: []const u8) !PrivateRemoveLiquidityParams {
        const min_size = 256 + 256 + 32 + 64 + 32 + 32;
        if (data.len < min_size) {
            return error.InvalidInstructionData;
        }

        var params: PrivateRemoveLiquidityParams = undefined;
        var offset: usize = 0;

        params.proof = try verifier.Proof.deserialize(data[offset..][0..256]);
        offset += 256;

        params.public_inputs = try verifier.SwapPublicInputs.deserialize(data[offset..][0..256]);
        offset += 256;

        @memcpy(&params.input_nullifier, data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.output_commitments[0], data[offset..][0..32]);
        offset += 32;
        @memcpy(&params.output_commitments[1], data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_pool_state_hash, data[offset..][0..32]);
        offset += 32;

        @memcpy(&params.new_blinding, data[offset..][0..32]);

        return params;
    }
};

/// 隐私添加流动性后更新池状态
pub fn updateAfterPrivateAddLiquidity(account: sol.account.Account, params: PrivateAddLiquidityParams) !void {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 更新 blinding (储备量变化已在 ZK 证明中验证)
    state.blinding = params.new_blinding;

    try state.serialize(data);
}

/// 隐私移除流动性后更新池状态
pub fn updateAfterPrivateRemoveLiquidity(account: sol.account.Account, params: PrivateRemoveLiquidityParams) !void {
    const data = account.data();
    var state = try PoolState.deserialize(data);

    // 更新 blinding (储备量变化已在 ZK 证明中验证)
    state.blinding = params.new_blinding;

    try state.serialize(data);
}

// ============================================================================
// 测试
// ============================================================================

test "pool state serialization" {
    var state = PoolState{
        .is_initialized = true,
        .bump = 255,
        .token_a_mint = [_]u8{1} ** 32,
        .token_b_mint = [_]u8{2} ** 32,
        .reserve_a = 1000000,
        .reserve_b = 2000000,
        .total_lp = 1414213,
        .pool_pubkey = [_]u8{3} ** 32,
        .blinding = [_]u8{4} ** 32,
        .last_update_slot = 12345678,
    };

    var buffer: [PoolState.SIZE]u8 = undefined;
    try state.serialize(&buffer);

    const decoded = try PoolState.deserialize(&buffer);
    try std.testing.expect(decoded.is_initialized);
    try std.testing.expectEqual(state.reserve_a, decoded.reserve_a);
    try std.testing.expectEqual(state.reserve_b, decoded.reserve_b);
}

test "constant product swap formula" {
    // 验证恒定乘积公式
    // reserve_a = 1000, reserve_b = 1000
    // swap 100 A → B
    // 预期: amount_out = (1000 * 100 * 997) / (1000 * 1000 + 100 * 997)
    //                  = 99700000 / 1099700
    //                  ≈ 90.66

    const reserve_a: u128 = 1000;
    const reserve_b: u128 = 1000;
    const amount_in: u128 = 100;

    const amount_in_with_fee = amount_in * 997;
    const numerator = reserve_b * amount_in_with_fee;
    const denominator = reserve_a * 1000 + amount_in_with_fee;

    const amount_out: u64 = @truncate(numerator / denominator);

    // 预期约 90 (含 0.3% 手续费)
    try std.testing.expect(amount_out >= 90);
    try std.testing.expect(amount_out <= 91);

    // 验证 k 值增长 (手续费导致)
    const k_before = reserve_a * reserve_b;
    const k_after = (reserve_a + amount_in) * (reserve_b - amount_out);
    try std.testing.expect(k_after >= k_before);
}

test "sqrt_u128" {
    try std.testing.expectEqual(@as(u64, 0), sqrt_u128(0));
    try std.testing.expectEqual(@as(u64, 1), sqrt_u128(1));
    try std.testing.expectEqual(@as(u64, 10), sqrt_u128(100));
    try std.testing.expectEqual(@as(u64, 100), sqrt_u128(10000));
    try std.testing.expectEqual(@as(u64, 1000), sqrt_u128(1000000));
    // sqrt(1000000 * 2000000) ≈ 1414213
    try std.testing.expectEqual(@as(u64, 1414213), sqrt_u128(1000000 * 2000000));
}
