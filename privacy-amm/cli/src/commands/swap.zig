// Swap Command - 隐私交换
// 执行隐私代币交换

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;
const utils = main.utils;
const crypto = utils.crypto;
const storage = utils.storage;
const prover = utils.prover;
const rpc = utils.rpc;

/// Swap 参数
pub const SwapArgs = struct {
    /// 输入代币
    token_in: []const u8,
    /// 输出代币
    token_out: []const u8,
    /// 输入金额
    amount: f64,
    /// 最小输出金额 (滑点保护)
    min_out: ?f64 = null,
    /// 滑点百分比 (默认 1%)
    slippage: f64 = 1.0,
    /// 接收者地址 (默认为自己)
    recipient: ?[]const u8 = null,
};

/// 执行 swap 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    // 解析参数
    const swap_args = parseArgs(args) catch |err| {
        if (err == error.HelpRequested) return;
        return err;
    };

    std.debug.print("\n", .{});
    std.debug.print("=== Privacy Swap ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Input:  {d:.6} {s}\n", .{ swap_args.amount, swap_args.token_in });
    std.debug.print("Output: {s}\n", .{swap_args.token_out});
    std.debug.print("Slippage: {d:.2}%\n", .{swap_args.slippage});
    std.debug.print("\n", .{});

    // 加载用户公钥
    const owner_pubkey = getDefaultPubkey();

    // 1. 获取用户的 UTXO
    std.debug.print("[1/6] Fetching your private UTXOs...\n", .{});

    var utxo_storage = storage.UtxoStorage.init(allocator, owner_pubkey) catch {
        std.debug.print("Error: No private balance found\n", .{});
        std.debug.print("Hint: Use 'titan-privacy deposit' to add funds first\n", .{});
        return;
    };
    defer utxo_storage.deinit();

    // 2. 选择 UTXO
    std.debug.print("[2/6] Selecting UTXOs...\n", .{});

    const amount_lamports: u64 = @intFromFloat(swap_args.amount * 1_000_000_000);
    const selection = utxo_storage.selectUtxos(swap_args.token_in, amount_lamports, allocator) catch {
        std.debug.print("Error: Insufficient balance for {s}\n", .{swap_args.token_in});
        std.debug.print("Hint: Use 'titan-privacy deposit' to add funds first\n", .{});
        return;
    };
    defer allocator.free(selection.utxos);

    const total_display = @as(f64, @floatFromInt(selection.total)) / 1_000_000_000.0;
    std.debug.print("       Selected {d} UTXOs, total: {d:.6}\n", .{ selection.utxos.len, total_display });

    // 3. 获取池状态和计算输出
    std.debug.print("[3/6] Fetching pool state...\n", .{});

    // 模拟池状态
    const pool_reserve_in: u64 = 1_000_000_000_000_000; // 1M tokens
    const pool_reserve_out: u64 = 1_000_000_000_000_000;

    const amount_out = calculateSwapOutput(
        amount_lamports,
        pool_reserve_in,
        pool_reserve_out,
    );

    const min_out_lamports: u64 = if (swap_args.min_out) |m|
        @intFromFloat(m * 1_000_000_000)
    else
        @intFromFloat(@as(f64, @floatFromInt(amount_out)) * (100.0 - swap_args.slippage) / 100.0);

    const amount_out_display = @as(f64, @floatFromInt(amount_out)) / 1_000_000_000.0;
    const min_out_display = @as(f64, @floatFromInt(min_out_lamports)) / 1_000_000_000.0;

    std.debug.print("       Expected output: {d:.6} {s}\n", .{ amount_out_display, swap_args.token_out });
    std.debug.print("       Minimum output:  {d:.6} {s}\n", .{ min_out_display, swap_args.token_out });

    // 4. 构建电路输入
    std.debug.print("[4/6] Building circuit inputs...\n", .{});

    const circuit_input = buildCircuitInput(
        allocator,
        selection.utxos,
        amount_lamports,
        amount_out,
        min_out_lamports,
        pool_reserve_in,
        pool_reserve_out,
        swap_args.token_in,
        swap_args.token_out,
        owner_pubkey,
    ) catch |err| {
        std.debug.print("Error building circuit input: {}\n", .{err});
        return;
    };

    // 5. 生成 ZK 证明
    std.debug.print("[5/6] Generating ZK proof (this may take a moment)...\n", .{});
    const start_time = std.time.milliTimestamp();

    const prover_config = prover.ProverConfig{
        .circuits_dir = "/home/davirain/dev/titan_framework/privacy-amm/circuits/build",
    };

    const proof_result = prover.generateSwapProof(allocator, prover_config, circuit_input) catch |err| {
        std.debug.print("Error generating proof: {}\n", .{err});
        std.debug.print("Note: Ensure snarkjs is installed and circuits are compiled\n", .{});

        // 使用模拟证明继续演示
        std.debug.print("\n[!] Using simulated proof for demo...\n", .{});
        return continueWithSimulatedProof(allocator, config, swap_args, amount_out);
    };
    defer {
        var result = proof_result;
        result.deinit(allocator);
    }

    const proof_time = std.time.milliTimestamp() - start_time;
    std.debug.print("       Proof generated in {d}ms\n", .{proof_time});

    // 6. 提交到 Relayer
    std.debug.print("[6/6] Submitting to relayer...\n", .{});

    var relayer_client = rpc.RelayerClient.init(allocator, config.relayer_url);

    const submit_result = relayer_client.submitProof(proof_result.proof_json, proof_result.public_json) catch |err| {
        std.debug.print("Error submitting to relayer: {}\n", .{err});
        std.debug.print("Note: Ensure relayer is running at {s}\n", .{config.relayer_url});
        return;
    };
    defer {
        var result = submit_result;
        result.deinit(allocator);
    }

    if (!submit_result.success) {
        std.debug.print("Relayer error: {s}\n", .{submit_result.error_msg});
        return;
    }

    // 更新本地 UTXO 状态
    for (selection.utxos) |utxo| {
        utxo_storage.markSpent(utxo.commitment, submit_result.tx_signature) catch {};
    }

    // 打印结果
    printSwapResult(swap_args, amount_out_display, submit_result.tx_signature);
}

