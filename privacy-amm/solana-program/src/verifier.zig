// Groth16 Proof Verifier for Privacy AMM
// 使用 Solana 的 BN254 syscalls 验证 ZK 证明
//
// Groth16 验证方程:
// e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
//
// 其中 vk_x = IC[0] + sum(public_input[i] * IC[i+1])
//
// 等价于配对检查:
// e(A, B) * e(-alpha, beta) * e(-vk_x, gamma) * e(-C, delta) = 1
// 或者 (用于 Solana):
// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1

const std = @import("std");
const sol = @import("solana_program_sdk");
const bn254 = sol.bn254;
const vk = @import("vk.zig");

// ============================================================================
// Proof Structure
// ============================================================================

/// Groth16 证明结构 (BN254 曲线)
pub const Proof = struct {
    /// pi_a: G1 点 (64 bytes, little-endian)
    pi_a: [64]u8,
    /// pi_b: G2 点 (128 bytes, little-endian)
    pi_b: [128]u8,
    /// pi_c: G1 点 (64 bytes, little-endian)
    pi_c: [64]u8,

    const Self = @This();

    /// 从字节数组反序列化证明
    pub fn deserialize(data: []const u8) !Self {
        if (data.len < 256) {
            return error.InvalidProofSize;
        }
        var proof: Self = undefined;
        @memcpy(&proof.pi_a, data[0..64]);
        @memcpy(&proof.pi_b, data[64..192]);
        @memcpy(&proof.pi_c, data[192..256]);
        return proof;
    }

    /// 序列化证明为字节数组
    pub fn serialize(self: Self, out: *[256]u8) void {
        @memcpy(out[0..64], &self.pi_a);
        @memcpy(out[64..192], &self.pi_b);
        @memcpy(out[192..256], &self.pi_c);
    }
};

// ============================================================================
// Public Inputs
// ============================================================================

