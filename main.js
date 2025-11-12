// グローバル変数でZIPとXMLデータを保持
let dawProjectZip = null;
let projectXmlDoc = null;
const audioContext = new AudioContext(); // Web Audio APIの「親」

// HTML要素を取得
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const playButton = document.getElementById('play-button');
const projectDataEl = document.getElementById('project-data');

// --- ファイル読み込み処理 ---
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
dropZone.addEventListener('dragover', (e) => e.preventDefault());
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
    if (!file) return;
    console.log(`ファイル ${file.name} を読み込み中...`);

    try {
        // 1. ファイルをArrayBufferとして読み込む
        const arrayBuffer = await file.arrayBuffer();
        
        // 2. JSZipでZIPをロード
        dawProjectZip = await JSZip.loadAsync(arrayBuffer);
        console.log('ZIPの解凍に成功:', dawProjectZip.files);

        // 3. 'project.xml' を探してテキストとして取得
        const projectXmlFile = dawProjectZip.file('project.xml');
        if (!projectXmlFile) {
            throw new Error('project.xml が見つかりません。');
        }
        
        const xmlString = await projectXmlFile.async('string');
        
        // XML解析処理へ
        parseProjectXml(xmlString);

    } catch (err) {
        console.error('DAWprojectの読み込みに失敗:', err);
        projectDataEl.textContent = `エラー: ${err.message}`;
    }
}

// --- XML解析処理 ---
function parseProjectXml(xmlString) {
    // 1. ブラウザのDOMParserでXML文字列を解析
    const parser = new DOMParser();
    projectXmlDoc = parser.parseFromString(xmlString, 'application/xml');
    console.log('XMLの解析に成功:', projectXmlDoc);

    // 2. トラック情報を抽出（これは Project.java や Track.java の構造を模倣）
    // querySelectorAll は、Javaライブラリの @XmlElementRef に相当する操作です
    const tracks = projectXmlDoc.querySelectorAll('Structure > Track');
    
    let info = `プロジェクトの読み込み完了！\n`;
    info += `トラック数: ${tracks.length}\n\n`;

    tracks.forEach((track, index) => {
        const trackName = track.getAttribute('name');
        info += `  Track ${index + 1}: ${trackName}\n`;
        
        // 3. 各トラックのオーディオクリップを探す
        //    (Clips.java, Clip.java, Audio.java, FileReference.java の構造)
        const clips = track.querySelectorAll('Lanes > Clips > Clip');
        clips.forEach((clip, cIndex) => {
            const clipName = clip.getAttribute('name') || '(クリップ名なし)';
            const clipTime = clip.getAttribute('time'); // 開始時間
            const audioFileEl = clip.querySelector('Warps > Audio > File, Audio > File'); // AudioまたはWarps配下のFileを探す
            
            if (audioFileEl) {
                const filePath = audioFileEl.getAttribute('path');
                info += `    - Audio Clip ${cIndex + 1}: ${clipName} (at ${clipTime} beats)\n`;
                info += `      > File: ${filePath}\n`;
            }
        });
    });

    projectDataEl.textContent = info;
    playButton.disabled = false; // 解析が成功したら再生ボタンを有効化
}

// --- 再生処理 ---
playButton.addEventListener('click', () => {
    if (!dawProjectZip || !projectXmlDoc || audioContext.state === 'running') {
        // 動作中なら停止（トグル）
        audioContext.suspend();
        playButton.textContent = "再生";
        return;
    }
    
    if (audioContext.state === 'suspended') {
        audioContext.resume();
        playButton.textContent = "停止";
        return;
    }
    
    playButton.textContent = "停止";
    playProject();
});

async function playProject() {
    console.log('再生処理を開始...');

    // 1. 全てのオーディオクリップ情報をXMLから取得
    const audioClips = projectXmlDoc.querySelectorAll('Clips > Clip');
    const promises = [];

    // 2. テンポを取得（Transport.java の構造）
    //    簡単のため、ここではテンポ=120BPM (1拍=0.5秒) と仮定します
    const tempo = 120.0;
    const secondsPerBeat = 60.0 / tempo;

    audioClips.forEach(clip => {
        const audioFileEl = clip.querySelector('Warps > Audio > File, Audio > File');
        if (!audioFileEl) return;

        // 3. 再生スケジュールのプロミスを作成
        const promise = (async () => {
            const filePath = audioFileEl.getAttribute('path');
            const clipTimeBeats = parseFloat(clip.getAttribute('time') || 0);
            
            // 4. ZIPからオーディオファイル(例: "audio/drumloop.wav")を取得
            const audioFile = dawProjectZip.file(filePath);
            if (!audioFile) {
                console.warn(`${filePath} がZIP内に見つかりません。`);
                return;
            }
            const audioArrayBuffer = await audioFile.async('arraybuffer');
            
            // 5. Web Audio API でデコード
            const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);

            // 6. オーディオソースノードを作成
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            // 7. 再生タイミングをスケジュール
            const startTimeSeconds = clipTimeBeats * secondsPerBeat;
            source.start(audioContext.currentTime + startTimeSeconds);
            
            console.log(`SCHEDULED: ${filePath} at ${startTimeSeconds.toFixed(2)}s`);
        })();
        
        promises.push(promise);
    });

    // 全てのオーディオデコードとスケジュールが終わるのを待つ
    await Promise.all(promises);
    console.log('全てのクリップの再生準備が完了しました。');
}