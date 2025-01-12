import { V1Reader } from './v1.js';
import { V2Reader } from './v2.js';

document.addEventListener('DOMContentLoaded', async () => {
    const v1Reader = new V1Reader();
    const v2Reader = new V2Reader();
    let currentReader = null;

    // 版本切换按钮
    const v1Btn = document.getElementById('v1-btn');
    const v2Btn = document.getElementById('v2-btn');

    // 切换版本按钮状态
    function setVersionActive(version) {
        v1Btn.classList.toggle('active', version === 'v1');
        v2Btn.classList.toggle('active', version === 'v2');
    }

    // 版本切换处理
    async function switchVersion(version) {
        // 停止当前的朗读
        await window.speechAPI.stop();

        // 如果当前有阅读器，重置其状态
        if (currentReader) {
            currentReader.isReading = false;
            currentReader.isPaused = false;
            currentReader.lastHighlightPosition = 0;
            window.getSelection().removeAllRanges();
            currentReader.updateButtonStates();
        }

        const config = window.utools.dbStorage.getItem('voice-config') || {};
        config.version = version;
        window.utools.dbStorage.setItem('voice-config', config);

        document.body.dataset.version = version;
        setVersionActive(version);

        // 切换当前使用的阅读器
        currentReader = version === 'v1' ? v1Reader : v2Reader;

        // 同步两个版本的内容
        if (version === 'v2') {
            document.getElementById('text-layer-v2').textContent = document.getElementById('text-layer').textContent;
            // 重置V1的状态
            v1Reader.readingEnabled = false;
            v1Reader.updateButtonStates();
        } else {
            document.getElementById('text-layer').textContent = document.getElementById('text-layer-v2').textContent;
            // 重置V2的状态
            v2Reader.readingEnabled = false;
            v2Reader.updateButtonStates();
        }
    }

    // 版本切换按钮事件
    v1Btn.addEventListener('click', () => {
        switchVersion('v1');
    });

    v2Btn.addEventListener('click', () => {
        switchVersion('v2');
    });

    // 监听来自preload的消息
    window.addEventListener('message', (event) => {
        if (event.data.type === 'read-text') {
            console.log('收到朗读请求:', event.data);
            const version = document.body.dataset.version;
            const textLayer = version === 'v1' ?
                document.getElementById('text-layer') :
                document.getElementById('text-layer-v2');

            textLayer.textContent = event.data.text;

            if (currentReader && currentReader.readingEnabled) {
                currentReader.startReadingFromPosition(0);
            }
        }
    });

    // 添加键盘事件监听
    document.addEventListener('keydown', (event) => {
        // 如果正在输入文本，不处理快捷键
        if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
            return;
        }

        // 空格键控制暂停/继续
        if (event.code === 'Space' && currentReader && currentReader.isReading) {
            event.preventDefault(); // 防止页面滚动
            if (currentReader.isPaused) {
                window.speechAPI.resume();
                currentReader.isPaused = false;
            } else {
                window.speechAPI.pause();
                currentReader.isPaused = true;
            }
            currentReader.updateButtonStates();
        }
    });

    // 初始化
    const config = window.utools.dbStorage.getItem('voice-config') || {};
    const version = config.version || 'v1';

    // 先设置版本
    document.body.dataset.version = version;
    setVersionActive(version);

    // 初始化当前版本的Reader
    if (version === 'v1') {
        await v1Reader.init();
        currentReader = v1Reader;
        // 延迟初始化V2
        setTimeout(() => {
            v2Reader.init();
        }, 1000);
    } else {
        await v2Reader.init();
        currentReader = v2Reader;
        // 延迟初始化V1
        setTimeout(() => {
            v1Reader.init();
        }, 1000);
    }
});