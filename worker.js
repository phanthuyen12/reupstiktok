// worker.js
const { Blob: NodeBlob, File: NodeFile } = require("buffer");

/**
 * Older Node.js releases (especially <=18) might not expose the WHATWG File API globally.
 * Some third-party libraries expect `global.File` to exist, so we provide a light polyfill.
 */
if (typeof global.File === "undefined") {
    if (typeof NodeFile !== "undefined") {
        global.File = NodeFile;
    } else if (typeof NodeBlob !== "undefined") {
        class NodeCompatibleFile extends NodeBlob {
            constructor(fileBits = [], fileName = "", options = {}) {
                super(fileBits, options);
                this.name = fileName;
                this.lastModified = options.lastModified ?? Date.now();
            }
        }
        global.File = NodeCompatibleFile;
    } else {
        class MinimalFilePolyfill {
            constructor(fileBits = [], fileName = "", options = {}) {
                this[Symbol.toStringTag] = "File";
                this.name = fileName;
                this.lastModified = options.lastModified ?? Date.now();
                this.size = fileBits.reduce((acc, chunk) => acc + Buffer.byteLength(chunk), 0);
                this.type = options.type ?? "";
                this._chunks = fileBits;
            }
            async arrayBuffer() {
                return Buffer.concat(this._chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).buffer;
            }
            stream() {
                const { Readable } = require("stream");
                return Readable.from(this._chunks);
            }
            text() {
                return Promise.resolve(Buffer.concat(this._chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString());
            }
            slice() {
                return new MinimalFilePolyfill([], this.name, { type: this.type });
            }
        }
        global.File = MinimalFilePolyfill;
    }
}

const { workerData, parentPort } = require("worker_threads");
const { google } = require("googleapis");
const puppeteer = require("puppeteer-core");
const { getDownloadLink, downloadVideo, make65sVideo, mergeVideoAudio } = require("./dow.js");
const path = require("path");
const fs = require("fs");
const Genlogin = require("./Genlogin.js");
const { performance } = require("perf_hooks");

const API_KEY = workerData.apiKey;
const CHANNEL_IDS = workerData.channels;
const PROFILE_ID = workerData.profileId;
// wsEndpoint sẽ được truyền từ main process khi start worker

const youtube = google.youtube({ version: "v3", auth: API_KEY });
const last_video_ids = new Set();
const startTime = new Date();
const pendingVideos = [];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        parentPort.postMessage(`[${PROFILE_ID}] 📡 Đang gọi YouTube API để lấy thông tin kênh ${channelId}...`);
        const ch = await youtube.channels.list({ part: "contentDetails", id: channelId });
        
        if (!ch.data.items.length) {
            parentPort.postMessage(`[${PROFILE_ID}] ⚠️ Không tìm thấy kênh YouTube: ${channelId}`);
            return [];
        }
        
        const uploadsId = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
        parentPort.postMessage(`[${PROFILE_ID}] 📡 Đang gọi YouTube API để lấy danh sách video từ playlist ${uploadsId}...`);
        const playlist = await youtube.playlistItems.list({ part: "snippet", playlistId: uploadsId, maxResults: 5 });
        
        parentPort.postMessage(`[${PROFILE_ID}] 📊 Tìm thấy ${playlist.data.items.length} video gần nhất trong playlist`);

        const newVideos = [];
        for (const item of playlist.data.items) {
            const vid = item.snippet.resourceId.videoId;
            const published = new Date(item.snippet.publishedAt);
            const publishedTime = published.toLocaleString('vi-VN');
            const startTimeStr = startTime.toLocaleString('vi-VN');
            
            parentPort.postMessage(`[${PROFILE_ID}] 📹 Video: "${item.snippet.title}" - Published: ${publishedTime} (Start time: ${startTimeStr})`);
            
            if (published > startTime && !last_video_ids.has(vid)) {
                last_video_ids.add(vid);
                newVideos.push({
                    id: vid,
                    title: item.snippet.title,
                    url: `https://www.youtube.com/watch?v=${vid}`,
                    channelId,
                });
                parentPort.postMessage(`[${PROFILE_ID}] ✅ Video mới được phát hiện: "${item.snippet.title}"`);
            } else if (last_video_ids.has(vid)) {
                parentPort.postMessage(`[${PROFILE_ID}] ⏭️ Video "${item.snippet.title}" đã được xử lý trước đó`);
            } else {
                parentPort.postMessage(`[${PROFILE_ID}] ⏭️ Video "${item.snippet.title}" được publish trước khi bắt đầu monitoring`);
            }
        }
        
        parentPort.postMessage(`[${PROFILE_ID}] 📊 Kết quả: ${newVideos.length} video mới cần xử lý`);
        return newVideos;
    } catch (err) {
        parentPort.postMessage(`❌ [${PROFILE_ID}] ERROR khi kiểm tra kênh ${channelId}: ${err.message}`);
        parentPort.postMessage(`❌ [${PROFILE_ID}] Stack trace: ${err.stack}`);
        return [];
    }
}

