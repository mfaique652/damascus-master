const http = require('http');
const fs = require('fs');
const port = process.argv[2] || '3026';
const url = `http://localhost:${port}/axe_max.html`;

function printLogs(){
  console.log('\n--- server-local.log ---');
  try { console.log(fs.existsSync('server-local.log') ? fs.readFileSync('server-local.log','utf8') : '<missing>'); } catch(e){ console.log('ERR', e.message) }
  console.log('\n--- server.err.log ---');
  try { console.log(fs.existsSync('server.err.log') ? fs.readFileSync('server.err.log','utf8') : '<missing>'); } catch(e){ console.log('ERR', e.message) }
}

http.get(url, res => {
  let d='';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('FETCH_STATUS', res.statusCode);
    console.log('BODY_PREVIEW');
    console.log(d.slice(0,300));
    printLogs();
  });
}).on('error', e => { console.error('FETCH_ERR', e.message); printLogs(); });
