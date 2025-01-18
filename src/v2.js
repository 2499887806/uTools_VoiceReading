// V2 版本的语音朗读实现
const { EdgeTTS } = window.EdgeTTS;

export class V2Reader {
    constructor() {
        this.voiceSelect = document.getElementById('voice-select-v2');
        this.speedControl = document.getElementById('speed-control-v2');
        this.speedValue = document.getElementById('speed-value-v2');
        this.volumeControl = document.getElementById('volume-control-v2');
        this.volumeValue = document.getElementById('volume-value-v2');
        this.playBtn = document.getElementById('play-btn-v2');
        this.pauseBtn = document.getElementById('pause-btn-v2');
        this.stopBtn = document.getElementById('stop-btn-v2');
        this.textLayer = document.getElementById('text-layer-v2');
        this.readingStatus = document.getElementById('reading-status-v2');
        this.saveMp3Btn = document.getElementById('save-mp3-btn-v2');

        this.config = null;
        this.currentVoice = null;
        this.isReading = false;
        this.isPaused = false;
        this.lastHighlightPosition = 0;
        this.currentText = '';
        this.readingEnabled = false;
        this.tts = null;
        this.tempFiles = new Set(); // 跟踪临时文件
        this.audioCache = new Map(); // 缓存音频文件
        this.currentAudioFile = null; // 当前播放的音频文件
        this.currentSubtitles = []; // 当前的字幕数据
        this.currentTextHash = null; // 当前文本的哈希值
        this.inUseFiles = new Set(); // 正在使用的文件
        this.isSaving = false; // 是否正在保存MP3
        this.timeout = 1000 * 60 * 5;
        // 监听应用退出事件
        window.utools.onPluginOut(() => {
            this.cleanup();
        });

        // 设置语速范围 (-100% 到 +100%)
        this.speedControl.min = -100;
        this.speedControl.max = 100;
        this.speedControl.value = 0;
        this.speedValue.textContent = '0%';

        // 设置音量范围 (0% 到 100%)
        this.volumeControl.min = 0;
        this.volumeControl.max = 100;
        this.volumeControl.value = 100;
        this.volumeValue.textContent = '100%';

        this.initEventListeners();
        this.initTTS();
    }

