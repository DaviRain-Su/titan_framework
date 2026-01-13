// Solana RPC Client for Privacy AMM CLI
// Solana JSON-RPC 客户端

const std = @import("std");
const crypto = @import("crypto.zig");
const FieldElement = crypto.FieldElement;

/// RPC 错误
pub const RpcError = error{
    ConnectionFailed,
    InvalidResponse,
    RequestFailed,
    ParseError,
    Timeout,
};

/// RPC 客户端
pub const RpcClient = struct {
    allocator: std.mem.Allocator,
    endpoint: []const u8,

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, endpoint: []const u8) Self {
        return Self{
            .allocator = allocator,
            .endpoint = endpoint,
        };
    }

    /// 发送 JSON-RPC 请求
    fn sendRequest(self: *Self, method: []const u8, params: []const u8) ![]const u8 {
        // 构建 JSON-RPC 请求体
        const request_body = try std.fmt.allocPrint(self.allocator,
            \\{{"jsonrpc":"2.0","id":1,"method":"{s}","params":{s}}}
        , .{ method, params });
        defer self.allocator.free(request_body);

        // 初始化 HTTP 客户端
        var client: std.http.Client = .{ .allocator = self.allocator };
        defer client.deinit();

        // 解析 URI
        const uri = std.Uri.parse(self.endpoint) catch {
            return RpcError.ConnectionFailed;
        };

        // 创建请求
        var req = client.request(.POST, uri, .{
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "application/json" },
            },
        }) catch {
            return RpcError.ConnectionFailed;
        };
        defer req.deinit();

        // 发送请求体
        req.sendBodyComplete(@constCast(request_body)) catch {
            return RpcError.RequestFailed;
        };

        // 接收响应头
        var header_buf: [8192]u8 = undefined;
        var response = req.receiveHead(&header_buf) catch {
            return RpcError.RequestFailed;
        };

        // 检查状态码
        const status = @intFromEnum(response.head.status);
        if (status < 200 or status >= 300) {
            return RpcError.RequestFailed;
        }

        // 读取响应体
        var body_buf: [8192]u8 = undefined;
        var body_reader = response.reader(&body_buf);
        const body = body_reader.allocRemaining(self.allocator, std.Io.Limit.limited(1024 * 1024)) catch {
            return RpcError.InvalidResponse;
        };

        return body;
    }

    /// 获取账户信息
    pub fn getAccountInfo(self: *Self, pubkey: []const u8) !?AccountInfo {
        const params = try std.fmt.allocPrint(self.allocator,
            \\["{s}",{{"encoding":"base64"}}]
        , .{pubkey});
        defer self.allocator.free(params);

        const response = self.sendRequest("getAccountInfo", params) catch |err| {
            std.debug.print("RPC error: {}\n", .{err});
            return null;
        };
        defer self.allocator.free(response);

        // 解析 JSON 响应
        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response, .{}) catch {
            return null;
        };
        defer parsed.deinit();

        const result = parsed.value.object.get("result") orelse return null;
        if (result == .null) return null;

        const value = result.object.get("value") orelse return null;
        if (value == .null) return null;

        var info: AccountInfo = undefined;
        info.lamports = @intCast(value.object.get("lamports").?.integer);
        info.executable = value.object.get("executable").?.bool;
        info.rent_epoch = @intCast(value.object.get("rentEpoch").?.integer);

        // owner 需要 base58 解码
        @memset(&info.owner, 0);

        // data 需要 base64 解码
        info.data = "";

        return info;
    }

    /// 获取最新 blockhash
    pub fn getLatestBlockhash(self: *Self) !Blockhash {
        const response = self.sendRequest("getLatestBlockhash", "[]") catch |err| {
            std.debug.print("RPC error: {}\n", .{err});
            // 返回空 blockhash
            var result: Blockhash = undefined;
            @memset(&result.blockhash, 0);
            result.last_valid_block_height = 0;
            return result;
        };
        defer self.allocator.free(response);

        // 解析 JSON 响应
        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response, .{}) catch {
            var result: Blockhash = undefined;
            @memset(&result.blockhash, 0);
            result.last_valid_block_height = 0;
            return result;
        };
        defer parsed.deinit();

        var result: Blockhash = undefined;

        const res = parsed.value.object.get("result") orelse {
            @memset(&result.blockhash, 0);
            result.last_valid_block_height = 0;
            return result;
        };

        const value = res.object.get("value") orelse {
            @memset(&result.blockhash, 0);
            result.last_valid_block_height = 0;
            return result;
        };

        result.last_valid_block_height = @intCast(value.object.get("lastValidBlockHeight").?.integer);

        // blockhash 需要 base58 解码
        const blockhash_str = value.object.get("blockhash").?.string;
        _ = blockhash_str;
        @memset(&result.blockhash, 0);

        return result;
    }

    /// 发送交易
    pub fn sendTransaction(self: *Self, tx_base64: []const u8) ![]const u8 {
        const params = try std.fmt.allocPrint(self.allocator,
            \\["{s}",{{"encoding":"base64"}}]
        , .{tx_base64});
        defer self.allocator.free(params);

        const response = self.sendRequest("sendTransaction", params) catch |err| {
            std.debug.print("RPC error: {}\n", .{err});
            return self.allocator.dupe(u8, "");
        };
        defer self.allocator.free(response);

        // 解析签名
        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response, .{}) catch {
            return self.allocator.dupe(u8, "");
        };
        defer parsed.deinit();

        const result = parsed.value.object.get("result") orelse {
            return self.allocator.dupe(u8, "");
        };

        if (result == .string) {
            return self.allocator.dupe(u8, result.string);
        }

        return self.allocator.dupe(u8, "");
    }

    /// 发送并确认交易
    pub fn sendAndConfirmTransaction(self: *Self, tx_base64: []const u8) ![]const u8 {
        const signature = try self.sendTransaction(tx_base64);

        if (signature.len == 0) {
            return signature;
        }

        // 轮询确认状态
        var attempts: u32 = 0;
        while (attempts < 30) : (attempts += 1) {
            const status = try self.getSignatureStatus(signature);
            switch (status) {
                .confirmed, .finalized => return signature,
                .failed => {
                    self.allocator.free(signature);
                    return self.allocator.dupe(u8, "");
                },
                else => {},
            }
            std.time.sleep(500 * std.time.ns_per_ms);
        }

        return signature;
    }

    /// 获取交易状态
    pub fn getSignatureStatus(self: *Self, signature: []const u8) !TransactionStatus {
        const params = try std.fmt.allocPrint(self.allocator,
            \\[["{s}"],{{"searchTransactionHistory":true}}]
        , .{signature});
        defer self.allocator.free(params);

        const response = self.sendRequest("getSignatureStatuses", params) catch {
            return .unknown;
        };
        defer self.allocator.free(response);

        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response, .{}) catch {
            return .unknown;
        };
        defer parsed.deinit();

        const result = parsed.value.object.get("result") orelse return .unknown;
        const value = result.object.get("value") orelse return .unknown;

        if (value != .array or value.array.items.len == 0) {
            return .unknown;
        }

        const status_obj = value.array.items[0];
        if (status_obj == .null) {
            return .pending;
        }

        // 检查是否有错误
        const err_field = status_obj.object.get("err");
        if (err_field) |e| {
            if (e != .null) {
                return .failed;
            }
        }

        // 检查确认状态
        const confirmation = status_obj.object.get("confirmationStatus");
        if (confirmation) |c| {
            if (c == .string) {
                if (std.mem.eql(u8, c.string, "finalized")) {
                    return .finalized;
                } else if (std.mem.eql(u8, c.string, "confirmed")) {
                    return .confirmed;
                }
            }
        }

        return .pending;
    }

    /// 获取 Merkle 树账户数据
    pub fn getMerkleTreeData(self: *Self, address: []const u8) !MerkleTreeData {
        const account_info = try self.getAccountInfo(address);

        var result: MerkleTreeData = undefined;
        @memset(&result.root, 0);
        result.next_index = 0;

        if (account_info) |info| {
            _ = info;
            // TODO: 解析账户数据提取 Merkle 树状态
        }

        return result;
    }
};

