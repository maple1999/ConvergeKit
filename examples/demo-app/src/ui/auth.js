// UI layer — renders login results. Must not access the DB layer directly.
import { login } from "../service/auth.js";

export function renderLogin(email, password) {
  const result = login(email, password);
  return result.ok ? `Welcome, ${result.name}!` : "Login failed.";
}
