// ============================================================
//  БАЗОВЫЕ НАСТРОЙКИ И DOM
// ============================================================
const video = document.getElementById('videoPlayer');
const insertPlayer = document.getElementById('insertPlayer');
const overlay = document.getElementById('overlay');
const controls = document.getElementById('controls');
const player = document.getElementById('player');
const endMessage = document.getElementById('endMessage');
const timeline = document.getElementById('timeline');
const timelineProgress = document.getElementById('timelineProgress');
const timelineThumb = document.getElementById('timelineThumb');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const playPauseBtn = document.getElementById('playPauseBtn');
const volumeBtn = document.getElementById('volumeBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const choiceCountdownEl = document.getElementById('choiceCountdown');
const countdownNumberEl = document.getElementById('countdownNumber');
const countdownRingEl = document.getElementById('countdownRing');
const bufferingSpinner = document.getElementById('bufferingSpinner');

let currentScene = null;
let currentSceneId = null;
let isInsertPlaying = false;
let lastTime = 0;
let hideControlsTimeout = null;
let isDraggingTimeline = false;

const sceneChoiceState = {
    pauseAt: null, triggered: false, resolved: false,
    timeoutId: null, countdownId: null, timeoutAt: 0, timeoutDuration: 10
};

// Безопасный вызов play (глушит AbortError)
function safePlay(el) {
    if (!el) return;
    try {
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getActiveVideo() { return isInsertPlaying ? insertPlayer : video; }

// ============================================================
//  УПРАВЛЕНИЕ СЦЕНАМИ
// ============================================================
async function loadScene(sceneId) {
    try {
        resetChoiceState();
        const res = await fetch(`/api/scene/${sceneId}`);
        if (!res.ok) throw new Error('Сцена не найдена');
        const scene = await res.json();

        currentSceneId = scene.id;
        currentScene = scene;
        endMessage.classList.add('hidden');

        video.src = `/uploads/${scene.video}`;
        video.load();
        
        video.oncanplay = () => {
            video.oncanplay = null;
            safePlay(video);
        };

        buildChoiceAreas(scene);
        sceneChoiceState.pauseAt = scene.pause_at || null;
        sceneChoiceState.timeoutDuration = scene.choice_timeout || 10;

        lastTime = 0;
    } catch (err) {
        console.error(err);
    }
}

function buildChoiceAreas(scene) {
    overlay.innerHTML = '';
    if (!scene.choices) return;

    scene.choices.forEach(choice => {
        const area = choice.area;
        if (!area) return;
        const div = document.createElement('div');
        div.className = 'area';
        div.style.left = area.x + '%';
        div.style.top = area.y + '%';
        div.style.width = area.width + '%';
        div.style.height = area.height + '%';
        div.style.display = 'none';

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = choice.label || '';
        div.appendChild(label);

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sceneChoiceState.resolved) return;
            handleChoice(choice);
        });
        overlay.appendChild(div);
    });
}

function resetChoiceState() {
    if (sceneChoiceState.timeoutId) clearTimeout(sceneChoiceState.timeoutId);
    if (sceneChoiceState.countdownId) clearInterval(sceneChoiceState.countdownId);
    sceneChoiceState.pauseAt = null;
    sceneChoiceState.triggered = false;
    sceneChoiceState.resolved = false;
    choiceCountdownEl.classList.add('hidden');
}

function triggerChoicePause() {
    if (!currentScene || !currentScene.choices || sceneChoiceState.resolved) return;
    sceneChoiceState.triggered = true;

    video.pause();
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'flex');

    const timeout = sceneChoiceState.timeoutDuration;
    sceneChoiceState.timeoutAt = Date.now() + timeout * 1000;

    choiceCountdownEl.classList.remove('hidden');
    countdownNumberEl.textContent = timeout;
    const circumference = 2 * Math.PI * 19;
    countdownRingEl.style.strokeDasharray = circumference;
    countdownRingEl.style.strokeDashoffset = 0;

    sceneChoiceState.countdownId = setInterval(() => {
        const remaining = Math.max(0, (sceneChoiceState.timeoutAt - Date.now()) / 1000);
        countdownNumberEl.textContent = Math.ceil(remaining);
        countdownRingEl.style.strokeDashoffset = circumference * (1 - (remaining / timeout));
    }, 100);

    sceneChoiceState.timeoutId = setTimeout(() => {
        if (!sceneChoiceState.resolved) handleNoChoice();
    }, timeout * 1000);
}

// ============================================================
//  ОБРАБОТКА ВЫБОРА
// ============================================================
async function handleChoice(choice) {
    sceneChoiceState.resolved = true;
    if (sceneChoiceState.timeoutId) clearTimeout(sceneChoiceState.timeoutId);
    if (sceneChoiceState.countdownId) clearInterval(sceneChoiceState.countdownId);
    choiceCountdownEl.classList.add('hidden');
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');

    if (choice.after_choice && choice.after_choice.video) {
        await playInsert(choice.after_choice.video);
        await continueAfterInsert(choice.next || (currentScene && currentScene.next));
    } else if (choice.next) {
        await loadScene(choice.next);
    }
}

