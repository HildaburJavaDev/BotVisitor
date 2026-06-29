import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'bot.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function log(message) {
  ensureLogDir();

  const line = `[${new Date().toISOString()}] ${message}\n`;

  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.log(line.trim());
}

export function logError(message, error) {
  ensureLogDir();

  const line =
    `[${new Date().toISOString()}] ERROR: ${message}\n` +
    `${error?.stack ?? error}\n`;

  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.error(line);
}