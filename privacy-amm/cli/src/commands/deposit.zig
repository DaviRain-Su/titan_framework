// Deposit Command - 存款
// 将公开代币存入隐私池

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;
const utils = main.utils;
const crypto = utils.crypto;
const storage = utils.storage;
const rpc = utils.rpc;

/// 存款参数
pub const DepositArgs = struct {
    amount: f64,
    token: []const u8,
};

/// 执行 deposit 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    // 解析参数
    const deposit_args = parseArgs(args) catch |err| {
        if (err == error.HelpRequested) return;
        return err;
    };

    std.debug.print("\n", .{});
    std.debug.print("=== Privacy Deposit ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Depositing {d:.6} {s} into privacy pool...\n", .{ deposit_args.amount, deposit_args.token });
    std.debug.print("\n", .{});

    // 1. 生成 commitment
    std.debug.print("[1/4] Generating commitment...\n", .{});

    // 获取用户公钥 (从密钥文件)
    const owner_pubkey = try loadOwnerPubkey(allocator, config.keypair_path);

    // 生成盲因子
    const blinding = crypto.generateBlinding();

    // 获取资产 ID
    const asset_id = crypto.assetIdFromSymbol(deposit_args.token);

    // 转换金额为最小单位 (假设 9 位小数，如 SOL)
    const amount_lamports: u64 = @intFromFloat(deposit_args.amount * 1_000_000_000);

    // 生成 commitment
    const commitment = crypto.generateCommitment(
        amount_lamports,
        asset_id,
        owner_pubkey,
        blinding,
    );

    var commitment_hex: [64]u8 = undefined;
    const commitment_str = crypto.toHexString(commitment.hash, &commitment_hex);
    std.debug.print("       Commitment: 0x{s}...{s}\n", .{ commitment_str[0..8], commitment_str[56..64] });

    // 2. 发送代币到池 (模拟)
    std.debug.print("[2/4] Sending tokens to pool...\n", .{});

    // 初始化 RPC 客户端
    var rpc_client = rpc.RpcClient.init(allocator, config.rpc_url);
    _ = &rpc_client;

    // TODO: 实际的 SPL Token transfer
    // 需要构建并签名交易，转移代币到池账户
    std.debug.print("       (Simulated: Token transfer to pool)\n", .{});

    // 3. 调用链上 deposit 指令
    std.debug.print("[3/4] Calling deposit instruction...\n", .{});

    // TODO: 构建并发送 deposit 指令
    // instruction_data = [0x01, commitment...]
    std.debug.print("       (Simulated: Deposit instruction sent)\n", .{});

    // 模拟交易签名
    const tx_signature = "5xyzABC123...simulated...";

    // 4. 保存 UTXO 到本地
    std.debug.print("[4/4] Saving UTXO locally...\n", .{});

    // 初始化 UTXO 存储
    var utxo_storage = try storage.UtxoStorage.init(allocator, owner_pubkey);
    defer utxo_storage.deinit();

    // 创建新 UTXO
    var new_utxo: storage.Utxo = undefined;
    new_utxo.commitment = commitment.hash;
    new_utxo.blinding = blinding;
    new_utxo.amount = amount_lamports;
    new_utxo.setAssetSymbol(deposit_args.token);
    new_utxo.asset_id = asset_id;
    new_utxo.leaf_index = -1; // 尚未确认
    new_utxo.status = .unspent; // For demo, mark as unspent immediately
    new_utxo.created_at = std.time.timestamp();
    new_utxo.spent_at = 0;
    @memset(&new_utxo.spent_tx, 0);

    try utxo_storage.addUtxo(new_utxo);
    std.debug.print("       UTXO saved to local storage\n", .{});

    // 完成
    std.debug.print("\n", .{});
    std.debug.print("=== Deposit Completed ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Amount:      {d:.6} {s}\n", .{ deposit_args.amount, deposit_args.token });
    std.debug.print("Transaction: {s}\n", .{tx_signature});
    std.debug.print("\n", .{});
    std.debug.print("Your tokens are now private!\n", .{});
    std.debug.print("Use 'titan-privacy balance' to check your private balance.\n", .{});
    std.debug.print("\n", .{});
}

/// 解析命令行参数
fn parseArgs(args: []const []const u8) !DepositArgs {
    var result = DepositArgs{
        .amount = 0,
        .token = "",
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

/// 加载用户公钥
fn loadOwnerPubkey(allocator: std.mem.Allocator, keypair_path: ?[]const u8) !crypto.FieldElement {
    if (keypair_path) |path| {
        // 尝试从密钥文件加载
        const content = std.fs.cwd().readFileAlloc(allocator, path, 1024) catch {
            std.debug.print("Warning: Could not read keypair file, using default\n", .{});
            return getDefaultPubkey();
        };
        defer allocator.free(content);

        // 解析密钥文件 (Solana 格式是 JSON 数组)
        // TODO: 正确解析 Solana 密钥格式
        return crypto.pubkeyFromBase58(path);
    }

    return getDefaultPubkey();
}

fn getDefaultPubkey() crypto.FieldElement {
    // 使用默认测试公钥
    var pubkey: crypto.FieldElement = undefined;
    @memset(&pubkey, 0x42);
    return pubkey;
}

fn printHelp() void {
    const help =
        \\Usage: titan-privacy deposit [OPTIONS]
        \\
        \\Deposit tokens into the privacy pool
        \\
        \\Options:
        \\  -a, --amount <AMOUNT>  Amount to deposit
        \\  -t, --token <TOKEN>    Token symbol (e.g., SOL, USDC)
        \\  -h, --help             Print this help
        \\
        \\Examples:
        \\  titan-privacy deposit --amount 10 --token SOL
        \\  titan-privacy deposit -a 100 -t USDC
        \\
    ;
    std.debug.print("{s}", .{help});
}
