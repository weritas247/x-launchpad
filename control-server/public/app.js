const powerBtn = document.getElementById('power-btn');
const statusMsg = document.getElementById('status-msg');
const infoStatus = document.getElementById('info-status');

let serverRunning = false;
let serverStarting = false;
let stopping = false;
let ws = null;

function connectWS() {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProto}//${location.host}/ws`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      serverRunning = msg.running;
      serverStarting = msg.starting;
      if (msg.running) {
        infoStatus.textContent = '실행 중';
        powerBtn.classList.add('running');
        powerBtn.classList.remove('starting');
        powerBtn.title = '서버 중지';
      } else if (msg.starting) {
        infoStatus.textContent = '시작 중...';
        powerBtn.classList.add('starting');
        powerBtn.classList.remove('running');
        powerBtn.title = '시작 중...';
      } else {
        infoStatus.textContent = '꺼짐';
        powerBtn.classList.remove('running', 'starting');
        powerBtn.title = '서버 시작';
      }
      if (msg.exitCode !== null && msg.exitCode !== undefined) {
        document.getElementById('info-last-exit').textContent =
          msg.exitCode === 0 ? '정상 종료' : `종료 코드: ${msg.exitCode}`;
      }
    }
    if (msg.type === 'started') {
      statusMsg.textContent = '서버 시작 완료! 리다이렉트 중...';
      statusMsg.className = 'status-msg';
      stopping = true;
      setTimeout(() => location.reload(), 1000);
    }
    if (msg.type === 'start_failed') {
      statusMsg.textContent = `시작 실패: ${msg.reason}`;
      statusMsg.className = 'status-msg error';
      powerBtn.classList.remove('starting');
    }
  };
  ws.onclose = () => { if (!stopping) setTimeout(connectWS, 3000); };
  ws.onerror = () => ws.close();
}
connectWS();

powerBtn.addEventListener('click', async () => {
  if (serverRunning) {
    // Stop
    powerBtn.classList.add('starting');
    statusMsg.textContent = '서버 중지 중...';
    statusMsg.className = 'status-msg';
    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Stop failed');
      }
      statusMsg.textContent = '서버가 중지되었습니다';
    } catch (err) {
      statusMsg.textContent = `오류: ${err.message}`;
      statusMsg.className = 'status-msg error';
      powerBtn.classList.remove('starting');
    }
  } else if (!serverStarting) {
    // Start
    powerBtn.classList.add('starting');
    statusMsg.textContent = '서버 시작 중...';
    statusMsg.className = 'status-msg';
    try {
      const res = await fetch('/api/start', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Start failed');
      }
    } catch (err) {
      statusMsg.textContent = `오류: ${err.message}`;
      statusMsg.className = 'status-msg error';
      powerBtn.classList.remove('starting');
    }
  }
});
