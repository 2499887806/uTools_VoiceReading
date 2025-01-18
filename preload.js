const { ipcRenderer } = require('electron');
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 将 EdgeTTS 注入到 window 对象中
window.EdgeTTS = { EdgeTTS };

let currentUtterance = null;
let edgeVoices = null;
let currentEdgeStream = null;
let audioContext = null;
let audioSource = null;
let isPlaying = false;

// 创建音频上下文
function createAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}


// 播放音频数据
async function playAudioData(audioData, onEnd) {
    try {
        const context = createAudioContext();
        if (context.state === 'suspended') {
            await context.resume();
        }

        // 将音频数据转换为 AudioBuffer
        const arrayBuffer = audioData.buffer.slice(
            audioData.byteOffset,
            audioData.byteOffset + audioData.byteLength
        );
        const audioBuffer = await context.decodeAudioData(arrayBuffer);

        // 创建音频源并播放
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start(0);

        // 保存当前音频源以便停止播放
        audioSource = source;

        // 监听播放结束
        source.onended = () => {
            audioSource = null;
            console.log('播放完成');
            if (onEnd) {
                onEnd();
            }
        };

        return source;
    } catch (error) {
        console.error('播放音频失败:', error);
        if (onEnd) {
            onEnd();
        }
        return null;
    }
}

// 监听主进程发送的音频数据
ipcRenderer.on('play-audio', (event, audioData) => {
    playAudioData(Buffer.from(audioData));
});

