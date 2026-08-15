import { Schema, model, Types, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens are persisted so they can be rotated and revoked. A stolen token
 * stops working the moment the legitimate one is used.
 *
 * Only a SHA-256 hash is stored — a database leak must not yield usable tokens.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    /** Rotation lineage. Reuse of any revoked member revokes the whole family. */
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ family: 1 });
// TTL: MongoDB removes expired tokens on its own, so the collection cannot grow
// without bound and no cleanup job is needed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenAttrs = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDoc = HydratedDocument<RefreshTokenAttrs>;

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
