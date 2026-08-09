/**
 * Dev launcher.
 *
 * `npm run dev` used to be `node server/index.js & vite --host`, which is a
 * Unix-ism — on Windows PowerShell `&` is a call operator, so the command
 * failed outright. This spawns both processes portably, prefixes their output
 * so you can tell them apart, and makes Ctrl-C shut both down cleanly.
 */
import { spawn } from 'child_process';
import process from 'process';

const isWindows = process.platform === 'win32';

const tasks = [
  // `process.execPath` is an absolute path that usually contains a space
  // ("C:\Program Files\nodejs\node.exe"). Spawning it through a shell would
  // split it at the space, so this one must NOT use a shell.
  { name: 'server', color: '\x1b[36m', command: process.execPath, args: ['server/index.js'], shell: false },
  // npx, by contrast, is a .cmd on Windows and can only be run via a shell.
  { name: 'client', color: '\x1b[35m', command: 'npx', args: ['vite', '--host'], shell: isWindows },
];

const RESET = '\x1b[0m';
const children = [];
let shuttingDown = false;

function prefix(name, color, stream, chunk) {
  const text = chunk.toString().replace(/\s+$/, '');
  if (!text) return;
  for (const line of text.split('\n')) {
    stream.write(`${color}[${name}]${RESET} ${line}\n`);
  }
}

for (const task of tasks) {
  const child = spawn(task.command, task.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: task.shell,
    env: process.env,
  });

  child.stdout.on('data', (c) => prefix(task.name, task.color, process.stdout, c));
  child.stderr.on('data', (c) => prefix(task.name, task.color, process.stderr, c));

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`${task.color}[${task.name}]${RESET} exited with code ${code}. Shutting down.`);
    shutdown(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(`${task.color}[${task.name}]${RESET} failed to start: ${err.message}`);
    shutdown(1);
  });

  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try { child.kill(); } catch { /* already gone */ }
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\nServer  → http://localhost:3000');
console.log('App     → http://localhost:5173');
console.log('Press Ctrl-C to stop both.\n');