    initEventListeners() {
        this.speedControl.addEventListener('input', () => {
            const value = parseInt(this.speedControl.value);
            this.speedValue.textContent = `${value}%`;
            this.updateTTSConfig();
            this.saveConfig();
            this.currentTextHash = null;
        });

        this.voiceSelect.addEventListener('change', () => {
            this.currentVoice = this.voiceSelect.value;
            this.updateTTSConfig();
            this.saveConfig();
            this.currentTextHash = null;
        });

        this.volumeControl.addEventListener('input', () => {
            const value = parseInt(this.volumeControl.value);
            this.volumeValue.textContent = `${value}%`;
            this.updateTTSConfig();
            this.saveConfig();
            this.currentTextHash = null;
        });

        this.textLayer.addEventListener('input', () => {
            if (!this.isReading) {
                this.currentText = this.textLayer.textContent;
                this.updateCurrentTextHash();
                this.saveConfig();
            }
        });

        this.textLayer.addEventListener('click', async (event) => {
            if (!this.readingEnabled) return;
            const position = this.getTextPosition(this.textLayer, event.clientX, event.clientY);

            if (this.isReading || this.isPaused) {
                await window.speechAPI.stop();
                this.onReadingEnd();
                // 添加延迟以确保之前的音频完全停止
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            this.startReadingFromPosition(position);
        });

        // 按钮事件
        this.playBtn.addEventListener('click', async () => {
            this.readingEnabled = !this.readingEnabled;
            if (!this.readingEnabled) {
                // 如果正在朗读或暂停状态，先停止当前朗读
                if (this.isReading || this.isPaused) {
                    await window.speechAPI.stop();
                    this.isReading = false;
                    this.isPaused = false;
                    window.getSelection().removeAllRanges();
                    this.lastHighlightPosition = 0;
                }
                this.readingStatus.textContent = '已关闭朗读';
            } else {
                this.readingStatus.textContent = '已开启朗读';
                // 如果有文本，自动开始朗读
                if (this.textLayer.textContent.trim()) {
                    // 等待一小段时间确保UI更新完成
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // 从头开始朗读
                    this.startReadingFromPosition(0);
                }
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
                    this.readingStatus.textContent = '已暂停';
                } else {
                    // 继续朗读
                    await window.speechAPI.resume();
                    this.isPaused = false;
                    this.readingStatus.textContent = '正在朗读...';
                }
                this.updateButtonStates();
            }
        });

        this.stopBtn.addEventListener('click', async () => {
            if (!this.stopBtn.disabled && (this.isReading || this.isPaused)) {
                await window.speechAPI.stop();
                if (this.currentAudioFile) {
                    this.inUseFiles.delete(this.currentAudioFile);
                }
                this.isReading = false;
                this.isPaused = false;
                window.getSelection().removeAllRanges();
                this.lastHighlightPosition = 0;
                this.updateButtonStates();
            }
        });

        // 添加保存MP3按钮事件
        this.saveMp3Btn.addEventListener('click', async () => {
            if (this.isSaving) return;

            const text = this.textLayer.textContent.trim();
            if (!text) {
                this.readingStatus.textContent = '没有可保存的文本';
                return;
            }

            try {
                this.isSaving = true;
                this.saveMp3Btn.classList.add('loading');
                this.saveMp3Btn.disabled = true;

                // 确保TTS配置是最新的
                this.updateTTSConfig();

                // 预处理文本
                const processedText = this.preprocessText(text);

                // 生成临时文件名
                const textHash = this.generateTextHash(
                    processedText,
                    this.currentVoice,
                    this.speedControl.value,
                    this.volumeControl.value
                );
                const tempFile = `edge-tts-${textHash}.mp3`;
                const tempPath = window.speechAPI.getTempFilePath(tempFile);

                // 检查文件是否已存在
                const fileExists = await window.speechAPI.fileExists(tempPath);
                if (!fileExists) {
                    // 生成新的音频文件
                    await this.tts.ttsPromise(processedText, tempPath);
                }

                // 生成文件名（使用当前时间）
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hour = String(now.getHours()).padStart(2, '0');
                const minute = String(now.getMinutes()).padStart(2, '0');
                const second = String(now.getSeconds()).padStart(2, '0');

                const timestamp = `${year}-${month}-${day}_${hour}-${minute}-${second}`;
                const defaultPath = `语音朗读_${timestamp}.mp3`;
                console.log('准备保存文件:', {
                    tempPath,
                    defaultPath,
                    textLength: text.length,
                    processedTextLength: processedText.length,
                    voice: this.currentVoice,
                    speed: this.speedControl.value,
                    volume: this.volumeControl.value
                });

                // 打开保存对话框
                const savePath = await window.utools.showSaveDialog({
                    title: '保存MP3文件',
                    defaultPath: defaultPath,
                    filters: [{ name: 'MP3文件', extensions: ['mp3'] }]
                });

                if (savePath) {
                    console.log('用户选择的保存路径:', savePath);
                    try {
                        // 复制文件到目标位置
                        await window.speechAPI.copyFile(tempPath, savePath);

                        // 获取文件大小
                        const fileSize = window.speechAPI.getFileSize(savePath);
                        console.log('文件保存成功:', {
                            源文件: tempPath,
                            目标文件: savePath,
                            文件大小: fileSize + ' bytes'
                        });

                        // 验证文件是否存在
                        if (await window.speechAPI.fileExists(savePath)) {
                            this.readingStatus.textContent = '文件保存成功';
                            setTimeout(() => {
                                if (!this.isReading) {
                                    this.readingStatus.textContent = this.readingEnabled ? '已开启朗读' : '已关闭朗读';
                                }
                            }, 2000);
                        } else {
                            throw new Error('文件保存失败：目标文件不存在');
                        }
                    } catch (err) {
                        console.error('文件复制失败:', err);
                        throw new Error(`文件保存失败: ${err.message}`);
                    }
                } else {
                    console.log('用户取消了保存操作');
                }
            } catch (error) {
                console.error('保存MP3失败:', error);
                this.readingStatus.textContent = '保存失败: ' + error.message;
            } finally {
                this.isSaving = false;
                this.saveMp3Btn.classList.remove('loading');
                this.saveMp3Btn.disabled = false;
            }
        });
    }

    saveConfig() {
        const currentConfig = window.utools.dbStorage.getItem('voice-config') || {};
        const newConfig = {
            ...currentConfig,
            v2: {
                ...currentConfig.v2,
                voice: this.voiceSelect.value,
                speed: this.speedControl.value,
                volume: this.volumeControl.value,
                readingEnabled: this.readingEnabled,
                pitch: '0%'
            }
        };
        console.log('保存V2配置:', newConfig);
        window.utools.dbStorage.setItem('voice-config', newConfig);
    }

