const http = require('http');
const fs = require('fs');
const url = 'http://localhost:3026/axe_max.html';

function printLogs(){
  console.log('\n--- server-local.log ---');
  try {
    if (fs.existsSync('server-local.log')) console.log(fs.readFileSync('server-local.log', 'utf8'));
    else console.log('<missing>');
  } catch (e) { console.log('LOG_READ_ERR', e.message); }

  console.log('\n--- server.err.log ---');
  try {
    if (fs.existsSync('server.err.log')) console.log(fs.readFileSync('server.err.log', 'utf8'));
    else console.log('<missing>');
  } catch (e) { console.log('LOG_READ_ERR', e.message); }
}

http.get(url, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('FETCH_STATUS', res.statusCode);
    console.log('FETCH_BODY_PREVIEW');
    console.log(d.slice(0,400));
    printLogs();
  });
}).on('error', e => {
  console.error('FETCH_ERR', e.message);
  printLogs();
});
