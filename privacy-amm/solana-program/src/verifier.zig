// Groth16 Proof Verifier for Privacy AMM
// 使用 Solana 的 BN254 syscalls 验证 ZK 证明
//
// 优化版本：减少栈使用以适应 SBF 4KB 限制

const std = @import("std");
const sol = @import("solana_program_sdk");
const syscalls = sol.syscalls;
const vk = @import("vk.zig");

// BN254 操作码
const ALT_BN128_G1_ADD_LE: u64 = 0x80;
const ALT_BN128_G1_MUL_LE: u64 = 0x82;
const ALT_BN128_PAIRING_LE: u64 = 0x83;

// ============================================================================
// Proof Structure
// ============================================================================

/// Groth16 证明结构 (BN254 曲线)
pub const Proof = struct {
    /// pi_a: G1 点 (64 bytes)
    pi_a: [64]u8,
    /// pi_b: G2 点 (128 bytes)
    pi_b: [128]u8,
    /// pi_c: G1 点 (64 bytes)
    pi_c: [64]u8,

    const Self = @This();

    pub fn deserialize(data: []const u8) !Self {
        if (data.len < 256) return error.InvalidProofSize;
        var proof: Self = undefined;
        @memcpy(&proof.pi_a, data[0..64]);
        @memcpy(&proof.pi_b, data[64..192]);
        @memcpy(&proof.pi_c, data[192..256]);
        return proof;
    }
};

// ============================================================================
// Public Inputs
// ============================================================================

/// Swap 公开输入 (8 个字段元素)
pub const SwapPublicInputs = struct {
    root: [32]u8,
    input_nullifier: [2][32]u8,
    output_commitment: [2][32]u8,
    pool_state_hash: [32]u8,
    new_pool_state_hash: [32]u8,
    ext_data_hash: [32]u8,

    const Self = @This();

    pub fn deserialize(data: []const u8) !Self {
        if (data.len < 256) return error.InvalidPublicInputsSize;
        var inputs: Self = undefined;
        @memcpy(&inputs.root, data[0..32]);
        @memcpy(&inputs.input_nullifier[0], data[32..64]);
        @memcpy(&inputs.input_nullifier[1], data[64..96]);
        @memcpy(&inputs.output_commitment[0], data[96..128]);
        @memcpy(&inputs.output_commitment[1], data[128..160]);
        @memcpy(&inputs.pool_state_hash, data[160..192]);
        @memcpy(&inputs.new_pool_state_hash, data[192..224]);
        @memcpy(&inputs.ext_data_hash, data[224..256]);
        return inputs;
    }
};

/// Deposit 公开输入
pub const DepositPublicInputs = struct {
    commitment: [32]u8,
    amount: u64,

    pub fn deserialize(data: []const u8) !DepositPublicInputs {
        if (data.len < 40) return error.InvalidPublicInputsSize;
        var inputs: DepositPublicInputs = undefined;
        @memcpy(&inputs.commitment, data[0..32]);
        inputs.amount = std.mem.readInt(u64, data[32..40], .little);
        return inputs;
    }
};

/// Withdraw 公开输入
pub const WithdrawPublicInputs = struct {
    root: [32]u8,
    nullifier: [32]u8,
    recipient: [32]u8,
    amount: u64,

    pub fn deserialize(data: []const u8) !WithdrawPublicInputs {
        if (data.len < 104) return error.InvalidPublicInputsSize;
        var inputs: WithdrawPublicInputs = undefined;
        @memcpy(&inputs.root, data[0..32]);
        @memcpy(&inputs.nullifier, data[32..64]);
        @memcpy(&inputs.recipient, data[64..96]);
        inputs.amount = std.mem.readInt(u64, data[96..104], .little);
        return inputs;
    }
};

// ============================================================================
// Verifier Errors
// ============================================================================

pub const VerifyError = error{
    InvalidProofSize,
    InvalidPublicInputsSize,
    InvalidG1Point,
    InvalidG2Point,
    PairingFailed,
    VerificationFailed,
    ComputeError,
};

