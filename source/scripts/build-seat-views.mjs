import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
const result = await build({entryPoints:[fileURLToPath(new URL('experiments/seat-views.js',root))],bundle:true,write:false,format:'iife',target:'es2020',minify:true});
const [template,css] = await Promise.all(['experiments/seat-views.html','experiments/seat-views.css'].map(p=>readFile(new URL(p,root),'utf8')));
await writeFile(new URL('public/seat-views.html',root),template.replace('/* INLINE_CSS */',()=>css).replace('/* INLINE_JS */',()=>result.outputFiles[0].text));
console.log('Built public/seat-views.html — standalone, offline, read-only.');
