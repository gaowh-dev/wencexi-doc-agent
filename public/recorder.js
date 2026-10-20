/* ============================================================
 * 文策析 · 录音纪要模块
 * 纯浏览器原生能力，零第三方依赖：
 *   - 录音：getUserMedia + MediaRecorder（音频仅在本机处理，可本地保存）
 *   - 转写：浏览器内置 Web Speech API（webkitSpeechRecognition，中文）
 *           该能力由浏览器/系统提供，Chrome/Edge 下可能经浏览器厂商服务处理，
 *           因此做成用户可勾选的可选项，并在界面明确提示；不勾选则仅本地录音。
 *   - 纪要：转写文本交给本地中文分析引擎（ZhiBanTong.processAll）生成纪要/待办/计划。
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var rec = {
    stream: null,
    mediaRecorder: null,
    chunks: [],
    audioBlob: null,
    audioUrl: null,
    recognition: null,
    finalText: '',        // 已确认的转写文本
    baseFinalLen: 0,      // 本次录音开始时已确认文本长度（用于分段）
    recognizing: false,
    wantRecognition: false,
    recording: false,
    timer: null,
    seconds: 0,
    mimeType: ''
  };

  function toast(msg, ms) {
    var el = $('toast');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 2400);
  }

  function download(filename, blobOrText, mime) {
    var blob = (blobOrText instanceof Blob) ? blobOrText : new Blob([blobOrText], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDuration(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad(m) + ':' + pad(s);
  }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 40);
  }

  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function recorderSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  /* ---------------- 计时 ---------------- */
  function startTimer() {
    rec.seconds = 0;
    $('recTime').textContent = fmtDuration(0);
    rec.timer = setInterval(function () {
      rec.seconds++;
      $('recTime').textContent = fmtDuration(rec.seconds);
    }, 1000);
  }
  function stopTimer() {
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
  }

  /* ---------------- 语音识别 ---------------- */
  function createRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var r = new SR();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          rec.finalText += t;
        } else {
          interim += t;
        }
      }
      renderTranscript(interim);
    };
    r.onerror = function (ev) {
      var map = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试',
        'service-not-allowed': '当前浏览器不允许使用语音识别服务',
        'network': '语音识别需要联网（浏览器内置服务），网络异常，已保留本地录音',
        'audio-capture': '未检测到可用麦克风设备',
        'no-speech': '未检测到语音'
      };
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
        rec.wantRecognition = false;
        setRecStatus('实时转写已停止：' + (map[ev.error] || ev.error), true);
      } else {
        setRecStatus(map[ev.error] || ('语音识别提示：' + ev.error), false);
      }
    };
    r.onend = function () {
      // 录音仍在进行且用户需要转写时，浏览器可能因静音自动结束，这里自动续接
      if (rec.recording && rec.wantRecognition) {
        try { r.start(); } catch (e) { /* 忽略重复启动 */ }
      } else {
        rec.recognizing = false;
      }
    };
    return r;
  }

  function startRecognition() {
    if (!rec.wantRecognition) return;
    if (!rec.recognition) rec.recognition = createRecognition();
    if (!rec.recognition) { setRecStatus('当前浏览器不支持实时转写，请使用 Edge/Chrome 或手动整理', true); return; }
    try {
      rec.recognition.start();
      rec.recognizing = true;
      setRecStatus('正在录音并实时转写…', false);
    } catch (e) { /* 已在识别中 */ }
  }
  function stopRecognition() {
    if (rec.recognition && rec.recognizing) {
      rec.wantRecognition = false;
      try { rec.recognition.stop(); } catch (e) { /* 忽略 */ }
    }
  }

  function setRecStatus(text, isWarn) {
    var el = $('recStatus');
    el.textContent = text;
    el.className = 'rec-status' + (isWarn ? ' warn' : '');
  }

  function renderTranscript(interim) {
    var ta = $('recTranscript');
    var base = rec.finalText;
    ta.value = base + (interim ? '（' + interim + '…）' : '');
    updateTranscriptCount();
  }

  function updateTranscriptCount() {
    var n = $('recTranscript').value.replace(/\s/g, '').length;
    $('recWordCount').textContent = n + ' 字';
  }

  /* ---------------- 录音 ---------------- */
  async function startRecording() {
    if (!recorderSupported()) {
      toast('当前浏览器不支持录音，请改用 Edge/Chrome，或直接粘贴会议文字');
      return;
    }
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('无法访问麦克风：' + (e.message || '权限被拒绝') + '。可直接粘贴会议文字生成纪要');
      return;
    }

    // 选择浏览器支持的录音格式
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    rec.mimeType = '';
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder.isTypeSupported(candidates[i])) { rec.mimeType = candidates[i]; break; }
    }

    rec.chunks = [];
    try {
      rec.mediaRecorder = rec.mimeType ? new MediaRecorder(rec.stream, { mimeType: rec.mimeType }) : new MediaRecorder(rec.stream);
    } catch (e) {
      toast('录音初始化失败：' + e.message);
      rec.stream.getTracks().forEach(function (t) { t.stop(); });
      return;
    }

    rec.mediaRecorder.ondataavailable = function (ev) {
      if (ev.data && ev.data.size > 0) rec.chunks.push(ev.data);
    };
    rec.mediaRecorder.onstop = function () {
      rec.audioBlob = new Blob(rec.chunks, { type: rec.mimeType || 'audio/webm' });
      if (rec.audioUrl) URL.revokeObjectURL(rec.audioUrl);
      rec.audioUrl = URL.createObjectURL(rec.audioBlob);
      $('recAudio').src = rec.audioUrl;
      $('recAudio').hidden = false;
      $('btnDownloadAudio').disabled = false;
    };

    // 记录本次录音起点（保留上一段已转写文本，支持多次录音追加）
    rec.baseFinalLen = rec.finalText.length;
    rec.mediaRecorder.start(250);
    rec.recording = true;
    startTimer();

    // 实时转写（可选）
    rec.wantRecognition = $('recEnableSTT').checked;
    if (rec.wantRecognition) startRecognition();
    else setRecStatus('正在录音（未开启实时转写，结束后可手动整理）', false);

    updateRecordUI(true);
  }

  function stopRecording() {
    if (!rec.recording) return;
    rec.recording = false;
    if (rec.mediaRecorder && rec.mediaRecorder.state !== 'inactive') {
      try { rec.mediaRecorder.stop(); } catch (e) { /* 忽略 */ }
    }
    if (rec.stream) rec.stream.getTracks().forEach(function (t) { t.stop(); });
    stopRecognition();
    stopTimer();
    // 去掉临时的“（…）”提示
    $('recTranscript').value = rec.finalText;
    updateTranscriptCount();
    setRecStatus('录音已结束，可在下方核对/编辑转写文本，然后生成会议纪要', false);
    updateRecordUI(false);
    if (!rec.finalText) {
      toast('录音已保存；若未开启实时转写，可手动整理或粘贴文字');
    }
  }

  function updateRecordUI(isRecording) {
    var btn = $('btnRecord');
    btn.classList.toggle('recording', isRecording);
    btn.innerHTML = isRecording ? '<span class="rec-dot"></span> 停止录音' : '🎤 开始录音';
    $('recEnableSTT').disabled = isRecording;
    $('recIndicator').className = 'rec-indicator' + (isRecording ? ' live' : '');
    $('recTime').className = 'rec-time' + (isRecording ? ' live' : '');
  }

  /* ---------------- 生成纪要（送入工作台本地引擎） ---------------- */
  function generateMinutes() {
    var text = $('recTranscript').value.replace(/（[^（）]*…）/g, '').trim();
    if (!text) { toast('转写内容为空，请先录音或粘贴会议文字'); return; }

    // 自动补一个会议标题结构，帮助引擎识别“会议纪要”体裁
    var topic = $('recTopic').value.trim();
    var title = topic ? (topic + '·会议纪要') : '录音会议纪要';
    var header = '会议录音转写纪要：' + (topic || '未命名会议') + '\n';
    header += '记录时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
    var full = header + text;

    // 填入工作台
    $('docTitle').value = title;
    $('inputText').value = full;
    $('inputText').dispatchEvent(new Event('input', { bubbles: true }));

    // 切换到工作台并触发一键分析
    document.querySelector('.nav-btn[data-view="workbench"]').click();
    setTimeout(function () { $('btnAnalyze').click(); }, 60);
    toast('纪要已生成，可在右侧查看待办、计划与报告');
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    // 能力探测与提示
    if (!recorderSupported()) {
      $('btnRecord').disabled = true;
      $('recUnsupported').hidden = false;
      $('recUnsupported').textContent = '当前浏览器不支持网页录音。你仍可在下方文本框粘贴会议文字，直接生成纪要。';
    }
    if (!speechSupported()) {
      var cb = $('recEnableSTT');
      cb.checked = false;
      cb.disabled = true;
      $('stthint').textContent = '当前浏览器不支持实时语音转写（推荐 Edge / Chrome）；可仅录音后手动整理。';
    }

    $('btnRecord').addEventListener('click', function () {
      if (rec.recording) stopRecording();
      else startRecording();
    });

    $('recTranscript').addEventListener('input', function () {
      // 用户手动编辑后，以文本框内容为准同步 finalText
      rec.finalText = this.value;
      updateTranscriptCount();
    });

    $('btnGenMinutes').addEventListener('click', generateMinutes);

    $('btnClearRec').addEventListener('click', function () {
      if (!confirm('确定清空当前录音与转写文本吗？（不会删除已下载文件）')) return;
      rec.finalText = '';
      $('recTranscript').value = '';
      $('recTopic').value = '';
      updateTranscriptCount();
      if (rec.audioUrl) { URL.revokeObjectURL(rec.audioUrl); rec.audioUrl = null; }
      rec.audioBlob = null;
      $('recAudio').hidden = true;
      $('recAudio').src = '';
      $('btnDownloadAudio').disabled = true;
      setRecStatus('已重置', false);
      toast('已清空');
    });

    $('btnDownloadAudio').addEventListener('click', function () {
      if (!rec.audioBlob) { toast('暂无录音文件'); return; }
      var ext = (rec.mimeType || '').indexOf('mp4') >= 0 ? 'm4a' : 'webm';
      download(safeName($('recTopic').value) + '_录音_' + stamp() + '.' + ext, rec.audioBlob);
      toast('录音已下载');
    });

    $('btnDownloadText').addEventListener('click', function () {
      var t = $('recTranscript').value.trim();
      if (!t) { toast('暂无转写文本'); return; }
      download(safeName($('recTopic').value) + '_转写_' + stamp() + '.txt', t, 'text/plain');
      toast('转写文本已下载');
    });

    $('btnCopyText').addEventListener('click', function () {
      var t = $('recTranscript').value.trim();
      if (!t) { toast('暂无转写文本'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { toast('已复制到剪贴板'); }, function () { fallbackCopy(t); });
      } else fallbackCopy(t);
    });

    function fallbackCopy(t) {
      var ta = $('recTranscript');
      ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请手动选择复制'); }
    }

    updateTranscriptCount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
