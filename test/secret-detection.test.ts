import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSecretLike } from "../apps/api/src/autoConfirm.ts";

test("detects common secret formats and context-bound high entropy values", () => {
  assert.equal(detectSecretLike("github token", "ghp_123456789012345678901234567890"), true);
  assert.equal(detectSecretLike("Authorization", "Bearer abcdefghijklmnopqrstuvwxyz123456"), true);
  assert.equal(detectSecretLike("client_secret", "aB3$eF7!gH9@jK2#pQ4%rS6^"), true);
  assert.equal(detectSecretLike("record id", "aB3$eF7!gH9@jK2#pQ4%rS6^"), false);
  assert.equal(detectSecretLike("record id", "123456789012345678901234"), false);
});

test("detects PEM private keys but does not treat ordinary code as a secret", () => {
  assert.equal(detectSecretLike("config", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"), true);
  assert.equal(detectSecretLike("function", "const token = 'placeholder';"), false);
});
