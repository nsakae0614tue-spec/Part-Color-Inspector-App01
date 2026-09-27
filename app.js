/**
 * Vision Checker - App Core Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // App State
    let isFirstLoad = true;
    const state = {
        image: null,
        imageName: '',
        zoomLevel: 1.0,
        panOffset: { x: 0, y: 0 },
        isPanning: false,
        panStart: { x: 0, y: 0 },
        
        // 4 Inspection Points (Coordinates in Raw Image Space)
        points: [
            { id: 1, x: 100, y: 100, radius: 15, targetColor: '#a81a20', targetRgb: { r: 168, g: 26, b: 32 }, tolerance: 40, currentRgb: null, diff: null, status: 'idle', name: '赤 (左下)' },
            { id: 2, x: 200, y: 100, radius: 15, targetColor: '#0a7a3f', targetRgb: { r: 10, g: 122, b: 63 }, tolerance: 40, currentRgb: null, diff: null, status: 'idle', name: '緑 (左上)' },
            { id: 3, x: 100, y: 200, radius: 15, targetColor: '#095fa8', targetRgb: { r: 9, g: 95, b: 168 }, tolerance: 40, currentRgb: null, diff: null, status: 'idle', name: '青 (右上)' },
            { id: 4, x: 200, y: 200, radius: 15, targetColor: '#1c1c1c', targetRgb: { r: 28, g: 28, b: 28 }, tolerance: 40, currentRgb: null, diff: null, status: 'idle', name: '黒 (右側)' }
        ],
        
        draggingPoint: null,
        pipetteActivePoint: null,
        history: [],
        
        // Canvas Drag states
        isDraggingPoint: false,

        // Input Mode & Webカメラ関連の状態
        inputMode: 'image', // 'image' | 'camera'
        isCameraRunning: false,
        cameraStream: null,
        cameraAnimationId: null,
        isRealtimeInspect: true,
        selectedCameraId: '',

        // 合格音（ピンポンチャイム）関連の状態
        soundEnabled: true,
        previousTotalPass: false,
        lastChimeTimestamp: 0
    };

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const dropPlaceholder = document.getElementById('drop-placeholder');
    const canvas = document.getElementById('inspection-canvas');
    const ctx = canvas.getContext('2d');
    
    // Offscreen Canvas for Raw Image Pixel extraction
    const offscreenCanvas = document.createElement('canvas');
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

    // Magnifier Elements
    const magnifier = document.getElementById('pixel-magnifier');
    const magnifierCanvas = document.getElementById('magnifier-canvas');
    const magnifierCtx = magnifierCanvas.getContext('2d');
    const magnifierColorText = document.getElementById('magnifier-color-text');

    // Controls & Buttons
    const imageFileInput = document.getElementById('image-file-input');
    const selectImageBtn = document.getElementById('select-image-btn');
    const clearImageBtn = document.getElementById('clear-image-btn');
    const canvasControls = document.getElementById('canvas-controls');
    const zoomDisplay = document.getElementById('zoom-display');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('zoom-reset-btn');

    // Camera & Mode Elements
    const modeImageTab = document.getElementById('mode-image-tab');
    const modeCameraTab = document.getElementById('mode-camera-tab');
    const cameraControls = document.getElementById('camera-controls');
    const cameraSelect = document.getElementById('camera-select');
    const toggleCameraBtn = document.getElementById('toggle-camera-btn');
    const realtimeInspectToggle = document.getElementById('realtime-inspect-toggle');
    const soundEnabledToggle = document.getElementById('sound-enabled-toggle');
    const captureFrameBtn = document.getElementById('capture-frame-btn');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const startCameraPlaceholderBtn = document.getElementById('start-camera-placeholder-btn');
    const webcamVideo = document.getElementById('webcam-video');
    
    const triggerInspectionBtn = document.getElementById('trigger-inspection-btn');
    const totalJudgementCard = document.getElementById('total-judgement-card');
    const totalJudgementValue = document.getElementById('total-judgement-value');
    const passPointsCount = document.getElementById('pass-points-count');
    
    const recipeSelect = document.getElementById('recipe-select');
    const saveRecipeBtn = document.getElementById('save-recipe-btn');
    const exportRecipeBtn = document.getElementById('export-recipe-btn');
    const importRecipeBtn = document.getElementById('import-recipe-btn');
    const recipeFileInput = document.getElementById('recipe-file-input');
    
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const historyLogBody = document.getElementById('history-log-body');
    const toast = document.getElementById('toast');

    // Magnifier Canvas Setup (constant size)
    magnifierCanvas.width = 120;
    magnifierCanvas.height = 120;

    // Accordion Toggle Logic
    document.querySelectorAll('.accordion-toggle').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            
            const container = header.closest('.point-item');
            container.classList.toggle('expanded');
        });
    });

    // Expand the first point by default
    const firstPoint = document.getElementById('point-1-container');
    if (firstPoint) firstPoint.classList.add('expanded');

    // Save/Restore Last Session Helpers
    function saveLastSession() {
        localStorage.setItem('vision_checker_last_session', JSON.stringify(getRecipeData()));
    }

    function applyLastSession(savedData) {
        if (!savedData || !Array.isArray(savedData)) return;

        savedData.forEach(savedPt => {
            const currentPt = state.points.find(p => p.id === savedPt.id);
            if (currentPt) {
                currentPt.x = savedPt.x;
                currentPt.y = savedPt.y;
                currentPt.radius = savedPt.radius;
                currentPt.targetColor = savedPt.targetColor;
                currentPt.targetRgb = savedPt.targetRgb;
                currentPt.tolerance = savedPt.tolerance;
                if (savedPt.name) currentPt.name = savedPt.name;

                // Sync with UI
                document.getElementById(`p${savedPt.id}-color-input`).value = savedPt.targetColor;
                document.getElementById(`p${savedPt.id}-target-preview`).style.backgroundColor = savedPt.targetColor;
                document.getElementById(`p${savedPt.id}-tolerance`).value = savedPt.tolerance;
                document.getElementById(`p${savedPt.id}-tolerance-val`).textContent = savedPt.tolerance;
                
                const labelEl = document.querySelector(`#point-${savedPt.id}-container .point-name`);
                if (labelEl) labelEl.textContent = currentPt.name;

                updateCoordinateInputs(currentPt);
            }
        });
    }

    // Load saved settings & history
    loadHistoryFromStorage();
    loadRecipesList();
    
    // Restore last session if available, otherwise default to default recipe
    const lastSession = localStorage.getItem('vision_checker_last_session');
    if (lastSession) {
        try {
            applyLastSession(JSON.parse(lastSession));
            isFirstLoad = false;
        } catch (e) {
            console.error("Failed to restore last session, loading default", e);
            applyRecipe('default');
        }
    } else {
        applyRecipe('default');
    }

    /* ==========================================================================
       1. Image Loader & Canvas Management
       ========================================================================== */
    
    // Click to upload
    selectImageBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleFileSelect);

    // Drag & Drop events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            if (state.inputMode === 'camera') {
                switchInputMode('image');
            }
            loadImage(e.dataTransfer.files[0]);
        }
    });

    function handleFileSelect(e) {
        if (e.target.files.length > 0) {
            loadImage(e.target.files[0]);
        }
    }

    function loadImage(file) {
        if (!file.type.startsWith('image/')) {
            showToast('画像ファイルを選択してください。', 'error');
            return;
        }

        state.imageName = file.name;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                state.image = img;
                
                // Initialize Offscreen Canvas with raw image size
                offscreenCanvas.width = img.naturalWidth;
                offscreenCanvas.height = img.naturalHeight;
                offscreenCtx.drawImage(img, 0, 0);

                // Setup display Canvas sizes
                resizeCanvas();
                resetZoomAndPan();
                
                // Show Canvas & controls, hide placeholder
                canvas.style.display = 'block';
                dropPlaceholder.style.display = 'none';
                canvasControls.style.display = 'flex';
                triggerInspectionBtn.disabled = false;

                // Adjust inspection points based on ratios if default recipe is active and it's the first image load.
                // Otherwise, keep the current positions (allowing testing consecutive images with the same setup).
                if (recipeSelect.value === 'default' && isFirstLoad) {
                    applyDefaultDeviceCoordinates(img.naturalWidth, img.naturalHeight);
                    isFirstLoad = false;
                } else {
                    adjustPointsToImageBoundary();
                }

                // Trigger initial rendering & inspection
                draw();
                inspectAllPoints(false); // Silent initial check
                showToast('画像を読み込みました。', 'success');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    function resizeCanvas() {
        if (!state.image) return;
        
        // Set rendering size to match layout container size
        const containerRect = dropZone.getBoundingClientRect();
        canvas.width = containerRect.width;
        canvas.height = containerRect.height;
    }

    // Window resize handler
    window.addEventListener('resize', () => {
        if (state.image) {
            resizeCanvas();
            draw();
        }
    });

    function clearImage() {
        state.image = null;
        state.imageName = '';
        canvas.style.display = 'none';
        if (state.inputMode === 'image') {
            dropPlaceholder.style.display = 'flex';
        }
        canvasControls.style.display = 'none';
        triggerInspectionBtn.disabled = true;
        
        // Reset point states
        state.points.forEach(p => {
            p.currentRgb = null;
            p.diff = null;
            p.status = 'idle';
        });
        updatePointsUI();
        resetTotalJudgementUI();
        
        imageFileInput.value = '';
        showToast('画像を解除しました。', 'info');
    }

    clearImageBtn.addEventListener('click', clearImage);

    /* ==========================================================================
       Camera Mode & Streaming Control
       ========================================================================== */

    // Tab click handlers
    modeImageTab.addEventListener('click', () => switchInputMode('image'));
    modeCameraTab.addEventListener('click', () => switchInputMode('camera'));

    function switchInputMode(mode) {
        if (state.inputMode === mode) return;
        state.inputMode = mode;

        if (mode === 'image') {
            modeImageTab.classList.add('active');
            modeCameraTab.classList.remove('active');
            
            // Stop camera if running
            stopCamera();
            cameraControls.style.display = 'none';
            cameraPlaceholder.style.display = 'none';

            if (state.image && !(state.image instanceof HTMLCanvasElement)) {
                canvas.style.display = 'block';
                canvasControls.style.display = 'flex';
                dropPlaceholder.style.display = 'none';
                triggerInspectionBtn.disabled = false;
                resizeCanvas();
                draw();
            } else {
                state.image = null;
                canvas.style.display = 'none';
                canvasControls.style.display = 'none';
                dropPlaceholder.style.display = 'flex';
                triggerInspectionBtn.disabled = true;
                resetTotalJudgementUI();
            }
        } else {
            modeImageTab.classList.remove('active');
            modeCameraTab.classList.add('active');

            // Hide image controls & placeholder
            canvasControls.style.display = 'none';
            dropPlaceholder.style.display = 'none';
            cameraControls.style.display = 'flex';

            // Enumerate cameras
            enumerateCameras();

            if (state.isCameraRunning) {
                canvas.style.display = 'block';
                cameraPlaceholder.style.display = 'none';
            } else {
                canvas.style.display = 'none';
                cameraPlaceholder.style.display = 'flex';
                triggerInspectionBtn.disabled = true;
            }
        }
        lucide.createIcons();
    }

    async function enumerateCameras() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return;
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            
            cameraSelect.innerHTML = '';
            if (videoDevices.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'カメラが見つかりません';
                cameraSelect.appendChild(opt);
                return;
            }

            videoDevices.forEach((dev, idx) => {
                const opt = document.createElement('option');
                opt.value = dev.deviceId;
                opt.textContent = dev.label || `カメラ ${idx + 1}`;
                cameraSelect.appendChild(opt);
            });

            if (state.selectedCameraId) {
                cameraSelect.value = state.selectedCameraId;
            } else if (videoDevices.length > 0) {
                state.selectedCameraId = videoDevices[0].deviceId;
            }
        } catch (err) {
            console.error("Failed to enumerate devices:", err);
        }
    }

    cameraSelect.addEventListener('change', (e) => {
        state.selectedCameraId = e.target.value;
        if (state.isCameraRunning) {
            startCamera();
        }
    });

    toggleCameraBtn.addEventListener('click', () => {
        if (state.isCameraRunning) {
            stopCamera();
        } else {
            startCamera();
        }
    });

    startCameraPlaceholderBtn.addEventListener('click', () => {
        startCamera();
    });

    async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('お使いのブラウザはWebカメラ機能に対応していません。', 'error');
            return;
        }

        // ユーザー操作イベント内でAudioContextをアンロック
        getAudioContext();

        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(t => t.stop());
            state.cameraStream = null;
        }

        const constraints = {
            video: state.selectedCameraId ? 
                { deviceId: { exact: state.selectedCameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } } :
                { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        };

        try {
            showToast('カメラを起動中...', 'info');
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.cameraStream = stream;
            webcamVideo.srcObject = stream;

            webcamVideo.onloadedmetadata = () => {
                webcamVideo.play();
                state.isCameraRunning = true;

                offscreenCanvas.width = webcamVideo.videoWidth || 1280;
                offscreenCanvas.height = webcamVideo.videoHeight || 720;

                if (isFirstLoad) {
                    applyDefaultDeviceCoordinates(offscreenCanvas.width, offscreenCanvas.height);
                    isFirstLoad = false;
                } else {
                    adjustPointsToImageBoundary();
                }

                cameraPlaceholder.style.display = 'none';
                canvas.style.display = 'block';
                triggerInspectionBtn.disabled = false;
                captureFrameBtn.disabled = false;

                toggleCameraBtn.innerHTML = '<i data-lucide="video-off"></i> カメラ停止';
                toggleCameraBtn.classList.remove('btn-primary');
                toggleCameraBtn.classList.add('btn-danger');

                resizeCanvas();
                resetZoomAndPan();
                lucide.createIcons();

                showToast('カメラ映像を開始しました。', 'success');

                if (state.cameraAnimationId) cancelAnimationFrame(state.cameraAnimationId);
                cameraRenderLoop();

                // Re-enumerate to get labeled camera names after permission granted
                enumerateCameras();
            };
        } catch (err) {
            console.error("Error starting camera:", err);
            showToast('カメラへのアクセスが拒否されたか、起動に失敗しました。', 'error');
            stopCamera();
        }
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(t => t.stop());
            state.cameraStream = null;
        }
        if (state.cameraAnimationId) {
            cancelAnimationFrame(state.cameraAnimationId);
            state.cameraAnimationId = null;
        }

        state.isCameraRunning = false;
        captureFrameBtn.disabled = true;

        toggleCameraBtn.innerHTML = '<i data-lucide="video"></i> カメラ起動';
        toggleCameraBtn.classList.remove('btn-danger');
        toggleCameraBtn.classList.add('btn-primary');

        if (state.inputMode === 'camera') {
            canvas.style.display = 'none';
            cameraPlaceholder.style.display = 'flex';
            triggerInspectionBtn.disabled = true;
            resetTotalJudgementUI();
        }
        lucide.createIcons();
    }

    function cameraRenderLoop() {
        if (!state.isCameraRunning || state.inputMode !== 'camera') return;

        if (webcamVideo.readyState >= 2) {
            offscreenCanvas.width = webcamVideo.videoWidth;
            offscreenCanvas.height = webcamVideo.videoHeight;
            offscreenCtx.drawImage(webcamVideo, 0, 0);

            state.image = offscreenCanvas;
            state.imageName = 'リアルタイムカメラ';

            draw();

            if (state.isRealtimeInspect && !state.isDraggingPoint) {
                inspectAllPoints(false);
            }
        }

        state.cameraAnimationId = requestAnimationFrame(cameraRenderLoop);
    }

    realtimeInspectToggle.addEventListener('change', (e) => {
        state.isRealtimeInspect = e.target.checked;
        if (!state.isRealtimeInspect) {
            showToast('リアルタイム判定を一時停止しました。', 'info');
        } else {
            showToast('リアルタイム判定を再開しました。', 'info');
        }
    });

    captureFrameBtn.addEventListener('click', () => {
        if (!state.isCameraRunning) return;
        state.imageName = 'カメラ撮影_' + new Date().toLocaleTimeString('ja-JP').replace(/:/g, '');
        inspectAllPoints(true);
        showToast('カメラフレームの判定を実行し、履歴に記録しました。', 'success');
    });

    /* ==========================================================================
       Sound Notifications (Web Audio API Synthesizer)
       ========================================================================== */
    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // 「ピンポン♪」チャイム合成音（A5: 880Hz → F5: 698.46Hz）
    function playChimeSound() {
        if (!state.soundEnabled) return;
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;

        // 1音目: 「ピン」（高音: A5 880Hz）
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);

        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.3, now + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.55);

        // 2音目: 「ポン」（長3度下: F5 698.46Hz）
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(698.46, now + 0.24);

        gain2.gain.setValueAtTime(0, now + 0.24);
        gain2.gain.linearRampToValueAtTime(0.3, now + 0.255);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc2.start(now + 0.24);
        osc2.stop(now + 1.1);
    }

    soundEnabledToggle.addEventListener('change', (e) => {
        state.soundEnabled = e.target.checked;
        if (state.soundEnabled) {
            getAudioContext();
            playChimeSound(); // 確認用プレビュー
            showToast('ピンポン音通知を有効にしました。', 'info');
        } else {
            showToast('ピンポン音通知を無効にしました。', 'info');
        }
    });

    /* ==========================================================================
       2. Zoom & Pan Control
       ========================================================================== */
    function resetZoomAndPan() {
        if (!state.image) return;

        // Calculate fit-to-screen scale
        const scaleX = canvas.width / state.image.naturalWidth;
        const scaleY = canvas.height / state.image.naturalHeight;
        state.zoomLevel = Math.min(scaleX, scaleY, 1.0) * 0.9; // 90% size of fit

        // Center the image
        const imgWidth = state.image.naturalWidth * state.zoomLevel;
        const imgHeight = state.image.naturalHeight * state.zoomLevel;
        state.panOffset.x = (canvas.width - imgWidth) / 2;
        state.panOffset.y = (canvas.height - imgHeight) / 2;
        
        updateZoomDisplay();
    }

    function updateZoomDisplay() {
        zoomDisplay.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    }

    zoomInBtn.addEventListener('click', () => {
        adjustZoom(1.2);
    });

    zoomOutBtn.addEventListener('click', () => {
        adjustZoom(1 / 1.2);
    });

    zoomResetBtn.addEventListener('click', () => {
        resetZoomAndPan();
        draw();
    });

    function adjustZoom(factor, centerX = canvas.width / 2, centerY = canvas.height / 2) {
        if (!state.image) return;
        
        const oldZoom = state.zoomLevel;
        state.zoomLevel = Math.max(0.1, Math.min(10.0, state.zoomLevel * factor));
        
        // Zoom relative to point (centerX, centerY)
        state.panOffset.x = centerX - (centerX - state.panOffset.x) * (state.zoomLevel / oldZoom);
        state.panOffset.y = centerY - (centerY - state.panOffset.y) * (state.zoomLevel / oldZoom);
        
        updateZoomDisplay();
        draw();
    }

    // Mouse Wheel zoom
    dropZone.addEventListener('wheel', (e) => {
        if (!state.image) return;
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        adjustZoom(factor, mouseX, mouseY);
    }, { passive: false });


    /* ==========================================================================
       3. Coordinate Translation (Screen Space <-> Image Space)
       ========================================================================== */
    
    // Converts screen canvas mouse coordinate to original image pixel coordinates
    function screenToImageCoords(screenX, screenY) {
        return {
            x: Math.round((screenX - state.panOffset.x) / state.zoomLevel),
            y: Math.round((screenY - state.panOffset.y) / state.zoomLevel)
        };
    }

    // Converts original image pixel coordinates to screen canvas coordinates
    function imageToScreenCoords(imageX, imageY) {
        return {
            x: imageX * state.zoomLevel + state.panOffset.x,
            y: imageY * state.zoomLevel + state.panOffset.y
        };
    }

    function adjustPointsToImageBoundary() {
        if (!state.image) return;
        const w = state.image.naturalWidth;
        const h = state.image.naturalHeight;
        
        state.points.forEach(p => {
            p.x = Math.max(0, Math.min(w, p.x));
            p.y = Math.max(0, Math.min(h, p.y));
            updateCoordinateInputs(p);
        });
    }

    // デバイス画像に合わせたパーセンテージ比率での初期座標配置
    function applyDefaultDeviceCoordinates(imgWidth, imgHeight) {
        const defaultRatios = [
            { id: 1, xRatio: 0.33, yRatio: 0.55, targetColor: '#a81a20', targetRgb: { r: 168, g: 26, b: 32 }, tolerance: 40, name: '赤 (左下)' },
            { id: 2, xRatio: 0.40, yRatio: 0.28, targetColor: '#0a7a3f', targetRgb: { r: 10, g: 122, b: 63 }, tolerance: 40, name: '緑 (左上)' },
            { id: 3, xRatio: 0.62, yRatio: 0.28, targetColor: '#095fa8', targetRgb: { r: 9, g: 95, b: 168 }, tolerance: 40, name: '青 (右上)' },
            { id: 4, xRatio: 0.68, yRatio: 0.55, targetColor: '#1c1c1c', targetRgb: { r: 28, g: 28, b: 28 }, tolerance: 40, name: '黒 (右側)' }
        ];

        defaultRatios.forEach(ratio => {
            const point = state.points.find(p => p.id === ratio.id);
            if (point) {
                point.x = Math.round(imgWidth * ratio.xRatio);
                point.y = Math.round(imgHeight * ratio.yRatio);
                point.targetColor = ratio.targetColor;
                point.targetRgb = ratio.targetRgb;
                point.tolerance = ratio.tolerance;
                point.name = ratio.name;

                // Sync with UI
                document.getElementById(`p${point.id}-color-input`).value = ratio.targetColor;
                document.getElementById(`p${point.id}-target-preview`).style.backgroundColor = ratio.targetColor;
                document.getElementById(`p${point.id}-tolerance`).value = ratio.tolerance;
                document.getElementById(`p${point.id}-tolerance-val`).textContent = ratio.tolerance;
                
                const labelEl = document.querySelector(`#point-${point.id}-container .point-name`);
                if (labelEl) labelEl.textContent = ratio.name;
                
                updateCoordinateInputs(point);
            }
        });
    }

    /* ==========================================================================
       4. Point Settings Panel Binding
       ========================================================================== */
    
    state.points.forEach(point => {
        const id = point.id;
        
        // Color input
        const colorInput = document.getElementById(`p${id}-color-input`);
        const targetPreview = document.getElementById(`p${id}-target-preview`);
        
        targetPreview.addEventListener('click', () => colorInput.click());
        colorInput.addEventListener('input', (e) => {
            point.targetColor = e.target.value;
            point.targetRgb = hexToRgb(point.targetColor);
            targetPreview.style.backgroundColor = point.targetColor;
            if (state.image) {
                inspectPoint(point);
                updateTotalJudgement();
                draw();
            }
            saveLastSession();
        });

        // Pipette Tool
        const pickBtn = document.getElementById(`p${id}-pick-btn`);
        pickBtn.addEventListener('click', () => {
            togglePipetteMode(id);
        });

        // Tolerance Range Slider
        const toleranceSlider = document.getElementById(`p${id}-tolerance`);
        const toleranceVal = document.getElementById(`p${id}-tolerance-val`);
        
        toleranceSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            point.tolerance = val;
            toleranceVal.textContent = val;
            if (state.image) {
                inspectPoint(point);
                updateTotalJudgement();
                draw();
            }
            saveLastSession();
        });

        // Coordinate inputs (X, Y, Radius)
        const xInput = document.getElementById(`p${id}-x`);
        const yInput = document.getElementById(`p${id}-y`);
        const rInput = document.getElementById(`p${id}-radius`);

        const handleManualCoordChange = () => {
            point.x = parseInt(xInput.value) || 0;
            point.y = parseInt(yInput.value) || 0;
            point.radius = parseInt(rInput.value) || 5;
            
            adjustPointsToImageBoundary();
            if (state.image) {
                inspectPoint(point);
                updateTotalJudgement();
                draw();
            }
            saveLastSession();
        };

        xInput.addEventListener('change', handleManualCoordChange);
        yInput.addEventListener('change', handleManualCoordChange);
        rInput.addEventListener('change', handleManualCoordChange);
    });

    function updateCoordinateInputs(point) {
        document.getElementById(`p${point.id}-x`).value = Math.round(point.x);
        document.getElementById(`p${point.id}-y`).value = Math.round(point.y);
        document.getElementById(`p${point.id}-radius`).value = Math.round(point.radius);
    }

    function togglePipetteMode(pointId) {
        const buttons = [1, 2, 3, 4].map(id => document.getElementById(`p${id}-pick-btn`));
        
        if (state.pipetteActivePoint === pointId) {
            // Deactivate
            state.pipetteActivePoint = null;
            buttons[pointId - 1].classList.remove('active');
            canvas.style.cursor = 'crosshair';
            showToast('スポイトモードを解除しました。', 'info');
        } else {
            // Activate target, deactivate others
            state.pipetteActivePoint = pointId;
            buttons.forEach((btn, idx) => {
                if (idx === pointId - 1) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            canvas.style.cursor = 'cell';
            showToast(`ポイント ${pointId} の基準色を取得：画像上の検査位置をクリックしてください。`, 'info');
        }
    }

    /* ==========================================================================
       5. Mouse & Drag Interaction on Canvas
       ========================================================================== */
    
    // Canvas Mouse & Touch listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // Touch event helpers for mobile/iPhone
    function getTouchPos(e) {
        const touch = e.touches[0] || e.changedTouches[0];
        return {
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0,
            preventDefault: () => e.preventDefault()
        };
    }

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const fakeEvent = getTouchPos(e);
            handleMouseDown(fakeEvent);
            if (state.isDraggingPoint) {
                e.preventDefault();
            }
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (state.isDraggingPoint) {
            const fakeEvent = getTouchPos(e);
            handleMouseMove(fakeEvent);
            e.preventDefault();
        }
    }, { passive: false });

    window.addEventListener('touchend', () => {
        if (state.isDraggingPoint) {
            handleMouseUp();
        }
    });

    function getMousePosOnCanvas(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function handleMouseDown(e) {
        if (!state.image) return;
        
        const screenPos = getMousePosOnCanvas(e);
        const imgPos = screenToImageCoords(screenPos.x, screenPos.y);

        // 1. Check Pipette mode
        if (state.pipetteActivePoint !== null) {
            // Sample color at click location
            const rgb = getPixelColor(imgPos.x, imgPos.y);
            const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
            
            const point = state.points.find(p => p.id === state.pipetteActivePoint);
            if (point) {
                point.targetColor = hex;
                point.targetRgb = rgb;
                
                // Update UI elements
                document.getElementById(`p${point.id}-color-input`).value = hex;
                document.getElementById(`p${point.id}-target-preview`).style.backgroundColor = hex;
                
                inspectPoint(point);
                updateTotalJudgement();
                draw();
                
                showToast(`ポイント ${point.id} の基準色を更新: ${hex}`, 'success');
                saveLastSession();
            }
            togglePipetteMode(state.pipetteActivePoint); // Turn off pipette
            return;
        }

        // 2. Left click: Check if clicked on a Point Marker
        if (e.button === 0) {
            // Find closest marker within interaction radius (screen distance)
            const clickToleranceScreen = 20; // px on screen
            let foundPoint = null;
            let minDist = Infinity;

            state.points.forEach(point => {
                const screenPt = imageToScreenCoords(point.x, point.y);
                const dist = Math.hypot(screenPos.x - screenPt.x, screenPos.y - screenPt.y);
                if (dist < clickToleranceScreen && dist < minDist) {
                    minDist = dist;
                    foundPoint = point;
                }
            });

            if (foundPoint) {
                state.draggingPoint = foundPoint;
                state.isDraggingPoint = true;
                document.getElementById(`point-${foundPoint.id}-container`).classList.add('active-inspecting');
                canvas.style.cursor = 'grabbing';
                
                // Display Pixel Magnifier immediately
                updateMagnifier(screenPos.x, screenPos.y, imgPos.x, imgPos.y);
                return;
            }

            // 3. Middle click, Space key down, or simply click on background to Pan
            state.isPanning = true;
            state.panStart.x = e.clientX - state.panOffset.x;
            state.panStart.y = e.clientY - state.panOffset.y;
            canvas.style.cursor = 'grabbing';
        }
    }

    function handleMouseMove(e) {
        if (!state.image) return;

        const rect = canvas.getBoundingClientRect();
        // Constrain bounding box checks
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            if (!state.isDraggingPoint && !state.isPanning) {
                magnifier.style.display = 'none';
                return;
            }
        }

        const screenPos = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        const imgPos = screenToImageCoords(screenPos.x, screenPos.y);

        // 1. Handle Point Dragging
        if (state.isDraggingPoint && state.draggingPoint) {
            // Constrain within image boundary
            state.draggingPoint.x = Math.max(0, Math.min(state.image.naturalWidth, imgPos.x));
            state.draggingPoint.y = Math.max(0, Math.min(state.image.naturalHeight, imgPos.y));
            
            updateCoordinateInputs(state.draggingPoint);
            inspectPoint(state.draggingPoint);
            updateTotalJudgement();
            
            // Draw & Update Magnifier
            draw();
            updateMagnifier(screenPos.x, screenPos.y, state.draggingPoint.x, state.draggingPoint.y);
            return;
        }

        // 2. Handle Image Panning
        if (state.isPanning) {
            state.panOffset.x = e.clientX - state.panStart.x;
            state.panOffset.y = e.clientY - state.panStart.y;
            draw();
            return;
        }

        // 3. Hovering / Pipette Mode Magnifier
        if (state.pipetteActivePoint !== null) {
            updateMagnifier(screenPos.x, screenPos.y, imgPos.x, imgPos.y);
        } else {
            // Detect point hover to change cursor
            const clickToleranceScreen = 20;
            let hoverPoint = false;
            state.points.forEach(point => {
                const screenPt = imageToScreenCoords(point.x, point.y);
                const dist = Math.hypot(screenPos.x - screenPt.x, screenPos.y - screenPt.y);
                if (dist < clickToleranceScreen) {
                    hoverPoint = true;
                }
            });
            canvas.style.cursor = hoverPoint ? 'grab' : 'crosshair';
            magnifier.style.display = 'none';
        }
    }

    function handleMouseUp() {
        if (state.isDraggingPoint && state.draggingPoint) {
            document.getElementById(`point-${state.draggingPoint.id}-container`).classList.remove('active-inspecting');
            state.isDraggingPoint = false;
            state.draggingPoint = null;
            saveLastSession();
        }
        
        state.isPanning = false;
        canvas.style.cursor = state.pipetteActivePoint !== null ? 'cell' : 'crosshair';
        magnifier.style.display = 'none';
    }

    /* ==========================================================================
       6. Magnifier HUD Logic
       ========================================================================== */
    function updateMagnifier(screenX, screenY, imgX, imgY) {
        if (!state.image) return;

        // Position Magnifier circle near mouse cursor, offset slightly
        const magSize = 120;
        let left = screenX + 15;
        let top = screenY + 15;

        // Keep inside canvas boundary
        if (left + magSize > canvas.width) left = screenX - magSize - 15;
        if (top + magSize > canvas.height) top = screenY - magSize - 15;

        magnifier.style.left = `${left}px`;
        magnifier.style.top = `${top}px`;
        magnifier.style.display = 'flex';

        // Draw zoomed pixelated content onto magnifier canvas
        magnifierCtx.clearRect(0, 0, magSize, magSize);
        
        // We want to zoom 9x9 pixels around the target coordinate
        const sizeInSource = 9; // pixels from original image
        const centerOffset = Math.floor(sizeInSource / 2);
        
        const srcX = imgX - centerOffset;
        const srcY = imgY - centerOffset;

        // Draw zoom block
        magnifierCtx.imageSmoothingEnabled = false;
        magnifierCtx.drawImage(
            offscreenCanvas,
            srcX, srcY, sizeInSource, sizeInSource, // Source rect
            0, 0, magSize, magSize                  // Target rect
        );

        // Draw reticle target lines at center
        magnifierCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        magnifierCtx.lineWidth = 1.5;
        
        // Center crosshair box
        const pixelZoomSize = magSize / sizeInSource;
        const centerPxX = centerOffset * pixelZoomSize;
        const centerPxY = centerOffset * pixelZoomSize;
        
        magnifierCtx.strokeRect(centerPxX, centerPxY, pixelZoomSize, pixelZoomSize);
        
        // Current hover color text
        const currentRgb = getPixelColor(imgX, imgY);
        magnifierColorText.textContent = `RGB(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b})`;
    }


    /* ==========================================================================
       7. Color Processing & Inspection Engine
       ========================================================================== */
    
    // Grabs raw pixel color from original size canvas
    function getPixelColor(x, y) {
        if (x < 0 || x >= offscreenCanvas.width || y < 0 || y >= offscreenCanvas.height) {
            return { r: 0, g: 0, b: 0 };
        }
        const imgData = offscreenCtx.getImageData(x, y, 1, 1).data;
        return { r: imgData[0], g: imgData[1], b: imgData[2] };
    }

    // Calculates average color in a circular area on the original image coordinate
    function getAverageColor(centerX, centerY, radius) {
        // Clamp bounds
        const startX = Math.max(0, Math.floor(centerX - radius));
        const startY = Math.max(0, Math.floor(centerY - radius));
        const endX = Math.min(offscreenCanvas.width - 1, Math.ceil(centerX + radius));
        const endY = Math.min(offscreenCanvas.height - 1, Math.ceil(centerY + radius));

        const width = endX - startX + 1;
        const height = endY - startY + 1;

        if (width <= 0 || height <= 0) return { r: 0, g: 0, b: 0 };

        const imgData = offscreenCtx.getImageData(startX, startY, width, height).data;
        
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        const radiusSq = radius * radius;

        for (let y = startY; y <= endY; y++) {
            const dy = y - centerY;
            const dySq = dy * dy;
            
            for (let x = startX; x <= endX; x++) {
                const dx = x - centerX;
                
                // If point lies within circle
                if (dx * dx + dySq <= radiusSq) {
                    const localX = x - startX;
                    const localY = y - startY;
                    const index = (localY * width + localX) * 4;
                    
                    sumR += imgData[index];
                    sumG += imgData[index + 1];
                    sumB += imgData[index + 2];
                    count++;
                }
            }
        }

        if (count === 0) {
            return getPixelColor(centerX, centerY);
        }

        return {
            r: Math.round(sumR / count),
            g: Math.round(sumG / count),
            b: Math.round(sumB / count)
        };
    }

    // Evaluates single inspection point color match status (Search robustly within the radius)
    function inspectPoint(point) {
        if (!state.image) return;

        const centerX = point.x;
        const centerY = point.y;
        const radius = point.radius;
        const targetRgb = point.targetRgb;

        const startX = Math.max(0, Math.floor(centerX - radius));
        const startY = Math.max(0, Math.floor(centerY - radius));
        const endX = Math.min(offscreenCanvas.width - 1, Math.ceil(centerX + radius));
        const endY = Math.min(offscreenCanvas.height - 1, Math.ceil(centerY + radius));

        const width = endX - startX + 1;
        const height = endY - startY + 1;

        let minDistance = Infinity;
        let bestMatchRgb = null;

        // P4（黒）の場合：他3色（P1:赤, P2:緑, P3:青）の混入を追跡
        let otherMinDistances = [Infinity, Infinity, Infinity];
        let otherMatchesCount = [0, 0, 0];

        if (width > 0 && height > 0) {
            const imgData = offscreenCtx.getImageData(startX, startY, width, height).data;
            const radiusSq = radius * radius;

            for (let y = startY; y <= endY; y++) {
                const dy = y - centerY;
                const dySq = dy * dy;
                
                for (let x = startX; x <= endX; x++) {
                    const dx = x - centerX;
                    
                    // 円の領域内のピクセルのみ検査
                    if (dx * dx + dySq <= radiusSq) {
                        const localX = x - startX;
                        const localY = y - startY;
                        const index = (localY * width + localX) * 4;
                        
                        const r = imgData[index];
                        const g = imgData[index + 1];
                        const b = imgData[index + 2];
                        
                        // 基準色との色差
                        const rDiff = r - targetRgb.r;
                        const gDiff = g - targetRgb.g;
                        const bDiff = b - targetRgb.b;
                        const distance = Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
                        
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestMatchRgb = { r, g, b };
                        }

                        // P4（黒）の場合、P1〜P3（赤・緑・青）の基準色との距離も計算
                        if (point.id === 4) {
                            for (let i = 0; i < 3; i++) {
                                const other = state.points[i];
                                const od = Math.sqrt(
                                    (r - other.targetRgb.r) ** 2 +
                                    (g - other.targetRgb.g) ** 2 +
                                    (b - other.targetRgb.b) ** 2
                                );
                                if (od < otherMinDistances[i]) {
                                    otherMinDistances[i] = od;
                                }
                                if (od <= other.tolerance) {
                                    otherMatchesCount[i]++;
                                }
                            }
                        }
                    }
                }
            }
        }

        // マッチするピクセルが見つからない場合のフォールバック（中心点）
        if (!bestMatchRgb) {
            const centerColor = getPixelColor(centerX, centerY);
            bestMatchRgb = centerColor;
            const rDiff = centerColor.r - targetRgb.r;
            const gDiff = centerColor.g - targetRgb.g;
            const bDiff = centerColor.b - targetRgb.b;
            minDistance = Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
        }

        point.currentRgb = bestMatchRgb;
        point.diff = Math.round(minDistance);
        point.mixError = null;

        // 基本合否判定（黒の基準色との合致）
        if (point.diff <= point.tolerance) {
            point.status = 'pass';
        } else {
            point.status = 'fail';
        }

        // 黒（P4）に他の3色（赤、青、緑）が検出された場合は強制的に不合格（FAIL）とする
        if (point.id === 4) {
            for (let i = 0; i < 3; i++) {
                const other = state.points[i];
                // サークル内に他色しきい値内のピクセルが存在、または他色との最小距離が他色許容値以下の場合
                if (otherMatchesCount[i] > 0 || otherMinDistances[i] <= other.tolerance) {
                    point.status = 'fail';
                    const colorName = other.name.replace(/[\(（].*[\)）]/, '').trim();
                    point.mixError = `${colorName}混入`;
                    break;
                }
            }
        }

        updateSinglePointUI(point);
    }

    function inspectAllPoints(logResult = true) {
        if (!state.image) return;

        state.points.forEach(point => inspectPoint(point));
        updateTotalJudgement();
        
        if (logResult) {
            logInspectionToHistory();
        }
    }

    triggerInspectionBtn.addEventListener('click', () => {
        if (state.image) {
            inspectAllPoints(true);
            showToast('色判定検査を完了しました。', 'success');
        }
    });

    /* ==========================================================================
       8. UI Updates & Rendering
       ========================================================================== */
    
    // Draw elements on canvas
    function draw() {
        if (!state.image) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        // Apply camera zoom and pan transform matrix
        ctx.translate(state.panOffset.x, state.panOffset.y);
        ctx.scale(state.zoomLevel, state.zoomLevel);

        // 1. Draw raw image
        ctx.drawImage(state.image, 0, 0);

        // 2. Draw inspection points on image coordinate system
        state.points.forEach(point => {
            const colorName = `var(--color-p${point.id})`;

            // Draw bounding inspection circle
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.radius, 0, 2 * Math.PI);
            
            // Adjust line width to screen resolution so it looks fine regardless of zoom
            ctx.lineWidth = Math.max(1.5, 2.5 / state.zoomLevel);
            
            // Neon glowing line depending on result
            if (point.status === 'pass') {
                ctx.strokeStyle = '#10b981'; // Green
            } else if (point.status === 'fail') {
                ctx.strokeStyle = '#ef4444'; // Red
            } else {
                // Idle, color code by point ID
                ctx.strokeStyle = point.id === 1 ? '#f87171' : 
                                  point.id === 2 ? '#4ade80' : 
                                  point.id === 3 ? '#60a5fa' : '#facc15';
            }
            ctx.stroke();

            // Draw outer white circle trace for high visibility contrast
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.radius + (1.5 / state.zoomLevel), 0, 2 * Math.PI);
            ctx.lineWidth = 1 / state.zoomLevel;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.stroke();

            // Draw crosshair reticle at center
            const hair = Math.max(2, 4 / state.zoomLevel);
            ctx.beginPath();
            ctx.moveTo(point.x - hair, point.y);
            ctx.lineTo(point.x + hair, point.y);
            ctx.moveTo(point.x, point.y - hair);
            ctx.lineTo(point.x, point.y + hair);
            ctx.lineWidth = 1.5 / state.zoomLevel;
            ctx.strokeStyle = 'white';
            ctx.stroke();

            // Draw Badge Label floating just above the point
            const fontSize = Math.max(9, 12 / state.zoomLevel);
            ctx.font = `bold ${fontSize}px var(--font-heading)`;
            ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
            
            const badgeText = `P${point.id}`;
            const textWidth = ctx.measureText(badgeText).width;
            
            const padX = 6 / state.zoomLevel;
            const padY = 4 / state.zoomLevel;
            const badgeW = textWidth + padX * 2;
            const badgeH = fontSize + padY * 2;
            
            const badgeX = point.x - badgeW / 2;
            const badgeY = point.y - point.radius - badgeH - (4 / state.zoomLevel);

            // Draw text bubble background
            roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4 / state.zoomLevel);
            ctx.fill();
            
            // Draw text bubble border
            ctx.lineWidth = 1 / state.zoomLevel;
            ctx.strokeStyle = ctx.strokeStyle = point.id === 1 ? '#f87171' : 
                                                    point.id === 2 ? '#4ade80' : 
                                                    point.id === 3 ? '#60a5fa' : '#facc15';
            ctx.stroke();

            // Draw text
            ctx.fillStyle = 'white';
            ctx.textBaseline = 'top';
            ctx.fillText(badgeText, badgeX + padX, badgeY + padY);
        });

        ctx.restore();
    }

    // Helper to draw rounded rectangle in Canvas
    function roundRect(ctx, x, y, width, height, radius) {
        if (typeof radius === 'undefined') {
            radius = 5;
        }
        if (typeof radius === 'number') {
            radius = {tl: radius, tr: radius, br: radius, bl: radius};
        } else {
            var defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
            for (var side in defaultRadius) {
                radius[side] = radius[side] || defaultRadius[side];
            }
        }
        ctx.beginPath();
        ctx.moveTo(x + radius.tl, y);
        ctx.lineTo(x + width - radius.tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
        ctx.lineTo(x + width, y + height - radius.br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
        ctx.lineTo(x + radius.bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
        ctx.lineTo(x, y + radius.tl);
        ctx.quadraticCurveTo(x, y, x + radius.tl, y);
        ctx.closePath();
    }

    function updateSinglePointUI(point) {
        const id = point.id;
        const statusEl = document.getElementById(`p${id}-status`);
        const currentPreview = document.getElementById(`p${id}-current-preview`);
        const currentText = document.getElementById(`p${id}-current-text`);
        const diffText = document.getElementById(`p${id}-diff-text`);
        const container = document.getElementById(`point-${id}-container`);
        
        // Summary elements
        const summaryColorEl = document.getElementById(`p${id}-summary-color`);
        const summaryDiffEl = document.getElementById(`p${id}-summary-diff`);

        // Highlight status colors
        statusEl.className = 'point-status';
        container.classList.remove('active-feedback');
        
        if (point.currentRgb) {
            const hex = rgbToHex(point.currentRgb.r, point.currentRgb.g, point.currentRgb.b);
            currentPreview.style.backgroundColor = hex;
            currentText.textContent = `${hex.toUpperCase()}`;
            diffText.textContent = point.diff;
            container.classList.add('active-feedback');
            
            // Update Summary
            summaryColorEl.style.backgroundColor = hex;
            summaryDiffEl.textContent = point.diff;

            if (point.status === 'pass') {
                statusEl.textContent = 'PASS';
                statusEl.classList.add('status-pass');
                diffText.style.color = 'var(--color-pass)';
                summaryDiffEl.style.color = 'var(--text-secondary)';
            } else {
                statusEl.textContent = point.mixError ? 'FAIL(混入)' : 'FAIL';
                statusEl.classList.add('status-fail');
                diffText.style.color = 'var(--color-fail)';

                if (point.mixError) {
                    diffText.textContent = `${point.mixError} (差:${point.diff})`;
                    summaryDiffEl.textContent = point.mixError;
                    summaryDiffEl.style.color = 'var(--color-fail)';
                } else {
                    summaryDiffEl.style.color = 'var(--text-secondary)';
                }
            }
        } else {
            statusEl.textContent = 'WAIT';
            statusEl.classList.add('status-idle');
            currentPreview.style.backgroundColor = '#000';
            currentText.textContent = 'N/A';
            diffText.textContent = '--';
            diffText.style.color = 'var(--text-muted)';
            
            // Reset Summary
            summaryColorEl.style.backgroundColor = 'transparent';
            summaryDiffEl.textContent = '--';
        }
    }

    function updatePointsUI() {
        state.points.forEach(p => updateSinglePointUI(p));
    }

    function updateTotalJudgement() {
        if (!state.image) {
            resetTotalJudgementUI();
            return;
        }

        const passCount = state.points.filter(p => p.status === 'pass').length;
        passPointsCount.textContent = `${passCount} / 4`;

        totalJudgementValue.className = 'judgement-value';
        const isPass = (passCount === 4);
        
        if (isPass) {
            // PASS
            totalJudgementValue.innerHTML = `
                <span class="status-icon"><i data-lucide="check-circle-2"></i></span>
                <span class="status-text">合格 (PASS)</span>
            `;
            totalJudgementValue.classList.add('status-pass');
            totalJudgementCard.style.borderColor = 'rgba(16, 185, 129, 0.4)';

            // Webカメラでの判定時に合格（PASS）となった瞬間、「ピンポン♪」チャイム音を再生
            if (state.inputMode === 'camera' && state.soundEnabled) {
                const now = Date.now();
                // 直前がPASSでなかった（FAILから合格に変化した）、または前回発音から1.5秒以上経過している場合
                if (!state.previousTotalPass || (now - state.lastChimeTimestamp > 1500)) {
                    playChimeSound();
                    state.lastChimeTimestamp = now;
                }
            }
        } else {
            // FAIL
            totalJudgementValue.innerHTML = `
                <span class="status-icon"><i data-lucide="x-circle"></i></span>
                <span class="status-text">不合格 (FAIL)</span>
            `;
            totalJudgementValue.classList.add('status-fail');
            totalJudgementCard.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        }
        
        state.previousTotalPass = isPass;

        // Re-draw lucide icons inside updated HTML
        lucide.createIcons();
    }

    function resetTotalJudgementUI() {
        passPointsCount.textContent = '0 / 4';
        totalJudgementValue.className = 'judgement-value status-idle';
        totalJudgementValue.innerHTML = `
            <span class="status-icon"><i data-lucide="clock"></i></span>
            <span class="status-text">画像待機中</span>
        `;
        totalJudgementCard.style.borderColor = 'var(--border-color)';
        state.previousTotalPass = false;
        lucide.createIcons();
    }

    /* ==========================================================================
       9. Recipe Management (Load/Save Configuration)
       ========================================================================== */
    
    // Save current setup (point coordinates, target colors, tolerances) to storage
    function getRecipeData() {
        return state.points.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            radius: p.radius,
            targetColor: p.targetColor,
            targetRgb: p.targetRgb,
            tolerance: p.tolerance
        }));
    }

    function loadRecipesList() {
        const recipes = JSON.parse(localStorage.getItem('vision_checker_recipes_v2') || '{}');
        
        // Always ensure default is present
        if (!recipes['default']) {
            recipes['default'] = [
                { id: 1, x: 338, y: 422, radius: 15, targetColor: '#a81a20', targetRgb: { r: 168, g: 26, b: 32 }, tolerance: 40, name: '赤 (左下)' },
                { id: 2, x: 410, y: 215, radius: 15, targetColor: '#0a7a3f', targetRgb: { r: 10, g: 122, b: 63 }, tolerance: 40, name: '緑 (左上)' },
                { id: 3, x: 635, y: 215, radius: 15, targetColor: '#095fa8', targetRgb: { r: 9, g: 95, b: 168 }, tolerance: 40, name: '青 (右上)' },
                { id: 4, x: 702, y: 422, radius: 15, targetColor: '#1c1c1c', targetRgb: { r: 28, g: 28, b: 28 }, tolerance: 40, name: '黒 (右側)' }
            ];
            localStorage.setItem('vision_checker_recipes_v2', JSON.stringify(recipes));
        }

        recipeSelect.innerHTML = '';
        Object.keys(recipes).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name === 'default' ? 'デフォルト設定' : name;
            recipeSelect.appendChild(option);
        });
    }

    function applyRecipe(recipeName) {
        if (recipeName === 'default' && state.image) {
            applyDefaultDeviceCoordinates(state.image.naturalWidth, state.image.naturalHeight);
            inspectAllPoints(false);
            draw();
            saveLastSession();
            return;
        }

        const recipes = JSON.parse(localStorage.getItem('vision_checker_recipes_v2') || '{}');
        const recipe = recipes[recipeName];
        
        if (!recipe) return;

        recipe.forEach(savedPt => {
            const currentPt = state.points.find(p => p.id === savedPt.id);
            if (currentPt) {
                currentPt.x = savedPt.x;
                currentPt.y = savedPt.y;
                currentPt.radius = savedPt.radius;
                currentPt.targetColor = savedPt.targetColor;
                currentPt.targetRgb = savedPt.targetRgb;
                currentPt.tolerance = savedPt.tolerance;
                if (savedPt.name) currentPt.name = savedPt.name;

                // Sync with settings UI
                document.getElementById(`p${savedPt.id}-color-input`).value = savedPt.targetColor;
                document.getElementById(`p${savedPt.id}-target-preview`).style.backgroundColor = savedPt.targetColor;
                document.getElementById(`p${savedPt.id}-tolerance`).value = savedPt.tolerance;
                document.getElementById(`p${savedPt.id}-tolerance-val`).textContent = savedPt.tolerance;
                
                const labelEl = document.querySelector(`#point-${savedPt.id}-container .point-name`);
                if (labelEl) labelEl.textContent = currentPt.name;

                updateCoordinateInputs(currentPt);
            }
        });

        if (state.image) {
            adjustPointsToImageBoundary();
            inspectAllPoints(false);
            draw();
        }
        saveLastSession();
    }

    recipeSelect.addEventListener('change', (e) => {
        applyRecipe(e.target.value);
        showToast(`レシピ 「${recipeSelect.options[recipeSelect.selectedIndex].text}」 を適用しました。`, 'info');
    });

    saveRecipeBtn.addEventListener('click', () => {
        let name = prompt('レシピ名を入力してください (例: 基板-型式A):');
        if (name === null) return; // cancelled
        name = name.trim();
        if (!name) {
            showToast('有効なレシピ名を入力してください。', 'error');
            return;
        }

        const recipes = JSON.parse(localStorage.getItem('vision_checker_recipes_v2') || '{}');
        recipes[name] = getRecipeData();
        localStorage.setItem('vision_checker_recipes_v2', JSON.stringify(recipes));
        
        loadRecipesList();
        recipeSelect.value = name;
        showToast(`レシピ 「${name}」 を保存しました。`, 'success');
    });

    // JSON export
    exportRecipeBtn.addEventListener('click', () => {
        const recipeName = recipeSelect.value;
        const recipes = JSON.parse(localStorage.getItem('vision_checker_recipes_v2') || '{}');
        const recipeData = recipes[recipeName];

        if (!recipeData) {
            showToast('エクスポートするレシピがありません。', 'error');
            return;
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
            recipeName: recipeName,
            version: "1.0",
            config: recipeData
        }, null, 2));
        
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `recipe_${recipeName}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('レシピ設定JSONを書き出しました。', 'success');
    });

    // JSON import
    importRecipeBtn.addEventListener('click', () => recipeFileInput.click());
    recipeFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                if (!parsed.config || !Array.isArray(parsed.config)) {
                    throw new Error("Invalid format");
                }

                let recipeName = parsed.recipeName || '取り込みレシピ';
                
                // Prompt to rename if duplicate
                const recipes = JSON.parse(localStorage.getItem('vision_checker_recipes_v2') || '{}');
                if (recipes[recipeName]) {
                    recipeName = prompt('同名のレシピがすでに存在します。新しいレシピ名を入力してください。', `${recipeName}_new`) || recipeName + '_1';
                }

                recipes[recipeName] = parsed.config;
                localStorage.setItem('vision_checker_recipes_v2', JSON.stringify(recipes));
                
                loadRecipesList();
                recipeSelect.value = recipeName;
                applyRecipe(recipeName);
                
                showToast(`レシピ 「${recipeName}」 を読み込みました。`, 'success');
            } catch (err) {
                showToast('設定JSONの解析に失敗しました。ファイル形式を確認してください。', 'error');
                console.error(err);
            }
            recipeFileInput.value = ''; // Reset input
        };
        reader.readAsText(file);
    });

    /* ==========================================================================
       10. Inspection History Logging
       ========================================================================== */
    
    function logInspectionToHistory() {
        if (!state.image) return;

        const entry = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('ja-JP', { hour12: false }),
            imageName: state.imageName || 'Webカメラ検査',
            points: state.points.map(p => ({
                id: p.id,
                status: p.status,
                color: p.currentRgb ? rgbToHex(p.currentRgb.r, p.currentRgb.g, p.currentRgb.b) : '#000000',
                diff: p.mixError ? `${p.mixError}(${p.diff})` : p.diff,
                mixError: p.mixError || null
            })),
            isPass: state.points.every(p => p.status === 'pass')
        };

        state.history.unshift(entry); // Prepend to history (newest first)
        
        // Cap history to 50 items
        if (state.history.length > 50) {
            state.history.pop();
        }

        saveHistoryToStorage();
        renderHistoryTable();
    }

    function renderHistoryTable() {
        if (state.history.length === 0) {
            historyLogBody.innerHTML = `
                <tr>
                    <td colspan="7" class="no-data">履歴がありません。画像をロードして判定を行ってください。</td>
                </tr>
            `;
            return;
        }

        historyLogBody.innerHTML = '';
        state.history.forEach(log => {
            const tr = document.createElement('tr');
            
            const passText = log.isPass ? 
                '<span class="badge-table pass">合格</span>' : 
                '<span class="badge-table fail">不合格</span>';

            const pCols = log.points.map(p => {
                const badgeClass = p.status === 'pass' ? 'pass' : 'fail';
                const statusSymbol = p.status === 'pass' ? '● OK' : (p.mixError ? `× ${p.mixError}` : '× NG');
                return `<td><span class="badge-table ${badgeClass}">${statusSymbol} (${p.diff})</span></td>`;
            }).join('');

            tr.innerHTML = `
                <td>${log.timestamp}</td>
                <td title="${log.imageName}">${truncateText(log.imageName, 20)}</td>
                ${pCols}
                <td>${passText}</td>
            `;

            historyLogBody.appendChild(tr);
        });
    }

    function saveHistoryToStorage() {
        localStorage.setItem('vision_checker_history', JSON.stringify(state.history));
    }

    function loadHistoryFromStorage() {
        state.history = JSON.parse(localStorage.getItem('vision_checker_history') || '[]');
        renderHistoryTable();
    }

    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('判定履歴をすべて消去しますか？')) {
            state.history = [];
            saveHistoryToStorage();
            renderHistoryTable();
            showToast('判定履歴をクリアしました。', 'info');
        }
    });

    exportCsvBtn.addEventListener('click', () => {
        if (state.history.length === 0) {
            showToast('エクスポートする履歴がありません。', 'error');
            return;
        }

        // Generate CSV content
        let csvContent = "\uFEFF"; // UTF-8 BOM
        csvContent += "日時,画像名,P1判定,P1誤差,P2判定,P2誤差,P3判定,P3誤差,P4判定,P4誤差,総合判定\n";

        state.history.forEach(log => {
            const row = [
                log.timestamp,
                log.imageName,
                log.points[0].status.toUpperCase(), log.points[0].diff,
                log.points[1].status.toUpperCase(), log.points[1].diff,
                log.points[2].status.toUpperCase(), log.points[2].diff,
                log.points[3].status.toUpperCase(), log.points[3].diff,
                log.isPass ? "PASS" : "FAIL"
            ];
            csvContent += row.map(val => `"${val}"`).join(',') + '\n';
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", url);
        downloadAnchor.setAttribute("download", `vision_checker_history_${Date.now()}.csv`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('検査履歴をCSVとして出力しました。', 'success');
    });


    /* ==========================================================================
       11. Utility Functions
       ========================================================================== */
    
    function hexToRgb(hex) {
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function truncateText(str, maxLength) {
        if (!str) return '';
        return str.length > maxLength ? str.substr(0, maxLength - 3) + '...' : str;
    }

    let toastTimeout;
    function showToast(message, type = 'info') {
        clearTimeout(toastTimeout);
        toast.textContent = message;
        toast.className = `toast-notification show`;
        
        if (type === 'success') {
            toast.style.borderLeft = "5px solid var(--color-pass)";
        } else if (type === 'error') {
            toast.style.borderLeft = "5px solid var(--color-fail)";
        } else {
            toast.style.borderLeft = "5px solid var(--color-info)";
        }

        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3500);
    }
});
