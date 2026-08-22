"use strict";
/* =========================================================================
   Обработка медиа через ffmpeg.

   Видео приводится к единому виду ВСЕГДА:
     • 1080p (короткая сторона 1080, длинная не больше 1920)
     • 30 кадров в секунду
     • не длиннее 20 секунд (лишнее обрезается)
     • H.264 high + AAC, moov в начале файла (+faststart)
     • плюс постер-кадр в webp
   ========================================================================= */

const crypto = require("crypto");
const { execFile } = require("child_process");
const fsp = require("fs/promises");
const path = require("path");

const config = require("./config");

function run(bin, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		execFile(
			bin,
			args,
			{ maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs || 15 * 60 * 1000 },
			(err, stdout, stderr) => {
				if (err) {
					const tail = String(stderr || err.message).split(/\r?\n/).slice(-6).join(" | ");
					reject(new Error(path.basename(bin) + ": " + tail));
					return;
				}
				resolve({ stdout: String(stdout), stderr: String(stderr) });
			},
		);
	});
}

function even(value) {
	const rounded = Math.round(value);
	return Math.max(2, rounded % 2 === 0 ? rounded : rounded - 1);
}

async function probe(file) {
	const { stdout } = await run(
		config.ffprobe,
		[
			"-v",
			"error",
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			file,
		],
		60000,
	);
	let info;
	try {
		info = JSON.parse(stdout);
	} catch (err) {
		throw new Error("Не удалось разобрать файл");
	}
	const streams = Array.isArray(info.streams) ? info.streams : [];
	const video = streams.find((s) => s.codec_type === "video");
	const audio = streams.find((s) => s.codec_type === "audio");
	if (!video) throw new Error("В файле нет видеодорожки");

	// Поворот из метаданных (видео с телефона часто снято боком)
	let rotation = 0;
	const sideData = Array.isArray(video.side_data_list) ? video.side_data_list : [];
	sideData.forEach((item) => {
		if (item && item.rotation !== undefined) rotation = Number(item.rotation) || 0;
	});
	if (!rotation && video.tags && video.tags.rotate) {
		rotation = Number(video.tags.rotate) || 0;
	}
	const swapped = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;

	const rawW = Number(video.width) || 0;
	const rawH = Number(video.height) || 0;
	const duration =
		Number(info.format && info.format.duration) ||
		Number(video.duration) ||
		0;

	return {
		width: swapped ? rawH : rawW,
		height: swapped ? rawW : rawH,
		duration,
		hasAudio: !!audio,
		codec: video.codec_name || "",
		bitrate: Number(info.format && info.format.bit_rate) || 0,
	};
}

// Короткая сторона → 1080, длинная → не больше 1920.
// Вертикаль 720×1280 → 1080×1920, 4K → 1080×1920, горизонталь 3840×2160 → 1920×1080.
function videoSize(width, height) {
	const limits = config.video;
	if (!width || !height) {
		return { width: limits.shortSide, height: limits.longSide };
	}
	const shortSide = Math.min(width, height);
	const longSide = Math.max(width, height);
	let factor = Math.min(limits.shortSide / shortSide, limits.longSide / longSide);
	if (!limits.upscale) factor = Math.min(1, factor);
	return { width: even(width * factor), height: even(height * factor) };
}

function shortId() {
	return crypto.randomBytes(4).toString("hex");
}

/* ------------------------------- Видео ------------------------------- */

