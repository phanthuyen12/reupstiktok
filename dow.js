// youtubeDownloader.js
import ytdl from "@distube/ytdl-core";
import fetch from "node-fetch";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

// ====== Cấu hình ======
const ROOT = path.resolve();
const FFMPEG = path.join(ROOT, "ffmpeg.exe");
const FFPROBE = path.join(ROOT, "ffprobe.exe");
const ARIA2 = path.join(ROOT, "aria2c.exe");

const TEMP = path.join(ROOT, "temp");
const OUT = path.join(ROOT, "output");
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// Kiểm tra URL có tồn tại
export async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

// Lấy link download tốt nhất
export async function getDownloadLink(videoUrl) {
  try {
    const info = await ytdl.getInfo(videoUrl);

    // 1️⃣ Lọc các format combined
    const combinedFormats = info.formats
      .filter(f => f.hasVideo && f.hasAudio && f.height && f.height <= 720)
      .sort((a, b) => a.height - b.height);

    // 2️⃣ Check tất cả link combined song song
    const validLink = await Promise.any(
      combinedFormats.map(f =>
        checkUrl(f.url).then(ok => {
          if (ok) return f.url;
          throw new Error("Not working");
        })
      )
    ).catch(() => null);

    if (validLink) return { combined: validLink };

    // 3️⃣ Nếu không có combined, lấy fallback video + audio
    const videoOnly = info.formats.filter(f => f.hasVideo && !f.hasAudio && f.height <= 360);
    const audioOnly = info.formats.filter(f => f.hasAudio && !f.hasVideo);

    // Chạy check video + audio **song song hết mức** → stop khi tìm được
    const fallbackPromises = [];
    for (const v of videoOnly) {
      for (const a of audioOnly) {
        fallbackPromises.push(
          Promise.all([checkUrl(v.url), checkUrl(a.url)]).then(([vOk, aOk]) => {
            if (vOk && aOk) return { video: v.url, audio: a.url };
            return null;
          })
        );
      }
    }

    const fallbackResult = await Promise.any(fallbackPromises).catch(() => null);
    return fallbackResult;

  } catch (err) {
    throw new Error(err.message);
  }
}

// Download file với aria2c
// export async function downloadVideo(url, filename) {
//   const filepath = path.join(TEMP, filename);
//   const cmd = `"${ARIA2}" -x16 -s16 -k1M "${url}" -o "${filename}" --dir="${TEMP}" --allow-overwrite=true`;
//   await run(cmd);
//   return filepath;
// }
export async function downloadVideo(url, filename) {
  const filepath = path.join(TEMP, filename);

  // Chỉ 1 dòng, đúng syntax aria2c
  const cmd = `"${ARIA2}" -x16 -s16 -k1M --file-allocation=none --summary-interval=0 --dir="${TEMP}" --allow-overwrite=true -o "${filename}" "${url}"`;

  await run(cmd);
  return filepath;
}

// Lấy duration video
export async function getDuration(file) {
  const cmd = `"${FFPROBE}" -v error -show_entries format=duration -of csv=p=0 "${file}"`;
  const out = await run(cmd);
  return parseFloat(out);
}

// Ghép 65s (copy stream, không nén)
export async function make65sVideo(input, output) {
  const dur = await getDuration(input);
  if (dur >= 65) {
    fs.copyFileSync(input, output);
    return output;
  }

  const loops = Math.ceil(65 / dur);
  const listFile = path.join(TEMP, "list.txt");
  const lines = Array(loops).fill(`file '${input.replace(/\\/g, "/")}'`).join("\n");
  fs.writeFileSync(listFile, lines);

  const cmd = `"${FFMPEG}" -y -f concat -safe 0 -i "${listFile}" -t 65 -c copy "${output}"`;
  await run(cmd);
  return output;
}

// Download + merge 65s
export async function downloadAndMake65s(videoUrl) {
  const link = await getDownloadLink(videoUrl);
  let rawFile;

  if (link.combined) {
    rawFile = await downloadVideo(link.combined, "raw.mp4");
  } else if (link.video && link.audio) {
    const [videoFile, audioFile] = await Promise.all([
      downloadVideo(link.video, "video.mp4"),
      downloadVideo(link.audio, "audio.mp4")
    ]);

    rawFile = path.join(TEMP, "merged.mp4");
    await run(`"${FFMPEG}" -y -i "${videoFile}" -i "${audioFile}" -c copy "${rawFile}"`);
  }

  const finalFile = path.join(OUT, `video_65s_${Date.now()}.mp4`);
  await make65sVideo(rawFile, finalFile);
  return finalFile;
}
