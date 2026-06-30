/**
 * Session 加密/解密工具
 * 算法：AES-256-GCM（认证加密，防篡改）
 * 密钥来源：SESSION_ENCRYPTION_KEY 环境变量（32字节 hex）
 *
 * 用法：
 *   # 生成加密密钥（只需一次，保存到 .env）
 *   node scripts/encrypt-session.mjs --gen-key
 *
 *   # 加密 session 文件
 *   node scripts/encrypt-session.mjs --encrypt
 *
 *   # 解密 session 文件（验证）
 *   node scripts/encrypt-session.mjs --decrypt
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync }       from "node:fs";
import { resolve }                                       from "node:path";
import { fileURLToPath }                                  from "node:url";

const ROOT           = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SESSION_FILE   = resolve(ROOT, ".session/youtube-session.json");
const ENC_FILE       = resolve(ROOT, ".session/youtube-session.enc");
const ALGORITHM      = "aes-256-gcm";
const KEY_LEN        = 32; // 256 bits
const IV_LEN         = 12; // 96 bits (GCM standard)
const AUTH_TAG_LEN   = 16; // 128 bits

// ── Load encryption key from env ─────────────────────────────────────────
function getKey() {
  const keyHex = process.env.SESSION_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY 未设置\n" +
      "生成方法：node scripts/encrypt-session.mjs --gen-key"
    );
  }
  if (keyHex.length !== KEY_LEN * 2) {
    throw new Error(`SESSION_ENCRYPTION_KEY 长度应为 ${KEY_LEN * 2} 个 hex 字符`);
  }
  return Buffer.from(keyHex, "hex");
}

// ── Encrypt ───────────────────────────────────────────────────────────────
export function encryptSession(plaintext) {
  const key  = getKey();
  const iv   = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv (12) + authTag (16) + encrypted
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

// ── Decrypt ───────────────────────────────────────────────────────────────
export function decryptSession(encBase64) {
  const key  = getKey();
  const data = Buffer.from(encBase64, "base64");

  const iv       = data.subarray(0, IV_LEN);
  const authTag  = data.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const payload  = data.subarray(IV_LEN + AUTH_TAG_LEN);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(payload),
    decipher.final(),
  ]).toString("utf8");
}

// ── Load session (auto-detect encrypted vs plain) ─────────────────────────
export function loadSession(sessionFile) {
  // Prefer encrypted file
  if (existsSync(ENC_FILE)) {
    const keyHex = process.env.SESSION_ENCRYPTION_KEY;
    if (keyHex) {
      const encData = readFileSync(ENC_FILE, "utf8").trim();
      return JSON.parse(decryptSession(encData));
    }
  }
  // Fall back to plain JSON
  if (existsSync(SESSION_FILE)) {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  }
  return null;
}

// ── CLI ───────────────────────────────────────────────────────────────────
const arg = process.argv[2];

if (arg === "--gen-key") {
  const key = randomBytes(KEY_LEN).toString("hex");
  console.log("\n生成的加密密钥（添加到 .env）：");
  console.log(`SESSION_ENCRYPTION_KEY=${key}`);
  console.log("\n⚠  请妥善保管此密钥，丢失后 session 将无法解密");

} else if (arg === "--encrypt") {
  if (!existsSync(SESSION_FILE)) {
    console.error(`❌ Session 文件不存在：${SESSION_FILE}`);
    process.exit(1);
  }
  const plain  = readFileSync(SESSION_FILE, "utf8");
  const enc    = encryptSession(plain);
  writeFileSync(ENC_FILE, enc);
  console.log(`✅ Session 已加密：${ENC_FILE}`);
  console.log("   建议删除明文文件：rm .session/youtube-session.json");

} else if (arg === "--decrypt") {
  if (!existsSync(ENC_FILE)) {
    console.error(`❌ 加密文件不存在：${ENC_FILE}`);
    process.exit(1);
  }
  const enc   = readFileSync(ENC_FILE, "utf8").trim();
  const plain = decryptSession(enc);
  const data  = JSON.parse(plain);
  console.log("✅ 解密成功");
  console.log(`   账号：${data.email}`);
  console.log(`   创建时间：${data.createdAt}`);
  console.log(`   Cookie 数量：${data.cookies?.length}`);

} else {
  console.log("用法：");
  console.log("  node scripts/encrypt-session.mjs --gen-key    生成加密密钥");
  console.log("  node scripts/encrypt-session.mjs --encrypt    加密 session 文件");
  console.log("  node scripts/encrypt-session.mjs --decrypt    验证解密");
}