function enqueueVideos(channelId, videos, checkTime) {
    for (const video of videos) {
        pendingVideos.push(video);
        parentPort.postMessage(
            `[${PROFILE_ID}] 📥 [${checkTime}] Đã thêm video "${video.title}" từ kênh ${channelId} vào hàng chờ xử lý`
        );
    }
}

async function detectionLoop() {
    let checkCount = 0;
    while (true) {
        checkCount++;
        const cycleStart = performance.now();
        const checkTime = new Date().toLocaleTimeString('vi-VN');
        parentPort.postMessage(`[${PROFILE_ID}] 🔄 [${checkTime}] Đang kiểm tra kênh YouTube (lần ${checkCount})...`);

        const channelResults = await Promise.all(
            CHANNEL_IDS.map(async (chId) => {
                parentPort.postMessage(`[${PROFILE_ID}] 🔍 [${checkTime}] Đang kiểm tra kênh: ${chId}`);
                const videos = await checkChannel(chId);
                return { channelId: chId, videos };
            })
        );

        for (const { channelId, videos } of channelResults) {
            if (videos.length > 0) {
                parentPort.postMessage(
                    `[${PROFILE_ID}] 🎉 [${checkTime}] Tìm thấy ${videos.length} video mới từ kênh ${channelId}`
                );
                enqueueVideos(channelId, videos, checkTime);
            } else {
                parentPort.postMessage(`[${PROFILE_ID}] ℹ️ [${checkTime}] Không có video mới từ kênh ${channelId}`);
            }
        }

        const elapsed = performance.now() - cycleStart;
        const waitTime = Math.max(0, 1000 - elapsed);
        if (waitTime > 0) {
            await sleep(waitTime);
        }
    }
}

async function processQueue(page, initialInput) {
    let uploadInput = initialInput;
    while (true) {
        const job = pendingVideos.shift();
        if (!job) {
            await sleep(500);
            continue;
        }

        const v = job;
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
                if (!path.isAbsolute(rawFile)) {
                    rawFile = path.resolve(rawFile);
                }
                parentPort.postMessage(`[${PROFILE_ID}] ✅ Download combined xong`);
            } else if (link.video && link.audio) {
                const [videoFile, audioFile] = await Promise.all([
                    downloadVideo(link.video, "temp/video.mp4"),
                    downloadVideo(link.audio, "temp/audio.mp4"),
                ]);
                rawFile = path.resolve("temp", "merged.mp4");
                await mergeVideoAudio(videoFile, audioFile, rawFile);
                parentPort.postMessage(`[${PROFILE_ID}] ✅ Download video + audio & merge xong`);
            } else {
                throw new Error("Không lấy được link download hợp lệ");
            }
            const endDownload = performance.now();

            // 3️⃣ Ghép 65s
            const start65s = performance.now();
            const outputDir = path.resolve("output");
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const finalFile = path.resolve(outputDir, `video_65s_${Date.now()}.mp4`);
            await make65sVideo(rawFile, finalFile);
            const end65s = performance.now();
            parentPort.postMessage(`[${PROFILE_ID}] ✅ Ghép 65s xong sau ${(end65s - start65s).toFixed(2)} ms`);

            // 4️⃣ Upload video
            const startUpload = performance.now();
            if (!fs.existsSync(finalFile)) {
                throw new Error(`File không tồn tại: ${finalFile}`);
            }
            await uploadVideo(page, uploadInput, finalFile);
            const endUpload = performance.now();

            const endTotal = performance.now();
            const totalElapsed = ((endTotal - startTotal) / 1000).toFixed(2);
            const adjustedElapsed = (totalElapsed - 1).toFixed(2);
            parentPort.postMessage(`[${PROFILE_ID}] ✅ Upload xong: ${v.title} → ${finalFile}`);
            parentPort.postMessage(
                `[${PROFILE_ID}] ⏱ Tổng thời gian từ nhận → download → merge → 65s → upload (đã trừ redirect 1s): ${adjustedElapsed}s`
            );
            parentPort.postMessage(
                `[${PROFILE_ID}] Chi tiết thời gian: link ${(endLink - startLink).toFixed(2)}ms | download ${(endDownload - startDownload).toFixed(2)}ms | 65s ${(end65s - start65s).toFixed(2)}ms | upload ${(endUpload - startUpload).toFixed(2)}ms`
            );

            await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", { waitUntil: "networkidle2" });
            uploadInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        } catch (err) {
            parentPort.postMessage(`❌ [${PROFILE_ID}] Error: ${err.message}`);
        }
    }
}

