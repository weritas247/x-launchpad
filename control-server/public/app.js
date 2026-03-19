const powerBtn = document.getElementById('power-btn');
const statusMsg = document.getElementById('status-msg');
const infoStatus = document.getElementById('info-status');

let ws = null;
function connectWS() {
  ws = new WebSocket('ws://127.0.0.1:3001/ws');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      if (msg.running) {
        infoStatus.textContent = '실행 중';
      } else if (msg.starting) {
        infoStatus.textContent = '시작 중...';
      } else {
        infoStatus.textContent = '꺼짐';
      }
      if (msg.exitCode !== null && msg.exitCode !== undefined) {
        document.getElementById('info-last-exit').textContent =
          msg.exitCode === 0 ? '정상 종료' : `종료 코드: ${msg.exitCode}`;
      }
    }
    if (msg.type === 'started') {
      statusMsg.textContent = '서버 시작 완료! 리다이렉트 중...';
      statusMsg.className = 'status-msg';
      setTimeout(() => location.reload(), 500);
    }
    if (msg.type === 'start_failed') {
      statusMsg.textContent = `시작 실패: ${msg.reason}`;
      statusMsg.className = 'status-msg error';
      powerBtn.classList.remove('starting');
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}
connectWS();

powerBtn.addEventListener('click', async () => {
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
});
