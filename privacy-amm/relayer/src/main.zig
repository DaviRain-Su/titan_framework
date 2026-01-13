// Privacy AMM Relayer
// 隐私交易中继服务

const std = @import("std");
const net = std.net;

/// Relayer 配置
const Config = struct {
    /// 监听端口
    port: u16 = 8080,
    /// Solana RPC URL
    rpc_url: []const u8 = "https://api.devnet.solana.com",
    /// Program ID
    program_id: []const u8 = "",
    /// Relayer 费用 (basis points)
    fee_bps: u16 = 30, // 0.3%
};

var global_config: Config = .{};

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
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    std.debug.print("\n", .{});
    std.debug.print("╔══════════════════════════════════════╗\n", .{});
    std.debug.print("║    Privacy AMM Relayer v0.1.0        ║\n", .{});
    std.debug.print("╚══════════════════════════════════════╝\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Configuration:\n", .{});
    std.debug.print("  Port:    {d}\n", .{global_config.port});
    std.debug.print("  RPC:     {s}\n", .{global_config.rpc_url});
    std.debug.print("  Fee:     {d} bps ({d:.2}%)\n", .{ global_config.fee_bps, @as(f32, @floatFromInt(global_config.fee_bps)) / 100.0 });
    std.debug.print("\n", .{});

    // 启动 HTTP 服务器
    try startServer(allocator);
}

fn startServer(allocator: std.mem.Allocator) !void {
    const address = net.Address.initIp4(.{ 0, 0, 0, 0 }, global_config.port);
    var server = try address.listen(.{
        .reuse_address = true,
    });
    defer server.deinit();

    std.debug.print("Listening on http://0.0.0.0:{d}\n", .{global_config.port});
    std.debug.print("\n", .{});
    std.debug.print("Endpoints:\n", .{});
    std.debug.print("  POST /submit    Submit a proof for relaying\n", .{});
    std.debug.print("  GET  /status    Get relayer status\n", .{});
    std.debug.print("  GET  /health    Health check\n", .{});
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
    var buffer: [4096]u8 = undefined;
    const bytes_read = conn.stream.read(&buffer) catch |err| {
        std.debug.print("Read error: {}\n", .{err});
        return;
    };

    if (bytes_read == 0) return;

    const request = buffer[0..bytes_read];

    // 简单的 HTTP 解析
    if (std.mem.startsWith(u8, request, "POST /submit")) {
        handleSubmit(allocator, conn.stream, request);
    } else if (std.mem.startsWith(u8, request, "GET /status")) {
        handleStatus(conn.stream);
    } else if (std.mem.startsWith(u8, request, "GET /health")) {
        handleHealth(conn.stream);
    } else {
        sendResponse(conn.stream, "404 Not Found", "Not Found");
    }
}

fn handleSubmit(allocator: std.mem.Allocator, stream: net.Stream, request: []const u8) void {
    _ = allocator;

    std.debug.print("Received submit request\n", .{});

    // 解析请求体
    // TODO: 提取 proof 和 public inputs

    // 找到请求体开始位置
    const body_start = std.mem.indexOf(u8, request, "\r\n\r\n");
    if (body_start == null) {
        sendResponse(stream, "400 Bad Request", "Invalid request");
        return;
    }

    const body = request[body_start.? + 4 ..];
    std.debug.print("Body length: {d}\n", .{body.len});

    // TODO: 验证证明格式
    // TODO: 构建 Solana 交易
    // TODO: 签名并提交
    // TODO: 返回交易签名

    // 模拟响应
    const response =
        \\{
        \\  "success": true,
        \\  "txSignature": "5xyzABC123...simulated...",
        \\  "message": "Transaction submitted successfully"
        \\}
    ;

    sendJsonResponse(stream, "200 OK", response);
    std.debug.print("Submit processed\n", .{});
}

fn handleStatus(stream: net.Stream) void {
    const response =
        \\{
        \\  "status": "running",
        \\  "version": "0.1.0",
        \\  "pendingTxs": 0,
        \\  "totalProcessed": 0,
        \\  "feeBps": 30
        \\}
    ;

    sendJsonResponse(stream, "200 OK", response);
}

fn handleHealth(stream: net.Stream) void {
    sendJsonResponse(stream, "200 OK",
        \\{"healthy": true}
    );
}

fn sendResponse(stream: net.Stream, status: []const u8, body: []const u8) void {
    const header_fmt = "HTTP/1.1 {s}\r\nContent-Type: text/plain\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n";
    var header_buf: [256]u8 = undefined;
    const header = std.fmt.bufPrint(&header_buf, header_fmt, .{ status, body.len }) catch return;

    _ = stream.write(header) catch return;
    _ = stream.write(body) catch return;
}

fn sendJsonResponse(stream: net.Stream, status: []const u8, body: []const u8) void {
    const header_fmt = "HTTP/1.1 {s}\r\nContent-Type: application/json\r\nContent-Length: {d}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
    var header_buf: [512]u8 = undefined;
    const header = std.fmt.bufPrint(&header_buf, header_fmt, .{ status, body.len }) catch return;

    _ = stream.write(header) catch return;
    _ = stream.write(body) catch return;
}

fn printHelp() void {
    const help =
        \\Privacy AMM Relayer
        \\
        \\Usage: privacy-relayer [OPTIONS]
        \\
        \\Options:
        \\  -p, --port <PORT>   Listen port (default: 8080)
        \\  --rpc <URL>         Solana RPC endpoint
        \\  -h, --help          Print this help
        \\
        \\The relayer accepts ZK proofs and submits transactions
        \\to Solana on behalf of users, preserving their privacy.
        \\
    ;
    std.debug.print("{s}", .{help});
}
