import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { openLocalStore } from './local-store.mjs';
import { preparePdfAssets } from './pdf-assets.mjs';
import { readPreviewRequest } from './preview-api.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../..');
await preparePdfAssets();
const store=await openLocalStore(process.env.SALES_LOCAL_DIR || resolve(repo,'.local/sales-materials'));
const server=await createServer({ root:resolve(here,'preview'),configFile:false,cacheDir:resolve(repo,'.local/sales-materials/vite'),
  publicDir:resolve(repo,'public'),server:{host:'127.0.0.1',port:4177,strictPort:true,fs:{allow:[repo]},cors:false},
  resolve:{alias:[{find:'@',replacement:repo},{find:'react-dom/client',replacement:repo+'/node_modules/react-dom/client.js'},
    {find:'react/jsx-dev-runtime',replacement:repo+'/node_modules/react/jsx-dev-runtime.js'},{find:'react/jsx-runtime',replacement:repo+'/node_modules/react/jsx-runtime.js'},
    {find:'react-dom',replacement:repo+'/node_modules/react-dom/index.js'},{find:'react',replacement:repo+'/node_modules/react/index.js'}]},
  css:{postcss:{plugins:[tailwind({base:repo})]}},esbuild:{jsx:'automatic'},
  plugins:[{name:'local-sales-database',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if (!req.url?.startsWith('/api/local/')) return next();
    // Local-only read server; reject cross-origin browser requests.
    if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:4177') {res.statusCode=403;res.end();return;}
    try {
      if (req.url === '/api/local/map') {
        const [footprints,base] = await Promise.all([readFile(resolve(repo,'public/data/building_footprints.geojson'),'utf8'),readFile(resolve(repo,'public/data/beijing_map_data.json'),'utf8')]);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({footprints:JSON.parse(footprints),subways:JSON.parse(base).subways}));return;
      }
      const response=await readPreviewRequest(store,new Request(`http://127.0.0.1:4177${req.url}`,{method:req.method}));
      res.statusCode=response.status;
      response.headers.forEach((value,key)=>res.setHeader(key,value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error){ console.error('本地资料读取失败',error.message);res.statusCode=500;res.end(); }
  });}}] });
await server.listen();
console.log('本地地图：http://127.0.0.1:4177/');
const stop=async()=>{await server.close();store.close();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
