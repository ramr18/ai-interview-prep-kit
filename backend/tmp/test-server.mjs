import { createServer } from "../src/server.js";
import { getRepository } from "../src/repos/repo.js";

process.env.LLM_PROVIDER = "mock";
process.env.REPOSITORY = "file";

const repo = await getRepository();
const app = await createServer();
app.locals.repo = repo;

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  console.log("server on", port);

  // health
  let r = await fetch(`${base}/api/health`);
  console.log("health:", r.status, await r.json());

  // register
  r = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "password123" }),
  });
  const reg = await r.json();
  console.log("register:", r.status, reg.user?.email);
  const cookie = r.headers.get("set-cookie");

  // create kit
  r = await fetch(`${base}/api/kits`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ jd: "Senior React engineer. Required: 5+ years React. Bonus: AWS.", companyUrl: "https://example.com", days: 3 }),
  });
  console.log("create kit:", r.status, await r.json());

  server.close();
  process.exit(0);
});