    loadConfig() {
        this.config = window.utools.dbStorage.getItem('voice-config');
        console.log('加载V2配置:', this.config);
        if (this.config?.v2) {
            const { voice, speed, volume, readingEnabled } = this.config.v2;

            if (voice) {
                this.voiceSelect.value = voice;
                this.currentVoice = voice;
            }

            if (speed !== undefined) {
                const speedValue = parseInt(speed);
                // 确保语速在新的范围内
                this.speedControl.value = Math.max(-100, Math.min(100, speedValue));
                this.speedValue.textContent = `${this.speedControl.value}%`;
            } else {
                this.speedControl.value = 0;
                this.speedValue.textContent = '0%';
            }

            if (readingEnabled !== undefined) {
                this.readingEnabled = readingEnabled;
                if (this.readingEnabled) {
                    this.readingStatus.textContent = '已开启朗读';
                } else {
                    this.readingStatus.textContent = '已关闭朗读';
                }
            }

            // 加载音量设置
            if (volume !== undefined) {
                const volumeValue = parseInt(volume);
                // 确保音量在新的范围内
                this.volumeControl.value = Math.max(0, Math.min(100, volumeValue));
                this.volumeValue.textContent = `${this.volumeControl.value}%`;
            } else {
                this.volumeControl.value = 100;
                this.volumeValue.textContent = '100%';
            }

            // 重新初始化 TTS
            this.initTTS();
            this.updateButtonStates();
        }
    }

    async initVoices() {
        try {
            const voices = await window.speechAPI.getEdgeVoices();

            // 创建一个容器元素
            const container = document.createElement('div');
            container.id = 'voice-select-v2-container';

            // 创建自定义下拉列表容器
            const customSelect = document.createElement('div');
            customSelect.className = 'custom-select';

            // 创建选中项显示区域
            const selectedItem = document.createElement('div');
            selectedItem.className = 'selected-item';
            selectedItem.innerHTML = '<span></span><i style="border: solid #666; border-width: 0 2px 2px 0; display: inline-block; padding: 3px; transform: rotate(45deg);"></i>';

            // 创建下拉列表
            const dropdown = document.createElement('div');
            dropdown.className = 'voice-dropdown';

            // 按语言分组
            const groups = {};
            voices.forEach(voice => {
                const category = voice.Category;
                if (!groups[category]) {
                    groups[category] = {
                        name: category,
                        voices: []
                    };
                }
                groups[category].voices.push(voice);
            });

            // 生成语音选择列表
            Object.entries(groups).forEach(([category, group]) => {
                if (group.voices.length > 0) {
                    const categoryDiv = document.createElement('div');
                    categoryDiv.className = 'voice-category';
                    categoryDiv.textContent = group.name;
                    dropdown.appendChild(categoryDiv);

                    const voicesFragment = document.createDocumentFragment();
                    group.voices.forEach(voice => {
                        const item = document.createElement('div');
                        item.className = 'voice-item';
                        item.dataset.value = voice.ShortName;

                        const content = `
                            <span class="gender-icon ${voice.Gender.toLowerCase()}">${voice.Gender === 'Female' ? '女' : '男'}</span>
                            <span class="voice-info">
                                <span class="voice-name">${voice.LocalName}</span>
                                <span class="voice-locale">${voice.Locale}</span>
                                <span class="voice-region">[${voice.Region}]</span>
                            </span>
                        `;
                        item.innerHTML = content;

                        item.addEventListener('click', () => {
                            this.currentVoice = voice.ShortName;
                            const selectedContent = `
                                <span class="gender-icon ${voice.Gender.toLowerCase()}">${voice.Gender === 'Female' ? '女' : '男'}</span>
                                <span class="voice-info">
                                    <span class="voice-name">${voice.LocalName}</span>
                                    <span class="voice-locale">${voice.Locale}</span>
                                    <span class="voice-region">[${voice.Region}]</span>
                                </span>
                            `;
                            selectedItem.querySelector('span').innerHTML = selectedContent;
                            dropdown.style.display = 'none';
                            this.updateTTSConfig();
                            this.saveConfig();
                            this.currentTextHash = null;
                        });

                        voicesFragment.appendChild(item);
                    });
                    dropdown.appendChild(voicesFragment);
                }
            });

            // 使用事件委托处理点击事件
            selectedItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = dropdown.style.display === 'block';
                dropdown.style.display = isVisible ? 'none' : 'block';
            });

