const express = require('express');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  НАСТРОЙКИ GITHUB RELEASES
//  Замените на ваши данные!
// ============================================================
const GITHUB_USER = 'breakskyprod'; // ваш ник на GitHub
const GITHUB_REPO = 'tochno_ti'; // имя репозитория
const GITHUB_TAG  = 'videos'; // тег, который вы создали в Releases

function getGithubUrl(filename) {
    return `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/${GITHUB_TAG}/${filename}`;
}

// ============================================================
//  РАЗДАЧА ФРОНТЕНДА И ПРОКСИ ДЛЯ ВИДЕО
// ============================================================
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Умный обработчик для видео
app.get('/uploads/:filename', async (req, res) => {
    const { filename } = req.params;
    const localPath = path.join(__dirname, 'uploads', filename);

    // 1. Если файл есть локально на сервере — отдаем его напрямую
    if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
    }

    // 2. Если локально нет — проксируем из GitHub Releases
    const githubUrl = getGithubUrl(filename);
    const headers = {};
    if (req.headers.range) {
        headers.Range = req.headers.range; // поддержка перемотки
    }

    try {
        const response = await fetch(githubUrl, { headers, redirect: 'follow' });

        if (!response.ok && response.status !== 206) {
            console.warn(`[proxy] ${filename} не найден на GitHub (статус ${response.status})`);
            return res.status(404).end();
        }

        // Ставим статус (200 или 206 для частичного контента)
        res.status(response.status);

        // 🔑 ГЛАВНОЕ: принудительно ставим видео-заголовки
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        // Пробрасываем длину и диапазон
        const contentLength = response.headers.get('content-length');
        if (contentLength) res.setHeader('Content-Length', contentLength);

        const contentRange = response.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);

        // Стримим видео
        if (response.body) {
            Readable.fromWeb(response.body).pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        console.error(`[proxy] Ошибка при загрузке ${filename}:`, err.message);
        res.status(500).end();
    }
});

// ============================================================
//  API ДЛЯ СЦЕНАРИЯ
// ============================================================
const DATA_FILE = path.join(__dirname, 'data', 'scenario.json');

app.get('/api/scene/:id', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const scene = data.scenes.find(s => s.id === req.params.id);
        if (!scene) return res.status(404).json({ error: 'Сцена не найдена' });
        res.json(scene);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 Прокси видео: github.com/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_TAG}`);
});
