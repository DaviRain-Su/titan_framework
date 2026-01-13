// Privacy AMM CLI - Titan Privacy
// 隐私 AMM 命令行工具

const std = @import("std");

// 工具模块
pub const utils = @import("utils.zig");

// 子命令模块
pub const swap = @import("commands/swap.zig");
pub const deposit = @import("commands/deposit.zig");
pub const withdraw = @import("commands/withdraw.zig");
pub const balance = @import("commands/balance.zig");

/// CLI 配置
pub const Config = struct {
    /// RPC 端点
    rpc_url: []const u8 = "https://api.devnet.solana.com",
    /// Relayer URL
    relayer_url: []const u8 = "http://localhost:8080",
    /// 密钥文件路径
    keypair_path: ?[]const u8 = null,
    /// 程序 ID
    program_id: ?[]const u8 = null,
    /// 池地址
    pool_address: ?[]const u8 = null,
};

/// 全局配置
var global_config: Config = .{};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    if (args.len < 2) {
        printUsage();
        return;
    }

    // 解析全局选项
    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "--rpc") or std.mem.eql(u8, arg, "-r")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --rpc requires a URL argument\n", .{});
                return;
            }
            global_config.rpc_url = args[i];
        } else if (std.mem.eql(u8, arg, "--relayer")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --relayer requires a URL argument\n", .{});
                return;
            }
            global_config.relayer_url = args[i];
        } else if (std.mem.eql(u8, arg, "--keypair") or std.mem.eql(u8, arg, "-k")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --keypair requires a path argument\n", .{});
                return;
            }
            global_config.keypair_path = args[i];
        } else if (std.mem.eql(u8, arg, "--program")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --program requires an address argument\n", .{});
                return;
            }
            global_config.program_id = args[i];
        } else if (std.mem.eql(u8, arg, "--pool")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --pool requires an address argument\n", .{});
                return;
            }
            global_config.pool_address = args[i];
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printUsage();
            return;
        } else if (std.mem.eql(u8, arg, "--version") or std.mem.eql(u8, arg, "-V")) {
            std.debug.print("titan-privacy 0.1.0\n", .{});
            return;
        } else if (!std.mem.startsWith(u8, arg, "-")) {
            // 这是子命令
            break;
        } else {
            std.debug.print("Error: Unknown option: {s}\n", .{arg});
            return;
        }
    }

    if (i >= args.len) {
        printUsage();
        return;
    }

    const command = args[i];
    const sub_args = args[i + 1 ..];

    // 执行子命令
    if (std.mem.eql(u8, command, "swap")) {
        try swap.execute(allocator, global_config, sub_args);
    } else if (std.mem.eql(u8, command, "deposit")) {
        try deposit.execute(allocator, global_config, sub_args);
    } else if (std.mem.eql(u8, command, "withdraw")) {
        try withdraw.execute(allocator, global_config, sub_args);
    } else if (std.mem.eql(u8, command, "balance")) {
        try balance.execute(allocator, global_config, sub_args);
    } else if (std.mem.eql(u8, command, "help")) {
        printUsage();
    } else {
        std.debug.print("Error: Unknown command: {s}\n", .{command});
        std.debug.print("Run 'titan-privacy help' for usage\n", .{});
    }
}

fn printUsage() void {
    const usage =
        \\Titan Privacy AMM CLI
        \\
        \\Usage: titan-privacy [OPTIONS] <COMMAND>
        \\
        \\Commands:
        \\  swap      Execute a private swap
        \\  deposit   Deposit tokens into the privacy pool
        \\  withdraw  Withdraw tokens from the privacy pool
        \\  balance   Query your private balance
        \\  help      Print this help message
        \\
        \\Options:
        \\  -r, --rpc <URL>       Solana RPC endpoint (default: devnet)
        \\  --relayer <URL>       Relayer service URL
        \\  -k, --keypair <PATH>  Path to keypair file
        \\  --program <ADDRESS>   Privacy AMM program ID
        \\  --pool <ADDRESS>      Pool address
        \\  -h, --help            Print help
        \\  -V, --version         Print version
        \\
        \\Examples:
        \\  # Deposit 10 SOL into the privacy pool
        \\  titan-privacy deposit --amount 10 --token SOL
        \\
        \\  # Private swap 5 SOL for USDC with 1% slippage
        \\  titan-privacy swap --token-in SOL --token-out USDC --amount 5 --slippage 1
        \\
        \\  # Check private balances
        \\  titan-privacy balance --all
        \\
        \\  # Withdraw 100 USDC to your public address
        \\  titan-privacy withdraw --amount 100 --token USDC
        \\
    ;
    std.debug.print("{s}", .{usage});
}

// ============================================================================
// 测试
// ============================================================================

test "cli entry point" {
    // 基本测试确保模块可以编译
    _ = utils;
    _ = swap;
    _ = deposit;
    _ = withdraw;
    _ = balance;
}
