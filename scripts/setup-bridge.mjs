import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../runtime/integration/',import.meta.url));
const file = directory + '/key';
mkdirSync(directory,{recursive:true});
if (!existsSync(file)) writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
if (!/^[a-f0-9]{64}$/.test(readFileSync(file,'utf8'))) throw new Error('Archivo de integración inválido');
console.log('Canal local de integración configurado.');
