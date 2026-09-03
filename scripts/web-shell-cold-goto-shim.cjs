'use strict';
const playwright=require('playwright-core');
const originalLaunch=playwright.chromium.launch.bind(playwright.chromium);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const SELECTOR_TIMEOUT_FLOOR_MS=35000;
const NAV_TIMEOUT_FLOOR_MS=45000;
const EVALUATE_TIMEOUT_MS=25000;
function navOptions(options={}){
  const requested=Number(options?.timeout||0);
  return {...options,waitUntil:'commit',timeout:Math.max(requested,NAV_TIMEOUT_FLOOR_MS)};
}
function safeUrl(value){
  try{const u=new URL(String(value||''));return u.origin+u.pathname;}catch{return String(value||'').split('?')[0].slice(0,240);}
}
async function withDeadline(run,label,ms,extra=''){
  let timer;
  const started=Date.now();
  console.log('WEB_SHELL_STAGE=BEGIN label='+label+' timeout_ms='+ms+(extra?' '+extra:''));
  try{
    const result=await Promise.race([
      Promise.resolve().then(run),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+'_DEADLINE_'+ms+'MS')),ms)}),
    ]);
    console.log('WEB_SHELL_STAGE=PASS label='+label+' elapsed_ms='+(Date.now()-started));
    return result;
  }catch(error){
    console.error('WEB_SHELL_STAGE=FAIL label='+label+' elapsed_ms='+(Date.now()-started)+' error='+String(error?.message||error).slice(0,260));
    throw error;
  }finally{clearTimeout(timer);}
}
async function withNavigationRetry(run,label,extra=''){
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    try{return await withDeadline(run,label+'#'+attempt,NAV_TIMEOUT_FLOOR_MS+3000,extra);}
    catch(error){
      last=error;
      const message=String(error?.message||error);
      const retryable=/Timeout|DEADLINE|net::ERR|Navigation|Target page, context or browser has been closed/i.test(message);
      if(!retryable||attempt===3)throw error;
      console.warn('WEB_SHELL_NAV_RETRY label='+label+' attempt='+attempt+' error='+message.slice(0,240));
      await sleep(800*attempt);
    }
  }
  throw last;
}
playwright.chromium.launch=async(...args)=>{
  const browser=await originalLaunch(...args);
  const originalNewContext=browser.newContext.bind(browser);
  browser.newContext=async(...ctxArgs)=>{
    const context=await originalNewContext(...ctxArgs);
    const originalNewPage=context.newPage.bind(context);
    context.newPage=async(...pageArgs)=>{
      const page=await originalNewPage(...pageArgs);
      const originalGoto=page.goto.bind(page);
      const originalReload=page.reload.bind(page);
      const originalEvaluate=page.evaluate.bind(page);
      const originalSetDefaultTimeout=page.setDefaultTimeout.bind(page);
      const originalSetDefaultNavigationTimeout=page.setDefaultNavigationTimeout.bind(page);
      const originalWaitForSelector=page.waitForSelector.bind(page);
      const failures=[];
      let stageSeq=0;
      const next=(op)=>op+'@'+(++stageSeq);
      page.on('requestfailed',request=>{
        failures.push('requestfailed '+safeUrl(request.url())+' '+String(request.failure()?.errorText||'').slice(0,160));
        if(failures.length>12)failures.shift();
      });
      page.on('response',response=>{
        if(response.status()<400)return;
        failures.push('http '+response.status()+' '+safeUrl(response.url()));
        if(failures.length>12)failures.shift();
      });
      page.setDefaultTimeout=(timeout)=>originalSetDefaultTimeout(Math.max(Number(timeout||0),SELECTOR_TIMEOUT_FLOOR_MS));
      page.setDefaultNavigationTimeout=(timeout)=>originalSetDefaultNavigationTimeout(Math.max(Number(timeout||0),NAV_TIMEOUT_FLOOR_MS));
      page.evaluate=(pageFunction,arg)=>{
        const label=next('evaluate');
        return withDeadline(()=>originalEvaluate(pageFunction,arg),label,EVALUATE_TIMEOUT_MS,'url='+safeUrl(page.url())).catch(error=>{
          console.error('WEB_SHELL_EVALUATE_DIAG label='+label+' url='+safeUrl(page.url())+' network='+JSON.stringify(failures));
          throw error;
        });
      };
      page.waitForSelector=async(selector,options={})=>{
        const label=next('waitForSelector');
        try{return await withDeadline(()=>originalWaitForSelector(selector,{...options,timeout:Math.max(Number(options?.timeout||0),SELECTOR_TIMEOUT_FLOOR_MS)}),label,SELECTOR_TIMEOUT_FLOOR_MS+3000,'selector='+String(selector).slice(0,100)+' url='+safeUrl(page.url()));}
        catch(error){
          const diag=await page.evaluate(()=>({
            readyState:document.readyState,
            href:location.origin+location.pathname+location.hash,
            title:document.title,
            hasShell:Boolean(document.querySelector('.app-shell')),
            hasLogin:Boolean(document.querySelector('#loginForm')),
            loginMessage:(document.querySelector('#loginMessage')?.textContent||'').trim().slice(0,300),
            bodyText:(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,500),
          })).catch(e=>({diagnosticError:String(e?.message||e).slice(0,240)}));
          console.error('WEB_SHELL_SELECTOR_DIAG selector='+String(selector).slice(0,120)+' state='+JSON.stringify(diag)+' network='+JSON.stringify(failures));
          throw error;
        }
      };
      page.goto=(inputUrl,options)=>{
        let url=inputUrl;
        if(typeof url==='string'&&url.includes('/#/')){
          const pos=url.indexOf('#');
          const base=url.slice(0,pos);
          const hash=url.slice(pos);
          const sep=base.includes('?')?'&':'?';
          url=base+sep+'shell_cold='+Date.now()+hash;
        }
        return withNavigationRetry(()=>originalGoto(url,navOptions(options)),next('goto'),'url='+safeUrl(url));
      };
      page.reload=(options)=>withNavigationRetry(()=>originalReload(navOptions(options)),next('reload'),'url='+safeUrl(page.url()));
      return page;
    };
    return context;
  };
  return browser;
};