            document.addEventListener('click', () => {
                dropdown.style.display = 'none';
            });

            customSelect.appendChild(selectedItem);
            customSelect.appendChild(dropdown);
            container.appendChild(customSelect);

            // 替换原有的select元素
            this.voiceSelect.style.display = 'none';
            this.voiceSelect.parentNode.insertBefore(container, this.voiceSelect);

            // 设置默认选中项
            let defaultVoice;
            if (this.config?.v2?.voice) {
                defaultVoice = voices.find(v => v.ShortName === this.config.v2.voice);
            }
            if (!defaultVoice) {
                defaultVoice = voices.find(v => v.Locale === 'zh-CN' && v.Gender === 'Female');
            }
            if (defaultVoice) {
                this.currentVoice = defaultVoice.ShortName;
                const selectedContent = `
                    <span class="gender-icon ${defaultVoice.Gender.toLowerCase()}">${defaultVoice.Gender === 'Female' ? '女' : '男'}</span>
                    <span class="voice-info">
                        <span class="voice-name">${defaultVoice.LocalName}</span>
                        <span class="voice-locale">${defaultVoice.Locale}</span>
                        <span class="voice-region">[${defaultVoice.Region}]</span>
                    </span>
                `;
                selectedItem.querySelector('span').innerHTML = selectedContent;
            }

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

        // 确保参数有效
        if (position < 0) position = 0;
        if (length <= 0) length = 1;

        // 确保不超过文本总长度
        const totalLength = this.currentText.length;
        if (position >= totalLength) {
            position = Math.max(0, totalLength - 1);
        }
        if (position + length > totalLength) {
            length = totalLength - position;
        }

