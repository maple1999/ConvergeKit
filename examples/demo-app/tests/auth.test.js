import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLogin } from "../src/ui/auth.js";

test("login succeeds with correct credentials", () => {
  assert.equal(renderLogin("alice@example.com", "wonderland"), "Welcome, Alice!");
});

test("login fails with wrong password", () => {
  assert.equal(renderLogin("alice@example.com", "nope"), "Login failed.");
});

test("login succeeds with uppercase email", () => {
  assert.equal(renderLogin("Alice@Example.com", "wonderland"), "Welcome, Alice!");
});
