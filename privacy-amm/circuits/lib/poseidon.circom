// Poseidon Hash - 从 circomlib 导入
// 用于计算 commitment 和 nullifier

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// 重新导出 Poseidon 模板以供本项目使用
// Poseidon(n) 接受 n 个输入，输出 1 个哈希值

// 使用示例:
// component hash = Poseidon(4);
// hash.inputs[0] <== amount;
// hash.inputs[1] <== asset_id;
// hash.inputs[2] <== pubkey;
// hash.inputs[3] <== blinding;
// commitment <== hash.out;
