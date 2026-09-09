const vttContent = `WEBVTT

00:00:00.100 --> 00:00:02.500
Hello world`;

function shiftVtt(vttContent, offsetSeconds) {
  return vttContent.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, (match, h, m, s, ms) => {
    let totalSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
    totalSeconds += offsetSeconds;
    
    const newH = Math.floor(totalSeconds / 3600);
    const newM = Math.floor((totalSeconds % 3600) / 60);
    const newS = Math.floor(totalSeconds % 60);
    const newMs = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
    
    return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}:${newS.toString().padStart(2, '0')}.${newMs.toString().padStart(3, '0')}`;
  });
}
console.log(shiftVtt(vttContent, 10.5));
