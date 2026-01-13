/**
 * Convert snarkjs verification_key.json to Zig format
 * Outputs bytes in little-endian format for BN254 curve
 */

const fs = require('fs');
const path = require('path');

// Read verification key
const vkPath = path.join(__dirname, '../circuits/build/verification_key.json');
const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));

// Convert decimal string to 32-byte little-endian hex
function toLE32(decStr) {
    let bn = BigInt(decStr);
    const bytes = [];
    for (let i = 0; i < 32; i++) {
        bytes.push(Number(bn & 0xFFn));
        bn >>= 8n;
    }
    return bytes;
}

// Format as Zig byte array
function formatZigBytes(bytes, indent = '    ') {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 8) {
        const chunk = bytes.slice(i, i + 8).map(b => `0x${b.toString(16).padStart(2, '0')}`);
        lines.push(indent + chunk.join(', ') + ',');
    }
    return lines.join('\n');
}

// Convert G1 point (2 field elements) to 64 bytes
function g1ToBytes(point) {
    const x = toLE32(point[0]);
    const y = toLE32(point[1]);
    return [...x, ...y];
}

// Convert G2 point (2x2 field elements) to 128 bytes
function g2ToBytes(point) {
    // G2 has complex coordinates: each coordinate is a Fp2 element (2 field elements)
    // point[0] = [x_im, x_re], point[1] = [y_im, y_re]
    const x_im = toLE32(point[0][0]);
    const x_re = toLE32(point[0][1]);
    const y_im = toLE32(point[1][0]);
    const y_re = toLE32(point[1][1]);
    return [...x_im, ...x_re, ...y_im, ...y_re];
}

console.log('// Auto-generated from verification_key.json');
console.log('// Do not edit manually\n');
console.log('/// Number of public inputs');
console.log(`pub const N_PUBLIC: usize = ${vk.nPublic};\n`);

// VK_ALPHA (G1)
console.log('/// vk.alpha (G1 point, 64 bytes)');
console.log('pub const VK_ALPHA: [64]u8 = .{');
console.log(formatZigBytes(g1ToBytes(vk.vk_alpha_1)));
console.log('};\n');

// VK_BETA (G2)
console.log('/// vk.beta (G2 point, 128 bytes)');
console.log('pub const VK_BETA: [128]u8 = .{');
console.log(formatZigBytes(g2ToBytes(vk.vk_beta_2)));
console.log('};\n');

// VK_GAMMA (G2)
console.log('/// vk.gamma (G2 point, 128 bytes)');
console.log('pub const VK_GAMMA: [128]u8 = .{');
console.log(formatZigBytes(g2ToBytes(vk.vk_gamma_2)));
console.log('};\n');

// VK_DELTA (G2)
console.log('/// vk.delta (G2 point, 128 bytes)');
console.log('pub const VK_DELTA: [128]u8 = .{');
console.log(formatZigBytes(g2ToBytes(vk.vk_delta_2)));
console.log('};\n');

// IC points (G1 array)
console.log('/// IC points (G1 array, 9 points x 64 bytes)');
console.log(`pub const VK_IC: [${vk.IC.length}][64]u8 = .{`);
for (let i = 0; i < vk.IC.length; i++) {
    console.log('    .{');
    console.log(formatZigBytes(g1ToBytes(vk.IC[i]), '        '));
    console.log('    },');
}
console.log('};');