window.exports = {
    "voice-reading": {
        mode: "none",
        args: {
            enter: (action) => {
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
    // 获取可用的语音列表 (Web Speech API)
    getVoices: async () => {
        try {
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

    // 获取 Edge TTS 语音列表
    getEdgeVoices: async () => {
        try {
            if (edgeVoices) {
                return edgeVoices;
            }

            // 从文件读取语音列表
            const pluginPath = window.utools.getPath('userData');
            const voicesFile = path.join(__dirname, 'src-utools/classified_voices.txt');
            console.log('语音列表文件路径:', voicesFile);

            const content = await fs.promises.readFile(voicesFile, 'utf8');
            const lines = content.split('\n');

            edgeVoices = [];
            let currentLocale = '';
            let currentRegion = '';

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // 处理语言子分类（以 ## 开头）
                if (trimmedLine.startsWith('## ')) {
                    currentLocale = trimmedLine.substring(3);
                    continue;
                }

                // 处理语音条目（以 - 开头）
                if (trimmedLine.startsWith('- ')) {
                    const match = /\(([\w-]+),\s*(\w+)\)\s*\((\w+)\)\s*\[(.*?)\]/.exec(trimmedLine);
                    if (match) {
                        const [_, locale, name, gender, region] = match;
                        const shortName = `${locale}-${name}`;
                        const localName = name.replace('Neural', '');

                        edgeVoices.push({
                            ShortName: shortName,
                            LocalName: localName,
                            Locale: locale,
                            Gender: gender,
                            Region: region,
                            Category: currentLocale
                        });
                    }
                }
            }

            console.log('Edge TTS 语音列表:', edgeVoices);
            return edgeVoices;
        } catch (error) {
            console.error('获取 Edge TTS 语音列表失败:', error);
            console.error('错误详情:', error.stack);
            return [];
        }
    },

    // 使用 Web Speech API 朗读
    speak: async (text, voiceName, rate, onBoundary, onEnd) => {
        try {
            console.log('开始朗读:', { text, voiceName, rate });
            if (currentUtterance) {
                window.speechAPI.stop();
            }

            currentUtterance = new SpeechSynthesisUtterance(text);

            const voices = speechSynthesis.getVoices();
            const voice = voices.find(v => v.name === voiceName);
            if (voice) {
                currentUtterance.voice = voice;
            }

            currentUtterance.rate = rate;
            console.log('设置语速:', rate);

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
        return new Promise(async (resolve) => {
            try {
                if (audioContext && audioSource) {
                    await audioContext.suspend();
                    console.log('音频已暂停');
                } else {
                    speechSynthesis.pause();
                }
                resolve();
            } catch (error) {
                console.error('暂停朗读失败:', error);
                resolve();
            }
        });
    },

    // 继续朗读
    resume: () => {
        console.log('继续朗读');
        return new Promise(async (resolve) => {
            try {
                if (audioContext && audioContext.state === 'suspended') {
                    await audioContext.resume();
                    console.log('音频已恢复');
                } else {
                    speechSynthesis.resume();
                }
                resolve();
            } catch (error) {
                console.error('继续朗读失败:', error);
                resolve();
            }
        });
    },

    // 停止朗读
    stop: () => {
        console.log('停止朗读');
        return new Promise(async (resolve) => {
            try {
                // 停止 Web Speech API
                speechSynthesis.cancel();
                currentUtterance = null;

                // 停止 Edge TTS
                if (audioSource) {
                    try {
                        audioSource.stop(0);
                    } catch (e) {
                        console.error('停止音频源失败:', e);
                    }
                    audioSource.disconnect();
                    audioSource = null;
                }

                if (currentEdgeStream) {
                    try {
                        currentEdgeStream.destroy();
                    } catch (e) {
                        console.error('销毁流失败:', e);
                    }
                    currentEdgeStream = null;
                }

                if (audioContext) {
                    try {
                        // 先暂停
                        await audioContext.suspend();
                        // 再关闭
                        await audioContext.close();
                        audioContext = null;
                    } catch (e) {
                        console.error('关闭音频上下文失败:', e);
                    }
                }

                // 重置播放状态
                isPlaying = false;

                // 确保所有资源都被清理
                setTimeout(() => {
                    try {
                        // 再次检查并清理
                        if (audioSource) {
                            audioSource.disconnect();
                            audioSource = null;
                        }
                        if (audioContext && audioContext.state !== 'closed') {
                            audioContext.close();
                            audioContext = null;
                        }
                        resolve();
                    } catch (e) {
                        console.error('清理资源失败:', e);
                        resolve();
                    }
                }, 100);
            } catch (error) {
                console.error('停止朗读时发生错误:', error);
                resolve();
            }
        });
    },

    // 添加高亮方法
    highlight: (position, length) => {
        const version = document.body.dataset.version;
        const textLayerId = version === 'v2' ? 'text-layer-v2' : 'text-layer';
        const textLayer = document.getElementById(textLayerId);

        // 首先移除所有现有的选择
        window.getSelection().removeAllRanges();

        // 如果位置或长度无效，直接返回
        if (position < 0 || length <= 0) return;

        // 创建新的范围
        const range = document.createRange();
        const nodeIterator = document.createNodeIterator(
            textLayer,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let currentPos = 0;
        let startNode = null;
        let startOffset = 0;
        let endNode = null;
        let endOffset = 0;
        let node;

        // 遍历所有文本节点
        while ((node = nodeIterator.nextNode())) {
            const nodeLength = node.length;

            // 找到起始节点
            if (!startNode && currentPos + nodeLength > position) {
                startNode = node;
                startOffset = position - currentPos;
            }

            // 找到结束节点
            if (!endNode && currentPos + nodeLength >= position + length) {
                endNode = node;
                endOffset = position + length - currentPos;
                break;
            }

            currentPos += nodeLength;
        }

        // 如果找到了有效的起始和结束节点
        if (startNode && endNode) {
            try {
                range.setStart(startNode, startOffset);
                range.setEnd(endNode, endOffset);
                window.getSelection().addRange(range);

                // 处理滚动
                const rect = range.getBoundingClientRect();
                const containerRect = textLayer.getBoundingClientRect();
                const relativeTop = rect.top - containerRect.top;
                const relativeBottom = rect.bottom - containerRect.top;

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
    },

    // 检查文件是否存在
    fileExists: (filePath) => {
        return new Promise((resolve) => {
            try {
                const exists = fs.existsSync(filePath);
                resolve(exists);
            } catch (error) {
                console.error('检查文件是否存在失败:', error);
                resolve(false);
            }
        });
    },

    // 删除文件
    deleteFile: (filePath) => {
        return new Promise((resolve, reject) => {
            fs.unlink(filePath, (err) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        resolve();
                    } else {
                        console.error('删除文件失败:', err);
                        reject(err);
                    }
                } else {
                    resolve();
                }
            });
        });
    },

    // 获取临时文件路径
    getTempFilePath: (filename) => {
        return path.join(os.tmpdir(), filename);
    },

    // 读取文件内容
    readFile: (filePath) => {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('读取文件失败:', err);
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    },

    // 播放音频文件
    playAudioFile: async (filename, onTimeUpdate, onEnd, startTime = 0) => {
        try {
            // 如果已经在播放，先停止当前播放
            if (isPlaying) {
                console.log('已有音频在播放，停止当前播放');
                if (audioSource) {
                    audioSource.stop();
                    audioSource.disconnect();
                    audioSource = null;
                }
                if (audioContext) {
                    await audioContext.close();
                    audioContext = null;
                }
            }
            isPlaying = true;

            const filePath = path.join(os.tmpdir(), filename);
            console.log('开始播放音频文件:', {
                filename,
                filePath,
                startTime: `${startTime}秒`
            });

            const audioData = await fs.promises.readFile(filePath);
            console.log('音频文件读取成功，大小:', audioData.length, '字节');

            const fileSize = await window.speechAPI.getFileSize(filePath);
            if (fileSize === 0) {
                alert('请检查文字, 可能需要更换语音!');
                isPlaying = false;
                return false;
            }

            const context = createAudioContext();
            if (context.state === 'suspended') {
                await context.resume();
            }

            const arrayBuffer = audioData.buffer.slice(
                audioData.byteOffset,
                audioData.byteOffset + audioData.byteLength
            );
            const audioBuffer = await context.decodeAudioData(arrayBuffer);
            console.log('音频解码成功，时长:', audioBuffer.duration, '秒');

            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);

            // 创建 AudioContext 时间更新处理器
            if (onTimeUpdate) {
                const interval = setInterval(() => {
                    if (context.state === 'running') {
                        const currentTime = ((context.currentTime - source.startTime) * 1000) + (startTime * 1000);
                        onTimeUpdate(currentTime);
                    }
                }, 10);

                source.onended = () => {
                    clearInterval(interval);
                    console.log('音频播放完成');
                    isPlaying = false;
                    if (onEnd) onEnd();
                };
            } else if (onEnd) {
                source.onended = () => {
                    isPlaying = false;
                    onEnd();
                };
            }

            source.startTime = context.currentTime;
            source.start(0, startTime);
            console.log('音频开始播放，起始位置:', startTime, '秒');
            audioSource = source;

            return true;
        } catch (error) {
            console.error('播放音频文件失败:', error);
            isPlaying = false;
            if (onEnd) onEnd();
            return false;
        }
    },

    // 生成文本的哈希值
    generateHash: (text) => {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(text).digest('hex');
    },

    // 获取临时目录
    getTempDir: () => {
        return os.tmpdir();
    },

    // 读取目录内容
    readDir: (dirPath) => {
        return new Promise((resolve, reject) => {
            fs.readdir(dirPath, (err, files) => {
                if (err) {
                    console.error('读取目录失败:', err);
                    reject(err);
                } else {
                    resolve(files);
                }
            });
        });
    },

    // 添加文件操作相关方法
    copyFile: (sourcePath, targetPath) => {
        return new Promise((resolve, reject) => {
            try {
                fs.copyFileSync(sourcePath, targetPath);
                resolve(true);
            } catch (error) {
                reject(error);
            }
        });
    },

    getFileSize: (filePath) => {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        } catch (error) {
            console.error('获取文件大小失败:', error);
            return 0;
        }
    }
}; 