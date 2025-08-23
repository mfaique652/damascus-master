const http = require('http');
function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
  const opts = { hostname: 'localhost', port: 3026, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = http.request(opts, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    console.log('Send with wrong password');
    console.log(await postJson('/api/auth/2fa/send-code', { email: 'faiqsajjad652@gmail.com', password: 'wrongpass' }));
    console.log('\nSend with correct password');
    console.log(await postJson('/api/auth/2fa/send-code', { email: 'faiqsajjad652@gmail.com', password: 'faiq1032' }));
  } catch (e) { console.error('Err', e); process.exit(2); }
})();