async function transcodeVideo({ inputPath, workDir, keepAudio }) {
	const limits = config.video;
	const source = await probe(inputPath);
	const size = videoSize(source.width, source.height);
	const withAudio = !!keepAudio && source.hasAudio;

	const outFile = path.join(workDir, "video-" + shortId() + ".mp4");
	const posterFile = path.join(workDir, "poster-" + shortId() + ".webp");

	const filters = [
		"scale=" + size.width + ":" + size.height + ":flags=lanczos",
		"fps=" + limits.fps,
		"format=yuv420p",
	].join(",");

	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		inputPath,
		"-t",
		String(limits.maxSeconds),
		"-map_metadata",
		"-1",
		"-vf",
		filters,
		"-c:v",
		"libx264",
		"-profile:v",
		"high",
		"-level",
		"4.1",
		"-preset",
		limits.preset,
		"-crf",
		String(limits.crf),
		"-maxrate",
		limits.maxrateK + "k",
		"-bufsize",
		limits.maxrateK * 2 + "k",
		"-g",
		String(limits.fps * 2),
		"-keyint_min",
		String(limits.fps),
		"-sc_threshold",
		"0",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
	];

	if (withAudio) {
		args.push(
			"-c:a",
			"aac",
			"-b:a",
			limits.audioK + "k",
			"-ar",
			"48000",
			"-ac",
			"2",
		);
	} else {
		args.push("-an");
	}
	args.push(outFile);

	await run(config.ffmpeg, args);

	// Постер: кадр с начала ролика (не первый — он часто тёмный)
	const posterAt = Math.min(0.6, Math.max(0, (source.duration || 1) / 4));
	try {
		await run(
			config.ffmpeg,
			[
				"-y",
				"-hide_banner",
				"-loglevel",
				"error",
				"-ss",
				posterAt.toFixed(2),
				"-i",
				outFile,
				"-frames:v",
				"1",
				"-vf",
				"scale=" +
					even(size.width / 2) +
					":" +
					even(size.height / 2) +
					":flags=lanczos",
				"-c:v",
				"libwebp",
				"-quality",
				"72",
				posterFile,
			],
			120000,
		);
	} catch (err) {
		// без постера ролик всё равно работает
	}

	const outInfo = await probe(outFile);
	const stat = await fsp.stat(outFile);
	let posterBuffer = null;
	try {
		posterBuffer = await fsp.readFile(posterFile);
	} catch (err) {
		posterBuffer = null;
	}

	return {
		video: {
			buffer: await fsp.readFile(outFile),
			bytes: stat.size,
			contentType: "video/mp4",
			ext: "mp4",
		},
		poster: posterBuffer
			? { buffer: posterBuffer, contentType: "image/webp", ext: "webp" }
			: null,
		meta: {
			width: outInfo.width,
			height: outInfo.height,
			duration: Math.round((outInfo.duration || 0) * 10) / 10,
			fps: limits.fps,
			hasAudio: outInfo.hasAudio,
			sourceWidth: source.width,
			sourceHeight: source.height,
			sourceDuration: Math.round((source.duration || 0) * 10) / 10,
			trimmed: (source.duration || 0) > limits.maxSeconds + 0.2,
			label: Math.min(outInfo.width, outInfo.height) + "p",
		},
	};
}

/* -------------------------------- Фото -------------------------------- */

async function encodePhoto(inputPath, outPath, side, quality) {
	const filter =
		"scale=" +
		"'if(gt(iw,ih),min(" +
		side +
		",iw),-2)':'if(gt(iw,ih),-2,min(" +
		side +
		",ih))':flags=lanczos";
	await run(
		config.ffmpeg,
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			inputPath,
			"-map_metadata",
			"-1",
			"-frames:v",
			"1",
			"-vf",
			filter,
			"-c:v",
			"libwebp",
			"-quality",
			String(quality),
			"-compression_level",
			"6",
			outPath,
		],
		180000,
	);
}

async function transcodePhoto({ inputPath, workDir }) {
	const limits = config.photo;
	const mainFile = path.join(workDir, "photo-" + shortId() + ".webp");
	const thumbFile = path.join(workDir, "thumb-" + shortId() + ".webp");

	await encodePhoto(inputPath, mainFile, limits.mainSide, limits.mainQuality);
	await encodePhoto(inputPath, thumbFile, limits.thumbSide, limits.thumbQuality);

	const info = await probe(mainFile).catch(() => ({ width: 0, height: 0 }));
	const mainStat = await fsp.stat(mainFile);
	const thumbStat = await fsp.stat(thumbFile);

	return {
		main: {
			buffer: await fsp.readFile(mainFile),
			bytes: mainStat.size,
			contentType: "image/webp",
			ext: "webp",
		},
		thumb: {
			buffer: await fsp.readFile(thumbFile),
			bytes: thumbStat.size,
			contentType: "image/webp",
			ext: "webp",
		},
		meta: { width: info.width, height: info.height },
	};
}

module.exports = { probe, videoSize, transcodeVideo, transcodePhoto, shortId, run };