/// 账户信息
pub const AccountInfo = struct {
    lamports: u64,
    owner: [32]u8,
    data: []const u8,
    executable: bool,
    rent_epoch: u64,
};

/// Blockhash
pub const Blockhash = struct {
    blockhash: [32]u8,
    last_valid_block_height: u64,
};

/// 交易状态
pub const TransactionStatus = enum {
    pending,
    confirmed,
    finalized,
    failed,
    unknown,
};

/// Merkle 树数据
pub const MerkleTreeData = struct {
    root: FieldElement,
    next_index: u32,
};

// ============================================================================
// Relayer 客户端
// ============================================================================

/// Relayer 客户端
pub const RelayerClient = struct {
    allocator: std.mem.Allocator,
    endpoint: []const u8,

    const Self = @This();

    pub fn init(allocator: std.mem.Allocator, endpoint: []const u8) Self {
        return Self{
            .allocator = allocator,
            .endpoint = endpoint,
        };
    }

    /// HTTP POST 请求
    fn httpPost(self: *Self, path: []const u8, body: []const u8) !HttpResponse {
        // 构建完整 URL
        const url = try std.fmt.allocPrint(self.allocator, "{s}{s}", .{ self.endpoint, path });
        defer self.allocator.free(url);

        // 初始化 HTTP 客户端
        var client: std.http.Client = .{ .allocator = self.allocator };
        defer client.deinit();

        // 解析 URI
        const uri = std.Uri.parse(url) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        // 创建请求
        var req = client.request(.POST, uri, .{
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "application/json" },
            },
        }) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };
        defer req.deinit();

        // 发送请求体
        req.sendBodyComplete(@constCast(body)) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        // 接收响应头
        var header_buf: [4096]u8 = undefined;
        var response = req.receiveHead(&header_buf) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        const status = @intFromEnum(response.head.status);

        // 读取响应体
        var body_buf: [4096]u8 = undefined;
        var body_reader = response.reader(&body_buf);
        const response_body = body_reader.allocRemaining(self.allocator, std.Io.Limit.limited(1024 * 1024)) catch {
            return HttpResponse{ .status = status, .body = "" };
        };

        return HttpResponse{
            .status = status,
            .body = response_body,
        };
    }

    /// HTTP GET 请求
    fn httpGet(self: *Self, path: []const u8) !HttpResponse {
        const url = try std.fmt.allocPrint(self.allocator, "{s}{s}", .{ self.endpoint, path });
        defer self.allocator.free(url);

        var client: std.http.Client = .{ .allocator = self.allocator };
        defer client.deinit();

        const uri = std.Uri.parse(url) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        var req = client.request(.GET, uri, .{}) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };
        defer req.deinit();

        req.sendBodiless() catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        var header_buf: [4096]u8 = undefined;
        var response = req.receiveHead(&header_buf) catch {
            return HttpResponse{ .status = 0, .body = "" };
        };

        const status = @intFromEnum(response.head.status);

        var body_buf: [4096]u8 = undefined;
        var body_reader = response.reader(&body_buf);
        const response_body = body_reader.allocRemaining(self.allocator, std.Io.Limit.limited(1024 * 1024)) catch {
            return HttpResponse{ .status = status, .body = "" };
        };

        return HttpResponse{
            .status = status,
            .body = response_body,
        };
    }

    /// 提交证明到 Relayer
    pub fn submitProof(self: *Self, proof_json: []const u8, public_json: []const u8) !SubmitResult {
        // 构建请求体
        const body = try std.fmt.allocPrint(self.allocator,
            \\{{"proof":{s},"publicInputs":{s}}}
        , .{ proof_json, public_json });
        defer self.allocator.free(body);

        // 发送请求
        const response = try self.httpPost("/api/submit", body);
        defer if (response.body.len > 0) self.allocator.free(response.body);

        if (response.status == 0) {
            return SubmitResult{
                .success = false,
                .tx_signature = "",
                .error_msg = "Connection failed",
            };
        }

        if (response.status < 200 or response.status >= 300) {
            return SubmitResult{
                .success = false,
                .tx_signature = "",
                .error_msg = try std.fmt.allocPrint(self.allocator, "HTTP {d}", .{response.status}),
            };
        }

        // 解析响应
        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response.body, .{}) catch {
            return SubmitResult{
                .success = false,
                .tx_signature = "",
                .error_msg = "Invalid JSON response",
            };
        };
        defer parsed.deinit();

        const success = if (parsed.value.object.get("success")) |s| s.bool else false;
        const tx_sig = if (parsed.value.object.get("txSignature")) |t|
            try self.allocator.dupe(u8, t.string)
        else
            try self.allocator.dupe(u8, "");

        const error_msg = if (parsed.value.object.get("error")) |e|
            try self.allocator.dupe(u8, e.string)
        else
            try self.allocator.dupe(u8, "");

        return SubmitResult{
            .success = success,
            .tx_signature = tx_sig,
            .error_msg = error_msg,
        };
    }

    /// 检查 Relayer 健康状态
    pub fn healthCheck(self: *Self) !bool {
        const response = try self.httpGet("/health");
        defer if (response.body.len > 0) self.allocator.free(response.body);

        return response.status == 200;
    }

    /// 获取 Relayer 状态
    pub fn getStatus(self: *Self) !RelayerStatus {
        const response = try self.httpGet("/api/status");
        defer if (response.body.len > 0) self.allocator.free(response.body);

        if (response.status != 200) {
            return RelayerStatus{
                .online = false,
                .pending_txs = 0,
                .processed_txs = 0,
            };
        }

        const parsed = std.json.parseFromSlice(std.json.Value, self.allocator, response.body, .{}) catch {
            return RelayerStatus{
                .online = false,
                .pending_txs = 0,
                .processed_txs = 0,
            };
        };
        defer parsed.deinit();

        return RelayerStatus{
            .online = true,
            .pending_txs = if (parsed.value.object.get("pendingTxs")) |p| @intCast(p.integer) else 0,
            .processed_txs = if (parsed.value.object.get("processedTxs")) |p| @intCast(p.integer) else 0,
        };
    }
};