// --- Upload video (theo testdow.js)
async function uploadVideo(page, input, filePath) {
    try {
        // Đảm bảo file path là absolute path
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
        
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File không tồn tại: ${absolutePath}`);
        }
        
        // Sử dụng uploadFile như testdow.js
        await input.uploadFile(absolutePath);
        parentPort.postMessage(`[${PROFILE_ID}] 📤 Upload video xong`);
    } catch (err) {
        parentPort.postMessage(`[${PROFILE_ID}] ❌ Lỗi khi upload file: ${err.message}`);
        throw err;
    }

    const btnSelector = 'button[data-e2e="post_video_button"]';
    let success = false;

    try {
        // Chờ nút xuất hiện và enabled
        const btn = await page.waitForFunction(
            selector => {
                const el = document.querySelector(selector);
                if (!el) return false;
                // check visible & enabled
                const style = window.getComputedStyle(el);
                const visible = style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
                const enabled = el.getAttribute('data-loading') === 'false' && el.getAttribute('aria-disabled') === 'false';
                return visible && enabled;
            },
            { polling: 500, timeout: 30000 },
            btnSelector
        );

        if (btn) {
            const el = await page.$(btnSelector);
            await el.evaluate(el => el.scrollIntoView({ block: "center" }));
            await el.click();

            // Chờ redirect sang content page
            const startRedirect = performance.now();
            await page.waitForFunction(
                () => window.location.href.includes("tiktokstudio/content"),
                { timeout: 15000 }
            );
            const endRedirect = performance.now();

            success = true;
            const redirectTime = ((endRedirect - startRedirect) / 1000).toFixed(2);
            parentPort.postMessage(`[${PROFILE_ID}] ✅ Upload + Post thành công`);
            parentPort.postMessage(`[${PROFILE_ID}] ⏱ Thời gian redirect sau click Post: ${redirectTime}s`);
        }
    } catch (err) {
        parentPort.postMessage(`[${PROFILE_ID}] ❌ Upload thất bại hoặc nút Post chưa sẵn sàng: ${err.message}`);
    }
}

// --- Main loop 24/7
async function main() {
    // Kiểm tra API key và channels
    if (!API_KEY) {
        parentPort.postMessage(`❌ [${PROFILE_ID}] ERROR: API Key không được cung cấp!`);
        return;
    }
    
    if (!CHANNEL_IDS || CHANNEL_IDS.length === 0) {
        parentPort.postMessage(`❌ [${PROFILE_ID}] ERROR: Không có kênh YouTube nào để theo dõi!`);
        return;
    }
    
    parentPort.postMessage(`[${PROFILE_ID}] 🔧 Cấu hình monitoring:`);
    parentPort.postMessage(`[${PROFILE_ID}]   - API Key: ${API_KEY.substring(0, 10)}...${API_KEY.substring(API_KEY.length - 5)}`);
    parentPort.postMessage(`[${PROFILE_ID}]   - Số kênh: ${CHANNEL_IDS.length}`);
    parentPort.postMessage(`[${PROFILE_ID}]   - Danh sách kênh: ${CHANNEL_IDS.join(', ')}`);
    
    // Lấy wsEndpoint từ workerData (được truyền từ main process)
    const wsEndpoint = workerData.wsEndpoint;
    if (!wsEndpoint) {
        parentPort.postMessage(`❌ [${PROFILE_ID}] ERROR: wsEndpoint không được cung cấp!`);
        return;
    }
    
    parentPort.postMessage(`[${PROFILE_ID}] 🔗 Đang kết nối với browser qua wsEndpoint...`);
    let { page, input } = await initBrowser(wsEndpoint);
    parentPort.postMessage(`[${PROFILE_ID}] ✅ Đã kết nối browser và sẵn sàng upload!`);

    parentPort.postMessage(`[${PROFILE_ID}] ✅ Đã khởi động monitoring. Đang theo dõi ${CHANNEL_IDS.length} kênh YouTube...`);
    parentPort.postMessage(`[${PROFILE_ID}] ⏰ Bắt đầu kiểm tra video mới từ ${new Date().toLocaleString('vi-VN')}...`);

    // Heartbeat log mỗi giây để hiển thị trạng thái monitoring
    const heartbeat = setInterval(() => {
        const now = new Date();
        parentPort.postMessage(
            `[${PROFILE_ID}] 💓 Monitoring vẫn đang chạy (${CHANNEL_IDS.length} kênh) - ${now.toLocaleTimeString('vi-VN')}`
        );
    }, 1000);

    const cleanup = () => clearInterval(heartbeat);
    process.on('exit', cleanup);
    parentPort.on('close', cleanup);
    
    detectionLoop().catch(err => {
        parentPort.postMessage(`❌ [${PROFILE_ID}] Detection loop lỗi: ${err.message}`);
    });

    await processQueue(page, input);
}

main();