/// Swap 公开输入 (8 个字段元素)
pub const SwapPublicInputs = struct {
    root: [32]u8,                  // Merkle 根
    input_nullifier: [2][32]u8,    // 输入 nullifier
    output_commitment: [2][32]u8,  // 输出 commitment
    pool_state_hash: [32]u8,       // 池状态哈希 (交换前)
    new_pool_state_hash: [32]u8,   // 新池状态哈希 (交换后)
    ext_data_hash: [32]u8,         // 外部数据哈希

    const Self = @This();

    pub fn deserialize(data: []const u8) !Self {
        if (data.len < 256) {
            return error.InvalidPublicInputsSize;
        }
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

    /// 转换为字段元素数组 (用于 Groth16 验证)
    pub fn toFieldElements(self: Self) [8][32]u8 {
        return .{
            self.root,
            self.input_nullifier[0],
            self.input_nullifier[1],
            self.output_commitment[0],
            self.output_commitment[1],
            self.pool_state_hash,
            self.new_pool_state_hash,
            self.ext_data_hash,
        };
    }
};

/// Deposit 公开输入
pub const DepositPublicInputs = struct {
    commitment: [32]u8,  // 新 commitment
    amount: u64,         // 存款金额

    pub fn deserialize(data: []const u8) !DepositPublicInputs {
        if (data.len < 40) {
            return error.InvalidPublicInputsSize;
        }
        var inputs: DepositPublicInputs = undefined;
        @memcpy(&inputs.commitment, data[0..32]);
        inputs.amount = std.mem.readInt(u64, data[32..40], .little);
        return inputs;
    }
};

/// Withdraw 公开输入
pub const WithdrawPublicInputs = struct {
    root: [32]u8,       // Merkle 根
    nullifier: [32]u8,  // Nullifier
    recipient: [32]u8,  // 接收者地址
    amount: u64,        // 提款金额

    pub fn deserialize(data: []const u8) !WithdrawPublicInputs {
        if (data.len < 104) {
            return error.InvalidPublicInputsSize;
        }
        var inputs: WithdrawPublicInputs = undefined;
        @memcpy(&inputs.root, data[0..32]);
        @memcpy(&inputs.nullifier, data[32..64]);
        @memcpy(&inputs.recipient, data[64..96]);
        inputs.amount = std.mem.readInt(u64, data[96..104], .little);
        return inputs;
    }
};

// ============================================================================
// Groth16 Verifier
// ============================================================================

/// Groth16 验证错误
pub const VerifyError = error{
    InvalidProofSize,
    InvalidPublicInputsSize,
    InvalidG1Point,
    InvalidG2Point,
    PairingFailed,
    VerificationFailed,
    ComputeError,
};

/// 验证 Groth16 证明
///
/// 使用配对检查: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
///
/// 参数:
/// - proof: Groth16 证明
/// - public_inputs: 公开输入数组 (每个 32 bytes)
///
/// 返回: 验证是否通过
pub fn verifyProof(proof: Proof, public_inputs: []const [32]u8) VerifyError!bool {
    if (public_inputs.len != vk.N_PUBLIC) {
        sol.log.log("Invalid number of public inputs");
        return VerifyError.InvalidPublicInputsSize;
    }

    // Step 1: 计算 vk_x = IC[0] + sum(public_input[i] * IC[i+1])
    const vk_x = computeVkX(public_inputs) catch |err| {
        sol.log.log("Failed to compute vk_x");
        return switch (err) {
            bn254.AltBn128Error.InvalidInputData => VerifyError.InvalidG1Point,
            bn254.AltBn128Error.GroupError => VerifyError.InvalidG1Point,
            else => VerifyError.ComputeError,
        };
    };

    // Step 2: 计算 -A (取反 pi_a 的 y 坐标)
    var neg_a: [64]u8 = undefined;
    negateG1Point(&proof.pi_a, &neg_a);

    // Step 3: 构建配对输入
    // 配对检查: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
    //
    // 配对输入格式: [G1, G2, G1, G2, G1, G2, G1, G2]
    // 每对 192 bytes (64 + 128)

    var pairing_input: [4 * 192]u8 = undefined;

    // Pair 1: e(-A, B)
    @memcpy(pairing_input[0..64], &neg_a);
    @memcpy(pairing_input[64..192], &proof.pi_b);

    // Pair 2: e(alpha, beta)
    @memcpy(pairing_input[192..256], &vk.VK_ALPHA);
    @memcpy(pairing_input[256..384], &vk.VK_BETA);

    // Pair 3: e(vk_x, gamma)
    @memcpy(pairing_input[384..448], &vk_x.bytes);
    @memcpy(pairing_input[448..576], &vk.VK_GAMMA);

    // Pair 4: e(C, delta)
    @memcpy(pairing_input[576..640], &proof.pi_c);
    @memcpy(pairing_input[640..768], &vk.VK_DELTA);

    // Step 4: 执行配对检查
    const result = bn254.pairingLE(&pairing_input) catch |err| {
        sol.log.log("Pairing check failed");
        return switch (err) {
            bn254.AltBn128Error.InvalidInputData => VerifyError.InvalidG1Point,
            bn254.AltBn128Error.GroupError => VerifyError.InvalidG2Point,
            else => VerifyError.PairingFailed,
        };
    };

    return result;
}

/// 计算 vk_x = IC[0] + sum(public_input[i] * IC[i+1])
fn computeVkX(public_inputs: []const [32]u8) !bn254.G1Point {
    // 从 IC[0] 开始
    var vk_x = bn254.G1Point.new(vk.VK_IC[0]);

    // 累加 public_input[i] * IC[i+1]
    for (public_inputs, 0..) |input, i| {
        // 标量乘法: IC[i+1] * public_input[i]
        const ic_point = bn254.G1Point.new(vk.VK_IC[i + 1]);
        const term = try bn254.mulG1Scalar(ic_point, input);

        // 累加到 vk_x
        vk_x = try bn254.addG1Points(vk_x, term);
    }

    return vk_x;
}

/// 取反 G1 点 (对 y 坐标取模逆)
/// 在 BN254 曲线上, -P = (x, -y) = (x, p - y)
fn negateG1Point(point: *const [64]u8, result: *[64]u8) void {
    // BN254 素数域模数 (little-endian)
    const p = [32]u8{
        0x47, 0xfd, 0x7c, 0xd8, 0x16, 0x8c, 0x20, 0x3c,
        0x8d, 0xca, 0x71, 0x68, 0x91, 0x6a, 0x81, 0x97,
        0x5d, 0x58, 0x81, 0x81, 0xb6, 0x45, 0x50, 0xb8,
        0x29, 0xa0, 0x31, 0xe1, 0x72, 0x4e, 0x64, 0x30,
    };

    // x 坐标保持不变
    @memcpy(result[0..32], point[0..32]);

    // y' = p - y (模减法)
    var borrow: u8 = 0;
    for (0..32) |i| {
        const a = p[i];
        const b = point[32 + i];
        const diff = @as(u16, a) -% @as(u16, b) -% @as(u16, borrow);
        result[32 + i] = @truncate(diff);
        borrow = @intFromBool(diff > 0xFF);
    }
}

// ============================================================================
// High-level Verification Functions
// ============================================================================

/// 验证 Swap 证明
pub fn verifySwapProof(
    proof: Proof,
    inputs: SwapPublicInputs,
    expected_root: [32]u8,
) VerifyError!bool {
    // 1. 验证 Merkle 根匹配
    if (!std.mem.eql(u8, &inputs.root, &expected_root)) {
        sol.log.log("Merkle root mismatch");
        return false;
    }

    // 2. 转换公开输入并验证证明
    const field_elements = inputs.toFieldElements();
    return verifyProof(proof, &field_elements);
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

test "verifier: swap inputs deserialization" {
    var data: [256]u8 = undefined;
    for (&data, 0..) |*b, i| {
        b.* = @truncate(i);
    }

    const inputs = try SwapPublicInputs.deserialize(&data);
    try std.testing.expectEqual(@as(u8, 0), inputs.root[0]);
    try std.testing.expectEqual(@as(u8, 32), inputs.input_nullifier[0][0]);
    try std.testing.expectEqual(@as(u8, 64), inputs.input_nullifier[1][0]);
}

test "verifier: negate G1 point" {
    // Test with zero point
    const zero: [64]u8 = [_]u8{0} ** 64;
    var neg_zero: [64]u8 = undefined;
    negateG1Point(&zero, &neg_zero);

    // p - 0 = p (但实际上 y=0 的点是无穷远点)
    // 只检查 x 坐标不变
    try std.testing.expectEqualSlices(u8, zero[0..32], neg_zero[0..32]);
}

test "verifier: field elements conversion" {
    var inputs: SwapPublicInputs = undefined;
    @memset(&inputs.root, 1);
    @memset(&inputs.input_nullifier[0], 2);
    @memset(&inputs.input_nullifier[1], 3);
    @memset(&inputs.output_commitment[0], 4);
    @memset(&inputs.output_commitment[1], 5);
    @memset(&inputs.pool_state_hash, 6);
    @memset(&inputs.new_pool_state_hash, 7);
    @memset(&inputs.ext_data_hash, 8);

    const elements = inputs.toFieldElements();
    try std.testing.expectEqual(@as(usize, 8), elements.len);
    try std.testing.expectEqual(@as(u8, 1), elements[0][0]);
    try std.testing.expectEqual(@as(u8, 2), elements[1][0]);
    try std.testing.expectEqual(@as(u8, 8), elements[7][0]);
}
