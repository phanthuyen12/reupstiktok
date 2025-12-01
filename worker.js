// worker.js
const { workerData, parentPort } = require("worker_threads");
const { google } = require("googleapis");
const puppeteer = require("puppeteer-core");
const { getDownloadLink, downloadVideo, make65sVideo, mergeVideoAudio } = require("./dow.js");
const path = require("path");
const Genlogin = require("./Genlogin.js");
const { performance } = require("perf_hooks");

const API_KEY = workerData.apiKey;
const CHANNEL_IDS = workerData.channels;
const PROFILE_ID = workerData.profileId;
// wsEndpoint sẽ được truyền từ main process khi start worker

const youtube = google.youtube({ version: "v3", auth: API_KEY });
const last_video_ids = new Set();
const startTime = new Date();

// --- Mở profile 1 lần (wsEndpoint được truyền từ main process)
async function initBrowser(wsEndpoint) {
    if (!wsEndpoint) {
        throw new Error("Profile chưa được mở trong Genlogin. Vui lòng mở profile trước khi bắt đầu theo dõi.");
    }

    const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    // Lần đầu vào trang upload
    const page = (await browser.pages())[0];
    await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", { waitUntil: "networkidle2" });
    let input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });

    return { browser, page, input };
}

// --- Check video mới trên kênh
async function checkChannel(channelId) {
    try {
        const ch = await youtube.channels.list({ part: "contentDetails", id: channelId });
        if (!ch.data.items.length) return [];
        const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
        const playlist = await youtube.playlistItems.list({ part: "snippet", playlistId: uploadsId, maxResults: 5 });

        const newVideos = [];
        for (const item of playlist.data.items) {
            const vid = item.snippet.resourceId.videoId;
            const published = new Date(item.snippet.publishedAt);
            if (published > startTime && !last_video_ids.has(vid)) {
                last_video_ids.add(vid);
                newVideos.push({
                    id: vid,
                    title: item.snippet.title,
                    url: `https://www.youtube.com/watch?v=${vid}`,
                    channelId,
                });
            }
        }
        return newVideos;
    } catch (err) {
        parentPort.postMessage(`❌ [${PROFILE_ID}] ERROR: ${err.message}`);
        return [];
    }
}

// --- Upload video
async function uploadVideo(page, input, filePath) {
    await input.uploadFile(filePath);

    const btnSelector = 'button[data-e2e="post_video_button"]';
    await page.waitForFunction(
        selector => {
            const el = document.querySelector(selector);
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            const enabled = el.getAttribute('data-loading') === 'false' && el.getAttribute('aria-disabled') === 'false';
            return visible && enabled;
        },
        { polling: 500, timeout: 30000 },
        btnSelector
    );

    const el = await page.$(btnSelector);
    await el.click();

    // Chờ redirect sang content page
    const startRedirect = performance.now();
    await page.waitForFunction(() => window.location.href.includes("tiktokstudio/content"), { timeout: 15000 });
    const endRedirect = performance.now();

    const redirectTime = ((endRedirect - startRedirect) / 1000).toFixed(2);
    parentPort.postMessage(`[${PROFILE_ID}] ⏱ Thời gian redirect sau click Post: ${redirectTime}s`);
}

// --- Main loop 24/7
async function main() {
    // Lấy wsEndpoint từ workerData (được truyền từ main process)
    const wsEndpoint = workerData.wsEndpoint;
    let { page, input } = await initBrowser(wsEndpoint);

    while (true) {
        for (const chId of CHANNEL_IDS) {
            const videos = await checkChannel(chId);

            for (const v of videos) {
                const startTotal = performance.now();
                try {
                    parentPort.postMessage(`[${PROFILE_ID}] 🎬 Nhận video: ${v.title} | ${v.url}`);

                    // 1️⃣ Lấy link download
                    const startLink = performance.now();
                    const link = await getDownloadLink(v.url);
                    const endLink = performance.now();
                    parentPort.postMessage(`[${PROFILE_ID}] ⏳ Lấy link xong sau ${(endLink - startLink).toFixed(2)} ms`);

                    // 2️⃣ Download / merge
                    const startDownload = performance.now();
                    let rawFile;
                    if (link.combined) {
                        rawFile = await downloadVideo(link.combined, "temp/raw.mp4");
                        parentPort.postMessage(`[${PROFILE_ID}] ✅ Download combined xong`);
                    } else if (link.video && link.audio) {
                        const [videoFile, audioFile] = await Promise.all([
                            downloadVideo(link.video, "temp/video.mp4"),
                            downloadVideo(link.audio, "temp/audio.mp4"),
                        ]);
                        rawFile = "temp/merged.mp4";
                        await mergeVideoAudio(videoFile, audioFile, rawFile);
                        parentPort.postMessage(`[${PROFILE_ID}] ✅ Download video + audio & merge xong`);
                    }
                    const endDownload = performance.now();

                    // 3️⃣ Ghép 65s
                    const start65s = performance.now();
                    const finalFile = path.join("output", `video_65s_${Date.now()}.mp4`);
                    await make65sVideo(rawFile, finalFile);
                    const end65s = performance.now();
                    parentPort.postMessage(`[${PROFILE_ID}] ✅ Ghép 65s xong sau ${(end65s - start65s).toFixed(2)} ms`);

                    // 4️⃣ Upload video
                    const startUpload = performance.now();
                    await uploadVideo(page, input, finalFile);
                    const endUpload = performance.now();

                    const endTotal = performance.now();
                    const totalElapsed = ((endTotal - startTotal) / 1000).toFixed(2);
                    const adjustedElapsed = (totalElapsed - 1).toFixed(2); // trừ ~1s redirect
                    parentPort.postMessage(`[${PROFILE_ID}] ✅ Upload xong: ${v.title} → ${finalFile}`);
                    parentPort.postMessage(`[${PROFILE_ID}] ⏱ Tổng thời gian từ nhận → download → merge → 65s → upload (đã trừ redirect 1s): ${adjustedElapsed}s`);
                    parentPort.postMessage(`[${PROFILE_ID}] Chi tiết thời gian: link ${(endLink - startLink).toFixed(2)}ms | download ${(endDownload - startDownload).toFixed(2)}ms | 65s ${(end65s - start65s).toFixed(2)}ms | upload ${(endUpload - startUpload).toFixed(2)}ms`);

                    // 🔁 Quay lại trang upload để nhận video tiếp theo
                    await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", { waitUntil: "networkidle2" });
                    input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });

                } catch (err) {
                    parentPort.postMessage(`❌ [${PROFILE_ID}] Error: ${err.message}`);
                }
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

main();
