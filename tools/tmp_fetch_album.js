const http = require('http');
const url = 'http://localhost:3026/hand_forged_damascus_steel_5_pcs_rosewood_handle_chef_knife_set.html';
http.get(url, res => {
  let b = '';
  res.on('data', c => b += c.toString());
  res.on('end', () => {
    const lines = b.split('\n');
    for (let i=0;i<lines.length;i++){
      if (lines[i].includes('<div id="unitPrice"') || lines[i].includes("<div id='unitPrice'") ){
        console.log(lines.slice(Math.max(0,i-2), i+8).join('\n'));
        return;
      }
    }
    console.log('unitPrice not found');
  });
}).on('error', e => { console.error('err', e.message); process.exit(2); });
