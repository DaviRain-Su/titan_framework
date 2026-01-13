// UTXO Local Storage for Privacy AMM CLI
// 本地 UTXO 存储管理

const std = @import("std");
const crypto = @import("crypto.zig");
const FieldElement = crypto.FieldElement;

/// UTXO 状态
pub const UtxoStatus = enum {
    /// 未花费
    unspent,
    /// 待确认 (已提交但未确认)
    pending,
    /// 已花费
    spent,
};

/// UTXO 记录
pub const Utxo = struct {
    /// Commitment 哈希
    commitment: FieldElement,
    /// 盲因子
    blinding: FieldElement,
    /// 金额 (最小单位)
    amount: u64,
    /// 资产符号
    asset: [8]u8,
    /// 资产 ID
    asset_id: FieldElement,
    /// Merkle 树索引 (-1 表示尚未插入)
    leaf_index: i64,
    /// 状态
    status: UtxoStatus,
    /// 创建时间戳
    created_at: i64,
    /// 花费时间戳 (如果已花费)
    spent_at: i64,
    /// 花费交易签名
    spent_tx: [88]u8,

    pub fn getAssetSymbol(self: *const Utxo) []const u8 {
        // 找到第一个零字节的位置
        var len: usize = 0;
        for (self.asset) |c| {
            if (c == 0) break;
            len += 1;
        }
        return self.asset[0..len];
    }

    pub fn setAssetSymbol(self: *Utxo, symbol: []const u8) void {
        @memset(&self.asset, 0);
        const copy_len = @min(symbol.len, 8);
        @memcpy(self.asset[0..copy_len], symbol[0..copy_len]);
    }
};

