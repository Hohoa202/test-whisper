(() => {
    "use strict";

    const CHUNK_INTERVAL_MS = 3000;
    const MAX_RETRY_COUNT = 3;

    const elements = {
        businessId: document.getElementById("businessId"),
        video: document.getElementById("cameraPreview"),
        status: document.getElementById("recordingStatus"),
        recordingTime: document.getElementById("recordingTime"),
        uploadSize: document.getElementById("uploadSize"),
        error: document.getElementById("errorMessage"),

        capturePhoto: $("#btnCapturePhoto"),
        submitPhotos: $("#btnSubmitPhotos"),
        clearPhotos: $("#btnClearPhotos"),
        photoList: $("#photoList"),

        start: document.getElementById("btnStartRecording"),
        stop: document.getElementById("btnStopRecording"),
        retake: document.getElementById("btnRetake"),
        submit: document.getElementById("btnSubmitVideo"),
        preview: document.getElementById("btnPreviewVideo"),
        cancel: document.getElementById("btnCancelVideo"),
        switchCamera: document.getElementById("btnSwitchCamera"),

        audioStart: $('#btnStartAudio'),
        audioStop: $('#btnStopAudio'),
        audioSubmit: $('#btnSubmitAudio'),
        audioCancel: $('#btnCancelAudio'),
        audioStatus: $('#audioStatus'),
        audioTime: $('#audioTime'),
        audioPreview: $('#audioPreview'),

        subtitleToggle: document.getElementById("btnToggleSubtitle"),
        subtitleOverlay: document.getElementById("subtitleOverlay"),
        transcript: document.getElementById("transcriptText"),
    };

    const state = {
        stream: null,
        recorder: null,
        sessionId: null,
        mimeType: null,
        facingMode: "environment",

        nextChunkNumber: 0,
        uploadedBytes: 0,

        /*
         * Promise chain bảo đảm upload chunk tuần tự.
         */
        uploadQueue: Promise.resolve(),

        /*
         * Dùng để tạo preview local.
         * Với video dài, nên bỏ cơ chế này và preview từ server.
         */
        previewChunks: [],
        isCancelling: false,

        recordingStartedAt: null,
        timerId: null,
        chunkTimerId: null,

        isStopping: false,
        hasUploadError: false,
        previewUrl: null,
        isPreviewing: false,

        photos: [],
        isSubmittingPhotos: false,

        audio: {
            stream: null,
            recorder: null,
            chunks: [],
            blob: null,
            previewUrl: null,
            startedAt: null,
            timerId: null,
            isRecording: false,
            isCancelling: false,
            isSubmitting: false
        },

        subtitle: {
            enabled: false,
            isStarting: false,

            socket: null,
            audioContext: null,
            source: null,
            workletNode: null,
            silentGain: null,

            finalText: "",
            currentText: ""
        }
    };

    function getAntiForgeryToken() {
        return document.querySelector(
            'input[name="__RequestVerificationToken"]'
        )?.value ?? "";
    }

    function getBusinessId() {
        if (!elements.businessId)
            throw new Error('Không tìm thấy #businessId.');

        const businessId = Number(elements.businessId.value);

        if (!Number.isFinite(businessId) || businessId <= 0)
            throw new Error('BusinessId không hợp lệ.');

        return businessId;
    }

    function showError(message) {
        console.error(message);

        elements.error.textContent = message instanceof Error ? message.message : String(message);
        elements.error.classList.remove("d-none");
    }

    function clearError() {
        elements.error.textContent = "";
        elements.error.classList.add("d-none");
    }

    function setStatus(text) {
        elements.status.textContent = text;
    }

    function setButtons(mode) {
        const states = {
            initial: {
                open: false,
                start: true,
                stop: true,
                retake: true,
                submit: true,
                cancel: true
            },
            cameraReady: {
                open: true,
                start: false,
                stop: true,
                retake: true,
                submit: true,
                cancel: true
            },
            recording: {
                open: true,
                start: true,
                stop: false,
                retake: true,
                submit: true,
                cancel: false
            },
            stopping: {
                open: true,
                start: true,
                stop: true,
                retake: true,
                submit: true,
                cancel: true
            },
            preview: {
                open: true,
                start: true,
                stop: true,
                retake: false,
                submit: false,
                cancel: false
            },
            submitting: {
                open: true,
                start: true,
                stop: true,
                retake: true,
                submit: true,
                cancel: true
            },
            completed: {
                open: true,
                start: true,
                stop: true,
                retake: true,
                submit: true,
                cancel: true
            }
        };

        const value = states[mode];

        elements.start.disabled = value.start;
        elements.stop.disabled = value.stop;
        if (elements.retake) elements.retake.disabled = value.retake;
        elements.submit.disabled = value.submit;
        elements.cancel.disabled = value.cancel;
    }

    updatePhotoButtons();

    function resolveMimeType() {
        const candidates = [
            "video/webm;codecs=vp8,opus",
            "video/webm",
            "video/mp4"
        ];

        return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? "";
    }

    async function switchCamera() {
        clearError();

        if (state.recorder?.state === "recording" || state.isStopping) {
            showError("Không thể chuyển camera khi đang quay.");
            return;
        }

        state.facingMode = state.facingMode === "environment" ? "user" : "environment";

        try {
            await openCamera();
        } catch (error) {
            showError(error);
        }
    }

    async function openCamera() {
        clearError();

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Trình duyệt không hỗ trợ camera hoặc trang chưa chạy bằng HTTPS."
            );
        }

        closeCurrentStream();
        stopChunkTimer();
        revokePreviewUrl();

        elements.video.removeAttribute("src");
        elements.video.controls = false;
        elements.video.muted = true;

        state.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: {
                    ideal: state.facingMode
                },
                width: {
                    ideal: 1280
                },
                height: {
                    ideal: 720
                },
                frameRate: {
                    ideal: 60,
                    max: 60
                }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });


        elements.video.srcObject = state.stream;
        await elements.video.play();
        updateCameraMirror();
        setStatus("Camera Ready");
        setButtons("cameraReady");
        updatePhotoButtons();
    }

    $(async function () {
        try {
            await openCamera();
        } catch (error) {
            showError(error);
            setStatus("Không thể mở camera.");
        }
    });

    async function createSession() {
        const response = await fetch("/VideoCapture/CreateSession",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "RequestVerificationToken": getAntiForgeryToken()
                },
                body: JSON.stringify({
                    businessId: getBusinessId(),
                    mimeType: state.mimeType || "video/webm"
                })
            });

        const result = await readResponse(response);
        state.sessionId = result.sessionId;
        sessionStorage.setItem("activeVideoSessionId", state.sessionId);
    }

    async function startRecording() {
        clearError();

        if (!state.stream) {
            await openCamera();
        }

        if (!window.MediaRecorder) {
            throw new Error("Trình duyệt không hỗ trợ MediaRecorder.");
        }

        resetRecordingState();

        state.mimeType = resolveMimeType();

        await createSession();

        const recorderOptions = state.mimeType
            ? {
                mimeType: state.mimeType,
                videoBitsPerSecond: 2_500_000,
                audioBitsPerSecond: 128_000
            }
            : undefined;

        state.recorder = new MediaRecorder(state.stream, recorderOptions);

        /*
         * MIME thực tế browser đã chọn.
         */
        state.mimeType = state.recorder.mimeType || state.mimeType || "video/webm";

        state.recorder.addEventListener("dataavailable", handleDataAvailable);

        state.recorder.addEventListener("stop", handleRecorderStopped);

        state.recorder.addEventListener("error", event => {
            state.hasUploadError = true;
            showError(event.error ?? new Error("MediaRecorder bị lỗi."));
        });

        state.recordingStartedAt = Date.now();
        startTimer();

        /*
         * Yêu cầu browser phát Blob khoảng mỗi 3 giây.
         */
        state.recorder.start();

        state.chunkTimerId = window.setInterval(() => {
            if (state.recorder?.state === "recording") {
                try {
                    state.recorder.requestData();
                } catch (error) {
                    console.warn("requestData failed:", error);
                }
            }
        }, CHUNK_INTERVAL_MS);

        setStatus("● Recording");
        setButtons("recording");
    }

    function handleDataAvailable(event) {
        if (!event.data || event.data.size === 0) {
            return;
        }
        const chunkNumber = state.nextChunkNumber++;

        /*
         * Chỉ giữ để preview.
         * Server vẫn được upload ngay.
         */
        state.previewChunks.push(event.data);
        state.uploadQueue = state.uploadQueue.then(() =>
            retryAsync(() => uploadChunk(chunkNumber, event.data), MAX_RETRY_COUNT)
        );
    }

    async function uploadChunk(
        chunkNumber,
        blob) {
        if (!state.sessionId) {
            throw new Error("Upload session không tồn tại.");
        }

        const formData = new FormData();

        /*
         * Tên file này không được server dùng làm đường dẫn lưu chính thức.
         */
        formData.append("chunk", blob, `chunk_${String(chunkNumber).padStart(8, "0")}.part`);

        const url = "/VideoCapture/UploadChunk" + `?sessionId=${encodeURIComponent(state.sessionId)}` + `&chunkNumber=${chunkNumber}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "RequestVerificationToken": getAntiForgeryToken()
            },
            body: formData
        });

        const result = await readResponse(response);

        /*
         * Không cộng lại khi server trả duplicate.
         */
        state.uploadedBytes = Number(result.totalBytes ?? 0);

        updateUploadSize();
    }

    function stopRecording() {
        if (!state.recorder || state.recorder.state === "inactive" || state.isStopping) {
            return;
        }

        state.isStopping = true;

        stopTimer();
        stopChunkTimer();

        /*
         * Không gọi requestData() ngay trước stop().
         * Với video dưới CHUNK_INTERVAL_MS, một số trình duyệt điện thoại
         * có thể phát chunk rỗng hoặc tách sự kiện không ổn định.
         *
         * stop() tự phát dataavailable cuối cùng trước sự kiện stop,
         * nên handleRecorderStopped() vẫn chờ đúng uploadQueue.
         */
        state.recorder.stop();

        setStatus("Đang dừng và gửi phần video cuối...");
        setButtons("stopping");
    }

    async function handleRecorderStopped() {
        if (state.isCancelling) {
            return;
        }

        try {
            await state.uploadQueue;

            if (state.hasUploadError) {
                throw new Error("Có chunk upload thất bại.");
            }

            state.isStopping = false;
            elements.preview.disabled = false;

            setStatus(`Đã quay xong, ${state.nextChunkNumber} chunk đã được lưu trên server.`);
            setButtons("preview");
            updatePhotoButtons();
        } catch (error) {
            state.isStopping = false;
            state.hasUploadError = true;
            showError(error);
            setStatus("Video chưa được upload đầy đủ.");
            elements.cancel.disabled = false;
            updatePhotoButtons();
        }
    }

    function previewVideo() {
        if (state.previewChunks.length === 0) {
            showError("Không có dữ liệu video để xem.");
            return;
        }

        state.isPreviewing = true;
        showLocalPreview();
        updateCameraMirror();

        elements.preview.disabled = true;
        elements.cancel.disabled = false;

        setStatus("Đang xem lại video.");
        updatePhotoButtons();
    }

    function updatePhotoButtons() {
        const hasCamera = !!state.stream;
        const hasPhotos = state.photos.length > 0;
        const disabled = state.isPreviewing || state.isSubmittingPhotos;

        elements.capturePhoto.prop("disabled", !hasCamera || disabled);
        elements.submitPhotos.prop("disabled", !hasPhotos || disabled);
        elements.clearPhotos.prop("disabled", !hasPhotos || disabled);
    }

    function showLocalPreview() {
        if (state.previewChunks.length === 0) {
            throw new Error("Không có dữ liệu video để preview.");
        }

        revokePreviewUrl();

        const previewBlob = new Blob(
            state.previewChunks,
            {
                type: state.recorder?.mimeType || state.mimeType || "video/webm"
            });

        state.previewUrl = URL.createObjectURL(previewBlob);

        elements.video.pause();
        elements.video.srcObject = null;
        elements.video.src = state.previewUrl;
        elements.video.controls = true;
        elements.video.muted = false;
        elements.video.currentTime = 0;
    }

    async function submitVideo() {
        clearError();

        if (!state.sessionId) {
            throw new Error("Không có video để submit.");
        }

        if (state.hasUploadError) {
            throw new Error("Không thể submit vì có chunk upload bị lỗi.");
        }

        setStatus("Đang hoàn tất video...");
        setButtons("submitting");

        /*
         * Bảo đảm queue hoàn thành trước khi gọi Complete.
         */
        await state.uploadQueue;

        const url = "/VideoCapture/Complete" + `?sessionId=${encodeURIComponent(state.sessionId)}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "RequestVerificationToken": getAntiForgeryToken()
            },
            body: JSON.stringify({
                expectedChunkCount: state.nextChunkNumber
            })
        });

        const result = await readResponse(response);

        sessionStorage.removeItem("activeVideoSessionId");

        resetRecordingState();
        elements.preview.disabled = true;

        setStatus("Đã lưu video. Có thể quay video mới.");
        setButtons("cameraReady");
        updatePhotoButtons();

        /*
         * Sau đây có thể gán vào input hidden
         * của màn hình nghiệp vụ.
         */
        console.log("Saved media:", result);
    }

    async function cancelVideo() {
        clearError();

        if (state.isPreviewing) {
            state.isPreviewing = false;

            elements.video.pause();
            revokePreviewUrl();

            elements.video.removeAttribute("src");
            elements.video.srcObject = state.stream;
            elements.video.controls = false;
            elements.video.muted = true;

            if (state.stream) {
                await elements.video.play();
            }

            updateCameraMirror();

            elements.preview.disabled = false;
            setStatus("Đã hủy xem video.");
            setButtons("preview");
            updatePhotoButtons();
            return;
        }

        state.isCancelling = true;
        stopTimer();
        setStatus("Đang hủy video...");
        setButtons("stopping");

        if (state.recorder && state.recorder.state !== "inactive") {
            state.recorder.stop();
        }

        await state.uploadQueue.catch(() => { });

        if (state.sessionId) {
            const url = "/VideoCapture/Cancel"
                + `?sessionId=${encodeURIComponent(state.sessionId)}`;

            const response = await fetch(url, {
                method: "DELETE",
                headers: {
                    "RequestVerificationToken": getAntiForgeryToken()
                }
            });

            if (!response.ok && response.status !== 404) {
                await readResponse(response);
            }
        }

        sessionStorage.removeItem("activeVideoSessionId");

        resetRecordingState();
        state.isCancelling = false;

        elements.video.pause();
        revokePreviewUrl();
        elements.video.removeAttribute("src");
        elements.video.srcObject = state.stream;
        elements.video.controls = false;
        elements.video.muted = true;

        if (state.stream) {
            await elements.video.play();
        } else {
            await openCamera();
        }

        updateCameraMirror();

        elements.preview.disabled = true;
        setStatus("Đã hủy video. Camera Ready");
        setButtons("cameraReady");
        updatePhotoButtons();
    }

    async function retryAsync(operation, maxAttempts) {
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (attempt >= maxAttempts) {
                    break;
                }

                setStatus(`Upload lỗi, đang thử lại lần ${attempt + 1}/${maxAttempts}...`);

                await delay(attempt * 1000);
            }
        }

        state.hasUploadError = true;

        throw lastError;
    }

    async function readResponse(response) {
        const contentType = response.headers.get("content-type") ?? "";

        let body;

        if (contentType.includes("application/json")) {
            body = await response.json();
        } else {
            body = await response.text();
        }

        if (!response.ok) {
            const message = typeof body === "object" ? body?.message : body;

            throw new Error(message || `HTTP ${response.status}`);
        }

        return body;
    }

    function startTimer() {
        stopTimer();
        updateRecordingTime();
        state.timerId = window.setInterval(updateRecordingTime, 500);
    }

    function stopTimer() {
        if (state.timerId !== null) {
            window.clearInterval(state.timerId);
            state.timerId = null;
        }
    }

    function updateRecordingTime() {
        if (!state.recordingStartedAt) {
            elements.recordingTime.textContent = "00:00";
            return;
        }

        const totalSeconds = Math.floor((Date.now() - state.recordingStartedAt) / 1000);

        const minutes = Math.floor(totalSeconds / 60);

        const seconds = totalSeconds % 60;

        elements.recordingTime.textContent =
            `${String(minutes).padStart(2, "0")}:` +
            `${String(seconds).padStart(2, "0")}`;
    }

    function updateUploadSize() {
        const mb = state.uploadedBytes / 1024 / 1024;
        elements.uploadSize.textContent = `Đã lưu: ${mb.toFixed(2)} MB`;
    }


    function resetAllState() {
        stopTimer();
        resetRecordingState();
        state.mimeType = null;
    }

    function closeCurrentStream() {
        if (!state.stream) {
            return;
        }
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
        updatePhotoButtons();
    }

    function revokePreviewUrl() {
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }
    }

    function stopChunkTimer() {
        if (state.chunkTimerId !== null) {
            window.clearInterval(state.chunkTimerId);
            state.chunkTimerId = null;
        }
    }

    function delay(milliseconds) {
        return new Promise(resolve => window.setTimeout(resolve, milliseconds));
    }

    async function capturePhoto() {
        clearError();

        if (!state.stream) throw new Error("Camera chưa được mở.");

        const video = elements.video;

        if (!video.videoWidth || !video.videoHeight) throw new Error("Camera chưa sẵn sàng để chụp.");

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Không thể khởi tạo canvas.");
        }

        if (state.facingMode === "user") {
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                result => result ? resolve(result) : reject(new Error("Không thể tạo ảnh JPEG.")),
                "image/jpeg",
                0.92
            );
        });

        const photo = {
            id: crypto.randomUUID(),
            blob,
            previewUrl: URL.createObjectURL(blob),
            fileName: `photo_${Date.now()}.jpg`,
            status: "pending",
            mediaId: null
        };

        state.photos.push(photo);
        renderPhotoList();
        updatePhotoButtons();
    }

    function resetRecordingState() {
        revokePreviewUrl();

        state.sessionId = null;
        state.recorder = null;
        state.nextChunkNumber = 0;
        state.uploadedBytes = 0;
        state.uploadQueue = Promise.resolve();
        state.previewChunks = [];
        state.recordingStartedAt = null;
        state.isStopping = false;
        state.isPreviewing = false;
        state.hasUploadError = false;

        elements.preview.disabled = true;
        elements.recordingTime.textContent = "00:00";
        updateUploadSize();
    }

    function updateCameraMirror() {
        elements.video.style.transform =
            state.facingMode === "user" && !state.isPreviewing
                ? "scaleX(-1)"
                : "none";
    }

    function renderPhotoList() {
        elements.photoList.empty();

        state.photos.forEach((photo, index) => {
            const isUploaded = photo.status === "uploaded";
            const statusText = isUploaded ? "Đã lưu" : "Chưa submit";

            const item = $(`
            <div data-photo-id="${photo.id}">
                <div class="card h-100">
                    <img class="card-img-top photo-thumbnail"
                         src="${photo.previewUrl}"
                         alt="Ảnh ${index + 1}"
                         style="width:160px;object-fit:cover;aspect-ratio: 5/7;">
                    <div class="card-body p-2">
                        <div class="small mb-2">
                            Ảnh ${index + 1} - ${statusText}
                        </div>
                        <button type="button"
                                class="btn btn-sm btn-outline-danger btn-remove-photo"
                                ${state.isSubmittingPhotos || isUploaded ? "disabled" : ""}>
                            Xóa
                        </button>
                    </div>
                </div>
            </div>
        `);

            elements.photoList.append(item);
        });
    }

    function removePhoto(photoId) {
        const index = state.photos.findIndex(photo => photo.id === photoId);
        if (index < 0) return;

        const photo = state.photos[index];

        if (photo.status === "uploaded") {
            showError("Ảnh này đã được lưu trên server.");
            return;
        }

        URL.revokeObjectURL(photo.previewUrl);
        state.photos.splice(index, 1);

        renderPhotoList();
        updatePhotoButtons();
    }

    function clearPhotos() {
        state.photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));

        state.photos.length = 0;

        renderPhotoList();
        updatePhotoButtons();

        setStatus("Đã xóa toàn bộ hình.");
    }

    async function uploadPhoto(photo) {
        const formData = new FormData();

        formData.append("businessId", String(getBusinessId()));

        /*
         * Ảnh không phụ thuộc video nên không cần gửi videoSessionId.
         * Bỏ hẳn field này.
         */
        formData.append("photo", photo.blob, photo.fileName);

        const response = await fetch("/VideoCapture/UploadPhoto", {
            method: "POST",
            headers: {
                "RequestVerificationToken": getAntiForgeryToken()
            },
            body: formData
        });

        return await readResponse(response);
    }

    async function submitPhotos() {
        clearError();

        if (state.photos.length === 0) throw new Error("Không có hình để submit.");
        state.isSubmittingPhotos = true;
        updatePhotoButtons();

        try {
            for (let i = 0; i < state.photos.length; i++) {
                showError(`Đang upload hình ${i + 1}/${state.photos.length}...`);
                await uploadPhoto(state.photos[i]);
            }

            state.photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
            state.photos.length = 0;

            renderPhotoList();
            updatePhotoButtons();

            showError("Đã lưu toàn bộ hình lên server.");
        }
        finally {
            state.isSubmittingPhotos = false;
            updatePhotoButtons();
        }
    }

    function startAudioTimer() {
        stopAudioTimer();
        updateAudioTime();
        state.audio.timerId = window.setInterval(updateAudioTime, 500);
    }

    function stopAudioTimer() {
        if (state.audio.timerId !== null) {
            window.clearInterval(state.audio.timerId);
            state.audio.timerId = null;
        }
    }

    function updateAudioTime() {
        if (!state.audio.startedAt) {
            elements.audioTime.text('00:00');
            return;
        }

        const totalSeconds = Math.floor((Date.now() - state.audio.startedAt) / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        elements.audioTime.text(
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );
    }

    function stopAudioPreview() {
        const audio = elements.audioPreview[0];
        if (!audio) return;

        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute("src");
        audio.load();

        elements.audioPreview.hide();
    }

    function clearAudioRecording() {
        stopAudioTimer();

        if (state.audio.recorder?.state === "recording") {
            state.audio.isCancelling = true;
            state.audio.recorder.stop();
        } else {
            state.audio.stream?.getTracks().forEach(track => track.stop());
            state.audio.stream = null;
        }

        stopAudioPreview();

        if (state.audio.previewUrl) {
            URL.revokeObjectURL(state.audio.previewUrl);
        }

        state.audio.blob = null;
        state.audio.previewUrl = null;
        state.audio.startedAt = null;
        state.audio.isRecording = false;

        elements.audioTime.text("00:00");
        updateAudioButtons();
    }

    function cancelAudio() {
        clearAudioRecording();
        elements.audioStatus.text('Đã hủy ghi âm');
    }

    async function submitAudio() {
        clearError();

        if (!state.audio.blob)
            throw new Error('Không có file ghi âm để submit.');

        state.audio.isSubmitting = true;
        elements.audioStatus.text('Đang upload ghi âm...');
        updateAudioButtons();

        try {
            const mimeType = state.audio.blob.type || 'audio/webm';
            const extension = mimeType.includes('mp4')
                ? 'm4a'
                : mimeType.includes('ogg')
                    ? 'ogg'
                    : 'webm';

            const formData = new FormData();
            formData.append('businessId', String(getBusinessId()));
            formData.append('audio', state.audio.blob, `audio_${Date.now()}.${extension}`);

            const response = await fetch('/VideoCapture/UploadAudio', {
                method: 'POST',
                headers: {
                    RequestVerificationToken: getAntiForgeryToken()
                },
                body: formData
            });

            const result = await readResponse(response);

            clearAudioRecording();
            elements.audioStatus.text(`Đã lưu ghi âm. Media ID: ${result.mediaId}`);
        } finally {
            state.audio.isSubmitting = false;
            updateAudioButtons();
        }
    }

    function stopAudioRecording() {
        if (!state.audio.recorder || state.audio.recorder.state === 'inactive')
            return;

        state.audio.recorder.stop();
        state.audio.isRecording = false;

        stopAudioTimer();
        elements.audioStatus.text('Đang hoàn tất ghi âm...');
        updateAudioButtons();
    }

    function handleAudioStopped() {
        state.audio.stream?.getTracks().forEach(track => track.stop());
        state.audio.stream = null;
        state.audio.isRecording = false;

        if (state.audio.isCancelling) {
            state.audio.isCancelling = false;
            state.audio.chunks = [];
            updateAudioButtons();
            return;
        }

        const mimeType = state.audio.recorder?.mimeType || 'audio/webm';
        state.audio.blob = new Blob(state.audio.chunks, { type: mimeType });

        if (!state.audio.blob.size) {
            showError('File ghi âm bị rỗng.');
            updateAudioButtons();
            return;
        }

        if (state.audio.previewUrl)
            URL.revokeObjectURL(state.audio.previewUrl);

        state.audio.previewUrl = URL.createObjectURL(state.audio.blob);

        elements.audioPreview
            .attr('src', state.audio.previewUrl)
            .show();

        elements.audioStatus.text(
            `Đã ghi âm (${(state.audio.blob.size / 1024).toFixed(1)} KB)`
        );

        updateAudioButtons();
    }

    async function startAudioRecording() {
        clearError();
        stopAudioPreview();

        if (!window.MediaRecorder)
            throw new Error('Trình duyệt không hỗ trợ MediaRecorder.');

        if (state.audio.isRecording)
            return;

        clearAudioRecording();

        const audioStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        if (audioStream.getAudioTracks().length === 0) {
            audioStream.getTracks().forEach(track => track.stop());
            throw new Error('Không tìm thấy microphone.');
        }

        state.audio.stream = audioStream;

        const mimeType = resolveAudioMimeType();
        const options = mimeType
            ? { mimeType, audioBitsPerSecond: 128000 }
            : undefined;

        state.audio.recorder = new MediaRecorder(audioStream, options);
        state.audio.chunks = [];
        state.audio.blob = null;
        state.audio.isRecording = true;

        state.audio.recorder.addEventListener('dataavailable', event => {
            if (event.data?.size > 0)
                state.audio.chunks.push(event.data);
        });

        state.audio.recorder.addEventListener('stop', handleAudioStopped);
        state.audio.recorder.addEventListener('error', event => {
            state.audio.isRecording = false;
            stopAudioTimer();
            showError(event.error ?? new Error('Ghi âm bị lỗi.'));
            updateAudioButtons();
        });

        state.audio.startedAt = Date.now();
        startAudioTimer();
        state.audio.recorder.start(1000);

        elements.audioStatus.text('● Đang ghi âm');
        elements.audioPreview.hide();
        updateAudioButtons();
    }

    function resolveAudioMimeType() {
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4'
        ];

        return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
    }

    function updateAudioButtons() {
        const audio = state.audio;
        const hasAudio = !!audio.blob;

        elements.audioStart.prop('disabled', audio.isRecording || audio.isSubmitting);
        elements.audioStop.prop('disabled', !audio.isRecording || audio.isSubmitting);
        elements.audioSubmit.prop('disabled', !hasAudio || audio.isRecording || audio.isSubmitting);
        elements.audioCancel.prop('disabled', (!hasAudio && !audio.isRecording) || audio.isSubmitting);
    }
    updateAudioButtons();

    $('#mediaTabs button[data-bs-toggle="tab"]').on('show.bs.tab', function (event) {
        const target = $(this).data('bs-target');
        const isVideoRecording = state.recorder?.state === 'recording' || state.isStopping;
        const isAudioRecording = state.audio.recorder?.state === 'recording';

        if (target === '#audio-pane' && isVideoRecording) {
            event.preventDefault();
            showError('Hãy dừng hoặc hủy video trước khi chuyển sang ghi âm.');
            return;
        }

        if (target === '#camera-pane' && isAudioRecording) {
            event.preventDefault();
            showError('Hãy dừng ghi âm trước khi chuyển sang camera.');
        }
        clearError();
    });

    $('#mediaTabs button[data-bs-toggle="tab"]').on('shown.bs.tab', async function () {
        const target = $(this).data('bs-target');

        try {
            if (target === '#audio-pane') {
                await stopSubtitle();
                closeCurrentStream();
                elements.video.pause();
                elements.video.srcObject = null;
                elements.video.removeAttribute('src');
                setStatus('Camera Off');
                setButtons('initial');
                updateAudioButtons();
                return;
            }

            if (target === '#camera-pane' && !state.stream) {
                setStatus('Đang mở camera...');
                await openCamera();
            }
        } catch (error) {
            showError(error);
        }
    });

    // Speech to text
    async function startSubtitle() {
        const subtitle = state.subtitle;

        if (subtitle.enabled || subtitle.isStarting) {
            return;
        }

        subtitle.isStarting = true;
        clearError();

        try {
            if (!state.stream) {
                await openCamera();
            }

            if (state.stream.getAudioTracks().length === 0) {
                throw new Error("Không lấy được microphone.");
            }

            const protocol =
                location.protocol === "https:"
                    ? "wss://"
                    : "ws://";

            const socket = new WebSocket(
                protocol + location.host + "/ws/voice"
            );

            socket.binaryType = "arraybuffer";
            subtitle.socket = socket;

            socket.onmessage = handleSubtitleMessage;

            socket.onerror = error => {
                console.error("Subtitle websocket error:", error);
            };

            socket.onclose = () => {
                if (subtitle.enabled) {
                    stopSubtitleLocal();
                    showError("Kết nối Speech To Text đã bị ngắt.");
                }
            };

            await waitForWebSocketOpen(socket);

            const audioContext = new AudioContext();

            subtitle.audioContext = audioContext;

            await audioContext.audioWorklet.addModule(
                "/js/pcm-worklet.js"
            );

            await audioContext.resume();

            const source =
                audioContext.createMediaStreamSource(
                    state.stream
                );

            const workletNode =
                new AudioWorkletNode(
                    audioContext,
                    "pcm-worklet-processor"
                );

            subtitle.source = source;
            subtitle.workletNode = workletNode;

            workletNode.port.onmessage = event => {
                if (
                    subtitle.socket?.readyState ===
                    WebSocket.OPEN
                ) {
                    subtitle.socket.send(event.data);
                }
            };

            source.connect(workletNode);

            // Giữ worklet hoạt động nhưng không phát mic ra loa.
            const silentGain =
                audioContext.createGain();

            silentGain.gain.value = 0;

            subtitle.silentGain = silentGain;

            workletNode.connect(silentGain);
            silentGain.connect(audioContext.destination);

            subtitle.enabled = true;

            elements.subtitleOverlay.style.display =
                "block";

            elements.subtitleToggle.textContent =
                "Stop Speech To Text";

            elements.subtitleToggle.classList.remove(
                "btn-outline-secondary"
            );

            elements.subtitleToggle.classList.add(
                "btn-secondary"
            );
        }
        catch (error) {
            await stopSubtitle();
            throw error;
        }
        finally {
            subtitle.isStarting = false;
        }
    }

    async function stopSubtitle() {
        const subtitle = state.subtitle;

        subtitle.enabled = false;

        if (subtitle.workletNode) {
            subtitle.workletNode.port.onmessage = null;

            try {
                subtitle.workletNode.disconnect();
            } catch {
            }

            subtitle.workletNode = null;
        }

        if (subtitle.source) {
            try {
                subtitle.source.disconnect();
            } catch {
            }

            subtitle.source = null;
        }

        if (subtitle.silentGain) {
            try {
                subtitle.silentGain.disconnect();
            } catch {
            }

            subtitle.silentGain = null;
        }

        if (subtitle.audioContext) {
            try {
                await subtitle.audioContext.close();
            } catch {
            }

            subtitle.audioContext = null;
        }

        if (subtitle.socket) {
            const socket = subtitle.socket;

            subtitle.socket = null;

            if (
                socket.readyState === WebSocket.OPEN ||
                socket.readyState === WebSocket.CONNECTING
            ) {
                try {
                    socket.close(
                        1000,
                        "subtitle stopped"
                    );
                } catch {
                }
            }
        }

        elements.subtitleOverlay.style.display =
            "none";

        elements.subtitleOverlay.textContent = "";

        elements.subtitleToggle.textContent =
            "Speech To Text";

        elements.subtitleToggle.classList.remove(
            "btn-secondary"
        );

        elements.subtitleToggle.classList.add(
            "btn-outline-secondary"
        );
    }

    function stopSubtitleLocal() {
        const subtitle = state.subtitle;

        subtitle.enabled = false;

        try {
            subtitle.workletNode?.disconnect();
        } catch {
        }

        try {
            subtitle.source?.disconnect();
        } catch {
        }

        try {
            subtitle.silentGain?.disconnect();
        } catch {
        }

        subtitle.workletNode = null;
        subtitle.source = null;
        subtitle.silentGain = null;
        subtitle.socket = null;

        if (subtitle.audioContext) {
            subtitle.audioContext
                .close()
                .catch(() => { });

            subtitle.audioContext = null;
        }

        elements.subtitleOverlay.style.display =
            "none";

        elements.subtitleOverlay.textContent = "";

        elements.subtitleToggle.textContent =
            "Speech To Text";
    }

    function waitForWebSocketOpen(socket) {
        return new Promise((resolve, reject) => {
            if (
                socket.readyState ===
                WebSocket.OPEN
            ) {
                resolve();
                return;
            }

            const onOpen = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();

                reject(
                    new Error(
                        "Không kết nối được Speech To Text server."
                    )
                );
            };

            const onClose = () => {
                cleanup();

                reject(
                    new Error(
                        "Speech To Text server đã đóng kết nối."
                    )
                );
            };

            function cleanup() {
                socket.removeEventListener(
                    "open",
                    onOpen
                );

                socket.removeEventListener(
                    "error",
                    onError
                );

                socket.removeEventListener(
                    "close",
                    onClose
                );
            }

            socket.addEventListener(
                "open",
                onOpen
            );

            socket.addEventListener(
                "error",
                onError
            );

            socket.addEventListener(
                "close",
                onClose
            );
        });
    }

    function handleSubtitleMessage(event) {
        let result;

        try {
            result = JSON.parse(event.data);
        }
        catch {
            console.warn(
                "Invalid Speech To Text response:",
                event.data
            );

            return;
        }

        const text =
            String(result.text ?? "").trim();

        if (!text) {
            return;
        }

        if (result.type === "partial") {
            state.subtitle.currentText = text;

            renderSubtitle();

            return;
        }

        // server cũ trả { text } cũng xử lý như final
        commitSubtitleText(text);
    }

    function renderSubtitle() {
        const subtitle = state.subtitle;

        elements.subtitleOverlay.textContent =
            subtitle.currentText;

        elements.transcript.value =
            subtitle.finalText +
            subtitle.currentText;
    }

    function commitSubtitleText(text) {
        const subtitle = state.subtitle;

        let normalizedText = text.trim();

        if (
            normalizedText &&
            !/[。！？!?]$/.test(normalizedText)
        ) {
            normalizedText += "。";
        }

        subtitle.finalText +=
            normalizedText;

        subtitle.currentText = "";

        elements.subtitleOverlay.textContent =
            normalizedText;

        elements.transcript.value =
            subtitle.finalText;
    }

    async function toggleSubtitle() {
        if (
            state.subtitle.enabled ||
            state.subtitle.isStarting
        ) {
            await stopSubtitle();
            return;
        }

        await startSubtitle();
    }

    elements.subtitleToggle?.addEventListener(
        "click",
        () => toggleSubtitle().catch(showError)
    );

    elements.audioStart.on('click', () => startAudioRecording().catch(showError));
    elements.audioStop.on('click', stopAudioRecording);
    elements.audioSubmit.on('click', () => submitAudio().catch(showError));
    elements.audioCancel.on('click', cancelAudio);

    elements.photoList.on("click", ".btn-remove-photo", function () {
        const photoId = $(this).closest("[data-photo-id]").data("photo-id");
        removePhoto(photoId);
    });
    elements.capturePhoto.on("click", () => capturePhoto().catch(showError));
    elements.submitPhotos.on("click", () => submitPhotos().catch(showError));
    elements.clearPhotos.on("click", clearPhotos);

    elements.preview.addEventListener("click", previewVideo);
    elements.start.addEventListener("click", () => startRecording().catch(showError));
    elements.stop.addEventListener("click", stopRecording);
    elements.submit.addEventListener("click", () => submitVideo().catch(error => {
        showError(error);
        setButtons("preview");
    }));
    elements.cancel.addEventListener("click", () => cancelVideo().catch(showError));
    window.addEventListener('beforeunload', () => {
        state.photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
        state.audio.stream?.getTracks().forEach(track => track.stop());

        if (state.audio.previewUrl)
            URL.revokeObjectURL(state.audio.previewUrl);

        closeCurrentStream();
    });
    elements.switchCamera?.addEventListener("click", switchCamera);

    setButtons("initial");
})();