async function handleNoChoice() {
    if (sceneChoiceState.resolved) return;
    sceneChoiceState.resolved = true;
    if (sceneChoiceState.timeoutId) clearTimeout(sceneChoiceState.timeoutId);
    if (sceneChoiceState.countdownId) clearInterval(sceneChoiceState.countdownId);
    choiceCountdownEl.classList.add('hidden');
    overlay.querySelectorAll('.area').forEach(el => el.style.display = 'none');

    const nc = (currentScene && currentScene.no_choice) || {};
    if (nc.after_choice && nc.after_choice.video) {
        await playInsert(nc.after_choice.video);
        await continueAfterInsert(nc.next || (currentScene && currentScene.next));
    } else if (nc.next) {
        await loadScene(nc.next);
    }
}

// ============================================================
//  ВСТАВКИ И ПЕРЕХОДЫ
// ============================================================
function playInsert(videoFile) {
    return new Promise((resolve) => {
        if (!insertPlayer) { resolve(); return; }
        insertPlayer.src = `/uploads/${videoFile}`;
        insertPlayer.classList.add('active');
        insertPlayer.currentTime = 0;
        isInsertPlaying = true;
        video.pause();

        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            insertPlayer.classList.remove('active');
            insertPlayer.removeAttribute('src');
            insertPlayer.load();
            isInsertPlaying = false;
            resolve();
        };

        insertPlayer.addEventListener('ended', finish);
        insertPlayer.addEventListener('error', finish);
        safePlay(insertPlayer);
        
        setTimeout(() => { if (!resolved && insertPlayer.readyState < 2) finish(); }, 5000);
    });
}

async function continueAfterInsert(nextSceneId) {
    if (nextSceneId) {
        await loadScene(nextSceneId);
    } else {
        onSceneEnded();
    }
}

function onSceneEnded() {
    if (currentScene.next) {
        loadScene(currentScene.next);
    } else {
        endMessage.classList.remove('hidden');
    }
}

// ============================================================
//  ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
// ============================================================
function onActiveTimeUpdate() {
    const v = getActiveVideo();
    if (!v) return;
    const cur = v.currentTime;
    const dur = v.duration || 0;

    if (dur > 0) {
        const percent = (cur / dur) * 100;
        timelineProgress.style.width = percent + '%';
        timelineThumb.style.left = percent + '%';
    }
    currentTimeEl.textContent = formatTime(cur);

    if (!isInsertPlaying) {
        if (sceneChoiceState.pauseAt != null
            && !sceneChoiceState.triggered
            && !sceneChoiceState.resolved
            && lastTime < sceneChoiceState.pauseAt
            && cur >= sceneChoiceState.pauseAt) {
            triggerChoicePause();
        }
        lastTime = cur;
    }
}

function onActiveLoadedMetadata() {
    const v = getActiveVideo();
    if (v && durationEl) durationEl.textContent = formatTime(v.duration);
}

function onActivePlay() { playPauseBtn.classList.add('playing'); showControls(); }
function onActivePause() { playPauseBtn.classList.remove('playing'); showControls(); }
function showBuffering() { bufferingSpinner.classList.add('visible'); }
function hideBuffering() { bufferingSpinner.classList.remove('visible'); }

function bindVideoEvents(v) {
    if (!v) return;
    v.addEventListener('timeupdate', onActiveTimeUpdate);
    v.addEventListener('loadedmetadata', onActiveLoadedMetadata);
    v.addEventListener('play', onActivePlay);
    v.addEventListener('pause', onActivePause);
    v.addEventListener('waiting', showBuffering);
    v.addEventListener('playing', hideBuffering);
    v.addEventListener('canplay', hideBuffering);
}

bindVideoEvents(video);
bindVideoEvents(insertPlayer);

// ============================================================
//  ПАНЕЛЬ УПРАВЛЕНИЯ
// ============================================================
function showControls() {
    controls.classList.add('visible');
    clearTimeout(hideControlsTimeout);
    if (!getActiveVideo().paused) {
        hideControlsTimeout = setTimeout(() => controls.classList.remove('visible'), 3000);
    }
}

player.addEventListener('mousemove', showControls);
player.addEventListener('mouseleave', () => { if (!getActiveVideo().paused) controls.classList.remove('visible'); });

function togglePlay() {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    const v = getActiveVideo();
    if (v.paused) safePlay(v); else v.pause();
}
playPauseBtn.addEventListener('click', togglePlay);
video.addEventListener('click', togglePlay);

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) player.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
});

volumeSlider.addEventListener('input', (e) => {
    const v = getActiveVideo();
    v.volume = parseFloat(e.target.value);
    v.muted = v.volume === 0;
});

volumeBtn.addEventListener('click', () => {
    const v = getActiveVideo();
    v.muted = !v.muted;
    volumeBtn.className = v.muted ? 'ctrl-btn volume-mute' : (v.volume < 0.5 ? 'ctrl-btn volume-low' : 'ctrl-btn volume-high');
});

timeline.addEventListener('mousedown', (e) => {
    if (sceneChoiceState.triggered && !sceneChoiceState.resolved) return;
    isDraggingTimeline = true;
    const rect = timeline.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    getActiveVideo().currentTime = percent * getActiveVideo().duration;
});

document.addEventListener('mousemove', (e) => {
    if (!isDraggingTimeline) return;
    const rect = timeline.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    getActiveVideo().currentTime = percent * getActiveVideo().duration;
});

document.addEventListener('mouseup', () => isDraggingTimeline = false);

// ============================================================
//  СТАРТ
// ============================================================
const restartBtn = document.getElementById('restartBtn');
if (restartBtn) {
    restartBtn.addEventListener('click', () => loadScene('s1_request'));
}

(async () => {
    await loadScene('s1_request');
    if (video) video.addEventListener('ended', onSceneEnded);
})();
