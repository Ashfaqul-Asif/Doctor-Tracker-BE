import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // select:false so it never rides along on an accidental find().
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['admin'], default: 'admin', required: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;

export const User = model('User', userSchema);

/**
 * Derived from the model rather than written as HydratedDocument<UserAttrs>: the
 * schema's toJSON transform changes the hydrated document type, so the hand-written
 * form no longer matches what findOne() actually returns.
 */
export type UserDoc = InstanceType<typeof User>;
