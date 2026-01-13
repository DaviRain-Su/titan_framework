// Privacy AMM Relayer
// 隐私交易中继服务

const std = @import("std");
const net = std.net;

/// Relayer 配置
pub const Config = struct {
    /// 监听端口
    port: u16 = 8080,
    /// Solana RPC URL
    rpc_url: []const u8 = "https://api.devnet.solana.com",
    /// Program ID
    program_id: []const u8 = "",
    /// Pool 地址
    pool_address: []const u8 = "",
    /// Relayer 费用 (basis points)
    fee_bps: u16 = 30, // 0.3%
    /// Relayer 密钥路径
    keypair_path: []const u8 = "",
};

/// Relayer 统计
const RelayerStats = struct {
    pending_txs: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    processed_txs: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    failed_txs: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    total_fees: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
};

var global_config: Config = .{};
var global_stats: RelayerStats = .{};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // 解析命令行参数
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--port") or std.mem.eql(u8, arg, "-p")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --port requires a number\n", .{});
                return;
            }
            global_config.port = try std.fmt.parseInt(u16, args[i], 10);
        } else if (std.mem.eql(u8, arg, "--rpc")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --rpc requires a URL\n", .{});
                return;
            }
            global_config.rpc_url = args[i];
        } else if (std.mem.eql(u8, arg, "--program")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --program requires an address\n", .{});
                return;
            }
            global_config.program_id = args[i];
        } else if (std.mem.eql(u8, arg, "--pool")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --pool requires an address\n", .{});
                return;
            }
            global_config.pool_address = args[i];
        } else if (std.mem.eql(u8, arg, "--keypair") or std.mem.eql(u8, arg, "-k")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --keypair requires a path\n", .{});
                return;
            }
            global_config.keypair_path = args[i];
        } else if (std.mem.eql(u8, arg, "--fee")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --fee requires basis points\n", .{});
                return;
            }
            global_config.fee_bps = try std.fmt.parseInt(u16, args[i], 10);
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    // 打印启动信息
    printBanner();

    std.debug.print("Configuration:\n", .{});
    std.debug.print("  Port:      {d}\n", .{global_config.port});
    std.debug.print("  RPC:       {s}\n", .{global_config.rpc_url});
    std.debug.print("  Program:   {s}\n", .{if (global_config.program_id.len > 0) global_config.program_id else "(not set)"});
    std.debug.print("  Pool:      {s}\n", .{if (global_config.pool_address.len > 0) global_config.pool_address else "(not set)"});
    std.debug.print("  Fee:       {d} bps ({d:.2}%)\n", .{ global_config.fee_bps, @as(f32, @floatFromInt(global_config.fee_bps)) / 100.0 });
    std.debug.print("\n", .{});

    // 启动 HTTP 服务器
    try startServer(allocator);
}

fn printBanner() void {
    std.debug.print("\n", .{});
    std.debug.print("╔══════════════════════════════════════════════════╗\n", .{});
    std.debug.print("║      Privacy AMM Relayer v0.1.0                  ║\n", .{});
    std.debug.print("║      Titan Framework - ZK Transaction Relay      ║\n", .{});
    std.debug.print("╚══════════════════════════════════════════════════╝\n", .{});
    std.debug.print("\n", .{});
}

fn startServer(allocator: std.mem.Allocator) !void {
    const address = net.Address.initIp4(.{ 0, 0, 0, 0 }, global_config.port);
    var server = try address.listen(.{
        .reuse_address = true,
    });
    defer server.deinit();

    std.debug.print("Server started on http://0.0.0.0:{d}\n", .{global_config.port});
    std.debug.print("\n", .{});
    std.debug.print("API Endpoints:\n", .{});
    std.debug.print("  POST /api/submit    Submit a ZK proof for relaying\n", .{});
    std.debug.print("  GET  /api/status    Get relayer status and stats\n", .{});
    std.debug.print("  GET  /api/tx/:sig   Get transaction status\n", .{});
    std.debug.print("  GET  /health        Health check\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Waiting for connections...\n", .{});
    std.debug.print("\n", .{});

    // 接受连接
    while (true) {
        const conn = server.accept() catch |err| {
            std.debug.print("Accept error: {}\n", .{err});
            continue;
        };

        // 在新线程中处理请求
        _ = std.Thread.spawn(.{}, handleConnection, .{ allocator, conn }) catch |err| {
            std.debug.print("Thread spawn error: {}\n", .{err});
            conn.stream.close();
        };
    }
}

