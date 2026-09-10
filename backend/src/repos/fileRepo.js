import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");

/** JSON-file repository: persists users and kits on disk with atomic writes. */
export function createFileRepository({ dataDir = DATA_DIR } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const usersFile = join(dataDir, "users.json");
  const kitsFile = join(dataDir, "kits.json");

  ensureJson(usersFile, []);
  ensureJson(kitsFile, []);

  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  const write = (file, data) => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, file);
  };

  return {
    kind: "file",
    // ---- users ----
    async createUser({ email, passwordHash }) {
      const users = read(usersFile);
      if (users.some((u) => u.email === email)) {
        const err = new Error("User already exists");
        err.code = 11000;
        throw err;
      }
      const user = { _id: `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`, email, passwordHash, createdAt: new Date().toISOString() };
      users.push(user);
      write(usersFile, users);
      return user;
    },
    async findUserByEmail(email) {
      const users = read(usersFile);
      return users.find((u) => u.email === email) || null;
    },
    async findUserById(id) {
      const users = read(usersFile);
      return users.find((u) => u._id === id) || null;
    },

    // ---- kits ----
    async insertKit(kit) {
      const kits = read(kitsFile);
      kits.push(kit);
      write(kitsFile, kits);
      return kit;
    },
    async findKitById(id) {
      const kits = read(kitsFile);
      return kits.find((k) => k.id === id) || null;
    },
    async findKitsByUser(userId, { limit = 200 } = {}) {
      const kits = read(kitsFile)
        .filter((k) => k.userId === userId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit);
      return kits;
    },
    async findKitByHash(jdHash) {
      const kits = read(kitsFile);
      return kits.find((k) => k.input?.jdHash === jdHash) || null;
    },
    async updateKit(id, patch) {
      const kits = read(kitsFile);
      const idx = kits.findIndex((k) => k.id === id);
      if (idx < 0) return null;
      const updated = { ...kits[idx], ...patch, id, updatedAt: patch.updatedAt || new Date().toISOString() };
      kits[idx] = updated;
      write(kitsFile, kits);
      return updated;
    },
    async deleteKit(id) {
      const kits = read(kitsFile);
      const idx = kits.findIndex((k) => k.id === id);
      if (idx < 0) return false;
      kits.splice(idx, 1);
      write(kitsFile, kits);
      return true;
    },
    async countKits() {
      return read(kitsFile).length;
    },
    async findKitByCaseId(caseId) {
      const kits = read(kitsFile);
      return kits.find((k) => k.caseId === caseId) || null;
    },
  };
}

function ensureJson(file, seed) {
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(seed, null, 2), "utf8");
}

export function parseUserId(value) {
  return String(value || "").trim();
}