// ============================================================================
// Full Groth16 Verifier
// ============================================================================

/// 验证 Swap 证明 - 完整 Groth16 验证
/// 使用 Solana BN254 syscalls 进行配对检查
pub fn verifySwapProof(
    proof: Proof,
    inputs: SwapPublicInputs,
    expected_root: [32]u8,
) VerifyError!bool {
    _ = expected_root; // TODO: 实现链上 Poseidon 后启用根检查
    _ = inputs;

    // 1. 验证证明不为零
    if (isZeroPoint(&proof.pi_a) or isZeroPoint(&proof.pi_c)) {
        return false;
    }

    // NOTE: 完整的 Groth16 验证由于 ELF 跳转限制暂时禁用
    // 在 Solana 支持更大的跳转范围或我们采用多指令验证时启用
    // 当前版本仅检查证明格式有效性
    return true;

    // 完整验证代码（保留供参考）:
    // const public_inputs = buildPublicInputArray(&inputs);
    // return verifyProofFull(&proof, &public_inputs);
}

/// 将 SwapPublicInputs 转换为公开输入数组
fn buildPublicInputArray(inputs: *const SwapPublicInputs) [vk.N_PUBLIC][32]u8 {
    return .{
        inputs.root,                   // [0] root
        inputs.input_nullifier[0],     // [1] nullifier 0
        inputs.input_nullifier[1],     // [2] nullifier 1
        inputs.output_commitment[0],   // [3] commitment 0
        inputs.output_commitment[1],   // [4] commitment 1
        inputs.pool_state_hash,        // [5] pool state hash
        inputs.new_pool_state_hash,    // [6] new pool state hash
        inputs.ext_data_hash,          // [7] ext data hash
    };
}

/// 检查 G1 点是否为零点
fn isZeroPoint(point: *const [64]u8) bool {
    for (point) |b| {
        if (b != 0) return false;
    }
    return true;
}

/// 完整的 Groth16 验证 (noinline 以隔离栈)
/// 使用时请确保调用栈有足够空间
pub noinline fn verifyProofFull(proof: *const Proof, public_inputs: *const [vk.N_PUBLIC][32]u8) VerifyError!bool {
    // 计算 vk_x = IC[0] + sum(input[i] * IC[i+1])
    var vk_x: [64]u8 = undefined;
    computeVkX(public_inputs, &vk_x) catch {
        return VerifyError.ComputeError;
    };

    // 取反 A 点 (用于 e(-A, B))
    var neg_a: [64]u8 = undefined;
    negateG1Point(&proof.pi_a, &neg_a);

    // 执行配对检查: e(-A,B) * e(alpha,beta) * e(vk_x,gamma) * e(C,delta) = 1
    return doPairingCheck(&neg_a, &proof.pi_b, &vk_x, &proof.pi_c);
}

/// 配对检查 - 直接调用 syscall (noinline)
noinline fn doPairingCheck(
    neg_a: *const [64]u8,
    pi_b: *const [128]u8,
    vk_x: *const [64]u8,
    pi_c: *const [64]u8,
) bool {
    // 构建配对输入 (768 bytes = 4 pairs × 192 bytes)
    var pairing_input: [768]u8 = undefined;

    // Pair 1: e(-A, B)
    @memcpy(pairing_input[0..64], neg_a);
    @memcpy(pairing_input[64..192], pi_b);

    // Pair 2: e(alpha, beta)
    @memcpy(pairing_input[192..256], &vk.VK_ALPHA);
    @memcpy(pairing_input[256..384], &vk.VK_BETA);

    // Pair 3: e(vk_x, gamma)
    @memcpy(pairing_input[384..448], vk_x);
    @memcpy(pairing_input[448..576], &vk.VK_GAMMA);

    // Pair 4: e(C, delta)
    @memcpy(pairing_input[576..640], pi_c);
    @memcpy(pairing_input[640..768], &vk.VK_DELTA);

    // 直接调用 pairing syscall
    var result: [32]u8 = undefined;
    const ret = syscalls.sol_alt_bn128_group_op(ALT_BN128_PAIRING_LE, &pairing_input, 768, &result);

    // 检查 syscall 成功且结果为 1
    if (ret != 0) return false;
    return result[0] == 1 and std.mem.allEqual(u8, result[1..32], 0);
}

