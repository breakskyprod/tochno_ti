const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздача статики
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Сценарий
const DATA_FILE = path.join(__dirname, 'data', 'scenario.json');

function loadScenario() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Получить список всех сцен
app.get('/api/scenes', (req, res) => {
    try {
        const data = loadScenario();
        res.json({ title: data.title, scenes: data.scenes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Получить одну сцену по id
app.get('/api/scene/:id', (req, res) => {
    try {
        const data = loadScenario();
        const scene = data.scenes.find(s => s.id === req.params.id);
        if (!scene) return res.status(404).json({ error: 'Сцена не найдена' });
        res.json(scene);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Плеер запущен на http://localhost:${PORT}`);
});
