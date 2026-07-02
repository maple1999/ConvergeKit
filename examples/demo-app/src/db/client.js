// DB layer — only the service layer may talk to this client.
const USERS = new Map([
  ["alice@example.com", { email: "alice@example.com", password: "wonderland", name: "Alice" }],
  ["bob@example.com", { email: "bob@example.com", password: "builder", name: "Bob" }],
]);

export function getUserByEmail(email) {
  return USERS.get(email) ?? null;
}
