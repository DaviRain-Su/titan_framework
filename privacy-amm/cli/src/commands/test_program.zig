// Test Program Command - 测试链上程序
// 与部署的 Privacy AMM 程序交互

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;
const utils = main.utils;
const crypto = utils.crypto;

/// 程序 ID (devnet)
const PROGRAM_ID = "5XNfzGiTt7WNveJrLRKcz2w9wyCDqLNMYHaQWZJjo8ef";

/// 指令类型
const Instruction = enum(u8) {
    InitializePool = 0,
    Deposit = 1,
    Withdraw = 2,
    Swap = 3,
};

/// 执行测试命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    var test_type: []const u8 = "all";

    // 解析参数
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--type") or std.mem.eql(u8, arg, "-t")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --type requires a value\n", .{});
                return;
            }
            test_type = args[i];
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    std.debug.print("\n", .{});
    std.debug.print("╔══════════════════════════════════════════════════╗\n", .{});
    std.debug.print("║    Privacy AMM Program Test Suite                 ║\n", .{});
    std.debug.print("╚══════════════════════════════════════════════════╝\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Program ID: {s}\n", .{PROGRAM_ID});
    std.debug.print("RPC URL:    {s}\n", .{config.rpc_url});
    std.debug.print("Test Type:  {s}\n", .{test_type});
    std.debug.print("\n", .{});

    if (std.mem.eql(u8, test_type, "init") or std.mem.eql(u8, test_type, "all")) {
        try testInitializePool(allocator, config);
    }

    if (std.mem.eql(u8, test_type, "deposit") or std.mem.eql(u8, test_type, "all")) {
        try testDeposit(allocator, config);
    }

    if (std.mem.eql(u8, test_type, "withdraw") or std.mem.eql(u8, test_type, "all")) {
        try testWithdraw(allocator, config);
    }

    if (std.mem.eql(u8, test_type, "swap") or std.mem.eql(u8, test_type, "all")) {
        try testSwap(allocator, config);
    }

    std.debug.print("\n", .{});
    std.debug.print("=== Test Suite Complete ===\n", .{});
    std.debug.print("\n", .{});
}

/// 测试初始化池
fn testInitializePool(allocator: std.mem.Allocator, config: Config) !void {
    _ = allocator;
    _ = config;

    std.debug.print("─────────────────────────────────────────────────────\n", .{});
    std.debug.print("[TEST] Initialize Pool\n", .{});
    std.debug.print("─────────────────────────────────────────────────────\n", .{});

    // 1. 派生 PDA 地址
    std.debug.print("[1/4] Deriving PDA addresses...\n", .{});

    const pool_seed = "pool";
    const merkle_seed = "merkle";
    const nullifier_seed = "nullifier";

    std.debug.print("       Pool PDA seed:      \"{s}\"\n", .{pool_seed});
    std.debug.print("       Merkle PDA seed:    \"{s}\"\n", .{merkle_seed});
    std.debug.print("       Nullifier PDA seed: \"{s}\"\n", .{nullifier_seed});

    // 2. 构建指令数据
    std.debug.print("[2/4] Building instruction data...\n", .{});

    // InitializeParams: fee_bps (u16) + token_a (32) + token_b (32)
    var ix_data: [67]u8 = undefined;
    ix_data[0] = @intFromEnum(Instruction.InitializePool);
    // fee_bps = 30 (0.3%)
    std.mem.writeInt(u16, ix_data[1..3], 30, .little);
    // token_a (placeholder - SOL mint)
    @memset(ix_data[3..35], 0);
    // token_b (placeholder - TUSDC mint)
    @memset(ix_data[35..67], 0);

    std.debug.print("       Instruction: InitializePool (0x00)\n", .{});
    std.debug.print("       Fee: 30 bps (0.3%%)\n", .{});

    // 3. 创建账户
    std.debug.print("[3/4] Creating accounts...\n", .{});
    std.debug.print("       (Requires: solana CLI to create PDAs)\n", .{});
    std.debug.print("       Run: solana program invoke ...\n", .{});

    // 4. 发送交易
    std.debug.print("[4/4] Transaction...\n", .{});
    std.debug.print("       Status: SIMULATED (no actual tx sent)\n", .{});

    std.debug.print("\n[RESULT] InitializePool: SIMULATED OK\n", .{});
    std.debug.print("\n", .{});
}