fn handleConnection(allocator: std.mem.Allocator, conn: net.Server.Connection) void {
    defer conn.stream.close();

    // 读取请求
    var buffer: [65536]u8 = undefined; // 64KB buffer for large proofs
    const bytes_read = conn.stream.read(&buffer) catch |err| {
        std.debug.print("Read error: {}\n", .{err});
        return;
    };

    if (bytes_read == 0) return;

    const request = buffer[0..bytes_read];

    // 路由请求
    if (std.mem.startsWith(u8, request, "POST /api/submit")) {
        handleSubmit(allocator, conn.stream, request);
    } else if (std.mem.startsWith(u8, request, "GET /api/status")) {
        handleStatus(conn.stream);
    } else if (std.mem.startsWith(u8, request, "GET /api/tx/")) {
        handleTxStatus(allocator, conn.stream, request);
    } else if (std.mem.startsWith(u8, request, "GET /health")) {
        handleHealth(conn.stream);
    } else if (std.mem.startsWith(u8, request, "OPTIONS ")) {
        handleCors(conn.stream);
    } else {
        sendJsonResponse(conn.stream, "404 Not Found",
            \\{"error": "Not found"}
        );
    }
}

/// 处理证明提交
fn handleSubmit(allocator: std.mem.Allocator, stream: net.Stream, request: []const u8) void {
    const timestamp = std.time.timestamp();
    std.debug.print("[{d}] Received submit request\n", .{timestamp});

    // 增加待处理计数
    _ = global_stats.pending_txs.fetchAdd(1, .monotonic);
    defer _ = global_stats.pending_txs.fetchSub(1, .monotonic);

    // 找到请求体开始位置
    const body_start = std.mem.indexOf(u8, request, "\r\n\r\n");
    if (body_start == null) {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"success": false, "error": "Invalid request format"}
        );
        return;
    }

    const body = request[body_start.? + 4 ..];

    // 解析 JSON
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"success": false, "error": "Invalid JSON"}
        );
        return;
    };
    defer parsed.deinit();

    // 提取 proof 和 publicInputs
    const proof_field = parsed.value.object.get("proof");
    const public_field = parsed.value.object.get("publicInputs");

    if (proof_field == null or public_field == null) {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"success": false, "error": "Missing proof or publicInputs"}
        );
        return;
    }

    // 验证证明格式
    if (!validateProofFormat(proof_field.?)) {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"success": false, "error": "Invalid proof format"}
        );
        return;
    }

    std.debug.print("[{d}] Proof validated, building transaction...\n", .{timestamp});

    // 构建并提交交易
    const tx_result = submitTransaction(allocator, proof_field.?, public_field.?);

    if (tx_result.success) {
        _ = global_stats.processed_txs.fetchAdd(1, .monotonic);

        var response_buf: [512]u8 = undefined;
        const response = std.fmt.bufPrint(&response_buf,
            \\{{"success": true, "txSignature": "{s}", "message": "Transaction submitted"}}
        , .{tx_result.signature}) catch {
            sendJsonResponse(stream, "500 Internal Server Error",
                \\{"success": false, "error": "Response formatting error"}
            );
            return;
        };

        sendJsonResponse(stream, "200 OK", response);
        std.debug.print("[{d}] Transaction submitted: {s}\n", .{ timestamp, tx_result.signature });
    } else {
        _ = global_stats.failed_txs.fetchAdd(1, .monotonic);

        var response_buf: [512]u8 = undefined;
        const response = std.fmt.bufPrint(&response_buf,
            \\{{"success": false, "error": "{s}"}}
        , .{tx_result.error_msg}) catch {
            sendJsonResponse(stream, "500 Internal Server Error",
                \\{"success": false, "error": "Response formatting error"}
            );
            return;
        };

        sendJsonResponse(stream, "500 Internal Server Error", response);
        std.debug.print("[{d}] Transaction failed: {s}\n", .{ timestamp, tx_result.error_msg });
    }
}

/// 验证证明格式
fn validateProofFormat(proof: std.json.Value) bool {
    // Groth16 证明应该包含 pi_a, pi_b, pi_c
    if (proof != .object) return false;

    const pi_a = proof.object.get("pi_a");
    const pi_b = proof.object.get("pi_b");
    const pi_c = proof.object.get("pi_c");

    if (pi_a == null or pi_b == null or pi_c == null) {
        // 也接受简化格式
        return true;
    }

    // 验证数组长度
    if (pi_a.? != .array or pi_a.?.array.items.len != 2) return false;
    if (pi_b.? != .array or pi_b.?.array.items.len != 2) return false;
    if (pi_c.? != .array or pi_c.?.array.items.len != 2) return false;

    return true;
}

/// 交易结果
const TxResult = struct {
    success: bool,
    signature: []const u8,
    error_msg: []const u8,
};

/// 提交交易到 Solana
fn submitTransaction(allocator: std.mem.Allocator, proof: std.json.Value, public_inputs: std.json.Value) TxResult {
    _ = allocator;
    _ = proof;
    _ = public_inputs;

    // TODO: 实现真正的交易构建和提交
    // 1. 序列化证明数据
    // 2. 构建指令数据
    // 3. 获取 blockhash
    // 4. 构建交易
    // 5. 签名交易
    // 6. 提交到 RPC

    // 目前返回模拟结果
    return TxResult{
        .success = true,
        .signature = "5xyzABC123simulated456DEF789",
        .error_msg = "",
    };
}

