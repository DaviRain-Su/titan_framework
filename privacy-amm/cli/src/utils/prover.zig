// ZK Proof Generator for Privacy AMM CLI
// 使用 snarkjs 生成 ZK 证明

const std = @import("std");
const crypto = @import("crypto.zig");
const FieldElement = crypto.FieldElement;

/// Groth16 证明
pub const Proof = struct {
    pi_a: [2]FieldElement,
    pi_b: [2][2]FieldElement,
    pi_c: [2]FieldElement,
};

/// 证明生成配置
pub const ProverConfig = struct {
    /// circuits 目录路径
    circuits_dir: []const u8,
    /// WASM 文件名
    wasm_file: []const u8 = "private_swap_js/private_swap.wasm",
    /// ZKey 文件名
    zkey_file: []const u8 = "private_swap_final.zkey",
};

/// Swap 电路输入
pub const SwapCircuitInput = struct {
    // 私有输入
    input_amount: [2]u64,
    input_blinding: [2]FieldElement,
    input_asset_id: [2]FieldElement,
    input_path_elements: [2][20]FieldElement,
    input_path_indices: [2][20]u1,
    output_amount: [2]u64,
    output_blinding: [2]FieldElement,
    output_asset_id: [2]FieldElement,
    owner_pubkey: FieldElement,
    spending_key: FieldElement,

    // 交换参数
    swap_amount_in: u64,
    swap_amount_out: u64,
    pool_reserve_in: u64,
    pool_reserve_out: u64,

    // 公开输入 (将被电路验证)
    root: FieldElement,
    pool_state_hash: FieldElement,
    new_pool_state_hash: FieldElement,
    ext_data_hash: FieldElement,
};

/// 生成 Swap 证明
pub fn generateSwapProof(
    allocator: std.mem.Allocator,
    config: ProverConfig,
    input: SwapCircuitInput,
) !ProofResult {
    // 1. 将输入序列化为 JSON
    const input_json = try serializeCircuitInput(allocator, input);
    defer allocator.free(input_json);

    // 2. 写入临时文件
    const tmp_dir = "/tmp/titan-privacy";
    std.fs.makeDirAbsolute(tmp_dir) catch |err| {
        if (err != error.PathAlreadyExists) return err;
    };

    const input_path = try std.fmt.allocPrint(allocator, "{s}/input_{d}.json", .{
        tmp_dir,
        std.time.milliTimestamp(),
    });
    defer allocator.free(input_path);

    {
        const file = try std.fs.createFileAbsolute(input_path, .{});
        defer file.close();
        try file.writeAll(input_json);
    }

    // 3. 调用 snarkjs 生成证明
    const wasm_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{
        config.circuits_dir,
        config.wasm_file,
    });
    defer allocator.free(wasm_path);

    const zkey_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{
        config.circuits_dir,
        config.zkey_file,
    });
    defer allocator.free(zkey_path);

    const proof_path = try std.fmt.allocPrint(allocator, "{s}/proof_{d}.json", .{
        tmp_dir,
        std.time.milliTimestamp(),
    });
    defer allocator.free(proof_path);

    const public_path = try std.fmt.allocPrint(allocator, "{s}/public_{d}.json", .{
        tmp_dir,
        std.time.milliTimestamp(),
    });
    defer allocator.free(public_path);

    // 执行 snarkjs
    const result = try runSnarkjs(allocator, .{
        .input_path = input_path,
        .wasm_path = wasm_path,
        .zkey_path = zkey_path,
        .proof_path = proof_path,
        .public_path = public_path,
    });

    if (!result.success) {
        std.debug.print("snarkjs error: {s}\n", .{result.error_msg});
        return error.ProofGenerationFailed;
    }

    // 4. 读取并解析证明
    const proof_json = try std.fs.cwd().readFileAlloc(allocator, proof_path, 1024 * 1024);
    defer allocator.free(proof_json);

    const public_json = try std.fs.cwd().readFileAlloc(allocator, public_path, 1024 * 1024);
    defer allocator.free(public_json);

    // 5. 解析证明 JSON
    const proof = try parseProofJson(allocator, proof_json);
    const public_inputs = try parsePublicInputsJson(allocator, public_json);

    return ProofResult{
        .proof = proof,
        .public_inputs = public_inputs,
        .proof_json = try allocator.dupe(u8, proof_json),
        .public_json = try allocator.dupe(u8, public_json),
    };
}

/// 证明生成结果
pub const ProofResult = struct {
    proof: Proof,
    public_inputs: [8]FieldElement,
    proof_json: []const u8,
    public_json: []const u8,

    pub fn deinit(self: *ProofResult, allocator: std.mem.Allocator) void {
        allocator.free(self.proof_json);
        allocator.free(self.public_json);
    }

    /// 序列化为链上格式 (256 bytes)
    pub fn serializeForChain(self: *const ProofResult) [256]u8 {
        var result: [256]u8 = undefined;

        // pi_a: 64 bytes (2 x 32)
        @memcpy(result[0..32], &self.proof.pi_a[0]);
        @memcpy(result[32..64], &self.proof.pi_a[1]);

        // pi_b: 128 bytes (2 x 2 x 32)
        @memcpy(result[64..96], &self.proof.pi_b[0][0]);
        @memcpy(result[96..128], &self.proof.pi_b[0][1]);
        @memcpy(result[128..160], &self.proof.pi_b[1][0]);
        @memcpy(result[160..192], &self.proof.pi_b[1][1]);

        // pi_c: 64 bytes (2 x 32)
        @memcpy(result[192..224], &self.proof.pi_c[0]);
        @memcpy(result[224..256], &self.proof.pi_c[1]);

        return result;
    }
};