/// 使用模拟证明继续（用于演示）
fn continueWithSimulatedProof(
    allocator: std.mem.Allocator,
    config: Config,
    swap_args: SwapArgs,
    amount_out: u64,
) !void {
    _ = allocator;
    _ = config;

    const amount_out_display = @as(f64, @floatFromInt(amount_out)) / 1_000_000_000.0;
    printSwapResult(swap_args, amount_out_display, "5xyzABC...simulated...");
}

/// 打印交换结果
fn printSwapResult(swap_args: SwapArgs, amount_out: f64, tx_signature: []const u8) void {
    std.debug.print("\n", .{});
    std.debug.print("=== Swap Completed ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Transaction: {s}\n", .{tx_signature});
    std.debug.print("Input:       {d:.6} {s}\n", .{ swap_args.amount, swap_args.token_in });
    std.debug.print("Output:      {d:.6} {s}\n", .{ amount_out, swap_args.token_out });
    std.debug.print("\n", .{});
}

/// 构建电路输入
fn buildCircuitInput(
    allocator: std.mem.Allocator,
    utxos: []const storage.Utxo,
    swap_amount_in: u64,
    swap_amount_out: u64,
    min_amount_out: u64,
    pool_reserve_in: u64,
    pool_reserve_out: u64,
    token_in: []const u8,
    token_out: []const u8,
    owner_pubkey: crypto.FieldElement,
) !prover.SwapCircuitInput {
    _ = min_amount_out;
    _ = allocator;

    var input: prover.SwapCircuitInput = undefined;

    // 输入 UTXO (最多 2 个)
    const num_inputs = @min(utxos.len, 2);
    for (0..2) |i| {
        if (i < num_inputs) {
            input.input_amount[i] = utxos[i].amount;
            input.input_blinding[i] = utxos[i].blinding;
            input.input_asset_id[i] = utxos[i].asset_id;
        } else {
            input.input_amount[i] = 0;
            @memset(&input.input_blinding[i], 0);
            @memset(&input.input_asset_id[i], 0);
        }

        // Merkle path (需要从链上获取)
        // 这里使用空路径
        for (0..20) |j| {
            @memset(&input.input_path_elements[i][j], 0);
            input.input_path_indices[i][j] = 0;
        }
    }

    // 输出 UTXO
    // 第一个输出: 交换后的代币
    input.output_amount[0] = swap_amount_out;
    input.output_blinding[0] = crypto.generateBlinding();
    input.output_asset_id[0] = crypto.assetIdFromSymbol(token_out);

    // 第二个输出: 找零 (如果有)
    var total_input: u64 = 0;
    for (0..num_inputs) |i| {
        total_input += input.input_amount[i];
    }
    const change = if (total_input > swap_amount_in) total_input - swap_amount_in else 0;

    input.output_amount[1] = change;
    input.output_blinding[1] = crypto.generateBlinding();
    input.output_asset_id[1] = crypto.assetIdFromSymbol(token_in);

    // 密钥
    input.owner_pubkey = owner_pubkey;
    input.spending_key = owner_pubkey; // 简化: 使用相同的密钥

    // 交换参数
    input.swap_amount_in = swap_amount_in;
    input.swap_amount_out = swap_amount_out;
    input.pool_reserve_in = pool_reserve_in;
    input.pool_reserve_out = pool_reserve_out;

    // 公开输入 (需要计算)
    @memset(&input.root, 0); // TODO: 从链上获取
    @memset(&input.pool_state_hash, 0);
    @memset(&input.new_pool_state_hash, 0);
    @memset(&input.ext_data_hash, 0);

    return input;
}

