import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = './data';
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const PARTICIPANTS_FILE = path.join(DATA_DIR, 'participants.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ATTENDANCE_FILE)) {
    fs.writeFileSync(ATTENDANCE_FILE, '{}', 'utf8');
  }

  if (!fs.existsSync(PARTICIPANTS_FILE)) {
    fs.writeFileSync(PARTICIPANTS_FILE, '[]', 'utf8');
  }
}

function readJson(filePath, fallback) {
  ensureDataDir();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');

    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Пишем через временный файл, потом rename.
// Это снижает шанс получить битый JSON, если процесс упадет во время записи.
function writeJsonAtomic(filePath, data) {
  ensureDataDir();

  const tempFile = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);

  fs.writeFileSync(tempFile, json, 'utf8');
  fs.renameSync(tempFile, filePath);
}

export function getParticipants() {
  return readJson(PARTICIPANTS_FILE, []);
}

export function saveParticipants(participants) {
  writeJsonAtomic(PARTICIPANTS_FILE, participants);
}

export function getAttendance() {
  return readJson(ATTENDANCE_FILE, {});
}

export function saveAttendance(attendance) {
  writeJsonAtomic(ATTENDANCE_FILE, attendance);
}

export function saveAnswer({ lessonDate, vkId, name, status, updatedAt }) {
  const attendance = getAttendance();

  if (!attendance[lessonDate]) {
    attendance[lessonDate] = {
      lessonDate,
      answers: {}
    };
  }

  attendance[lessonDate].answers[String(vkId)] = {
    vkId,
    name,
    status,
    updatedAt
  };

  saveAttendance(attendance);
}

export function getLessonAnswers(lessonDate) {
  const attendance = getAttendance();

  return Object.values(attendance[lessonDate]?.answers ?? {});
}