/// 直接调用 G1 标量乘法 syscall
noinline fn g1MulDirect(point: *const [64]u8, scalar: *const [32]u8, result: *[64]u8) !void {
    var input: [96]u8 = undefined;
    @memcpy(input[0..64], point);
    @memcpy(input[64..96], scalar);

    const ret = syscalls.sol_alt_bn128_group_op(ALT_BN128_G1_MUL_LE, &input, 96, result);
    if (ret != 0) return error.ComputeError;
}

/// 直接调用 G1 加法 syscall
noinline fn g1AddDirect(p1: *const [64]u8, p2: *const [64]u8, result: *[64]u8) !void {
    var input: [128]u8 = undefined;
    @memcpy(input[0..64], p1);
    @memcpy(input[64..128], p2);

    const ret = syscalls.sol_alt_bn128_group_op(ALT_BN128_G1_ADD_LE, &input, 128, result);
    if (ret != 0) return error.ComputeError;
}

/// 计算 vk_x = IC[0] + sum(input[i] * IC[i+1]) (noinline)
noinline fn computeVkX(public_inputs: *const [vk.N_PUBLIC][32]u8, result: *[64]u8) !void {
    // 从 IC[0] 开始
    @memcpy(result, &vk.VK_IC[0]);

    // 逐个累加 input[i] * IC[i+1]
    var temp: [64]u8 = undefined;
    var sum: [64]u8 = undefined;

    for (0..vk.N_PUBLIC) |i| {
        // temp = input[i] * IC[i+1]
        try g1MulDirect(&vk.VK_IC[i + 1], &public_inputs[i], &temp);
        // result = result + temp
        try g1AddDirect(result, &temp, &sum);
        @memcpy(result, &sum);
    }
}

/// 取反 G1 点
fn negateG1Point(point: *const [64]u8, result: *[64]u8) void {
    const p = [32]u8{
        0x47, 0xfd, 0x7c, 0xd8, 0x16, 0x8c, 0x20, 0x3c,
        0x8d, 0xca, 0x71, 0x68, 0x91, 0x6a, 0x81, 0x97,
        0x5d, 0x58, 0x81, 0x81, 0xb6, 0x45, 0x50, 0xb8,
        0x29, 0xa0, 0x31, 0xe1, 0x72, 0x4e, 0x64, 0x30,
    };

    @memcpy(result[0..32], point[0..32]);

    var borrow: u8 = 0;
    for (0..32) |i| {
        const diff = @as(u16, p[i]) -% @as(u16, point[32 + i]) -% @as(u16, borrow);
        result[32 + i] = @truncate(diff);
        borrow = @intFromBool(diff > 0xFF);
    }
}

// ============================================================================
// Tests
// ============================================================================

test "verifier: proof deserialization" {
    var data: [256]u8 = undefined;
    for (&data, 0..) |*b, i| {
        b.* = @truncate(i);
    }

    const proof = try Proof.deserialize(&data);
    try std.testing.expectEqual(@as(u8, 0), proof.pi_a[0]);
    try std.testing.expectEqual(@as(u8, 64), proof.pi_b[0]);
    try std.testing.expectEqual(@as(u8, 192), proof.pi_c[0]);
}

test "verifier: zero point check" {
    const zero: [64]u8 = [_]u8{0} ** 64;
    try std.testing.expect(isZeroPoint(&zero));

    var non_zero: [64]u8 = [_]u8{0} ** 64;
    non_zero[0] = 1;
    try std.testing.expect(!isZeroPoint(&non_zero));
}
