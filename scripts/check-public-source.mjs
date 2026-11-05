import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const secretValues=existsSync('.env')?readFileSync('.env','utf8').split(/\r?\n/).map(line=>/^([A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Z0-9_]*)=(.*)$/.exec(line)).filter(Boolean).map(m=>({name:m[1],value:m[2].trim().replace(/^["']|["']$/g,'')})).filter(x=>x.value.length>=8):[];
const problems=[];
for(const file of files){
  if(/(^|\/)\.env($|\.)/.test(file)&&!file.endsWith('.env.example'))problems.push(`${file}: credential file`);
  if(/^(data|logs)\//.test(file))problems.push(`${file}: runtime data`);
  if(/\.(?:mp3|png|woff2)$/i.test(file))continue;
  const content=readFileSync(file,'utf8');
  for(const secret of secretValues)if(content.includes(secret.value))problems.push(`${file}: contains configured ${secret.name}`);
  if(/\b(?:AIza[\w-]{30,}|gh[pousr]_[\w]{30,})\b/.test(content))problems.push(`${file}: token-shaped string`);
}
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log(`Public source audit passed: ${files.length} files; no runtime data or configured secrets.`);
