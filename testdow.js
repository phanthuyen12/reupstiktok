const { getDownloadLink, downloadVideo, make65sVideo } = require("./dow.js");
const { performance } = require("perf_hooks");
const path = require("path");
const fs = require("fs");
const Genlogin = require("./Genlogin");
const puppeteer = require("puppeteer-core");

async function runDownload(videoUrl) {
    try {
        // ------------------------------
        // Mở profile & TikTok Studio (không tính thời gian này)
        // ------------------------------
        const gen = new Genlogin("");
        const profileId = "25141883";
        let wsEndpoint;

        for (let i = 0; i < 15; i++) {
            const profile = await gen.runProfile(profileId);
            wsEndpoint = profile.wsEndpoint;
            if (wsEndpoint) break;
            console.log(`⏳ Chờ profile ${profileId} chạy... retry ${i + 1}`);
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!wsEndpoint) throw new Error(`Profile ${profileId} chưa chạy`);

        const browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            ignoreHTTPSErrors: true,
            defaultViewport: null,
            args: ["--disable-gpu", "--disable-infobars", "--mute-audio", "--window-size=584,716"]
        });

        const pages = await browser.pages();
        const page = pages[0];
        await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", {
            waitUntil: "networkidle2"
        });
        const input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
        console.log(`[${new Date().toISOString()}] TikTok Studio sẵn sàng`);

        // ------------------------------
        // START TIMING QUY TRÌNH
        // ------------------------------
        const startAll = performance.now();

        // 1️⃣ Lấy link download
        const startLink = performance.now();
        console.log("⏳ Bắt đầu lấy link download...");
        const link = await getDownloadLink(videoUrl);
        const endLink = performance.now();
        console.log(`✅ Lấy link xong sau ${(endLink - startLink).toFixed(2)} ms`);

        let rawFile;

        // 2️⃣ Download / merge video
        const startDownload = performance.now();
        if (link.combined) {
            console.log("⏳ Download combined video...");
            rawFile = await downloadVideo(link.combined, path.join("temp", "raw.mp4"));
            console.log("✅ Download xong");
        } else if (link.video && link.audio) {
            console.log("⏳ Download video + audio...");
            const videoFile = await downloadVideo(link.video, path.join("temp", "video.mp4"));
            rawFile = path.join("temp", "merged.mp4");
            await make65sVideo(videoFile, rawFile);
            console.log("✅ Download & merge xong");
        }
        const endDownload = performance.now();
        console.log(`⏱ Thời gian download/merge: ${(endDownload - startDownload).toFixed(2)} ms`);

        // 3️⃣ Ghép video 65s
        const start65s = performance.now();
        console.log("⏳ Ghép video đủ 65s...");
        const finalFile = path.join("output", `video_65s_${Date.now()}.mp4`);
        await make65sVideo(rawFile, finalFile);
        const end65s = performance.now();
        console.log(`✅ Ghép 65s xong, thời gian: ${(end65s - start65s).toFixed(2)} ms`);

        // 4️⃣ Upload + click post
        const startUpload = performance.now();
        await input.uploadFile(finalFile);
        console.log("📤 Upload video xong");

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
        await page.waitForFunction(
            () => window.location.href.includes("tiktokstudio/content"),
            { timeout: 15000 }
        );
        success = true;
        console.log(`[${new Date().toISOString()}] ✅ Upload + Post thành công`);
    }
} catch (err) {
    console.log("❌ Upload thất bại hoặc nút Post chưa sẵn sàng", err);
}

        const endUpload = performance.now();
        console.log(`⏱ Thời gian upload + click post: ${(endUpload - startUpload).toFixed(2)} ms`);

        const endAll = performance.now();
        console.log(`🎉 Tổng thời gian download → merge → 65s → upload: ${(endAll - startAll).toFixed(2)} ms`);
        console.log("📁 File cuối cùng:", finalFile);

    } catch (err) {
        console.error("❌ Error:", err);
    }
}

// ví dụ dùng
const videoUrl = "https://www.youtube.com/watch?v=5iUH04sZTfM";
runDownload(videoUrl);
