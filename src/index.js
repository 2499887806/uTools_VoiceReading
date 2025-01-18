import { V1Reader } from './v1.js';
import { V2Reader } from './v2.js';

// 添加文本处理工具类
class TextProcessor {
    static processHtmlContent(htmlText) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlText;

        // 移除所有图片
        tempDiv.querySelectorAll('img').forEach(img => img.remove());

        // 清除所有元素的样式
        const clearStyles = (element) => {
            element.removeAttribute('style');
            element.removeAttribute('class');
            element.style.backgroundColor = 'transparent';
            element.style.color = '#000000';
            element.style.margin = '0';
            element.style.padding = '0';
            element.style.width = '100%';
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
        content = content
            .replace(/(<br\s*\/?>\s*|\s*&nbsp;\s*|\s+)*(<\/div>|<\/p>)/g, '</div>')
            .replace(/(<div>|<p>)(<br\s*\/?>\s*|\s*&nbsp;\s*|\s+)*/g, '<div>')
            .replace(/(<br\s*\/?>\s*|\s*&nbsp;\s*){2,}/g, '\n')
            .replace(/^\s+|\s+$/g, '');

        return content;
    }

    static processPlainText(text) {
        return text
            .replace(/^\s+|\s+$/g, '')
            .replace(/\n\s*\n\s*\n/g, '\n');
    }

    static handlePaste(e, textLayer) {
        e.preventDefault();

        const plainText = e.clipboardData.getData('text/plain');
        const htmlText = e.clipboardData.getData('text/html');

        if (htmlText) {
            const content = TextProcessor.processHtmlContent(htmlText);
            document.execCommand('insertHTML', false, content);
        } else {
            const cleanText = TextProcessor.processPlainText(plainText);
            document.execCommand('insertText', false, cleanText);
        }
    }

    static handleCopy(e) {
        if (!e.clipboardData) return;

        const selection = window.getSelection();
        const text = selection.toString();

        e.preventDefault();
        e.clipboardData.setData('text/plain', text);
    }

    static handleInput(e, textLayer, maxLength, callback) {
        if (textLayer.textContent.length > maxLength) {
            e.preventDefault();
            textLayer.textContent = textLayer.textContent.slice(0, maxLength);
            if (callback) {
                callback(maxLength);
            }
        }
    }

    static handleKeydown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertText', false, '    ');
        }
    }

    static processContent(content) {
        // 创建临时容器
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // 处理所有文本节点
        const processTextNode = (node) => {
            if (node.nodeType === 3) { // 文本节点
                const text = node.textContent;
                // 保持单个换行，移除多余空白
                node.textContent = text.replace(/\n\s*\n\s*\n/g, '\n');
            } else if (node.nodeType === 1) { // 元素节点
                Array.from(node.childNodes).forEach(processTextNode);
            }
        };

        processTextNode(tempDiv);

        // 移除多余的空行和空格
        let html = tempDiv.innerHTML;
        html = html
            .replace(/(<div>|<p>)\s*(<br\s*\/?>\s*|\s*&nbsp;\s*|\s+)*/g, '$1')
            .replace(/\s*(<\/div>|<\/p>)/g, '$1')
            .replace(/(<br\s*\/?>\s*|\s*&nbsp;\s*){2,}/g, '<br>')
            .replace(/^\s+|\s+$/g, '');

        return html;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const v1Reader = new V1Reader();
    const v2Reader = new V2Reader();
    let currentReader = null;

    // 设置窗口高度
    window.utools.onPluginReady(() => {
        utools.setExpendHeight(610);
    });

    // 为两个版本的文本层添加统一的事件处理
    const textLayers = [
        document.getElementById('text-layer'),
        document.getElementById('text-layer-v2')
    ];

    textLayers.forEach(textLayer => {
        // 粘贴事件
        textLayer.addEventListener('paste', (e) => {
            TextProcessor.handlePaste(e, textLayer);
        });

        // 复制事件
        textLayer.addEventListener('copy', TextProcessor.handleCopy);

        // 输入事件
        textLayer.addEventListener('input', (e) => {
            TextProcessor.handleInput(e, textLayer, 50000, (maxLength) => {
                const reader = document.body.dataset.version === 'v1' ? v1Reader : v2Reader;
                reader.readingStatus.textContent = `已达到最大字符限制 (${maxLength})`;
                setTimeout(() => {
                    if (!reader.isReading) {
                        reader.readingStatus.textContent = reader.readingEnabled ? '已开启朗读' : '已关闭朗读';
                    }
                }, 2000);
            });
        });

        // 键盘事件
        textLayer.addEventListener('keydown', TextProcessor.handleKeydown);

        // 添加全屏按钮事件
        const textWrapper = textLayer.parentElement;
        const fullscreenBtn = textWrapper.querySelector('.fullscreen-btn');

        fullscreenBtn.addEventListener('click', () => {
            textWrapper.classList.toggle('fullscreen');
            if (textWrapper.classList.contains('fullscreen')) {
                fullscreenBtn.title = '退出全屏';
            } else {
                fullscreenBtn.title = '全屏';
            }
        });
    });

    // ESC 键退出全屏
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const fullscreenWrapper = document.querySelector('.text-wrapper.fullscreen');
            if (fullscreenWrapper) {
                fullscreenWrapper.classList.remove('fullscreen');
                fullscreenWrapper.querySelector('.fullscreen-btn').title = '全屏';
            }
        }
    });

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

        // 同步两个版本的内容，保持格式
        const sourceLayer = version === 'v2' ?
            document.getElementById('text-layer') :
            document.getElementById('text-layer-v2');
        const targetLayer = version === 'v2' ?
            document.getElementById('text-layer-v2') :
            document.getElementById('text-layer');

        // 使用 innerHTML 来保持格式
        const content = sourceLayer.innerHTML;
        // 处理内容，确保格式一致
        const processedContent = TextProcessor.processContent(content);
        targetLayer.innerHTML = processedContent;

        // 重置V1的状态
        if (version === 'v2') {
            v1Reader.readingEnabled = false;
            v1Reader.updateButtonStates();
        } else {
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