/// 处理状态查询
fn handleStatus(stream: net.Stream) void {
    const pending = global_stats.pending_txs.load(.monotonic);
    const processed = global_stats.processed_txs.load(.monotonic);
    const failed = global_stats.failed_txs.load(.monotonic);

    var response_buf: [1024]u8 = undefined;
    const response = std.fmt.bufPrint(&response_buf,
        \\{{
        \\  "status": "running",
        \\  "version": "0.1.0",
        \\  "config": {{
        \\    "rpcUrl": "{s}",
        \\    "feeBps": {d}
        \\  }},
        \\  "stats": {{
        \\    "pendingTxs": {d},
        \\    "processedTxs": {d},
        \\    "failedTxs": {d}
        \\  }}
        \\}}
    , .{
        global_config.rpc_url,
        global_config.fee_bps,
        pending,
        processed,
        failed,
    }) catch {
        sendJsonResponse(stream, "500 Internal Server Error",
            \\{"error": "Failed to format response"}
        );
        return;
    };

    sendJsonResponse(stream, "200 OK", response);
}

/// 处理交易状态查询
fn handleTxStatus(allocator: std.mem.Allocator, stream: net.Stream, request: []const u8) void {
    _ = allocator;

    // 提取签名
    const path_start = std.mem.indexOf(u8, request, "/api/tx/");
    if (path_start == null) {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"error": "Invalid path"}
        );
        return;
    }

    const sig_start = path_start.? + 8;
    const sig_end = std.mem.indexOfPos(u8, request, sig_start, " ") orelse request.len;
    const signature = request[sig_start..sig_end];

    if (signature.len == 0) {
        sendJsonResponse(stream, "400 Bad Request",
            \\{"error": "Missing signature"}
        );
        return;
    }

    // TODO: 查询实际交易状态
    var response_buf: [512]u8 = undefined;
    const response = std.fmt.bufPrint(&response_buf,
        \\{{"signature": "{s}", "status": "confirmed", "slot": 12345678}}
    , .{signature}) catch {
        sendJsonResponse(stream, "500 Internal Server Error",
            \\{"error": "Failed to format response"}
        );
        return;
    };

    sendJsonResponse(stream, "200 OK", response);
}

/// 处理健康检查
fn handleHealth(stream: net.Stream) void {
    sendJsonResponse(stream, "200 OK",
        \\{"healthy": true, "service": "privacy-relayer"}
    );
}

/// 处理 CORS 预检请求
fn handleCors(stream: net.Stream) void {
    const headers =
        "HTTP/1.1 204 No Content\r\n" ++
        "Access-Control-Allow-Origin: *\r\n" ++
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" ++
        "Access-Control-Allow-Headers: Content-Type\r\n" ++
        "Access-Control-Max-Age: 86400\r\n" ++
        "Connection: close\r\n\r\n";
    _ = stream.write(headers) catch return;
}

fn sendJsonResponse(stream: net.Stream, status: []const u8, body: []const u8) void {
    const header_fmt =
        "HTTP/1.1 {s}\r\n" ++
        "Content-Type: application/json\r\n" ++
        "Content-Length: {d}\r\n" ++
        "Access-Control-Allow-Origin: *\r\n" ++
        "Connection: close\r\n\r\n";
    var header_buf: [512]u8 = undefined;
    const header = std.fmt.bufPrint(&header_buf, header_fmt, .{ status, body.len }) catch return;

    _ = stream.write(header) catch return;
    _ = stream.write(body) catch return;
}

fn printHelp() void {
    const help =
        \\Privacy AMM Relayer - ZK Transaction Relay Service
        \\
        \\Usage: privacy-relayer [OPTIONS]
        \\
        \\Options:
        \\  -p, --port <PORT>       Listen port (default: 8080)
        \\  --rpc <URL>             Solana RPC endpoint
        \\  --program <ADDRESS>     Privacy AMM program ID
        \\  --pool <ADDRESS>        Pool account address
        \\  -k, --keypair <PATH>    Relayer keypair file
        \\  --fee <BPS>             Relayer fee in basis points (default: 30)
        \\  -h, --help              Print this help
        \\
        \\The relayer accepts ZK proofs and submits transactions
        \\to Solana on behalf of users, preserving their privacy.
        \\
        \\API Endpoints:
        \\  POST /api/submit    Submit a proof for relaying
        \\                      Body: {"proof": {...}, "publicInputs": [...]}
        \\  GET  /api/status    Get relayer status and statistics
        \\  GET  /api/tx/:sig   Get transaction status by signature
        \\  GET  /health        Health check endpoint
        \\
        \\Example:
        \\  privacy-relayer --port 8080 --rpc https://api.devnet.solana.com
        \\
    ;
    std.debug.print("{s}", .{help});
}

// ============================================================================
// Tests
// ============================================================================

test "relayer: validate proof format" {
    // 空对象也接受（简化格式）
    const simple = std.json.parseFromSlice(std.json.Value, std.testing.allocator, "{}", .{}) catch unreachable;
    defer simple.deinit();
    try std.testing.expect(validateProofFormat(simple.value));
}
