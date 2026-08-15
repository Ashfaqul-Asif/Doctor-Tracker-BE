import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * argon2id — memory-hard, so it resists GPU cracking far better than bcrypt.
 * @node-rs/argon2 ships prebuilt binaries, so there is no node-gyp build step.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP baseline
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export function verifyPassword(digest: string, plain: string): Promise<boolean> {
  return verify(digest, plain, OPTIONS);
}

/**
 * A valid argon2id digest of a random value, used when a login names an unknown
 * email. Without it the "user not found" branch returns immediately while the
 * "wrong password" branch spends ~50ms hashing — a timing oracle that enumerates
 * registered accounts. Verifying against this keeps both branches equally slow.
 */
let dummyDigest: string | null = null;

export async function getDummyDigest(): Promise<string> {
  if (!dummyDigest) {
    dummyDigest = await hashPassword('not-a-real-password-' + Math.random().toString(36));
  }
  return dummyDigest;
}
