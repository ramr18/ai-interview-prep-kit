/**
 * Local fixture "company site" used by the smoke test and sanity checks.
 * Exercises exactly the things the brief says a crawler must handle:
 * relative links, robots.txt, a buried hiring page, and a blog post about
 * how the company interviews (no hard-coded common path for it).
 */
import { createServer } from "node:http";

export const FIXTURE_HOST = "127.0.0.1";
let port = 0;

const ROBOTS = `User-agent: *
Allow: /
Disallow: /internal
`;

const HOME = `<html><head><title>Acme Products</title></head><body>
<h1>Acme Products</h1>
<p>Acme builds developer tools that teams use every day. Founded in 2016, we
ship a popular issue tracker and a continuous deployment platform. We value
ownership, craft and honest feedback.</p>
<nav>
  <a href="/about">About us</a>
  <a href="/careers">Careers</a>
  <a href="/blog/engineering/how-we-interview">Engineering blog</a>
  <a href="/internal/secret">internal</a>
</nav>
</body></html>`;

const ABOUT = `<html><head><title>About Acme</title></head><body>
<h1>About Acme Products</h1>
<p>Acme Products, Inc. is a 60-person software company. Our SaaS analytics
platform processes 2 billion events a day. We are remote-first, profitable
and product-led. Engineering is organised into small teams with on-call
rotations and a strong code-review culture.</p>
</body></html>`;

const CAREERS = `<html><head><title>Careers at Acme - how we hire</title></head><body>
<h1>Careers and hiring</h1>
<p>Our hiring process is deliberately simple:</p>
<ol>
  <li>A phone screen with the hiring manager (30 minutes).</li>
  <li>A take-home assignment, maximum 4 hours, on real product work.</li>
  <li>A system design round with two engineers.</li>
  <li>A behavioural round about working style, feedback and conflict.</li>
</ol>
<p>We never do whiteboard trivia. Please apply through our jobs page.</p>
</body></html>`;

const BLOG = `<html><head><title>How we interview engineers</title></head><body>
<h1>How we interview engineers</h1>
<p>We learned the hard way that whiteboard sessions do not predict who will
succeed at Acme. Today every technical candidate gets a take-home task
written by the team they would join, followed by a system design interview
and a behavioural interview about ownership and feedback.</p>
</body></html>`;

const ROUTES = new Map([
  ["/", { title: "Acme Products", body: HOME }],
  ["/about", { title: "About Acme", body: ABOUT }],
  ["/careers", { title: "Careers at Acme", body: CAREERS }],
  ["/blog/engineering/how-we-interview", { title: "How we interview", body: BLOG }],
]);

export function startFixtureSite({ host = FIXTURE_HOST, requestedPort = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(ROBOTS);
        return;
      }
      const path = (req.url || "/").split("?")[0];
      const route = ROUTES.get(path);
      if (!route) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (path === "/internal" || path.startsWith("/internal")) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(route.body);
    });
    server.listen(requestedPort, host, () => {
      port = server.address().port;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

export const getFixtureBase = () => `http://${FIXTURE_HOST}:${port}`;