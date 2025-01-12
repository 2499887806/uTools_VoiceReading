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
            // 语速改变时清除当前哈希值，因为需要重新生成语音
            this.currentTextHash = null;
        });

        this.voiceSelect.addEventListener('change', () => {
            this.currentVoice = this.voiceSelect.value;
            this.updateTTSConfig();
            this.saveConfig();
            // 语音改变时清除当前哈希值，因为需要重新生成语音
            this.currentTextHash = null;
        });

        this.volumeControl.addEventListener('input', () => {
            const value = parseInt(this.volumeControl.value);
            this.volumeValue.textContent = `${value}%`;
            this.updateTTSConfig();
            this.saveConfig();
            // 音量改变时清除当前哈希值，因为需要重新生成语音
            this.currentTextHash = null;
        });

        this.textLayer.addEventListener('input', () => {
            if (!this.isReading) {
                this.currentText = this.textLayer.textContent;
                // 文本改变时更新哈希值
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

        // 添加粘贴事件监听
        this.textLayer.addEventListener('paste', (e) => {
            e.preventDefault();

            // 获取纯文本和富文本
            const plainText = e.clipboardData.getData('text/plain');
            const htmlText = e.clipboardData.getData('text/html');

            if (htmlText) {
                // 如果有HTML内容，说明是带格式的文本
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlText;

                // 遍历所有元素清除背景色和文字颜色
                const clearStyles = (element) => {
                    element.style.backgroundColor = 'transparent';
                    element.style.color = '#000000';
                    element.style.width = '100%';
                    element.style.margin = '0';
                    element.style.padding = '0';
                    // 移除可能影响文字显示的属性
                    element.style.textShadow = 'none';
                    element.style.background = 'none';
                    element.style.backgroundImage = 'none';
                    element.style.backgroundClip = 'unset';
                    element.style.webkitBackgroundClip = 'unset';
                    element.style.webkitTextFillColor = '#000000';
                };

                // 处理所有元素
                clearStyles(tempDiv);
                tempDiv.querySelectorAll('*').forEach(clearStyles);

                // 清理内容
                let content = tempDiv.innerHTML;
                // 移除开头的空行
                content = content.replace(/^(\s*<br\s*\/?>\s*|\s*&nbsp;\s*|\s+)*/, '');
                // 移除结尾的空行
                content = content.replace(/(\s*<br\s*\/?>\s*|\s*&nbsp;\s*|\s+)*$/, '');
                // 移除连续的多个空行
                content = content.replace(/(<br\s*\/?>\s*|\s*&nbsp;\s*){2,}/g, '<br>');

                // 插入处理后的HTML
                document.execCommand('insertHTML', false, content);
            } else {
                // 如果是纯文本，清理换行
                const cleanText = plainText
                    .replace(/^\s+/, '')  // 移除开头的空白
                    .replace(/\s+$/, '')  // 移除结尾的空白
                    .replace(/\n{3,}/g, '\n\n');  // 将3个以上连续换行替换为2个
                document.execCommand('insertText', false, cleanText);
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
                lastText: this.textLayer.textContent,
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
            const { voice, speed, volume, lastText, readingEnabled } = this.config.v2;

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

            if (lastText) {
                this.textLayer.textContent = lastText;
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

            // 只在当前版本是V2时才自动开始朗读
            if (document.body.dataset.version === 'v2' && this.readingEnabled && this.textLayer.textContent.trim()) {
                setTimeout(async () => {
                    // 确保没有其他朗读在进行
                    if (!this.isReading && !this.isPaused) {
                        await window.speechAPI.stop();  // 确保清理所有资源
                        this.startReadingFromPosition(0);
                    }
                }, 1000);  // 增加延迟时间到1秒
            }
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

            // 生成下拉列表内容
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
            console.log('启动时清理临时文件完成');
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
                    const subtitlesContent = await window.speechAPI.readFile(subtitlesPath);
                    this.currentSubtitles = JSON.parse(subtitlesContent);
                } catch (error) {
                    console.error('读取字幕文件失败:', error);
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
                success = await window.speechAPI.playAudioFile(
                    outputFile,
                    (currentTime) => this.handleTimeUpdate(currentTime, position),
                    () => this.handlePlaybackEnd(outputFile, position, textToRead)
                );

                if (!success) {
                    throw new Error('播放失败');
                }
            } else {
                console.log('需要重新生成音频文件');
                // 确保使用最新的配置
                this.updateTTSConfig();

                // 添加重试逻辑
                let retryCount = 3;
                let lastError = null;

                while (retryCount > 0 && !success) {
                    try {
                        this.readingStatus.textContent = `正在生成语音...${retryCount < 3 ? `(重试第${3 - retryCount}次)` : ''}`;
                        await this.tts.ttsPromise(textToRead, fullPath);
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
                            const subtitlesContent = await window.speechAPI.readFile(subtitlesPath);
                            this.currentSubtitles = JSON.parse(subtitlesContent);
                        } catch (error) {
                            console.error('读取字幕文件失败:', error);
                            this.currentSubtitles = [];
                        }

                        // 开始播放新生成的文件
                        this.readingStatus.textContent = '正在朗读...';
                        success = await window.speechAPI.playAudioFile(
                            outputFile,
                            (currentTime) => this.handleTimeUpdate(currentTime, position),
                            () => this.handlePlaybackEnd(outputFile, position, textToRead)
                        );

                        if (!success) {
                            throw new Error('播放失败');
                        }
                    } catch (error) {
                        lastError = error;
                        console.error(`生成语音失败 (剩余重试次数: ${retryCount - 1}):`, error);
                        retryCount--;
                        if (retryCount > 0) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            this.initTTS();
                        }
                    }
                }

                if (!success) {
                    throw lastError || new Error('生成语音失败');
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
            timeout: 30000,  // 超时30秒
            // 添加连接选项
            connectionOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
                },
                // 添加重试选项
                maxRetries: 3,
                retryDelay: 2000,
                // 添加超时选项
                handshakeTimeout: 10000,
                // 添加保活选项
                keepAlive: true
            }
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
                timeout: 30000,  // 超时30秒
                // 添加连接选项
                connectionOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
                    },
                    // 添加重试选项
                    maxRetries: 3,
                    retryDelay: 2000,
                    // 添加超时选项
                    handshakeTimeout: 10000,
                    // 添加保活选项
                    keepAlive: true
                }
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

        // 只替换 & 符号
        let processedText = text.replace(/&/g, replacement);

        // 通用处理
        return processedText
            .replace(/[<>]/g, ' ')
        // .replace(/(%[0-9A-Fa-f]{2})/g, ' ')
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