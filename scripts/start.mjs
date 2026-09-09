/**
 * Starts all three processes and stops them together.
 *
 * There are three because the architecture has three. The render service is a
 * Node process that owns the PDF engine; the .NET API is an HTTP client of it;
 * the Angular app talks only to the API. Nothing here is orchestration you
 * would need in production — run each in its own terminal if you prefer, the
 * commands are in the README.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

const services = [
  {
    name: "render",
    colour: "\x1b[35m",
    command: "npm",
    args: ["start"],
    cwd: resolve(root, "render-service"),
    env: { BROADPAPER_TOKEN: "dev" }
  },
  {
    name: "api",
    colour: "\x1b[36m",
    command: "dotnet",
    args: ["run", "--project", "api/SampleApi.csproj", "--urls", "http://127.0.0.1:5170"],
    cwd: root,
    // The same token the render service is started with. In production this is
    // a secret in the API's configuration, not a literal in a start script.
    env: { BroadPaper__Token: "dev" }
  },
  {
    name: "web",
    colour: "\x1b[32m",
    command: "npm",
    args: ["start"],
    cwd: resolve(root, "web"),
    env: {}
  }
];

const children = [];
let stopping = false;

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    shell: windows,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const prefix = `${service.colour}[${service.name}]\x1b[0m`;
  const write = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) stream.write(`${prefix} ${line}\n`);
    }
  };
  child.stdout.on("data", write(process.stdout));
  child.stderr.on("data", write(process.stderr));

  child.on("exit", (code) => {
    if (stopping) return;
    console.log(`${prefix} exited with ${code}. Stopping the rest.`);
    stop();
  });

  children.push(child);
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // On Windows a shell-spawned child has its own process tree, and killing
    // the shell leaves the server holding its port — which is why the next run
    // says the address is already in use.
    if (windows && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log("\nStarting three processes. The app will be at http://localhost:4200 in a few seconds.\n");
