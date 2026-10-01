// Real-data browser smoke. Screenshots remain in ignored artifacts/ (health data).
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const root=fileURLToPath(new URL('../',import.meta.url));
const env=Object.fromEntries((await readFile(root+'.env','utf8')).split('\n').filter(x=>x.includes('=')&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^["']|["']$/g,'')]}));
const url=env.BOX_URL;
await mkdir(root+'artifacts',{recursive:true,mode:0o700});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(url,{waitUntil:'networkidle'});
 const password=page.locator('input[type=password]');
 await password.fill(env.APP_PASSWORD);
 await page.locator('form button[type=submit]').click();
 await page.waitForURL(url+'/',{timeout:20000});
 await password.waitFor({state:'hidden',timeout:20000});
 for(const route of ['/','/calendar','/insights','/coach']){
  await page.goto(url+route,{waitUntil:'networkidle'});
  await page.locator('h1').waitFor();
  await page.screenshot({path:root+'artifacts/'+(route==='/'?'overview':route.slice(1))+'.png',fullPage:true});
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  console.log(route, 'axe violations:',JSON.stringify(results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))));
  if(results.violations.length)errors.push('Accessibility '+route+': '+results.violations.map(v=>v.id).join(', '));
  console.log(route,'charts:',await page.locator('.recharts-wrapper').count());
 }
 for(const width of [320,768,1440]){
  await page.setViewportSize({width,height:1000});
  await page.goto(url+'/insights',{waitUntil:'networkidle'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  console.log('Viewport',width,'body overflow:',overflow);
  await page.screenshot({path:root+`artifacts/insights-${width}.png`,fullPage:true});
  if(overflow)errors.push('Body overflow at '+width);
 }
 console.log('Browser errors:',JSON.stringify(errors));
 if(errors.length)process.exitCode=1;
} finally {await browser.close();}
