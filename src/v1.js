// V1 版本的语音朗读实现
export class V1Reader {
    constructor() {
        this.voiceSelect = document.getElementById('voice-select');
        this.speedControl = document.getElementById('speed-control');
        this.speedValue = document.getElementById('speed-value');
        this.playBtn = document.getElementById('play-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.textLayer = document.getElementById('text-layer');
        this.readingStatus = document.getElementById('reading-status');

        this.config = null;
        this.currentVoice = null;
        this.isReading = false;
        this.isPaused = false;
        this.lastHighlightPosition = 0;
        this.currentText = '';
        this.readingEnabled = false;

        // 速度值映射
        this.speedLabels = ['极慢', '很慢', '较慢', '正常', '较快', '快', '很快', '极快'];

        this.initEventListeners();
    }

    initEventListeners() {
        this.speedControl.addEventListener('input', () => {
            const value = parseInt(this.speedControl.value);
            this.speedValue.textContent = this.speedLabels[value];
            this.saveConfig();
        });

        this.voiceSelect.addEventListener('change', () => {
            this.saveConfig();
        });

        this.textLayer.addEventListener('input', () => {
            if (!this.isReading) {
                this.currentText = this.textLayer.textContent;
                this.saveConfig();
            }
        });

        this.textLayer.addEventListener('click', async (event) => {
            if (!this.readingEnabled) return;
            const position = this.getTextPosition(this.textLayer, event.clientX, event.clientY);

            if (this.isReading || this.isPaused) {
                await window.speechAPI.stop();
                this.onReadingEnd();
            }

            setTimeout(() => {
                this.startReadingFromPosition(position);
            }, 100);
        });

        // 按钮事件
        this.playBtn.addEventListener('click', async () => {
            this.readingEnabled = !this.readingEnabled;
            if (!this.readingEnabled && (this.isReading || this.isPaused)) {
                await window.speechAPI.stop();
                this.isReading = false;
                this.isPaused = false;
                window.getSelection().removeAllRanges();
                this.lastHighlightPosition = 0;
            } else if (this.readingEnabled && this.textLayer.textContent.trim()) {
                await window.speechAPI.stop();
                setTimeout(() => {
                    this.startReadingFromPosition(0);
                }, 100);
            }
            this.updateButtonStates();
            this.saveConfig();
        });

        this.pauseBtn.addEventListener('click', async () => {
            if (!this.pauseBtn.disabled && this.isReading) {
                if (!this.isPaused) {
                    // 暂停朗读
                    await window.speechAPI.pause();
                    this.isPaused = true;
                } else {
                    // 继续朗读
                    await window.speechAPI.resume();
                    this.isPaused = false;
                }
                this.updateButtonStates();
            }
        });

        this.stopBtn.addEventListener('click', () => {
            if (!this.stopBtn.disabled && (this.isReading || this.isPaused)) {
                window.speechAPI.stop();
                this.isReading = false;
                this.isPaused = false;
                window.getSelection().removeAllRanges();
                this.updateButtonStates();
            }
        });
    }

    getSpeedValue(rawValue) {
        return 0.1 + (rawValue * 1.414);
    }

    saveConfig() {
        const currentConfig = window.utools.dbStorage.getItem('voice-config') || {};
        const newConfig = {
            ...currentConfig,
            voice: this.voiceSelect.value,
            speed: this.speedControl.value,
            v1: {
                ...currentConfig.v1,
                readingEnabled: this.readingEnabled
            }
        };
        window.utools.dbStorage.setItem('voice-config', newConfig);
    }

    loadConfig() {
        this.config = window.utools.dbStorage.getItem('voice-config');
        if (this.config) {
            if (this.config.voice) {
                this.voiceSelect.value = this.config.voice;
                this.currentVoice = this.config.voice;
            }
            if (this.config.speed) {
                this.speedControl.value = this.config.speed;
                this.speedValue.textContent = this.speedLabels[this.config.speed];
            }
            if (this.config.v1?.readingEnabled !== undefined) {
                this.readingEnabled = this.config.v1.readingEnabled;
                this.updateButtonStates();
            }
        }
    }

    async initVoices() {
        try {
            const voices = await window.speechAPI.getVoices();
            this.voiceSelect.innerHTML = voices
                .map(voice => `<option value="${voice.name}">${voice.name} (${voice.lang})</option>`)
                .join('');
            this.currentVoice = voices[0]?.name;
        } catch (error) {
            console.error('初始化语音失败:', error);
            this.readingStatus.textContent = '初始化失败';
        }
    }

    getTextPosition(element, x, y) {
        const range = document.caretRangeFromPoint(x, y);
        if (!range) return 0;

        const textNode = range.startContainer;
        let position = range.startOffset;

        const treeWalker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while ((node = treeWalker.nextNode()) !== null && node !== textNode) {
            position += node.textContent.length;
        }

        return position;
    }

    updateReadingPosition(position, length) {
        if (this.highlightUpdatePending) return;
        this.highlightUpdatePending = true;

        requestAnimationFrame(() => {
            try {
                window.speechAPI.highlight(position, length);
            } catch (error) {
                console.error('更新高亮位置失败:', error);
            }
            this.highlightUpdatePending = false;
        });

        this.lastHighlightPosition = position;
    }

    onReadingEnd() {
        this.isReading = false;
        this.isPaused = false;
        this.lastHighlightPosition = 0;
        window.getSelection().removeAllRanges();
        this.readingStatus.textContent = this.readingEnabled ? '已开启朗读' : '已关闭朗读';
        this.updateButtonStates();
    }

    async startReadingFromPosition(position) {
        this.currentText = this.textLayer.textContent;

        if (!this.currentText || this.currentText.trim() === '') {
            return;
        }

        if (position >= this.currentText.length) {
            return;
        }

        const textToRead = this.currentText.substring(position);
        this.readingStatus.textContent = '正在朗读...';
        this.isReading = true;
        this.isPaused = false;
        this.lastHighlightPosition = position;
        this.updateButtonStates();

        try {
            const rawSpeed = parseInt(this.speedControl.value);
            const mappedSpeed = this.getSpeedValue(rawSpeed);

            const success = await window.speechAPI.speak(
                textToRead,
                this.voiceSelect.value || this.currentVoice,
                mappedSpeed,
                (pos, length) => this.updateReadingPosition(position + pos, length),
                () => this.onReadingEnd()
            );

            if (!success) {
                throw new Error('朗读失败');
            }
        } catch (error) {
            console.error('朗读失败:', error);
            this.readingStatus.textContent = '朗读失败';
            this.onReadingEnd();
        }
    }

    updateButtonStates() {
        this.playBtn.disabled = false;
        this.playBtn.textContent = this.readingEnabled ? '关闭朗读' : '开启朗读';
        this.playBtn.style.background = this.readingEnabled ? '#666' : '#f8f9fa';
        this.playBtn.style.color = this.readingEnabled ? 'white' : '#333';

        this.pauseBtn.disabled = !this.readingEnabled || !this.isReading;
        this.pauseBtn.style.opacity = this.pauseBtn.disabled ? '0.5' : '1';
        if (this.isReading && !this.pauseBtn.disabled) {
            this.pauseBtn.textContent = this.isPaused ? '继续朗读' : '暂停';
        } else {
            this.pauseBtn.textContent = '暂停';
        }

        this.stopBtn.disabled = !this.readingEnabled || (!this.isReading && !this.isPaused);
        this.stopBtn.style.opacity = this.stopBtn.disabled ? '0.5' : '1';

        if (!this.readingEnabled) {
            this.readingStatus.textContent = '已关闭朗读';
        } else if (this.isReading) {
            this.readingStatus.textContent = this.isPaused ? '已暂停' : '正在朗读...';
        } else {
            this.readingStatus.textContent = '已开启朗读';
        }
    }

    async init() {
        await this.initVoices();
        this.loadConfig();
        this.updateButtonStates();
    }
} 