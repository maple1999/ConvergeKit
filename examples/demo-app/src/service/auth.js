// Service layer — business logic. UI must go through this layer.
import { getUserByEmail } from "../db/client.js";

export function login(email, password) {
  const user = getUserByEmail(email.toLowerCase());
  if (!user || user.password !== password) {
    return { ok: false };
  }
  return { ok: true, name: user.name };
}