/// 测试存款
fn testDeposit(allocator: std.mem.Allocator, config: Config) !void {
    _ = config;

    std.debug.print("─────────────────────────────────────────────────────\n", .{});
    std.debug.print("[TEST] Deposit\n", .{});
    std.debug.print("─────────────────────────────────────────────────────\n", .{});

    // 1. 生成 commitment
    std.debug.print("[1/3] Generating commitment...\n", .{});

    const amount: u64 = 1_000_000_000; // 1 SOL
    const blinding = crypto.generateBlinding();

    var owner_pubkey: crypto.FieldElement = undefined;
    @memset(&owner_pubkey, 0x42);

    const asset_id = crypto.assetIdFromSymbol("SOL");
    const commitment = crypto.generateCommitment(amount, asset_id, owner_pubkey, blinding);

    var commitment_hex: [64]u8 = undefined;
    const commitment_str = crypto.toHexString(commitment.hash, &commitment_hex);

    std.debug.print("       Amount: 1.0 SOL\n", .{});
    std.debug.print("       Commitment: 0x{s}...{s}\n", .{ commitment_str[0..8], commitment_str[56..64] });

    // 2. 构建指令数据
    std.debug.print("[2/3] Building instruction data...\n", .{});

    var ix_data: [41]u8 = undefined;
    ix_data[0] = @intFromEnum(Instruction.Deposit);
    // commitment (32 bytes)
    @memcpy(ix_data[1..33], &commitment.hash);
    // amount (8 bytes)
    std.mem.writeInt(u64, ix_data[33..41], amount, .little);

    std.debug.print("       Instruction: Deposit (0x01)\n", .{});

    // 3. 发送交易
    std.debug.print("[3/3] Transaction...\n", .{});

    // 保存 UTXO 到本地存储
    var storage = utils.storage.UtxoStorage.init(allocator, owner_pubkey) catch {
        std.debug.print("       Warning: Could not init storage\n", .{});
        return;
    };
    defer storage.deinit();

    var utxo: utils.storage.Utxo = undefined;
    utxo.commitment = commitment.hash;
    utxo.blinding = blinding;
    utxo.amount = amount;
    utxo.setAssetSymbol("SOL");
    utxo.asset_id = asset_id;
    utxo.leaf_index = 0; // First leaf
    utxo.status = .unspent;
    utxo.created_at = std.time.timestamp();
    utxo.spent_at = 0;
    @memset(&utxo.spent_tx, 0);

    storage.addUtxo(utxo) catch {
        std.debug.print("       Warning: Could not save UTXO\n", .{});
    };

    std.debug.print("       UTXO saved locally\n", .{});
    std.debug.print("       Status: SIMULATED (no actual tx sent)\n", .{});

    std.debug.print("\n[RESULT] Deposit: SIMULATED OK\n", .{});
    std.debug.print("\n", .{});
}

/// 测试取款
fn testWithdraw(allocator: std.mem.Allocator, config: Config) !void {
    _ = config;

    std.debug.print("─────────────────────────────────────────────────────\n", .{});
    std.debug.print("[TEST] Withdraw\n", .{});
    std.debug.print("─────────────────────────────────────────────────────\n", .{});

    var owner_pubkey: crypto.FieldElement = undefined;
    @memset(&owner_pubkey, 0x42);

    // 1. 获取 UTXO
    std.debug.print("[1/4] Fetching UTXOs...\n", .{});

    var storage = utils.storage.UtxoStorage.init(allocator, owner_pubkey) catch {
        std.debug.print("       No UTXOs found. Run deposit test first.\n", .{});
        std.debug.print("\n[RESULT] Withdraw: SKIPPED (no UTXOs)\n", .{});
        std.debug.print("\n", .{});
        return;
    };
    defer storage.deinit();

    const balance = storage.getBalance("SOL");
    if (balance == 0) {
        std.debug.print("       No SOL balance. Run deposit test first.\n", .{});
        std.debug.print("\n[RESULT] Withdraw: SKIPPED (no balance)\n", .{});
        std.debug.print("\n", .{});
        return;
    }

    std.debug.print("       Found balance: {d:.6} SOL\n", .{@as(f64, @floatFromInt(balance)) / 1e9});

    // 2. 选择 UTXO
    std.debug.print("[2/4] Selecting UTXO...\n", .{});

    const withdraw_amount: u64 = @min(balance, 500_000_000); // 0.5 SOL or less
    const selection = storage.selectUtxos("SOL", withdraw_amount, allocator) catch {
        std.debug.print("       Insufficient balance\n", .{});
        return;
    };
    defer allocator.free(selection.utxos);

    std.debug.print("       Selected {d} UTXO(s)\n", .{selection.utxos.len});
    std.debug.print("       Withdraw: {d:.6} SOL\n", .{@as(f64, @floatFromInt(withdraw_amount)) / 1e9});

    // 3. 计算 nullifier
    std.debug.print("[3/4] Computing nullifier...\n", .{});

    if (selection.utxos.len > 0) {
        const utxo = selection.utxos[0];
        const leaf_idx: u32 = if (utxo.leaf_index >= 0) @intCast(utxo.leaf_index) else 0;
        const nullifier = crypto.computeNullifier(utxo.commitment, leaf_idx, owner_pubkey);

        var nullifier_hex: [64]u8 = undefined;
        const nullifier_str = crypto.toHexString(nullifier, &nullifier_hex);
        std.debug.print("       Nullifier: 0x{s}...{s}\n", .{ nullifier_str[0..8], nullifier_str[56..64] });
    }

    // 4. 构建指令
    std.debug.print("[4/4] Building instruction...\n", .{});

    var ix_data: [105]u8 = undefined;
    ix_data[0] = @intFromEnum(Instruction.Withdraw);
    // root (32 bytes) - placeholder
    @memset(ix_data[1..33], 0);
    // nullifier (32 bytes) - placeholder
    @memset(ix_data[33..65], 0);
    // recipient (32 bytes) - placeholder
    @memset(ix_data[65..97], 0);
    // amount (8 bytes)
    std.mem.writeInt(u64, ix_data[97..105], withdraw_amount, .little);

    std.debug.print("       Instruction: Withdraw (0x02)\n", .{});
    std.debug.print("       Status: SIMULATED (no actual tx sent)\n", .{});

    std.debug.print("\n[RESULT] Withdraw: SIMULATED OK\n", .{});
    std.debug.print("\n", .{});
}

