// file: download.js
import { Innertube, UniversalCache, Utils, Parser } from 'youtubei.js';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import vm from 'node:vm';
import path from 'path';

// ---------------------- CUSTOM JS INTERPRETER ----------------------
// Youtubei.js cần bạn cung cấp interpreter để decipher signature URLs
const jsInterpreter = async (code, env) => {
  // YouTube cung cấp JS obfuscated => ta chạy trong vm để lấy n/sig
  // Đây là minimal example:
  return vm.runInNewContext(`
    ${code};
    export default function(n){ return n; }
  `, {}, { timeout: 1000 });
};

// ---------------------- INIT INNERTUBE ----------------------
const yt = await Innertube.create({
  cache: new UniversalCache(false),
  generate_session_locally: true,
  js_interpreter: jsInterpreter // cung cấp interpreter
});

// ---------------------- GET VIDEO INFO ----------------------
async function getVideo(videoId) {
  const info = await yt.actions.execute('/player', {
    videoId,
    client: 'WEB',  // 'WEB' hoặc 'YTMUSIC'
    parse: true
  });

  return info;
}

// ---------------------- DOWNLOAD VIDEO ----------------------
async function downloadVideo(videoId, outDir = './downloads') {
  const info = await getVideo(videoId);

  if (info.playability_status?.status !== 'OK') {
    console.error('Video không chơi được:', info.playability_status?.reason);
    return;
  }

  const videoDetails = info.video_details;
  console.log('Downloading video:', videoDetails.title);

  // Lấy format tốt nhất (video+audio)
  const formats = info.streaming_data?.adaptive_formats || [];
  const bestFormat = formats.find(f => f.mime_type?.includes('video/mp4')) || formats[0];

  if (!bestFormat) {
    console.error('Không tìm thấy format video hợp lệ!');
    return;
  }

  // Tạo thư mục
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const filePath = path.join(outDir, `${videoDetails.title.replace(/[\/\\?%*:|"<>]/g, '-')}.mp4`);
  const file = createWriteStream(filePath);

  // download
  const stream = await yt.download(videoId, {
    type: 'video',
    quality: 'best',
    format: 'mp4',
    client: 'WEB'
  });

  for await (const chunk of Utils.streamToIterable(stream)) {
    file.write(chunk);
  }

  file.close();
  console.log('Download completed:', filePath);
}

// ---------------------- RUN ----------------------
const VIDEO_ID = 'jLTOuvBTLxA'; // thay bằng video bạn muốn
await downloadVideo(VIDEO_ID);