        requestAnimationFrame(() => {
            try {
                window.speechAPI.highlight(position, length);
            } catch (error) {
                console.error('更新高亮位置失败:', error);
            }
            this.highlightUpdatePending = false;
        });
    }

    onReadingEnd() {
        this.isReading = false;
        this.isPaused = false;
        this.lastHighlightPosition = 0;
        window.getSelection().removeAllRanges();
        this.readingStatus.textContent = this.readingEnabled ? '已开启朗读' : '已关闭朗读';
        this.updateButtonStates();
    }

    // 生成文本的唯一标识符
    generateTextHash(text, voice, speed, volume) {
        return window.speechAPI.generateHash(`${text}-${voice}-${speed}-${volume}`);
    }

    // 清理临时文件
    async cleanup() {
        const tempDir = window.speechAPI.getTempDir();
        try {
            const files = await window.speechAPI.readDir(tempDir);
            const edgeFiles = files.filter(file => file.startsWith('edge-tts-'));

            console.log('准备清理的文件:', edgeFiles);

            // 删除所有找到的文件
            for (const fileName of edgeFiles) {
                try {
                    const fullPath = window.speechAPI.getTempFilePath(fileName);
                    // 删除音频文件
                    await window.speechAPI.deleteFile(fullPath);
                    // 删除字幕文件
                    await window.speechAPI.deleteFile(fullPath + '.json');
                    console.log('成功清理文件:', fileName);
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        console.error('清理文件失败:', fileName, error);
                    }
                }
            }
        } catch (error) {
            console.error('读取临时目录失败:', error);
        }
    }

    async startReadingFromPosition(position) {
        let outputFile = null;
        let success = false;

        try {
            this.currentText = this.textLayer.textContent;

            if (!this.currentText || this.currentText.trim() === '') {
                this.readingStatus.textContent = '没有可朗读的文本';
                return;
            }

            if (position >= this.currentText.length) {
                this.readingStatus.textContent = '已到达文本末尾';
                return;
            }

            let textToRead = this.currentText.substring(position);
            textToRead = this.preprocessText(textToRead);

            this.readingStatus.textContent = '正在准备朗读...';
            this.isReading = true;
            this.isPaused = false;
            this.lastHighlightPosition = position;
            this.updateButtonStates();

            // 如果没有当前哈希值，重新计算
            if (!this.currentTextHash) {
                this.updateCurrentTextHash();
            }

            // 使用当前的哈希值
            const textHash = this.currentTextHash;
            console.log('使用文本哈希:', textHash);

            // 生成文件名和路径
            outputFile = `edge-tts-${textHash}.mp3`;
            const fullPath = window.speechAPI.getTempFilePath(outputFile);
            console.log('音频文件路径:', fullPath);

            // 检查缓存状态
            const inCache = this.audioCache.has(textHash);
            console.log('缓存状态:', {
                inCache,
                cacheSize: this.audioCache.size,
                tempFiles: Array.from(this.tempFiles),
                inUseFiles: Array.from(this.inUseFiles)
            });

            // 标记文件为正在使用
            this.inUseFiles.add(outputFile);
            this.currentAudioFile = outputFile;

            // 检查文件是否存在
            const fileExists = await window.speechAPI.fileExists(fullPath);
            console.log('文件是否存在:', fileExists);

            // 如果文件在缓存中且存在，或者文件存在（即使不在缓存中）
            if (fileExists) {
                console.log('使用已存在的音频文件:', outputFile);
                if (!inCache) {
                    // 如果文件存在但不在缓存中，添加到缓存
                    this.audioCache.set(textHash, true);
                    this.tempFiles.add(outputFile);
                }

                // 读取字幕文件
                const subtitlesPath = fullPath + '.json';
                try {
                    // 先检查字幕文件是否存在
                    const subtitlesExists = await window.speechAPI.fileExists(subtitlesPath);
                    if (subtitlesExists) {
                        const subtitlesContent = await window.speechAPI.readFile(subtitlesPath);
                        this.currentSubtitles = JSON.parse(subtitlesContent);
                    } else {
                        console.log('字幕文件不存在，继续播放音频');
                        this.currentSubtitles = [];
                    }
                } catch (error) {
                    console.log('处理字幕文件时出错，继续播放音频:', error);
                    this.currentSubtitles = [];
                }

                // 如果是从中间位置开始，使用 startPlayingFromTime
                if (position > 0) {
                    const startTimeMs = this.calculateStartTime(position);
                    await this.startPlayingFromTime(startTimeMs);
                    return;
                }

                // 从头开始播放
                this.readingStatus.textContent = '正在朗读...';
                // 检查是否还允许朗读
                if (!this.readingEnabled) {
                    console.log('朗读已关闭，取消播放');
                    return;
                }
                success = await window.speechAPI.playAudioFile(
                    outputFile,
                    (currentTime) => this.handleTimeUpdate(currentTime, position),
                    () => this.handlePlaybackEnd(outputFile, position, textToRead)
                );

                if (!success) {
                    throw new Error('播放失败');
                }
            } else {
                // 确保使用最新的配置
                this.updateTTSConfig();

                try {
                    this.readingStatus.textContent = '正在生成语音...';

                    // 创建进度监控
                    let isGenerating = true;
                    let lastSize = 0;
                    let startTime = Date.now();

                    const progressChecker = setInterval(async () => {
                        if (!isGenerating) return;

                        try {
                            const exists = await window.speechAPI.fileExists(fullPath);
                            if (exists) {
                                const fileSize = await window.speechAPI.getFileSize(fullPath);
                                if (fileSize > 0 && fileSize !== lastSize) {
                                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                                    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
                                    const speed = (fileSize / 1024 / elapsedSeconds).toFixed(1);
                                    this.readingStatus.textContent = `已生成: ${sizeMB}MB (${speed} KB/s)`;
                                    lastSize = fileSize;
                                }
                            }
                        } catch (error) {
                            // 忽略文件不存在的错误
                            if (error.code !== 'ENOENT') {
                                console.log('检查文件大小失败:', error);
                            }
                        }
                    }, 100);

                    // 开始生成语音
                    const generatePromise = this.tts.ttsPromise(textToRead, fullPath);

                    // 设置超时处理
                    const timeoutPromise = new Promise((resolve, reject) => {
                        setTimeout(() => {
                            reject(new Error('生成超时'));
                        }, this.timeout);
                    });

                    // 等待生成完成或超时
                    await Promise.race([generatePromise, timeoutPromise]);

                    // 停止进度监控
                    isGenerating = false;
                    clearInterval(progressChecker);

                    success = true;
                    console.log('音频文件生成成功');

                    // 添加到缓存和临时文件列表
                    this.audioCache.set(textHash, true);
                    this.tempFiles.add(outputFile);
                    console.log('已添加到缓存:', {
                        hash: textHash,
                        file: outputFile,
                        cacheSize: this.audioCache.size,
                        tempFiles: Array.from(this.tempFiles)
                    });

                    // 读取字幕文件
                    const subtitlesPath = fullPath + '.json';
                    try {
                        // 先检查字幕文件是否存在
                        const subtitlesExists = await window.speechAPI.fileExists(subtitlesPath);
                        if (subtitlesExists) {
                            const subtitlesContent = await window.speechAPI.readFile(subtitlesPath);
                            this.currentSubtitles = JSON.parse(subtitlesContent);
                        } else {
                            console.log('字幕文件不存在，继续播放音频');
                            this.currentSubtitles = [];
                        }
                    } catch (error) {
                        console.log('处理字幕文件时出错，继续播放音频:', error);
                        this.currentSubtitles = [];
                    }

                    // 开始播放新生成的文件
                    this.readingStatus.textContent = '正在朗读...';
                    // 检查是否还允许朗读
                    if (!this.readingEnabled) {
                        console.log('朗读已关闭，取消播放');
                        return;
                    }
                    success = await window.speechAPI.playAudioFile(
                        outputFile,
                        (currentTime) => this.handleTimeUpdate(currentTime, position),
                        () => this.handlePlaybackEnd(outputFile, position, textToRead)
                    );

                    if (!success) {
                        throw new Error('播放失败');
                    }
                } catch (error) {
                    console.error('生成语音失败:', error);
                    this.readingStatus.textContent = '生成失败: ' + error.message;
                    this.onReadingEnd();
                }
            }
        } catch (error) {
            this.handleError(error, outputFile);
        }
    }

    // 修改计算开始时间的方法
    calculateStartTime(position) {
        if (!this.currentSubtitles || this.currentSubtitles.length === 0) {
            return (position / 5) * 1000; // 默认每秒5个字
        }

        let accumulatedLength = 0;
        for (const subtitle of this.currentSubtitles) {
            const nextLength = accumulatedLength + subtitle.part.length;
            if (nextLength > position) {
                // 找到了包含目标位置的字幕
                const progress = (position - accumulatedLength) / subtitle.part.length;
                return subtitle.start + (subtitle.end - subtitle.start) * progress;
            }
            accumulatedLength = nextLength;
        }

        // 如果位置超出了所有字幕，返回最后一个字幕的结束时间
        const lastSubtitle = this.currentSubtitles[this.currentSubtitles.length - 1];
        return lastSubtitle.end;
    }

    // 修改查找文本位置的辅助方法
    findTextPosition(text, startPosition = 0) {
        let position = -1;
        let bestMatch = {
            position: -1,
            distance: Number.MAX_VALUE
        };

        // 找出所有匹配位置
        let lastMatchEnd = 0;
        while (lastMatchEnd <= this.currentText.length) {
            const index = this.currentText.indexOf(text, lastMatchEnd);
            if (index === -1) break;

            // 计算与目标位置的距离
            const distance = Math.abs(index - startPosition);

            // 如果这个位置比之前找到的更接近目标位置
            if (distance < bestMatch.distance) {
                bestMatch = {
                    position: index,
                    distance: distance
                };
            }

            lastMatchEnd = index + 1;
        }

        // 使用最接近目标位置的匹配
        position = bestMatch.position;

        // 如果没有找到任何匹配，返回 -1
        return position;
    }

    // 修改处理时间更新的方法
    handleTimeUpdate(currentTime, startPosition) {
        if (!this.currentSubtitles || this.currentSubtitles.length === 0) return;

        // 找到当前时间对应的字幕
        const currentSubtitle = this.currentSubtitles.find(
            sub => currentTime >= sub.start && currentTime <= sub.end
        );

        if (!currentSubtitle) return;

        // 计算当前字幕在文本中的位置
        let textPosition = startPosition;
        for (const sub of this.currentSubtitles) {
            if (sub === currentSubtitle) {
                break;
            }
            textPosition += sub.part.length;
        }

        // 更新高亮位置
        this.updateReadingPosition(textPosition, currentSubtitle.part.length);
    }

    // 添加处理播放结束的方法
    handlePlaybackEnd(outputFile, position, textToRead) {
        // 不要在这里删除文件，只移除使用标记
        this.inUseFiles.delete(outputFile);
        this.onReadingEnd();

        // 检查是否需要继续朗读下一段
        if (this.isReading && !this.isPaused) {
            const nextPosition = position + textToRead.length;
            if (nextPosition < this.currentText.length) {
                setTimeout(() => {
                    this.startReadingFromPosition(nextPosition);
                }, 500);
            }
        }
    }

    // 添加处理错误的方法
    handleError(error, outputFile) {
        if (outputFile) {
            this.inUseFiles.delete(outputFile);
        }
        console.error('朗读失败:', error);
        this.readingStatus.textContent = `朗读失败: ${error.message}`;
        this.onReadingEnd();
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

    initTTS() {
        const rawSpeed = parseInt(this.speedControl.value);
        const rawVolume = parseInt(this.volumeControl.value);
        this.tts = new EdgeTTS({
            voice: this.currentVoice || 'zh-CN-YunyangNeural',
            lang: 'zh-CN',
            outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
            saveSubtitles: true,
            pitch: '0%',
            rate: `${rawSpeed}%`,
            volume: `${rawVolume}%`,
            timeout: this.timeout,
        });
    }

    updateTTSConfig() {
        if (this.tts) {
            const rawSpeed = parseInt(this.speedControl.value);
            const rawVolume = parseInt(this.volumeControl.value);
            const config = {
                voice: this.currentVoice || 'zh-CN-YunyangNeural',
                lang: 'zh-CN',
                outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
                saveSubtitles: true,
                pitch: '0%',
                rate: `${rawSpeed}%`,
                volume: `${rawVolume}%`,
                timeout: this.timeout,
            };

            // 更新配置
            Object.assign(this.tts, config);
            console.log('TTS配置已更新:', config);
        }
    }

    // 添加文本预处理方法
    preprocessText(text) {
        // 获取当前语音的语言代码
        const voiceLang = this.currentVoice?.split('-')[0] || 'zh';

        // 根据语言选择替换规则
        let replacement;
        switch (voiceLang) {
            case 'en':
                replacement = 'and';
                break;
            case 'ja':
                replacement = 'と';
                break;
            case 'ko':
                replacement = '와';
                break;
            case 'fr':
                replacement = 'et';
                break;
            case 'de':
                replacement = 'und';
                break;
            case 'es':
                replacement = 'y';
                break;
            case 'ru':
                replacement = 'и';
                break;
            default:
                replacement = '与';
        }

        // 处理换行和空格
        let processedText = text
            // .replace(/\n\s*\n\s*\n/g, '\n') // 将多个连续空行替换为单个换行
            .replace(/^\s+|\s+$/g, '') // 移除开头和结尾的空白
            .replace(/&/g, replacement)
            .replace(/[<>]/g, ' ');
        // .replace(/(%[0-9A-Fa-f]{2})/g, ' ')

        return processedText;
    }

    // 修改从指定时间开始播放的方法
    async startPlayingFromTime(startTimeMs) {
        if (!this.currentAudioFile || !this.readingEnabled) {
            return;
        }

        // 将毫秒转换为秒
        const startTime = startTimeMs / 1000;

        // 找到对应的字幕位置
        const subtitle = this.currentSubtitles.find(
            sub => startTimeMs >= sub.start && startTimeMs <= sub.end
        );

        if (subtitle) {
            // 计算字幕位置
            let textPosition = 0;
            for (const sub of this.currentSubtitles) {
                if (sub === subtitle) {
                    break;
                }
                textPosition += sub.part.length;
            }
            this.updateReadingPosition(textPosition, subtitle.part.length);
        }

        // 停止当前播放
        await window.speechAPI.stop();

        // 从新位置开始播放
        this.readingStatus.textContent = '正在朗读...';
        this.isReading = true;
        this.isPaused = false;
        this.updateButtonStates();

        const success = await window.speechAPI.playAudioFile(
            this.currentAudioFile,
            (currentTime) => this.handleTimeUpdate(currentTime, 0),
            () => this.onReadingEnd(),
            startTime
        );

        if (!success) {
            this.readingStatus.textContent = '播放失败';
            this.onReadingEnd();
        }
    }

    // 添加更新当前文本哈希值的方法
    updateCurrentTextHash() {
        const processedText = this.preprocessText(this.currentText);
        this.currentTextHash = this.generateTextHash(
            processedText,
            this.currentVoice,
            this.speedControl.value,
            this.volumeControl.value
        );
        console.log('文本内容已更新，新的哈希值:', this.currentTextHash);
    }
} 