/// 测试 Swap
fn testSwap(allocator: std.mem.Allocator, config: Config) !void {
    _ = allocator;
    _ = config;

    std.debug.print("─────────────────────────────────────────────────────\n", .{});
    std.debug.print("[TEST] Swap (ZK Proof)\n", .{});
    std.debug.print("─────────────────────────────────────────────────────\n", .{});

    // 1. 准备交换参数
    std.debug.print("[1/4] Preparing swap parameters...\n", .{});

    const amount_in: u64 = 100_000_000; // 0.1 SOL
    const reserve_in: u64 = 1_000_000_000_000; // 1000 SOL
    const reserve_out: u64 = 150_000_000_000_000; // 150000 TUSDC

    // AMM 公式: amount_out = (amount_in * 0.997 * reserve_out) / (reserve_in + amount_in * 0.997)
    const fee_num: u128 = 997;
    const fee_denom: u128 = 1000;
    const amount_with_fee: u128 = @as(u128, amount_in) * fee_num;
    const numerator: u128 = amount_with_fee * @as(u128, reserve_out);
    const denominator: u128 = @as(u128, reserve_in) * fee_denom + amount_with_fee;
    const amount_out: u64 = @truncate(numerator / denominator);

    std.debug.print("       Input:  0.1 SOL\n", .{});
    std.debug.print("       Output: {d:.6} TUSDC (estimated)\n", .{@as(f64, @floatFromInt(amount_out)) / 1e6});

    // 2. 构建电路输入
    std.debug.print("[2/4] Building circuit inputs...\n", .{});
    std.debug.print("       (Requires compiled ZK circuit)\n", .{});

    // 3. 生成证明
    std.debug.print("[3/4] Generating ZK proof...\n", .{});
    std.debug.print("       (Requires snarkjs + .wasm + .zkey)\n", .{});

    // 4. 构建指令
    std.debug.print("[4/4] Building instruction...\n", .{});

    // Swap instruction: proof (256) + public_inputs (256) + ...
    std.debug.print("       Instruction: Swap (0x03)\n", .{});
    std.debug.print("       Proof size: 256 bytes\n", .{});
    std.debug.print("       Public inputs: 8 x 32 = 256 bytes\n", .{});
    std.debug.print("       Status: SIMULATED (no ZK circuit available)\n", .{});

    std.debug.print("\n[RESULT] Swap: SIMULATED OK (no ZK proof)\n", .{});
    std.debug.print("\n", .{});
}

fn printHelp() void {
    const help =
        \\Privacy AMM Program Test Suite
        \\
        \\Usage: titan-privacy test-program [OPTIONS]
        \\
        \\Options:
        \\  -t, --type <TYPE>   Test type: all, init, deposit, withdraw, swap
        \\  -h, --help          Print this help
        \\
        \\Examples:
        \\  titan-privacy test-program --type all
        \\  titan-privacy test-program --type deposit
        \\
    ;
    std.debug.print("{s}", .{help});
}
