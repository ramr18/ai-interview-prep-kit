import mongoose from "mongoose";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const kitSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, default: null },
    userId: { type: String, default: null, index: true },
    status: { type: String, default: "draft", index: true },
    createdAt: { type: Date },
    updatedAt: { type: Date },
    input: { type: Schema.Types.Mixed },
    company: { type: Schema.Types.Mixed },
    role: { type: Schema.Types.Mixed },
    questions: { type: [Schema.Types.Mixed], default: [] },
    flashcards: { type: [Schema.Types.Mixed], default: [] },
    schedule: { type: [Schema.Types.Mixed], default: [] },
    notes: { type: Schema.Types.Mixed },
    gaps: { type: [Schema.Types.Mixed], default: [] },
    valid: { type: Boolean, default: false },
    validationErrors: { type: [String], default: [] },
    sources: { type: [Schema.Types.Mixed], default: [] },
    schemaVersion: { type: String, default: "1.0.0" },
  },
  { versionKey: false, minimize: false, strict: false }
);

let User = null;
let Kit = null;

function models() {
  if (!User) User = mongoose.models.User || mongoose.model("User", userSchema);
  if (!Kit) Kit = mongoose.models.Kit || mongoose.model("Kit", kitSchema);
  return { User, Kit };
}

function toClient(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  if (obj._id && !obj.id) obj.id = String(obj._id);
  delete obj._id;
  delete obj.__v;
  return obj;
}

/** Mongo repository - canonical for the deployed app. */
export function createMongoRepository(uri) {
  let connecting = null;
  const connect = () => {
    if (mongoose.connectionState === 1) return Promise.resolve();
    if (!connecting) {
      connecting = mongoose
        .connect(uri, { serverSelectionTimeoutMS: 5000 })
        .catch((e) => {
          connecting = null;
          throw e;
        });
    }
    return connecting;
  };

  return {
    kind: "mongo",
    _connection: connect,

    async createUser({ email, passwordHash }) {
      await connect();
      const { User } = models();
      try {
        const doc = await User.create({ email, passwordHash });
        return toClient(doc);
      } catch (e) {
        if (e?.code === 11000) {
          const err = new Error("User already exists");
          err.code = 11000;
          throw err;
        }
        throw e;
      }
    },
    async findUserByEmail(email) {
      await connect();
      const { User } = models();
      return toClient(await User.findOne({ email }).lean());
    },
    async findUserById(id) {
      await connect();
      const { User } = models();
      return toClient(await User.findById(id).lean());
    },

    async insertKit(kit) {
      await connect();
      const { Kit } = models();
      const doc = await Kit.create(kit);
      return toClient(doc);
    },
    async findKitById(id) {
      await connect();
      const { Kit } = models();
      return toClient(await Kit.findOne({ id }).lean());
    },
    async findKitsByUser(userId, { limit = 200 } = {}) {
      await connect();
      const { Kit } = models();
      const docs = await Kit.find({ userId }).sort({ updatedAt: -1 }).limit(limit).lean();
      return docs.map(toClient);
    },
    async findKitByHash(jdHash) {
      await connect();
      const { Kit } = models();
      return toClient(await Kit.findOne({ "input.jdHash": jdHash }).lean());
    },
    async findKitByCaseId(caseId) {
      await connect();
      const { Kit } = models();
      return toClient(await Kit.findOne({ caseId }).lean());
    },
    async updateKit(id, patch) {
      await connect();
      const { Kit } = models();
      const doc = await Kit.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: patch.updatedAt || new Date() } },
        { new: true, lean: true }
      );
      return toClient(doc);
    },
    async deleteKit(id) {
      await connect();
      const { Kit } = models();
      const res = await Kit.deleteOne({ id });
      return res.deletedCount > 0;
    },
    async countKits() {
      await connect();
      const { Kit } = models();
      return Kit.countDocuments({});
    },
  };
}