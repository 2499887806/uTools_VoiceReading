const { ipcRenderer } = require('electron');

let currentUtterance = null;

window.exports = {
    "voice-reading": {
        mode: "none",
        args: {
            enter: (action) => {
                // 处理从uTools进入插件
                window.utools.hideMainWindow();
                const selectedText = action.payload;
                console.log('选中的文本:', selectedText);
                if (selectedText) {
                    window.postMessage({
                        type: 'read-text',
                        text: selectedText
                    }, '*');
                }
            }
        }
    }
};

// 监听鼠标中键事件
window.utools.onPluginEnter(({ code, type, payload }) => {
    if (type === 'over') {
        console.log('鼠标中键选中文本:', payload);
        window.postMessage({
            type: 'read-text',
            text: payload
        }, '*');
    }
});

// 注入到window对象中，供renderer使用
window.speechAPI = {
    // 获取可用的语音列表
    getVoices: async () => {
        try {
            // 等待语音列表加载完成
            await new Promise((resolve) => {
                if (speechSynthesis.getVoices().length) {
                    resolve();
                } else {
                    speechSynthesis.onvoiceschanged = resolve;
                }
            });

            const voices = speechSynthesis.getVoices();
            console.log('获取到的语音列表:', voices);
            return voices;
        } catch (error) {
            console.error('获取语音列表失败:', error);
            return [];
        }
    },

    // 开始朗读
    speak: async (text, voiceName, rate, onBoundary, onEnd) => {
        try {
            console.log('开始朗读:', { text, voiceName, rate });
            if (currentUtterance) {
                this.stop();
            }

            // 创建语音合成实例
            currentUtterance = new SpeechSynthesisUtterance(text);

            // 设置语音
            const voices = speechSynthesis.getVoices();
            const voice = voices.find(v => v.name === voiceName);
            if (voice) {
                currentUtterance.voice = voice;
            }

            // 设置语速 (0-7 映射到 0.1-10.0)
            const mappedRate = 0.1 + (rate * 1.414);
            currentUtterance.rate = mappedRate;
            console.log('映射后的语速:', mappedRate);

            // 设置事件监听
            currentUtterance.onend = () => {
                console.log('朗读完成');
                currentUtterance = null;
                if (onEnd) {
                    onEnd();
                }
            };

            currentUtterance.onerror = (event) => {
                console.error('朗读错误:', event);
                currentUtterance = null;
                if (onEnd) {
                    onEnd();
                }
            };

            // 添加边界事件监听，用于跟踪朗读位置
            currentUtterance.onboundary = (event) => {
                if (event.name === 'word' || event.name === 'sentence') {
                    const position = event.charIndex;
                    const length = event.charLength || 1;
                    console.log('朗读位置:', { position, length });
                    if (onBoundary) {
                        onBoundary(position, length);
                    }
                }
            };

            // 开始朗读
            speechSynthesis.speak(currentUtterance);
            return true;
        } catch (error) {
            console.error('朗读失败:', error);
            if (onEnd) {
                onEnd();
            }
            return false;
        }
    },

    // 暂停朗读
    pause: () => {
        console.log('暂停朗读');
        speechSynthesis.pause();
    },

    // 继续朗读
    resume: () => {
        console.log('继续朗读');
        speechSynthesis.resume();
    },

    // 停止朗读
    stop: () => {
        console.log('停止朗读');
        speechSynthesis.cancel();
        currentUtterance = null;
    },

    // 添加高亮方法
    highlight: (position, length) => {
        const text = document.getElementById('text-layer').textContent;
        const range = document.createRange();
        const textLayer = document.getElementById('text-layer');

        // 获取正确的文本节点和位置
        let currentPos = 0;
        let targetNode = null;
        let nodeOffset = 0;

        function findPosition(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (currentPos + node.length >= position) {
                    targetNode = node;
                    nodeOffset = position - currentPos;
                    return true;
                }
                currentPos += node.length;
            } else {
                for (let child of node.childNodes) {
                    if (findPosition(child)) {
                        return true;
                    }
                }
            }
            return false;
        }

        findPosition(textLayer);

        if (targetNode) {
            try {
                range.setStart(targetNode, nodeOffset);
                range.setEnd(targetNode, nodeOffset + length);

                // 清除之前的选区
                window.getSelection().removeAllRanges();
                // 设置新的选区
                window.getSelection().addRange(range);

                // 确保高亮区域在视图中
                const rect = range.getBoundingClientRect();
                const containerRect = textLayer.getBoundingClientRect();

                // 计算当前高亮区域相对于容器的位置
                const relativeTop = rect.top - containerRect.top;
                const relativeBottom = rect.bottom - containerRect.top;

                // 如果高亮区域不在可视范围内，进行滚动
                if (relativeTop < 0 || relativeBottom > containerRect.height) {
                    const targetScrollTop = textLayer.scrollTop + relativeTop - (containerRect.height * 0.3);
                    textLayer.scrollTo({
                        top: targetScrollTop,
                        behavior: 'smooth'
                    });
                }
            } catch (error) {
                console.error('设置高亮范围失败:', error);
            }
        }
    }
}; 