/// UTXO 存储
pub const UtxoStorage = struct {
    allocator: std.mem.Allocator,
    utxos: std.ArrayListUnmanaged(Utxo),
    /// 存储文件路径
    file_path: []const u8,
    /// 用户公钥
    owner_pubkey: FieldElement,

    const Self = @This();

    /// 初始化存储
    pub fn init(allocator: std.mem.Allocator, owner_pubkey: FieldElement) !Self {
        // 获取配置目录
        const home = std.posix.getenv("HOME") orelse "/tmp";
        const config_dir = try std.fmt.allocPrint(allocator, "{s}/.titan-privacy", .{home});
        defer allocator.free(config_dir);

        // 创建目录 (如果不存在)
        std.fs.makeDirAbsolute(config_dir) catch |err| {
            if (err != error.PathAlreadyExists) return err;
        };

        // 构建文件路径
        var pubkey_hex: [64]u8 = undefined;
        const pubkey_str = crypto.toHexString(owner_pubkey, &pubkey_hex);
        const file_path = try std.fmt.allocPrint(allocator, "{s}/utxos_{s}.dat", .{ config_dir, pubkey_str[0..16] });

        var storage = Self{
            .allocator = allocator,
            .utxos = .{},
            .file_path = file_path,
            .owner_pubkey = owner_pubkey,
        };

        // 加载现有数据
        storage.load() catch |err| {
            // 文件不存在是正常的
            if (err != error.FileNotFound) {
                std.debug.print("Warning: Failed to load UTXO storage: {}\n", .{err});
            }
        };

        return storage;
    }

    pub fn deinit(self: *Self) void {
        self.utxos.deinit(self.allocator);
        self.allocator.free(self.file_path);
    }

    /// 添加新 UTXO
    pub fn addUtxo(self: *Self, utxo: Utxo) !void {
        try self.utxos.append(self.allocator, utxo);
        try self.save();
    }

    /// 标记 UTXO 为已花费
    pub fn markSpent(self: *Self, commitment: FieldElement, tx_signature: []const u8) !void {
        for (self.utxos.items) |*utxo| {
            if (std.mem.eql(u8, &utxo.commitment, &commitment)) {
                utxo.status = .spent;
                utxo.spent_at = std.time.timestamp();
                @memset(&utxo.spent_tx, 0);
                const copy_len = @min(tx_signature.len, 88);
                @memcpy(utxo.spent_tx[0..copy_len], tx_signature[0..copy_len]);
                try self.save();
                return;
            }
        }
        return error.UtxoNotFound;
    }

    /// 获取特定资产的未花费 UTXO
    pub fn getUnspentByAsset(self: *Self, asset_symbol: []const u8, allocator: std.mem.Allocator) ![]Utxo {
        var result: std.ArrayListUnmanaged(Utxo) = .{};

        for (self.utxos.items) |utxo| {
            if (utxo.status == .unspent) {
                const utxo_asset = utxo.getAssetSymbol();
                if (std.mem.eql(u8, utxo_asset, asset_symbol)) {
                    try result.append(allocator, utxo);
                }
            }
        }

        return result.toOwnedSlice(allocator);
    }

    /// 获取所有未花费 UTXO
    pub fn getAllUnspent(self: *Self, allocator: std.mem.Allocator) ![]Utxo {
        var result: std.ArrayListUnmanaged(Utxo) = .{};

        for (self.utxos.items) |utxo| {
            if (utxo.status == .unspent) {
                try result.append(allocator, utxo);
            }
        }

        return result.toOwnedSlice(allocator);
    }

    /// 计算特定资产的余额
    pub fn getBalance(self: *Self, asset_symbol: []const u8) u64 {
        var total: u64 = 0;

        for (self.utxos.items) |utxo| {
            if (utxo.status == .unspent) {
                const utxo_asset = utxo.getAssetSymbol();
                if (std.mem.eql(u8, utxo_asset, asset_symbol)) {
                    total += utxo.amount;
                }
            }
        }

        return total;
    }

    /// 获取所有资产余额
    pub fn getAllBalances(self: *Self, allocator: std.mem.Allocator) ![]AssetBalance {
        var balances: std.StringHashMapUnmanaged(AssetBalance) = .{};
        defer balances.deinit(allocator);

        for (self.utxos.items) |utxo| {
            if (utxo.status == .unspent) {
                const asset = utxo.getAssetSymbol();
                const gop = balances.getOrPut(allocator, asset) catch continue;
                if (!gop.found_existing) {
                    gop.value_ptr.* = AssetBalance{
                        .symbol = undefined,
                        .amount = 0,
                        .utxo_count = 0,
                    };
                    @memset(&gop.value_ptr.symbol, 0);
                    @memcpy(gop.value_ptr.symbol[0..asset.len], asset);
                }
                gop.value_ptr.amount += utxo.amount;
                gop.value_ptr.utxo_count += 1;
            }
        }

        var result: std.ArrayListUnmanaged(AssetBalance) = .{};
        var iter = balances.valueIterator();
        while (iter.next()) |balance| {
            try result.append(allocator, balance.*);
        }

        return result.toOwnedSlice(allocator);
    }

    /// 选择 UTXO 以满足目标金额
    pub fn selectUtxos(
        self: *Self,
        asset_symbol: []const u8,
        target_amount: u64,
        allocator: std.mem.Allocator,
    ) !SelectionResult {
        // 获取该资产的所有未花费 UTXO
        const unspent = try self.getUnspentByAsset(asset_symbol, allocator);
        defer allocator.free(unspent);

        if (unspent.len == 0) {
            return error.InsufficientBalance;
        }

        // 简单的贪婪算法: 从大到小选择
        // TODO: 实现更优的 UTXO 选择算法

        // 按金额排序 (从大到小)
        std.mem.sort(Utxo, unspent, {}, struct {
            fn lessThan(_: void, a: Utxo, b: Utxo) bool {
                return a.amount > b.amount;
            }
        }.lessThan);

        var selected: std.ArrayListUnmanaged(Utxo) = .{};
        var total: u64 = 0;

        for (unspent) |utxo| {
            try selected.append(allocator, utxo);
            total += utxo.amount;

            if (total >= target_amount) {
                break;
            }
        }

        if (total < target_amount) {
            selected.deinit(allocator);
            return error.InsufficientBalance;
        }

        return SelectionResult{
            .utxos = try selected.toOwnedSlice(allocator),
            .total = total,
            .change = total - target_amount,
        };
    }

    /// 保存到文件
    fn save(self: *Self) !void {
        const file = try std.fs.createFileAbsolute(self.file_path, .{});
        defer file.close();

        // 构建数据缓冲区
        const utxo_size = @sizeOf(Utxo);
        const header_size = 8; // version (4) + count (4)
        const total_size = header_size + self.utxos.items.len * utxo_size;

        var buffer = try self.allocator.alloc(u8, total_size);
        defer self.allocator.free(buffer);

        var offset: usize = 0;

        // 写入版本
        std.mem.writeInt(u32, buffer[offset..][0..4], 1, .little);
        offset += 4;

        // 写入数量
        std.mem.writeInt(u32, buffer[offset..][0..4], @intCast(self.utxos.items.len), .little);
        offset += 4;

        // 写入每个 UTXO
        for (self.utxos.items) |utxo| {
            @memcpy(buffer[offset..][0..32], &utxo.commitment);
            offset += 32;
            @memcpy(buffer[offset..][0..32], &utxo.blinding);
            offset += 32;
            std.mem.writeInt(u64, buffer[offset..][0..8], utxo.amount, .little);
            offset += 8;
            @memcpy(buffer[offset..][0..8], &utxo.asset);
            offset += 8;
            @memcpy(buffer[offset..][0..32], &utxo.asset_id);
            offset += 32;
            std.mem.writeInt(i64, buffer[offset..][0..8], utxo.leaf_index, .little);
            offset += 8;
            buffer[offset] = @intFromEnum(utxo.status);
            offset += 1;
            std.mem.writeInt(i64, buffer[offset..][0..8], utxo.created_at, .little);
            offset += 8;
            std.mem.writeInt(i64, buffer[offset..][0..8], utxo.spent_at, .little);
            offset += 8;
            @memcpy(buffer[offset..][0..88], &utxo.spent_tx);
            offset += 88;
        }

        _ = try file.writeAll(buffer[0..offset]);
    }

    /// 从文件加载
    fn load(self: *Self) !void {
        const file = std.fs.openFileAbsolute(self.file_path, .{}) catch |err| {
            if (err == error.FileNotFound) return error.FileNotFound;
            return err;
        };
        defer file.close();

        // 读取整个文件
        const stat = try file.stat();
        if (stat.size < 8) {
            return error.InvalidData;
        }

        var buffer = try self.allocator.alloc(u8, stat.size);
        defer self.allocator.free(buffer);

        const bytes_read = try file.readAll(buffer);
        if (bytes_read < 8) {
            return error.InvalidData;
        }

        var offset: usize = 0;

        // 读取版本
        const version = std.mem.readInt(u32, buffer[offset..][0..4], .little);
        offset += 4;
        if (version != 1) {
            return error.UnsupportedVersion;
        }

        // 读取数量
        const count = std.mem.readInt(u32, buffer[offset..][0..4], .little);
        offset += 4;

        // 读取每个 UTXO
        self.utxos.clearRetainingCapacity();

        for (0..count) |_| {
            var utxo: Utxo = undefined;

            @memcpy(&utxo.commitment, buffer[offset..][0..32]);
            offset += 32;
            @memcpy(&utxo.blinding, buffer[offset..][0..32]);
            offset += 32;
            utxo.amount = std.mem.readInt(u64, buffer[offset..][0..8], .little);
            offset += 8;
            @memcpy(&utxo.asset, buffer[offset..][0..8]);
            offset += 8;
            @memcpy(&utxo.asset_id, buffer[offset..][0..32]);
            offset += 32;
            utxo.leaf_index = std.mem.readInt(i64, buffer[offset..][0..8], .little);
            offset += 8;
            utxo.status = @enumFromInt(buffer[offset]);
            offset += 1;
            utxo.created_at = std.mem.readInt(i64, buffer[offset..][0..8], .little);
            offset += 8;
            utxo.spent_at = std.mem.readInt(i64, buffer[offset..][0..8], .little);
            offset += 8;
            @memcpy(&utxo.spent_tx, buffer[offset..][0..88]);
            offset += 88;

            try self.utxos.append(self.allocator, utxo);
        }
    }
};

/// 资产余额
pub const AssetBalance = struct {
    symbol: [8]u8,
    amount: u64,
    utxo_count: u32,

    pub fn getSymbol(self: *const AssetBalance) []const u8 {
        var len: usize = 0;
        for (self.symbol) |c| {
            if (c == 0) break;
            len += 1;
        }
        return self.symbol[0..len];
    }
};

/// UTXO 选择结果
pub const SelectionResult = struct {
    utxos: []Utxo,
    total: u64,
    change: u64,
};

// ============================================================================
// Tests
// ============================================================================

test "storage: utxo asset symbol" {
    var utxo: Utxo = undefined;
    utxo.setAssetSymbol("SOL");

    try std.testing.expectEqualSlices(u8, "SOL", utxo.getAssetSymbol());
}

test "storage: utxo status enum" {
    try std.testing.expectEqual(@as(u8, 0), @intFromEnum(UtxoStatus.unspent));
    try std.testing.expectEqual(@as(u8, 1), @intFromEnum(UtxoStatus.pending));
    try std.testing.expectEqual(@as(u8, 2), @intFromEnum(UtxoStatus.spent));
}
