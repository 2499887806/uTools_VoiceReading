document.addEventListener('DOMContentLoaded', async () => {
    const voiceSelect = document.getElementById('voice-select');
    const speedControl = document.getElementById('speed-control');
    const speedValue = document.getElementById('speed-value');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const textLayer = document.getElementById('text-layer');
    const readingStatus = document.getElementById('reading-status');

    let currentVoice = null;
    let isReading = false;
    let isPaused = false;
    let lastHighlightPosition = 0;
    let currentText = '';
    let readingEnabled = false;

    // 速度值映射
    const speedLabels = ['极慢', '很慢', '较慢', '正常', '较快', '快', '很快', '极快'];

    // 保存配置
    function saveConfig() {
        const config = {
            voice: voiceSelect.value,
            speed: speedControl.value,
            lastText: textLayer.textContent,
            readingEnabled: readingEnabled
        };
        window.utools.dbStorage.setItem('voice-config', config);
        console.log('保存配置:', config);
    }

    // 加载配置
    function loadConfig() {
        const config = window.utools.dbStorage.getItem('voice-config');
        console.log('加载配置:', config);
        if (config) {
            if (config.voice) {
                voiceSelect.value = config.voice;
                currentVoice = config.voice;
            }
            if (config.speed) {
                speedControl.value = config.speed;
                speedValue.textContent = speedLabels[config.speed];
            }
            if (config.lastText) {
                textLayer.textContent = config.lastText;
            }
            if (typeof config.readingEnabled !== 'undefined') {
                readingEnabled = config.readingEnabled;
                // 只更新按钮状态，不自动开始朗读
                updateButtonStates();
            }
        }
    }

    // 更新朗读位置显示
    let highlightUpdatePending = false;
    let lastScrollTime = 0;
    const SCROLL_THROTTLE = 100;

    function updateReadingPosition(position, length) {
        if (highlightUpdatePending) return;
        highlightUpdatePending = true;

        requestAnimationFrame(() => {
            try {
                window.speechAPI.highlight(position, length);
            } catch (error) {
                console.error('更新高亮位置失败:', error);
            }
            highlightUpdatePending = false;
        });

        lastHighlightPosition = position;
    }

    // 同步滚动优化
    let scrollUpdatePending = false;
    textLayer.addEventListener('scroll', () => {
        if (scrollUpdatePending) return;
        scrollUpdatePending = true;

        requestAnimationFrame(() => {
            highlightLayer.scrollTop = textLayer.scrollTop;
            scrollUpdatePending = false;
        });
    });

    // 朗读完成处理
    function onReadingEnd() {
        console.log('朗读结束处理');
        isReading = false;
        isPaused = false;
        lastHighlightPosition = 0;
        window.getSelection().removeAllRanges();
        readingStatus.textContent = readingEnabled ? '已开启朗读' : '已关闭朗读';
        updateButtonStates();
    }

    // 初始化语音列表
    async function initVoices() {
        try {
            const voices = await window.speechAPI.getVoices();
            console.log('获取到的语音列表:', voices);
            voiceSelect.innerHTML = voices
                .map(voice => `<option value="${voice.name}">${voice.name} (${voice.lang})</option>`)
                .join('');

            // 先设置默认语音
            currentVoice = voices[0]?.name;
            console.log('设置默认语音:', currentVoice);

            // 然后加载保存的配置
            loadConfig();
        } catch (error) {
            console.error('初始化语音失败:', error);
            readingStatus.textContent = '初始化失败';
        }
    }

    // 更新语速显示并保存配置
    speedControl.addEventListener('input', () => {
        const value = parseInt(speedControl.value);
        speedValue.textContent = speedLabels[value];
        console.log('语速更新:', { value, label: speedLabels[value] });
        saveConfig();
    });

    // 语音选择变化时保存配置
    voiceSelect.addEventListener('change', () => {
        console.log('语音更新:', voiceSelect.value);
        saveConfig();
    });

    // 文本变化时保存配置
    textLayer.addEventListener('input', () => {
        if (!isReading) {
            currentText = textLayer.textContent;
            saveConfig();
        }
    });

    // 添加点击事件处理
    textLayer.addEventListener('click', async (event) => {
        if (!readingEnabled) return;

        // 获取点击位置
        const position = getTextPosition(textLayer, event.clientX, event.clientY);
        console.log('点击位置:', position);

        // 如果当前正在朗读或暂停状态，需要先完全停止当前朗读
        if (isReading || isPaused) {
            await window.speechAPI.stop();
            onReadingEnd();  // 确保状态被正确重置
        }

        // 确保状态被正确设置后再开始新的朗读
        setTimeout(() => {
            startReadingFromPosition(position);
        }, 100);
    });

    // 获取点击位置对应的文本位置
    function getTextPosition(element, x, y) {
        const range = document.caretRangeFromPoint(x, y);
        if (!range) return 0;

        const textNode = range.startContainer;
        let position = range.startOffset;

        // 计算之前所有文本节点的长度
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

    // 修改开始朗读函数
    async function startReadingFromPosition(position) {
        currentText = textLayer.textContent;

        if (!currentText || currentText.trim() === '') {
            console.log('文本为空，取消朗读');
            return;
        }

        if (position >= currentText.length) {
            return;
        }

        const textToRead = currentText.substring(position);
        console.log('从位置继续朗读:', { position, textLength: textToRead.length });

        // 设置状态
        readingStatus.textContent = '正在朗读...';
        isReading = true;
        isPaused = false;
        lastHighlightPosition = position;
        updateButtonStates();

        try {
            const success = await window.speechAPI.speak(
                textToRead,
                voiceSelect.value || currentVoice,
                parseInt(speedControl.value),
                (pos, length) => updateReadingPosition(position + pos, length),
                onReadingEnd
            );

            if (!success) {
                throw new Error('朗读失败');
            }
        } catch (error) {
            console.error('朗读失败:', error);
            readingStatus.textContent = '朗读失败';
            onReadingEnd();
        }
    }

    // 更新按钮状态
    function updateButtonStates() {
        // 朗读开关按钮始终可用
        playBtn.disabled = false;
        playBtn.textContent = readingEnabled ? '关闭朗读' : '开启朗读';
        playBtn.style.background = readingEnabled ? '#666' : '#f8f9fa';
        playBtn.style.color = readingEnabled ? 'white' : '#333';

        // 暂停按钮：只有在朗读开启且正在朗读时可用
        pauseBtn.disabled = !readingEnabled || !isReading;
        pauseBtn.style.opacity = pauseBtn.disabled ? '0.5' : '1';
        // 更新暂停按钮文本
        if (isReading && !pauseBtn.disabled) {
            pauseBtn.textContent = isPaused ? '继续朗读' : '暂停';
        } else {
            pauseBtn.textContent = '暂停';
        }

        // 停止按钮：只有在朗读开启且正在朗读或暂停时可用
        stopBtn.disabled = !readingEnabled || (!isReading && !isPaused);
        stopBtn.style.opacity = stopBtn.disabled ? '0.5' : '1';

        // 更新状态文本
        if (!readingEnabled) {
            readingStatus.textContent = '已关闭朗读';
        } else if (isReading) {
            readingStatus.textContent = isPaused ? '已暂停' : '正在朗读...';
        } else {
            readingStatus.textContent = '已开启朗读';
        }
    }

    // 监听来自preload的消息
    window.addEventListener('message', (event) => {
        if (event.data.type === 'read-text') {
            console.log('收到朗读请求:', event.data);
            textLayer.textContent = event.data.text;
            // 只有在朗读已启用的情况下才开始朗读
            if (readingEnabled) {
                startReadingFromPosition(0);
            }
        }
    });

    // 初始化
    console.log('开始初始化...');
    initVoices();

    // 设置placeholder
    if (!textLayer.textContent) {
        textLayer.setAttribute('data-placeholder', '在此输入要朗读的文本，或使用快捷键/鼠标中键朗读选中的文本');
    }

    // 按钮事件
    playBtn.addEventListener('click', () => {
        readingEnabled = !readingEnabled;

        // 如果关闭朗读，停止当前朗读
        if (!readingEnabled && (isReading || isPaused)) {
            window.speechAPI.stop();
            isReading = false;
            isPaused = false;
        }

        updateButtonStates();
        saveConfig();
    });

    pauseBtn.addEventListener('click', () => {
        if (!pauseBtn.disabled && isReading && !isPaused) {
            console.log('点击暂停按钮');
            window.speechAPI.pause();
            isPaused = true;
            updateButtonStates();
        }
    });

    stopBtn.addEventListener('click', () => {
        if (!stopBtn.disabled && (isReading || isPaused)) {
            console.log('点击停止按钮');
            window.speechAPI.stop();
            isReading = false;
            isPaused = false;
            window.getSelection().removeAllRanges();
            updateButtonStates();
        }
    });

    // 添加键盘事件监听
    document.addEventListener('keydown', (event) => {
        // 如果正在输入文本，不处理快捷键
        if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
            return;
        }

        // 空格键控制暂停/继续
        if (event.code === 'Space' && isReading) {
            event.preventDefault(); // 防止页面滚动
            if (isPaused) {
                window.speechAPI.resume();
                isPaused = false;
            } else {
                window.speechAPI.pause();
                isPaused = true;
            }
            updateButtonStates();
        }
    });
}); 