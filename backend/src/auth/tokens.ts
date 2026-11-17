import { createHash, generateKeyPairSync, randomBytes, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

let privateKey: KeyObject;
let publicKey: KeyObject;

if (config.jwtPrivateKeyPem) {
  privateKey = createPrivateKey(config.jwtPrivateKeyPem);
  publicKey = createPublicKey(privateKey);
} else {
  // Solo desarrollo: los tokens de acceso dejan de valer al reiniciar; la app
  // los renueva con el token de renovación (que vive en la base).
  ({ privateKey, publicKey } = generateKeyPairSync("ed25519"));
}

export interface AccessClaims {
  sub: string;
  sid: string;
  cv: number;
  scope: "FULL" | "PASSWORD_CHANGE_ONLY";
}

export async function signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + config.accessTokenTtlSec * 1000);
  const token = await new SignJWT({ sid: claims.sid, cv: claims.cv, scope: claims.scope })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(privateKey);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ["EdDSA"] });
    if (typeof payload.sub !== "string" || typeof payload["sid"] !== "string") return null;
    return {
      sub: payload.sub,
      sid: payload["sid"] as string,
      cv: Number(payload["cv"]),
      scope: payload["scope"] === "FULL" ? "FULL" : "PASSWORD_CHANGE_ONLY",
    };
  } catch {
    return null;
  }
}

export const newRefreshToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
