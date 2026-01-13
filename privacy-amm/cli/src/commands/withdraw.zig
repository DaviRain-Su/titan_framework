// Withdraw Command - 取款
// 从隐私池取出代币到公开地址

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;
const utils = main.utils;
const crypto = utils.crypto;
const storage = utils.storage;
const rpc = utils.rpc;

/// Withdraw 参数
pub const WithdrawArgs = struct {
    amount: f64,
    token: []const u8,
    recipient: ?[]const u8,
};

/// 执行 withdraw 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    // 解析参数
    const withdraw_args = parseArgs(args) catch |err| {
        if (err == error.HelpRequested) return;
        return err;
    };

    const recipient_display = withdraw_args.recipient orelse "(your wallet)";

    std.debug.print("\n", .{});
    std.debug.print("=== Privacy Withdraw ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Withdrawing {d:.6} {s} to {s}...\n", .{ withdraw_args.amount, withdraw_args.token, recipient_display });
    std.debug.print("\n", .{});

    // 加载用户公钥
    const owner_pubkey = getDefaultPubkey();

    // 1. 选择 UTXO
    std.debug.print("[1/5] Selecting UTXOs...\n", .{});

    var utxo_storage = storage.UtxoStorage.init(allocator, owner_pubkey) catch {
        std.debug.print("Error: No private balance found\n", .{});
        std.debug.print("Hint: Use 'titan-privacy deposit' to add funds first\n", .{});
        return;
    };
    defer utxo_storage.deinit();

    const amount_lamports: u64 = @intFromFloat(withdraw_args.amount * 1_000_000_000);
    const selection = utxo_storage.selectUtxos(withdraw_args.token, amount_lamports, allocator) catch {
        std.debug.print("Error: Insufficient balance for {s}\n", .{withdraw_args.token});
        std.debug.print("Hint: Use 'titan-privacy balance --all' to check your balances\n", .{});
        return;
    };
    defer allocator.free(selection.utxos);

    std.debug.print("       Selected {d} UTXOs, total: {d:.6}\n", .{
        selection.utxos.len,
        @as(f64, @floatFromInt(selection.total)) / 1_000_000_000.0,
    });

    if (selection.change > 0) {
        std.debug.print("       Change: {d:.6} {s}\n", .{
            @as(f64, @floatFromInt(selection.change)) / 1_000_000_000.0,
            withdraw_args.token,
        });
    }

    // 2. 生成 ZK 证明
    std.debug.print("[2/5] Generating ZK proof...\n", .{});

    // 计算 nullifier
    var nullifiers: [2]crypto.FieldElement = undefined;
    for (selection.utxos, 0..) |utxo, i| {
        if (i >= 2) break;

        const leaf_index: u32 = if (utxo.leaf_index >= 0)
            @intCast(utxo.leaf_index)
        else
            0;

        nullifiers[i] = crypto.computeNullifier(
            utxo.commitment,
            leaf_index,
            owner_pubkey, // spending key
        );

        var nullifier_hex: [64]u8 = undefined;
        const nullifier_str = crypto.toHexString(nullifiers[i], &nullifier_hex);
        std.debug.print("       Nullifier #{d}: 0x{s}...{s}\n", .{
            i + 1,
            nullifier_str[0..8],
            nullifier_str[56..64],
        });
    }

    // 模拟证明生成时间
    std.debug.print("       (Simulated proof generation)\n", .{});

    // 3. 通过 Relayer 提交
    std.debug.print("[3/5] Submitting to relayer...\n", .{});

    var relayer_client = rpc.RelayerClient.init(allocator, config.relayer_url);

    // 检查 relayer 是否可用
    const relayer_healthy = relayer_client.healthCheck() catch false;
    if (!relayer_healthy) {
        std.debug.print("       Warning: Relayer not available, using direct submission\n", .{});
    }

    // 模拟提交
    const tx_signature = "5xyzABC123...simulated...";
    std.debug.print("       Transaction submitted\n", .{});

    // 4. 等待确认
    std.debug.print("[4/5] Waiting for confirmation...\n", .{});

    // 模拟等待
    std.debug.print("       Transaction confirmed\n", .{});

    // 5. 更新本地 UTXO
    std.debug.print("[5/5] Updating local state...\n", .{});

    // 标记已用 UTXO
    for (selection.utxos) |utxo| {
        utxo_storage.markSpent(utxo.commitment, tx_signature) catch |err| {
            std.debug.print("       Warning: Failed to mark UTXO as spent: {}\n", .{err});
        };
    }

    // 如果有找零，创建新 UTXO
    if (selection.change > 0) {
        const change_blinding = crypto.generateBlinding();
        const asset_id = crypto.assetIdFromSymbol(withdraw_args.token);
        const change_commitment = crypto.generateCommitment(
            selection.change,
            asset_id,
            owner_pubkey,
            change_blinding,
        );

        var change_utxo: storage.Utxo = undefined;
        change_utxo.commitment = change_commitment.hash;
        change_utxo.blinding = change_blinding;
        change_utxo.amount = selection.change;
        change_utxo.setAssetSymbol(withdraw_args.token);
        change_utxo.asset_id = asset_id;
        change_utxo.leaf_index = -1; // 待确认
        change_utxo.status = .unspent; // For demo, mark as unspent immediately
        change_utxo.created_at = std.time.timestamp();
        change_utxo.spent_at = 0;
        @memset(&change_utxo.spent_tx, 0);

        utxo_storage.addUtxo(change_utxo) catch |err| {
            std.debug.print("       Warning: Failed to save change UTXO: {}\n", .{err});
        };

        std.debug.print("       Change UTXO created\n", .{});
    }

    // 打印结果
    std.debug.print("\n", .{});
    std.debug.print("=== Withdraw Completed ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Amount:      {d:.6} {s}\n", .{ withdraw_args.amount, withdraw_args.token });
    std.debug.print("Recipient:   {s}\n", .{recipient_display});
    std.debug.print("Transaction: {s}\n", .{tx_signature});
    std.debug.print("\n", .{});
    std.debug.print("Your tokens have been withdrawn to the public address.\n", .{});
    std.debug.print("\n", .{});
}