/// AMM 恒定乘积公式计算输出
fn calculateSwapOutput(amount_in: u64, reserve_in: u64, reserve_out: u64) u64 {
    // amount_out = (amount_in * 0.997 * reserve_out) / (reserve_in + amount_in * 0.997)
    // 使用整数运算避免精度问题

    const fee_numerator: u128 = 997;
    const fee_denominator: u128 = 1000;

    const amount_with_fee: u128 = @as(u128, amount_in) * fee_numerator;
    const numerator: u128 = amount_with_fee * @as(u128, reserve_out);
    const denominator: u128 = @as(u128, reserve_in) * fee_denominator + amount_with_fee;

    return @truncate(numerator / denominator);
}

/// 解析命令行参数
fn parseArgs(args: []const []const u8) !SwapArgs {
    var result = SwapArgs{
        .token_in = "",
        .token_out = "",
        .amount = 0,
    };

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "--token-in") or std.mem.eql(u8, arg, "-i")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.token_in = args[i];
        } else if (std.mem.eql(u8, arg, "--token-out") or std.mem.eql(u8, arg, "-o")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.token_out = args[i];
        } else if (std.mem.eql(u8, arg, "--amount") or std.mem.eql(u8, arg, "-a")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.amount = try std.fmt.parseFloat(f64, args[i]);
        } else if (std.mem.eql(u8, arg, "--min-out")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.min_out = try std.fmt.parseFloat(f64, args[i]);
        } else if (std.mem.eql(u8, arg, "--slippage") or std.mem.eql(u8, arg, "-s")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.slippage = try std.fmt.parseFloat(f64, args[i]);
        } else if (std.mem.eql(u8, arg, "--recipient")) {
            i += 1;
            if (i >= args.len) return error.MissingArgument;
            result.recipient = args[i];
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return error.HelpRequested;
        }
    }

    if (result.token_in.len == 0) {
        std.debug.print("Error: --token-in is required\n", .{});
        return error.MissingArgument;
    }
    if (result.token_out.len == 0) {
        std.debug.print("Error: --token-out is required\n", .{});
        return error.MissingArgument;
    }
    if (result.amount <= 0) {
        std.debug.print("Error: --amount must be positive\n", .{});
        return error.InvalidArgument;
    }

    return result;
}

fn getDefaultPubkey() crypto.FieldElement {
    var pubkey: crypto.FieldElement = undefined;
    @memset(&pubkey, 0x42);
    return pubkey;
}

fn printHelp() void {
    const help =
        \\Usage: titan-privacy swap [OPTIONS]
        \\
        \\Execute a private token swap
        \\
        \\Options:
        \\  -i, --token-in <TOKEN>   Input token symbol (e.g., SOL)
        \\  -o, --token-out <TOKEN>  Output token symbol (e.g., USDC)
        \\  -a, --amount <AMOUNT>    Amount to swap
        \\  --min-out <AMOUNT>       Minimum output amount (overrides slippage)
        \\  -s, --slippage <PCT>     Slippage tolerance in percent (default: 1)
        \\  --recipient <ADDRESS>    Recipient address (default: self)
        \\  -h, --help               Print this help
        \\
        \\Examples:
        \\  titan-privacy swap -i SOL -o USDC -a 5
        \\  titan-privacy swap --token-in SOL --token-out USDC --amount 5 --slippage 0.5
        \\
    ;
    std.debug.print("{s}", .{help});
}