/// HTTP 响应
const HttpResponse = struct {
    status: u16,
    body: []const u8,
};

/// Relayer 状态
pub const RelayerStatus = struct {
    online: bool,
    pending_txs: u32,
    processed_txs: u64,
};

/// 提交结果
pub const SubmitResult = struct {
    success: bool,
    tx_signature: []const u8,
    error_msg: []const u8,

    pub fn deinit(self: *SubmitResult, allocator: std.mem.Allocator) void {
        if (self.tx_signature.len > 0) {
            allocator.free(self.tx_signature);
        }
        if (self.error_msg.len > 0 and !isStaticString(self.error_msg)) {
            allocator.free(self.error_msg);
        }
    }
};

fn isStaticString(s: []const u8) bool {
    // 检查是否是编译时字符串常量
    const static_strings = [_][]const u8{
        "Connection failed",
        "Invalid JSON response",
        "",
    };
    for (static_strings) |ss| {
        if (s.ptr == ss.ptr) return true;
    }
    return false;
}

// ============================================================================
// Tests
// ============================================================================

test "rpc: client initialization" {
    const client = RpcClient.init(std.testing.allocator, "https://api.devnet.solana.com");
    try std.testing.expectEqualSlices(u8, "https://api.devnet.solana.com", client.endpoint);
}

test "rpc: relayer client initialization" {
    const client = RelayerClient.init(std.testing.allocator, "http://localhost:8080");
    try std.testing.expectEqualSlices(u8, "http://localhost:8080", client.endpoint);
}