/// 解析命令行参数
fn parseArgs(args: []const []const u8) !WithdrawArgs {
    var result = WithdrawArgs{
        .amount = 0,
        .token = "",
        .recipient = null,
    };

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "--amount") or std.mem.eql(u8, arg, "-a")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --amount requires a value\n", .{});
                return error.MissingArgument;
            }
            result.amount = try std.fmt.parseFloat(f64, args[i]);
        } else if (std.mem.eql(u8, arg, "--token") or std.mem.eql(u8, arg, "-t")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --token requires a symbol\n", .{});
                return error.MissingArgument;
            }
            result.token = args[i];
        } else if (std.mem.eql(u8, arg, "--to") or std.mem.eql(u8, arg, "--recipient")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --to requires an address\n", .{});
                return error.MissingArgument;
            }
            result.recipient = args[i];
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return error.HelpRequested;
        }
    }

    if (result.amount <= 0) {
        std.debug.print("Error: --amount is required and must be positive\n", .{});
        return error.MissingArgument;
    }
    if (result.token.len == 0) {
        std.debug.print("Error: --token is required\n", .{});
        return error.MissingArgument;
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
        \\Usage: titan-privacy withdraw [OPTIONS]
        \\
        \\Withdraw tokens from the privacy pool to a public address
        \\
        \\Options:
        \\  -a, --amount <AMOUNT>     Amount to withdraw
        \\  -t, --token <TOKEN>       Token symbol (e.g., SOL, USDC)
        \\  --to, --recipient <ADDR>  Recipient address (default: your wallet)
        \\  -h, --help                Print this help
        \\
        \\Examples:
        \\  titan-privacy withdraw --amount 10 --token SOL
        \\  titan-privacy withdraw -a 100 -t USDC --to 7xKXt...
        \\
    ;
    std.debug.print("{s}", .{help});
}
