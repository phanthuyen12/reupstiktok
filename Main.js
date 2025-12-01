// main.js
const fs = require("fs");
const { Worker } = require("worker_threads");

// Đọc và parse file profiles.txt (hỗ trợ CRLF và comment)
const raw = fs.readFileSync('./profiles.txt', 'utf8');
const lines = raw
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const PROFILES = [];

for (const line of lines) {
  // CHỖ SỬA: dùng "line" chứ không phải "lines"
  const parts = line.split('|').map(p => p.trim());

  if (parts.length < 3) {
    console.error('❌ Sai cấu trúc dòng (thiếu profileId|apiKey|channels):', line);
    continue;
  }

  const profileId = parts[0];
  const apiKey = parts[1];
  // nếu channels rỗng -> mảng rỗng
  const channels = parts[2] ? parts[2].split(',').map(c => c.trim()).filter(Boolean) : [];

  PROFILES.push({ profileId, apiKey, channels });
}

console.log("🚀 Multi-thread YouTube Detector Started...\n");
console.log(`📄 Loaded ${PROFILES.length} profiles from profiles.txt\n`);
console.log(PROFILES);

// Tạo worker cho mỗi profile (file worker.js phải nằm cùng thư mục)
for (const profile of PROFILES) {
  const worker = new Worker('./worker.js', { workerData: profile });

  worker.on('message', msg => console.log(msg));
  worker.on('error', err => console.error('❌ Worker error:', err));
  worker.on('exit', code => console.log(`⚠️ Worker for ${profile.profileId} exited with code ${code}`));
}