/// 运行 snarkjs 的参数
const SnarkjsParams = struct {
    input_path: []const u8,
    wasm_path: []const u8,
    zkey_path: []const u8,
    proof_path: []const u8,
    public_path: []const u8,
};

/// 运行 snarkjs 结果
const SnarkjsResult = struct {
    success: bool,
    error_msg: []const u8,
};

/// 运行 snarkjs 命令
fn runSnarkjs(allocator: std.mem.Allocator, params: SnarkjsParams) !SnarkjsResult {
    // 构建 snarkjs 命令
    const argv = [_][]const u8{
        "snarkjs",
        "groth16",
        "fullprove",
        params.input_path,
        params.wasm_path,
        params.zkey_path,
        params.proof_path,
        params.public_path,
    };

    var child = std.process.Child.init(&argv, allocator);
    child.stderr_behavior = .Pipe;
    child.stdout_behavior = .Pipe;

    try child.spawn();

    // 等待完成
    const result = try child.wait();

    // 读取输出
    var stderr_buf: [4096]u8 = undefined;
    const stderr_len = child.stderr.?.read(&stderr_buf) catch 0;

    if (result.Exited != 0) {
        return SnarkjsResult{
            .success = false,
            .error_msg = stderr_buf[0..stderr_len],
        };
    }

    return SnarkjsResult{
        .success = true,
        .error_msg = "",
    };
}

/// 将电路输入序列化为 JSON
fn serializeCircuitInput(allocator: std.mem.Allocator, input: SwapCircuitInput) ![]const u8 {
    // 使用 fixedBufferStream 进行缓冲区写入
    var buffer: [32 * 1024]u8 = undefined;
    var fbs = std.io.fixedBufferStream(&buffer);
    const writer = fbs.writer();

    try writer.writeAll("{\n");

    // 输入金额
    try writer.print("  \"inputAmount\": [\"{d}\", \"{d}\"],\n", .{ input.input_amount[0], input.input_amount[1] });

    // 其他字段简化为占位符
    try writer.writeAll("  \"inputBlinding\": [\"0\", \"0\"],\n");

    // 交换参数
    try writer.print("  \"swapAmountIn\": \"{d}\",\n", .{input.swap_amount_in});
    try writer.print("  \"swapAmountOut\": \"{d}\"\n", .{input.swap_amount_out});

    try writer.writeAll("}\n");

    // 复制到分配的内存
    const written = fbs.getWritten();
    const result = try allocator.alloc(u8, written.len);
    @memcpy(result, written);
    return result;
}

/// 将字段元素写为 JSON 字符串 (十进制)
fn writeFieldElementJson(writer: anytype, fe: FieldElement) !void {
    // 转换为大整数再转为十进制字符串
    var value: u256 = 0;
    for (0..32) |i| {
        value |= @as(u256, fe[i]) << @intCast(i * 8);
    }

    try writer.print("\"{d}\"", .{value});
}

/// 解析证明 JSON
fn parseProofJson(allocator: std.mem.Allocator, json: []const u8) !Proof {
    _ = allocator;
    _ = json;

    // TODO: 实现真正的 JSON 解析
    // 目前返回空证明
    var proof: Proof = undefined;
    @memset(&proof.pi_a[0], 0);
    @memset(&proof.pi_a[1], 0);
    @memset(&proof.pi_b[0][0], 0);
    @memset(&proof.pi_b[0][1], 0);
    @memset(&proof.pi_b[1][0], 0);
    @memset(&proof.pi_b[1][1], 0);
    @memset(&proof.pi_c[0], 0);
    @memset(&proof.pi_c[1], 0);
    return proof;
}

/// 解析公开输入 JSON
fn parsePublicInputsJson(allocator: std.mem.Allocator, json: []const u8) ![8]FieldElement {
    _ = allocator;
    _ = json;

    // TODO: 实现真正的 JSON 解析
    var inputs: [8]FieldElement = undefined;
    for (&inputs) |*input| {
        @memset(input, 0);
    }
    return inputs;
}

// ============================================================================
// Tests
// ============================================================================

test "prover: serialize circuit input" {
    var input: SwapCircuitInput = undefined;
    @memset(std.mem.asBytes(&input), 0);
    input.input_amount = .{ 1000, 0 };
    input.swap_amount_in = 100;
    input.swap_amount_out = 99;

    const json = try serializeCircuitInput(std.testing.allocator, input);
    defer std.testing.allocator.free(json);

    // 验证 JSON 包含预期字段
    try std.testing.expect(std.mem.indexOf(u8, json, "inputAmount") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "swapAmountIn") != null);
}

test "prover: proof serialization" {
    var result: ProofResult = undefined;
    @memset(std.mem.asBytes(&result.proof), 0xAB);
    result.proof_json = "";
    result.public_json = "";

    const serialized = result.serializeForChain();
    try std.testing.expectEqual(@as(usize, 256), serialized.len);
}
